'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args, options = {}) {
  return execFileSync(npmBin, args, {
    cwd: options.cwd || path.join(__dirname, '..'),
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function parseTrailingJsonArray(output) {
  const match = output.match(/(?:^|\n)(\[\n[\s\S]*\n\])\s*$/);
  const json = match ? match[1] : output;
  return JSON.parse(json);
}

describe('Codex packaged artifact smoke test', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-pack-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('packed artifact includes Codex runtime files and installs locally', () => {
    const packDir = path.join(tmpRoot, 'pack');
    const projectDir = path.join(tmpRoot, 'project');
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const packOutput = runNpm(['pack', '--json', '--pack-destination', packDir]);
    const packInfo = parseTrailingJsonArray(packOutput)[0];
    const tarballPath = path.join(packDir, packInfo.filename);

    assert.ok(fs.existsSync(tarballPath), 'tarball exists');

    const packedFiles = new Set(packInfo.files.map(file => file.path));
    assert.ok(packedFiles.has('bin/install.js'), 'tarball includes installer');
    assert.ok(packedFiles.has('bin/lib/codex.cjs'), 'tarball includes Codex helper module');
    assert.ok(packedFiles.has('bin/lib/runtime-content.cjs'), 'tarball includes runtime content helper');
    assert.ok(packedFiles.has('commands/gsd/help.md'), 'tarball includes command sources');
    assert.ok(packedFiles.has('agents/gsd-executor.md'), 'tarball includes agent sources');
    assert.ok(packedFiles.has('get-shit-done/workflows/update.md'), 'tarball includes workflow sources');

    runNpm(
      ['exec', '--yes', '--package', tarballPath, 'get-shit-done-cc', '--', '--codex', '--local'],
      { cwd: projectDir }
    );

    const codexDir = path.join(projectDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const skillPath = path.join(codexDir, 'skills', 'gsd-help', 'SKILL.md');
    const hookPath = path.join(codexDir, 'hooks', 'gsd-check-update.js');

    assert.ok(fs.existsSync(configPath), 'packed artifact installs Codex config');
    assert.ok(fs.existsSync(skillPath), 'packed artifact installs Codex skills');
    assert.ok(fs.existsSync(hookPath), 'packed artifact installs Codex hooks');

    const skillContent = fs.readFileSync(skillPath, 'utf8');
    assert.ok(skillContent.includes('$gsd-help'), 'packed artifact installs Codex skill syntax');
    assert.ok(!skillContent.includes('__GSD_'), 'packed artifact resolves runtime tokens');
  });
});
