'use strict';

const fs = require('fs');
const { resolveCodexRoleModelConfig } = require('../../get-shit-done/bin/lib/core.cjs');
const {
  toSingleLine,
  yamlQuote,
  extractFrontmatterAndBody,
  extractFrontmatterField,
} = require('./runtime-content.cjs');

const GSD_CODEX_MARKER = '# GSD Agent Configuration — managed by get-shit-done installer';
const GSD_CODEX_HOOK_COMMAND_BASENAME = 'gsd-check-update.js';

const CODEX_AGENT_SANDBOX = {
  'gsd-executor': 'workspace-write',
  'gsd-planner': 'workspace-write',
  'gsd-phase-researcher': 'workspace-write',
  'gsd-project-researcher': 'workspace-write',
  'gsd-research-synthesizer': 'workspace-write',
  'gsd-verifier': 'workspace-write',
  'gsd-codebase-mapper': 'workspace-write',
  'gsd-roadmapper': 'workspace-write',
  'gsd-debugger': 'workspace-write',
  'gsd-plan-checker': 'read-only',
  'gsd-integration-checker': 'read-only',
};

function toTomlArray(values) {
  return `[${values.map(value => JSON.stringify(value)).join(', ')}]`;
}

function convertSlashCommandsToCodexSkillMentions(content) {
  let converted = content.replace(/\/gsd:([a-z0-9-]+)/gi, (_, commandName) => {
    return `$gsd-${String(commandName).toLowerCase()}`;
  });
  converted = converted.replace(/\/gsd-help\b/g, '$gsd-help');
  return converted;
}

function convertClaudeToCodexMarkdown(content) {
  let converted = convertSlashCommandsToCodexSkillMentions(content);
  converted = converted.replace(/\$ARGUMENTS\b/g, '{{GSD_ARGS}}');
  return converted;
}

function getCodexSkillAdapterHeader(skillName) {
  const invocation = `$${skillName}`;
  return `<codex_skill_adapter>
## A. Skill Invocation
- This skill is invoked by mentioning \`${invocation}\`.
- Treat all user text after \`${invocation}\` as \`{{GSD_ARGS}}\`.
- If no arguments are present, treat \`{{GSD_ARGS}}\` as empty.

## B. AskUserQuestion → request_user_input Mapping
GSD workflows use \`AskUserQuestion\` (Claude Code syntax). Translate to Codex \`request_user_input\`:

Parameter mapping:
- \`header\` → \`header\`
- \`question\` → \`question\`
- Options formatted as \`"Label" — description\` → \`{label: "Label", description: "description"}\`
- Generate \`id\` from header: lowercase, replace spaces with underscores

Batched calls:
- \`AskUserQuestion([q1, q2])\` → single \`request_user_input\` with multiple entries in \`questions[]\`

Multi-select workaround:
- Codex has no \`multiSelect\`. Use sequential single-selects, or present a numbered freeform list asking the user to enter comma-separated numbers.

Execute mode fallback:
- When \`request_user_input\` is rejected (Execute mode), present a plain-text numbered list and pick a reasonable default.

## C. Task() → spawn_agent Mapping
GSD workflows use \`Task(...)\` (Claude Code syntax). Translate to Codex collaboration tools:

Direct mapping:
- \`Task(subagent_type="X", prompt="Y")\` → \`spawn_agent(agent_type="X", message="Y")\`
- \`Task(model="...")\` → omit (Codex uses per-role config, not inline model selection)
- \`fork_context: false\` by default — GSD agents load their own context via \`<files_to_read>\` blocks

Parallel fan-out:
- Spawn multiple agents → collect agent IDs → \`wait(ids)\` for all to complete

Result parsing:
- Look for structured markers in agent output: \`CHECKPOINT\`, \`PLAN COMPLETE\`, \`SUMMARY\`, etc.
- \`close_agent(id)\` after collecting results from each agent
</codex_skill_adapter>`;
}

function convertClaudeCommandToCodexSkill(content, skillName) {
  const converted = convertClaudeToCodexMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let description = `Run GSD workflow ${skillName}.`;
  if (frontmatter) {
    const maybeDescription = extractFrontmatterField(frontmatter, 'description');
    if (maybeDescription) {
      description = maybeDescription;
    }
  }
  description = toSingleLine(description);
  const shortDescription = description.length > 180 ? `${description.slice(0, 177)}...` : description;
  const adapter = getCodexSkillAdapterHeader(skillName);

  return `---\nname: ${yamlQuote(skillName)}\ndescription: ${yamlQuote(description)}\nmetadata:\n  short-description: ${yamlQuote(shortDescription)}\n---\n\n${adapter}\n\n${body.trimStart()}`;
}

function convertClaudeAgentToCodexAgent(content) {
  let converted = convertClaudeToCodexMarkdown(content);

  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  if (!frontmatter) return converted;

  const name = extractFrontmatterField(frontmatter, 'name') || 'unknown';
  const description = extractFrontmatterField(frontmatter, 'description') || '';
  const tools = extractFrontmatterField(frontmatter, 'tools') || '';

  const roleHeader = `<codex_agent_role>
role: ${name}
tools: ${tools}
purpose: ${toSingleLine(description)}
</codex_agent_role>`;

  const cleanFrontmatter = `---\nname: ${yamlQuote(name)}\ndescription: ${yamlQuote(toSingleLine(description))}\n---`;

  return `${cleanFrontmatter}\n\n${roleHeader}\n${body}`;
}

function generateCodexAgentToml(agentName, agentContent) {
  const sandboxMode = CODEX_AGENT_SANDBOX[agentName] || 'read-only';
  const modelConfig = resolveCodexRoleModelConfig(agentName);
  const { body } = extractFrontmatterAndBody(agentContent);
  const instructions = body.trim();
  const escapedInstructions = instructions
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  const lines = [];
  if (modelConfig) {
    lines.push(`model = "${modelConfig.model}"`);
    lines.push(`model_reasoning_effort = "${modelConfig.model_reasoning_effort}"`);
  }
  lines.push(`sandbox_mode = "${sandboxMode}"`);
  lines.push('developer_instructions = """');
  lines.push(escapedInstructions);
  lines.push('"""');
  return lines.join('\n') + '\n';
}

function generateCodexConfigBlock(agents, hookCommands = {}) {
  const lines = [
    GSD_CODEX_MARKER,
    '[features]',
    'multi_agent = true',
    'codex_hooks = true',
    'default_mode_request_user_input = true',
    '',
    '[agents]',
    'max_threads = 4',
    'max_depth = 2',
    '',
  ];

  for (const { name, description } of agents) {
    lines.push(`[agents.${name}]`);
    lines.push(`description = ${JSON.stringify(description)}`);
    lines.push(`config_file = "agents/${name}.toml"`);
    lines.push('');
  }

  const hookOrder = [
    'session_start',
    'session_end',
    'approval_requested',
    'user_prompt_submit',
    'pre_tool_use',
    'tool_use_failure',
    'subagent_start',
    'subagent_stop',
    'compact_start',
    'agent_turn_error',
    'notification',
    'config_changed',
    'agent_turn_complete',
    'tool_use_complete',
  ];
  for (const hookName of hookOrder) {
    const command = hookCommands[hookName];
    if (!Array.isArray(command) || command.length === 0) continue;
    lines.push(`[[hooks.${hookName}]]`);
    lines.push(`command = ${toTomlArray(command)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function isGsdCodexSessionStartCommand(command) {
  return typeof command === 'string' && command.includes(GSD_CODEX_HOOK_COMMAND_BASENAME);
}

function generateCodexHooksFile(sessionStartCommand) {
  return JSON.stringify({
    hooks: {
      SessionStart: sessionStartCommand
        ? [
            {
              matcher: '^(startup|resume)$',
              hooks: [
                {
                  type: 'command',
                  command: sessionStartCommand,
                  timeoutSec: 15,
                },
              ],
            },
          ]
        : [],
      Stop: [],
    },
    gsdManaged: true,
  }, null, 2) + '\n';
}

function stripGsdFromCodexHooksFile(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    return content;
  }

  if (!parsed || typeof parsed !== 'object') return content;
  const hooks = parsed.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const filteredSessionStart = sessionStart
    .map(group => {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) return group;
      const filteredHooks = group.hooks.filter(hook => !isGsdCodexSessionStartCommand(hook && hook.command));
      return { ...group, hooks: filteredHooks };
    })
    .filter(group => group && (!Array.isArray(group.hooks) || group.hooks.length > 0));

  const next = {
    ...parsed,
    hooks: {
      ...hooks,
      SessionStart: filteredSessionStart,
      Stop: Array.isArray(hooks.Stop) ? hooks.Stop : [],
    },
  };

  if (filteredSessionStart.length === 0) {
    delete next.gsdManaged;
  }

  const hasAnyHooks = Object.values(next.hooks).some(value => Array.isArray(value) && value.length > 0);
  if (!hasAnyHooks) {
    return null;
  }

  return JSON.stringify(next, null, 2) + '\n';
}

function mergeCodexHooksFile(hooksPath, sessionStartCommand) {
  const nextContent = generateCodexHooksFile(sessionStartCommand);
  if (!fs.existsSync(hooksPath)) {
    fs.writeFileSync(hooksPath, nextContent);
    return;
  }

  const existing = fs.readFileSync(hooksPath, 'utf8');
  const cleaned = stripGsdFromCodexHooksFile(existing);
  if (cleaned === null) {
    fs.writeFileSync(hooksPath, nextContent);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    fs.writeFileSync(hooksPath, nextContent);
    return;
  }

  const hooks = parsed.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  sessionStart.push({
    matcher: '^(startup|resume)$',
    hooks: [
      {
        type: 'command',
        command: sessionStartCommand,
        timeoutSec: 15,
      },
    ],
  });

  const merged = {
    ...parsed,
    hooks: {
      ...hooks,
      SessionStart: sessionStart,
      Stop: Array.isArray(hooks.Stop) ? hooks.Stop : [],
    },
    gsdManaged: true,
  };

  fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + '\n');
}

function stripTopLevelAgentsTable(block) {
  return block.replace(/^\[agents\]\n(?:(?!\[)[^\n]*\n?)*/m, '');
}

function stripGsdFromCodexConfig(content) {
  const markerIndex = content.indexOf(GSD_CODEX_MARKER);

  if (markerIndex !== -1) {
    let before = content.substring(0, markerIndex).trimEnd();
    before = before.replace(/^multi_agent\s*=\s*true\s*\n?/m, '');
    before = before.replace(/^codex_hooks\s*=\s*true\s*\n?/m, '');
    before = before.replace(/^default_mode_request_user_input\s*=\s*true\s*\n?/m, '');
    before = before.replace(/^\[features\]\s*\n(?=\[|$)/m, '');
    before = before.replace(/\n{3,}/g, '\n\n').trim();
    if (!before) return null;
    return before + '\n';
  }

  let cleaned = content;
  cleaned = cleaned.replace(/^multi_agent\s*=\s*true\s*\n?/m, '');
  cleaned = cleaned.replace(/^codex_hooks\s*=\s*true\s*\n?/m, '');
  cleaned = cleaned.replace(/^default_mode_request_user_input\s*=\s*true\s*\n?/m, '');
  cleaned = cleaned.replace(/^\[agents\.gsd-[^\]]+\]\n(?:(?!\[)[^\n]*\n?)*/gm, '');
  cleaned = cleaned.replace(/^\[features\]\s*\n(?=\[|$)/m, '');
  cleaned = cleaned.replace(/^\[agents\]\s*\n(?=\[|$)/m, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  if (!cleaned) return null;
  return cleaned + '\n';
}

function mergeCodexConfig(configPath, gsdBlock) {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, gsdBlock + '\n');
    return;
  }

  const existing = fs.readFileSync(configPath, 'utf8');
  const markerIndex = existing.indexOf(GSD_CODEX_MARKER);

  if (markerIndex !== -1) {
    let before = existing.substring(0, markerIndex).trimEnd();
    if (before) {
      before = before.replace(/^\[agents\.gsd-[^\]]+\]\n(?:(?!\[)[^\n]*\n?)*/gm, '');
      before = before.replace(/\n{3,}/g, '\n\n').trimEnd();

      const hasFeatures = /^\[features\]\s*$/m.test(before);
      const hasAgents = /^\[agents\]\s*$/m.test(before);
      if (hasFeatures) {
        if (!before.includes('multi_agent')) {
          before = before.replace(/^\[features\]\s*$/m, '[features]\nmulti_agent = true');
        }
        if (!before.includes('codex_hooks')) {
          before = before.replace(/^\[features\].*$/m, '$&\ncodex_hooks = true');
        }
        if (!before.includes('default_mode_request_user_input')) {
          before = before.replace(/^\[features\].*$/m, '$&\ndefault_mode_request_user_input = true');
        }
      }
      let block = hasFeatures
        ? GSD_CODEX_MARKER + '\n' + gsdBlock.substring(gsdBlock.indexOf('[agents]'))
        : gsdBlock;
      if (hasAgents) {
        block = stripTopLevelAgentsTable(block);
      }
      fs.writeFileSync(configPath, before + '\n\n' + block + '\n');
    } else {
      fs.writeFileSync(configPath, gsdBlock + '\n');
    }
    return;
  }

  let content = existing;
  const featuresRegex = /^\[features\]\s*$/m;
  const hasFeatures = featuresRegex.test(content);
  const hasAgents = /^\[agents\]\s*$/m.test(content);

  if (hasFeatures) {
    if (!content.includes('multi_agent')) {
      content = content.replace(featuresRegex, '[features]\nmulti_agent = true');
    }
    if (!content.includes('codex_hooks')) {
      content = content.replace(/^\[features\].*$/m, '$&\ncodex_hooks = true');
    }
    if (!content.includes('default_mode_request_user_input')) {
      content = content.replace(/^\[features\].*$/m, '$&\ndefault_mode_request_user_input = true');
    }
    let agentsBlock = gsdBlock.substring(gsdBlock.indexOf('[agents]'));
    if (hasAgents) {
      agentsBlock = stripTopLevelAgentsTable(agentsBlock);
    }
    content = content.trimEnd() + '\n\n' + GSD_CODEX_MARKER + '\n' + agentsBlock + '\n';
  } else {
    let block = gsdBlock;
    if (hasAgents) {
      block = stripTopLevelAgentsTable(block);
    }
    content = content.trimEnd() + '\n\n' + block + '\n';
  }

  fs.writeFileSync(configPath, content);
}

module.exports = {
  GSD_CODEX_MARKER,
  CODEX_AGENT_SANDBOX,
  GSD_CODEX_HOOK_COMMAND_BASENAME,
  convertClaudeToCodexMarkdown,
  getCodexSkillAdapterHeader,
  convertClaudeCommandToCodexSkill,
  convertClaudeAgentToCodexAgent,
  generateCodexAgentToml,
  generateCodexConfigBlock,
  generateCodexHooksFile,
  stripGsdFromCodexConfig,
  stripGsdFromCodexHooksFile,
  mergeCodexConfig,
  mergeCodexHooksFile,
};
