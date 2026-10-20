import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const index = process.argv.indexOf('--package-root')
assert.ok(index >= 0 && process.argv[index + 1], 'A normal owner package root is required')
const root = resolve(process.argv[index + 1])
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const full = manifest.name === '@file-viewer/svelte-full'
assert.ok(full || manifest.name === '@file-viewer/svelte', 'Unexpected Svelte owner package')
assert.equal(manifest.peerDependencies.svelte, '>=3.59 <6')
// Resolve esbuild from the owner package so the builder also works when it is copied
// outside the workspace root (public CI ships it under .github/scripts). The resolved
// path is a native absolute path, which only the file: URL scheme can import on Windows.
const { build } = await import(
  pathToFileURL(createRequire(join(root, 'package.json')).resolve('esbuild')).href
)
const runtimeHelper = fileURLToPath(new URL('./lib/svelte-runtime-component.mjs', import.meta.url))
const controller = full ? '@file-viewer/svelte/controller' : '@file-viewer/core/browser'
const fullImports = full
  ? `
import allRenderers, { getDefaultFullAssetBaseUrl, mergeFullAssetOptions } from '@file-viewer/preset-all';
export { getDefaultFullAssetBaseUrl, resetDefaultFullAssetBaseUrl, setDefaultFullAssetBaseUrl } from '@file-viewer/preset-all';
function transformOptions(value = {}) {
  const { preset = allRenderers, rendererMode = 'replace', ...rest } = value;
  return { ...mergeFullAssetOptions(rest, getDefaultFullAssetBaseUrl()), preset, rendererMode, autoRenderers: rest.autoRenderers ?? true };
}
function transformMountOptions(value = {}) { return { ...value, options: transformOptions(value.options) }; }
`
  : ''
await mkdir(join(root, 'dist'), { recursive: true })
const receipts = []
for (const target of ['client', 'server']) {
  const functionName =
    target === 'client' ? 'createRuntimeComponent' : 'createServerRuntimeComponent'
  const contents = `${fullImports}
import { ${functionName} } from ${JSON.stringify(runtimeHelper)};
${
  target === 'client'
    ? `
import { createViewerControllerHandle, mountViewer, fileViewerCoreRendererRegistry } from '${controller}';
export default createRuntimeComponent({ createHandle: createViewerControllerHandle, mountViewer,
  coreOptions: { registry: fileViewerCoreRendererRegistry }${full ? ', transformOptions, transformMountOptions' : ''} });
`
    : 'export default createServerRuntimeComponent();'
}
`
  const result = await build({
    stdin: { contents, resolveDir: root, sourcefile: 'FileViewer.runtime.mjs' },
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: target === 'client' ? 'browser' : 'node',
    target: 'es2019',
    packages: 'external',
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    logLevel: 'silent'
  })
  assert.equal(result.outputFiles.length, 1)
  const bytes = result.outputFiles[0].contents
  assert.ok(
    !bytes.includes(Buffer.from('/Users/')) && !bytes.includes(Buffer.from('sourceMappingURL'))
  )
  const path = `dist/FileViewer.${target}.js`
  await writeFile(join(root, path), bytes)
  receipts.push({
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    externalPeerRuntime: true,
    inputGraph: Object.keys(result.metafile.inputs)
  })
}
// Private build evidence lives outside dist so normal npm packing cannot include
// owner maintenance paths. Public files are the generated JS and declarations.
await mkdir(join(root, '.build'), { recursive: true })
await writeFile(
  join(root, '.build', 'svelte-runtime-build.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      packageName: manifest.name,
      version: manifest.version,
      normalOwnerBuild: true,
      componentPeerRange: manifest.peerDependencies.svelte,
      embeddedSvelteRuntime: false,
      receipts
    },
    null,
    2
  )}\n`
)
console.log(`${manifest.name}: generated client/server runtime entries with external Svelte peer`)
