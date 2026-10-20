import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('single-bin carrier delegates arguments to the exact CLI dependency', async () => {
  // A file URL's pathname keeps the leading slash before a Windows drive letter.
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.bin, { 'file-viewer-cli': './dist/cli.js' })
  assert.equal(manifest.dependencies['@file-viewer/cli'], `workspace:${manifest.version}`)
  const help = spawnSync(process.execPath, [cli, '--help', '--lang', 'en'], {
    encoding: 'utf8',
    shell: false
  })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /file-viewer <create\|add>/)
})
