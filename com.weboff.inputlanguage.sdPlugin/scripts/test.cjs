'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.cjs'))
  .sort()
  .map(name => path.join(root, 'tests', name));
if (!files.length) {
  console.error('No test files found.');
  process.exitCode = 1;
} else {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.error) console.error('Could not start the test runner.');
  process.exitCode = result.status === null ? 1 : result.status;
}
