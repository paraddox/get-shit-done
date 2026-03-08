'use strict';

const fs = require('fs');
const {
  toSingleLine,
  yamlQuote,
  extractFrontmatterAndBody,
  extractFrontmatterField,
} = require('./runtime-content.cjs');

const GSD_CODEX_MARKER = '# GSD Agent Configuration — managed by get-shit-done installer';

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
  const { body } = extractFrontmatterAndBody(agentContent);
  const instructions = body.trim();

  const lines = [
    `sandbox_mode = "${sandboxMode}"`,
    'developer_instructions = """',
    instructions,
    '"""',
  ];
  return lines.join('\n') + '\n';
}

function generateCodexConfigBlock(agents, hookCommands = {}) {
  const lines = [
    GSD_CODEX_MARKER,
    '[features]',
    'multi_agent = true',
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
    'tool_use_complete',
    'tool_use_failure',
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

function stripGsdFromCodexConfig(content) {
  const markerIndex = content.indexOf(GSD_CODEX_MARKER);

  if (markerIndex !== -1) {
    let before = content.substring(0, markerIndex).trimEnd();
    before = before.replace(/^multi_agent\s*=\s*true\s*\n?/m, '');
    before = before.replace(/^default_mode_request_user_input\s*=\s*true\s*\n?/m, '');
    before = before.replace(/^\[features\]\s*\n(?=\[|$)/m, '');
    before = before.replace(/\n{3,}/g, '\n\n').trim();
    if (!before) return null;
    return before + '\n';
  }

  let cleaned = content;
  cleaned = cleaned.replace(/^multi_agent\s*=\s*true\s*\n?/m, '');
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
      before = before.replace(/^\[agents\]\n(?:(?!\[)[^\n]*\n?)*/m, '');
      before = before.replace(/\n{3,}/g, '\n\n').trimEnd();

      const hasFeatures = /^\[features\]\s*$/m.test(before);
      if (hasFeatures) {
        if (!before.includes('multi_agent')) {
          before = before.replace(/^\[features\]\s*$/m, '[features]\nmulti_agent = true');
        }
        if (!before.includes('default_mode_request_user_input')) {
          before = before.replace(/^\[features\].*$/m, '$&\ndefault_mode_request_user_input = true');
        }
      }
      const block = hasFeatures
        ? GSD_CODEX_MARKER + '\n' + gsdBlock.substring(gsdBlock.indexOf('[agents]'))
        : gsdBlock;
      fs.writeFileSync(configPath, before + '\n\n' + block + '\n');
    } else {
      fs.writeFileSync(configPath, gsdBlock + '\n');
    }
    return;
  }

  let content = existing;
  const featuresRegex = /^\[features\]\s*$/m;
  const hasFeatures = featuresRegex.test(content);

  if (hasFeatures) {
    if (!content.includes('multi_agent')) {
      content = content.replace(featuresRegex, '[features]\nmulti_agent = true');
    }
    if (!content.includes('default_mode_request_user_input')) {
      content = content.replace(/^\[features\].*$/m, '$&\ndefault_mode_request_user_input = true');
    }
    const agentsBlock = gsdBlock.substring(gsdBlock.indexOf('[agents]'));
    content = content.trimEnd() + '\n\n' + GSD_CODEX_MARKER + '\n' + agentsBlock + '\n';
  } else {
    content = content.trimEnd() + '\n\n' + gsdBlock + '\n';
  }

  fs.writeFileSync(configPath, content);
}

module.exports = {
  GSD_CODEX_MARKER,
  CODEX_AGENT_SANDBOX,
  convertClaudeToCodexMarkdown,
  getCodexSkillAdapterHeader,
  convertClaudeCommandToCodexSkill,
  convertClaudeAgentToCodexAgent,
  generateCodexAgentToml,
  generateCodexConfigBlock,
  stripGsdFromCodexConfig,
  mergeCodexConfig,
};
