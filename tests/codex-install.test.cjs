'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INSTALLER = path.join(__dirname, '..', 'bin', 'install.js');

function runInstaller(args, options = {}) {
  return execFileSync(process.execPath, [INSTALLER, ...args], {
    cwd: options.cwd || path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOME: options.home || process.env.HOME,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('Codex installer integration', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-codex-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('installs locally for Codex and remains idempotent on reinstall', () => {
    const projectDir = path.join(tmpRoot, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    runInstaller(['--codex', '--local'], { cwd: projectDir, home: tmpRoot });
    runInstaller(['--codex', '--local'], { cwd: projectDir, home: tmpRoot });

    const codexDir = path.join(projectDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const manifestPath = path.join(codexDir, 'gsd-file-manifest.json');
    const versionPath = path.join(codexDir, 'get-shit-done', 'VERSION');
    const skillsDir = path.join(codexDir, 'skills');
    const agentsDir = path.join(codexDir, 'agents');
    const hooksDir = path.join(codexDir, 'hooks');
    const helpSkillPath = path.join(skillsDir, 'gsd-help', 'SKILL.md');
    const executorTomlPath = path.join(agentsDir, 'gsd-executor.toml');
    const researcherTomlPath = path.join(agentsDir, 'gsd-phase-researcher.toml');
    const mapperTomlPath = path.join(agentsDir, 'gsd-codebase-mapper.toml');

    assert.ok(fs.existsSync(configPath), 'config.toml exists');
    assert.ok(fs.existsSync(manifestPath), 'manifest exists');
    assert.ok(fs.existsSync(versionPath), 'VERSION exists');
    assert.ok(fs.existsSync(helpSkillPath), 'help skill exists');
    assert.ok(fs.existsSync(executorTomlPath), 'executor toml exists');
    assert.ok(fs.existsSync(researcherTomlPath), 'researcher toml exists');
    assert.ok(fs.existsSync(mapperTomlPath), 'mapper toml exists');
    assert.ok(fs.existsSync(path.join(hooksDir, 'gsd-check-update.js')), 'check-update hook exists');
    assert.ok(fs.existsSync(path.join(hooksDir, 'gsd-context-monitor.js')), 'context-monitor hook exists');
    assert.ok(!fs.existsSync(path.join(codexDir, 'package.json')), 'Codex install does not write package.json');

    const config = fs.readFileSync(configPath, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const helpSkill = fs.readFileSync(helpSkillPath, 'utf8');
    const executorToml = fs.readFileSync(executorTomlPath, 'utf8');
    const researcherToml = fs.readFileSync(researcherTomlPath, 'utf8');
    const mapperToml = fs.readFileSync(mapperTomlPath, 'utf8');

    assert.ok(config.includes('[agents.gsd-executor]'), 'config contains executor agent');
    assert.ok(config.includes('multi_agent = true'), 'config includes multi_agent');
    assert.ok(config.includes('default_mode_request_user_input = true'), 'config includes request_user_input flag');
    assert.ok(config.includes('[[hooks.session_start]]'), 'config includes session_start hook');
    assert.ok(config.includes('gsd-check-update.js'), 'config references update hook');
    assert.ok(!config.includes('[[hooks.tool_use_complete]]'), 'config does not include unsupported context-monitor hooks');
    assert.ok(!config.includes('[[hooks.tool_use_failure]]'), 'config does not include unsupported failed-tool hooks');
    assert.ok(!config.includes('~/.claude'), 'config has no leaked Claude path');
    assert.ok(!config.includes('__GSD_'), 'config has no unresolved runtime tokens');

    assert.ok(helpSkill.includes('<codex_skill_adapter>'), 'help skill includes adapter');
    assert.ok(helpSkill.includes('$gsd-help'), 'help skill uses Codex invocation');
    assert.ok(!helpSkill.includes('~/.claude'), 'help skill has no leaked Claude path');
    assert.ok(!helpSkill.includes('__GSD_'), 'help skill has no unresolved runtime tokens');

    assert.ok(executorToml.includes('sandbox_mode = "workspace-write"'), 'executor toml has workspace-write');
    assert.ok(!executorToml.includes('~/.claude'), 'executor toml has no leaked Claude path');
    assert.ok(!executorToml.includes('__GSD_'), 'executor toml has no unresolved runtime tokens');
    assert.ok(executorToml.includes('model = "gpt-5.4"'), 'executor toml uses gpt-5.4');
    assert.ok(executorToml.includes('model_reasoning_effort = "high"'), 'executor toml uses high reasoning');

    assert.ok(researcherToml.includes('model = "gpt-5.4"'), 'researcher toml uses gpt-5.4');
    assert.ok(researcherToml.includes('model_reasoning_effort = "high"'), 'researcher toml uses high reasoning');

    assert.ok(mapperToml.includes('model = "gpt-5.3-codex-spark"'), 'mapper toml uses codex spark');
    assert.ok(mapperToml.includes('model_reasoning_effort = "xhigh"'), 'mapper toml uses xhigh reasoning');

    assert.ok(
      Object.keys(manifest.files).some(file => file.startsWith('skills/gsd-help/')),
      'manifest tracks Codex skills'
    );
    assert.ok(
      Object.keys(manifest.files).some(file => file === 'agents/gsd-executor.md'),
      'manifest tracks agent markdown'
    );

    const skillDirs = fs.readdirSync(skillsDir).filter(entry => entry.startsWith('gsd-'));
    assert.ok(skillDirs.length > 5, 'installs multiple Codex skills');
    const markerCount = (config.match(/# GSD Agent Configuration/g) || []).length;
    assert.strictEqual(markerCount, 1, 'config marker remains singular after reinstall');
  });

  test('uninstall preserves user config sections in Codex config.toml', () => {
    const codexHome = path.join(tmpRoot, 'codex-home');
    fs.mkdirSync(codexHome, { recursive: true });

    const userConfig = '[model]\nname = "o3"\n\n[features]\nuser_feature = true\n';
    fs.writeFileSync(path.join(codexHome, 'config.toml'), userConfig);

    runInstaller(['--codex', '--global', '--config-dir', codexHome], { home: tmpRoot });

    const installedConfig = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.ok(installedConfig.includes('[model]'), 'install preserves model section');
    assert.ok(installedConfig.includes('user_feature = true'), 'install preserves user feature');
    assert.ok(installedConfig.includes('[agents.gsd-executor]'), 'install adds GSD agents');

    runInstaller(['--codex', '--global', '--config-dir', codexHome, '--uninstall'], { home: tmpRoot });

    const configPath = path.join(codexHome, 'config.toml');
    assert.ok(fs.existsSync(configPath), 'user config.toml remains after uninstall');
    const cleanedConfig = fs.readFileSync(configPath, 'utf8');

    assert.ok(cleanedConfig.includes('[model]'), 'uninstall preserves model section');
    assert.ok(cleanedConfig.includes('user_feature = true'), 'uninstall preserves user feature');
    assert.ok(!cleanedConfig.includes('[agents.gsd-executor]'), 'uninstall removes GSD agent section');
    assert.ok(!cleanedConfig.includes('multi_agent = true'), 'uninstall removes injected GSD features');
    assert.ok(!cleanedConfig.includes('default_mode_request_user_input = true'), 'uninstall removes injected request_user_input');
    assert.ok(!fs.existsSync(path.join(codexHome, 'get-shit-done')), 'uninstall removes get-shit-done directory');
    assert.ok(!fs.existsSync(path.join(codexHome, 'skills', 'gsd-help')), 'uninstall removes Codex skills');
    assert.ok(!fs.existsSync(path.join(codexHome, 'agents', 'gsd-executor.toml')), 'uninstall removes agent toml files');
    assert.ok(!fs.existsSync(path.join(codexHome, 'hooks', 'gsd-check-update.js')), 'uninstall removes Codex hooks');
  });
});
