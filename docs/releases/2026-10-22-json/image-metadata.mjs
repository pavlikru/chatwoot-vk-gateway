import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
const sha256 = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else sha256[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
walk('dist');
sha256['package-lock.json'] = createHash('sha256')
  .update(readFileSync('package-lock.json'))
  .digest('hex');
assert.deepEqual(readdirSync('.').sort(), [
  'dist',
  'node_modules',
  'package-lock.json',
  'package.json',
]);
assert.equal(existsSync('node_modules/vitest'), false);
assert.equal(existsSync('node_modules/typescript'), false);
const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
const installed = {};
for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)]) {
  const version = JSON.parse(readFileSync(`node_modules/${name}/package.json`)).version;
  assert.equal(version, lock.packages[`node_modules/${name}`].version);
  installed[name] = version;
}
process.stdout.write(
  JSON.stringify({
    node: process.version,
    npm: JSON.parse(readFileSync('/usr/local/lib/node_modules/npm/package.json')).version,
    platform: `${process.platform}/${process.arch}`,
    installed,
    sha256,
    filesystemAllowlist: true,
    devDependenciesAbsent: true,
  }) + '\n',
);
