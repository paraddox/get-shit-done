'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECK_UPDATE_HOOK = path.join(__dirname, '..', 'hooks', 'gsd-check-update.js');

describe('Codex hook scripts', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-hooks-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('gsd-check-update emits Codex session_start additionalContext from cache', () => {
    const homeDir = path.join(tmpRoot, 'home');
    const codexHome = path.join(homeDir, '.codex');
    const cacheDir = path.join(codexHome, 'cache');
    const versionDir = path.join(codexHome, 'get-shit-done');
    const binDir = path.join(tmpRoot, 'bin');

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(versionDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    fs.writeFileSync(path.join(versionDir, 'VERSION'), '1.0.0');
    fs.writeFileSync(
      path.join(cacheDir, 'gsd-update-check.json'),
      JSON.stringify({
        update_available: true,
        installed: '1.0.0',
        latest: '1.2.3',
        checked: Math.floor(Date.now() / 1000),
      })
    );

    const npmStub = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    fs.writeFileSync(
      npmStub,
      process.platform === 'win32'
        ? '@echo off\r\necho 1.2.3\r\n'
        : '#!/bin/sh\nprintf "1.2.3\\n"\n'
    );
    if (process.platform !== 'win32') {
      fs.chmodSync(npmStub, 0o755);
    }

    const result = spawnSync(process.execPath, [CHECK_UPDATE_HOOK], {
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-123',
        cwd: tmpRoot,
        model: 'gpt-5.4',
        permission_mode: 'never',
        source: 'startup',
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: homeDir,
        CODEX_HOME: codexHome,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      },
    });

    assert.strictEqual(result.status, 0, `hook exits cleanly: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.continue, true, 'hook continues processing');
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /\$gsd-update/,
      'hook tells Codex user how to update'
    );
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /1\.2\.3/,
      'hook includes latest version from cache'
    );
  });
});
