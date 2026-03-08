# Plan: Full Codex CLI Adaptation

**Generated**: 2026-03-08T09:17:42Z
**Estimated Complexity**: High

## Overview

This repo already has partial Codex support: the installer can target `.codex`, convert GSD commands into Codex skills, generate `config.toml`, and emit per-agent TOML files from the Claude-first source corpus in [bin/install.js](/home/soso/get-shit-done/bin/install.js). The remaining work is to make Codex a first-class runtime rather than a compatibility layer.

The main problem is structural: the workflows, templates, agents, hooks, and docs are still authored around Claude assumptions and then rewritten during install. That works for basic install, but it leaves a large surface area where Codex behavior is fragile, hard to test, and dependent on install-time string replacement.

This plan moves the repo from "Codex-compatible installer path" to "Codex-native product surface" while preserving Claude/OpenCode/Gemini support.

## Assumptions

- Codex support must work in both global `~/.codex` and project-local `./.codex` installs.
- Codex adaptation should not depend on under-development feature flags being universally available.
- Current local Codex CLI supports `multi_agent`, supports configurable `config.toml`/profiles/sandbox/approval, and exposes skills under `.codex/skills`; however `default_mode_request_user_input` is not assumed safe as a hard requirement.
- Existing non-Codex runtimes must keep working; this is a refactor with parity requirements, not a Codex-only fork.

## Target Support Contract

When this plan is complete, the Codex path should guarantee:

1. `npx get-shit-done-cc --codex --global|--local` installs without manual fixes.
2. Every shipped GSD command is callable as a Codex skill and produces valid Codex-oriented instructions.
3. Installed skills, agents, templates, and docs contain no leaked Claude-only paths or syntax.
4. GSD workflows degrade gracefully when `request_user_input` or `multi_agent` features are unavailable.
5. Install, update, uninstall, and patch-reapply flows are covered by Codex-specific tests.
6. Codex users have first-party docs for install, troubleshooting, config merge behavior, and limitations.

## Prerequisites

- Keep [bin/install.js](/home/soso/get-shit-done/bin/install.js) as the current source of truth while introducing cleaner abstractions.
- Use official Codex docs as the behavioral reference for skills, agents, rules/AGENTS, and config:
  - Codex CLI setup and config: https://developers.openai.com/codex/cli
  - Codex configuration and profiles: https://developers.openai.com/codex/config
  - Codex AGENTS.md instructions: https://developers.openai.com/codex/agents
  - Codex skills: https://developers.openai.com/codex/skills
  - Codex multi-agent patterns: https://developers.openai.com/codex/multi-agent
- Use the local CLI as a second compatibility oracle:
  - `codex --help`
  - `codex features list`

## Sprint 1: Define the Codex Runtime Contract
**Goal**: Freeze what "fully adapted for Codex" means in code and docs before changing implementation.

**Demo/Validation**:
- A single design note exists listing supported Codex capabilities, feature-gated behavior, and explicit non-goals.
- A runtime capability matrix maps Claude/OpenCode/Gemini/Codex behavior for commands, agents, hooks, config, and docs.

### Task 1.1: Capture Codex capability matrix
- **Location**: [docs/CODEX-ADAPTATION-PLAN.md](/home/soso/get-shit-done/docs/CODEX-ADAPTATION-PLAN.md), [README.md](/home/soso/get-shit-done/README.md), [docs/USER-GUIDE.md](/home/soso/get-shit-done/docs/USER-GUIDE.md)
- **Description**: Document which Codex features GSD relies on, which are optional, and which need fallback paths. Include `skills`, `AGENTS.md`, `config.toml`, profiles, sandbox modes, approval policies, `multi_agent`, and `request_user_input`. Explicitly treat `default_mode_request_user_input` as feature-gated instead of universally guaranteed.
- **Dependencies**: None
- **Acceptance Criteria**:
  - A repo-visible support contract exists.
  - Codex feature assumptions are separated into required, optional, and unsupported.
- **Validation**:
  - Cross-check contract against official Codex docs and local `codex --help`/`codex features list`.

### Task 1.2: Define compatibility policy and fallback rules
- **Location**: [README.md](/home/soso/get-shit-done/README.md), [docs/USER-GUIDE.md](/home/soso/get-shit-done/docs/USER-GUIDE.md)
- **Description**: Decide how GSD behaves when Codex lacks or disables `multi_agent` or interactive question support. Standardize fallback behavior for serialized execution, plain-text prompting, and manual continuation.
- **Dependencies**: Task 1.1
- **Acceptance Criteria**:
  - Each feature-dependent workflow has a defined fallback.
  - The policy is documented before refactoring implementation.
- **Validation**:
  - Manual review of fallback table against current Codex CLI behavior.

## Sprint 2: Replace Install-Time String Surgery with Runtime-Aware Source Modeling
**Goal**: Reduce fragile Claude-first rewriting by introducing explicit runtime-aware authoring and conversion rules.

**Demo/Validation**:
- Command and workflow conversion rules are centralized and testable.
- The repo can explain exactly how a source workflow becomes a Codex skill.

### Task 2.1: Extract Codex adapter logic into dedicated module(s)
- **Location**: [bin/install.js](/home/soso/get-shit-done/bin/install.js), new files under `get-shit-done/bin/lib/` or `bin/lib/`
- **Description**: Move Codex-specific conversion responsibilities out of the monolithic installer: command-to-skill conversion, agent-to-TOML conversion, config merge/strip behavior, path rewriting, and runtime capability flags. Keep `bin/install.js` as orchestration only.
- **Dependencies**: Sprint 1
- **Acceptance Criteria**:
  - Codex adaptation logic is isolated in a reusable module.
  - Public functions have focused unit tests.
- **Validation**:
  - Existing tests continue passing.
  - New unit tests cover the extracted API.

### Task 2.2: Introduce runtime tokens instead of raw `~/.claude` source assumptions
- **Location**: [commands/gsd](/home/soso/get-shit-done/commands/gsd), [get-shit-done/workflows](/home/soso/get-shit-done/get-shit-done/workflows), [get-shit-done/templates](/home/soso/get-shit-done/get-shit-done/templates), [agents](/home/soso/get-shit-done/agents)
- **Description**: Replace raw source literals like `~/.claude/get-shit-done/...`, `./.claude/`, and Claude-specific command references with explicit placeholders or a small templating convention. Conversion should substitute runtime tokens rather than hunt arbitrary strings.
- **Dependencies**: Task 2.1
- **Acceptance Criteria**:
  - New source material does not rely on literal `~/.claude` path text.
  - Codex install no longer depends on broad regex replacement for critical runtime paths.
- **Validation**:
  - Repo-wide grep shows runtime placeholders in source and zero unexpected hard-coded `.claude` references in newly migrated files.

### Task 2.3: Define a first-class command/skill semantic model
- **Location**: [commands/gsd](/home/soso/get-shit-done/commands/gsd), new schema/helper module
- **Description**: Normalize concepts that vary by runtime: slash command name, skill name, arguments placeholder, user-question API, subagent API, and execution-context references. Ensure Codex conversion is generated from semantics, not text patching.
- **Dependencies**: Task 2.2
- **Acceptance Criteria**:
  - Command metadata is explicit enough to generate both Claude and Codex surfaces.
  - Future command additions do not require ad hoc Codex patches.
- **Validation**:
  - Add unit tests proving one source command can emit valid Claude and Codex forms.

### Task 2.4: Make command wrappers a first-class migration target
- **Location**: [commands/gsd](/home/soso/get-shit-done/commands/gsd)
- **Description**: Audit every command wrapper that becomes a Codex skill. Remove hard-coded `@~/.claude/...` execution-context references, Claude-only tool declarations, and wrapper-level assumptions that are currently being papered over by install-time rewriting.
- **Dependencies**: Task 2.3
- **Acceptance Criteria**:
  - Wrapper commands are explicitly modeled as a runtime surface, not incidental inputs to conversion.
  - Installed Codex skills generated from wrappers are valid without depending on broad string surgery.
- **Validation**:
  - Snapshot tests for representative wrapper commands such as `help`, `new-project`, `plan-phase`, `verify-work`, and `reapply-patches`.

## Sprint 3: Make Workflows and Agents Codex-Native
**Goal**: Remove the biggest runtime mismatches in the GSD workflow corpus.

**Demo/Validation**:
- Generated Codex skills read naturally as Codex instructions.
- Agents and templates reference Codex-supported behavior and defined fallbacks.

### Task 3.1: Audit and migrate workflow hotspots
- **Location**: [get-shit-done/workflows/map-codebase.md](/home/soso/get-shit-done/get-shit-done/workflows/map-codebase.md), [get-shit-done/workflows/new-project.md](/home/soso/get-shit-done/get-shit-done/workflows/new-project.md), [get-shit-done/workflows/plan-phase.md](/home/soso/get-shit-done/get-shit-done/workflows/plan-phase.md), [get-shit-done/workflows/execute-phase.md](/home/soso/get-shit-done/get-shit-done/workflows/execute-phase.md), [get-shit-done/workflows/settings.md](/home/soso/get-shit-done/get-shit-done/workflows/settings.md), [get-shit-done/workflows/update.md](/home/soso/get-shit-done/get-shit-done/workflows/update.md)
- **Description**: Prioritize the workflows most likely to break in Codex: ones with heavy `AskUserQuestion`, `Task(...)`, or `.claude` references. Rewrite them to express runtime-neutral behavior first, then emit Codex-specific forms cleanly.
- **Dependencies**: Sprint 2
- **Acceptance Criteria**:
  - The top 5-6 workflows no longer depend on installer regex hacks for correctness.
  - Codex fallbacks for no-multi-select and no-agent modes are explicit.
- **Validation**:
  - Snapshot tests for generated Codex skills from these workflows.

### Task 3.1b: Migrate second-wave workflows that still control key user paths
- **Location**: [get-shit-done/workflows/research-phase.md](/home/soso/get-shit-done/get-shit-done/workflows/research-phase.md), [get-shit-done/workflows/verify-work.md](/home/soso/get-shit-done/get-shit-done/workflows/verify-work.md), [get-shit-done/workflows/new-milestone.md](/home/soso/get-shit-done/get-shit-done/workflows/new-milestone.md), [get-shit-done/workflows/diagnose-issues.md](/home/soso/get-shit-done/get-shit-done/workflows/diagnose-issues.md), plus remaining workflow files with `AskUserQuestion`, `Task(...)`, or `@~/.claude/...` references
- **Description**: Treat the remaining orchestration flows as a named migration wave rather than cleanup. These workflows still sit on core milestone, debugging, research, and verification paths and will otherwise block true Codex parity.
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - The full user-visible workflow graph has Codex-safe orchestration, not just the primary happy path.
  - High-traffic secondary flows no longer rely on Claude-first syntax or assumptions.
- **Validation**:
  - Repo-wide grep and snapshot coverage for all migrated workflows.

### Task 3.2: Migrate agent prompts to Codex-oriented role contracts
- **Location**: [agents](/home/soso/get-shit-done/agents)
- **Description**: Review each agent for Claude-only assumptions. Standardize instructions around Codex concepts: child agents, file loading, tool availability, sandbox expectations, and fallback when a specific collaboration feature is not enabled.
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - Agent source prompts contain no invalid Codex assumptions.
  - Generated agent TOML and markdown remain aligned.
- **Validation**:
  - Unit tests for `convertClaudeAgentToCodexAgent()` and TOML generation.
  - Sample agent output reviewed for planner, executor, verifier, mapper, debugger.

### Task 3.3: Clean up templates and references that leak Claude-centric paths
- **Location**: [get-shit-done/templates](/home/soso/get-shit-done/get-shit-done/templates), [get-shit-done/references](/home/soso/get-shit-done/get-shit-done/references)
- **Description**: Replace path and runtime assumptions inside templates that are embedded into plans and prompts. Pay special attention to `phase-prompt.md`, codebase templates, discovery templates, and checkpoint references.
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - Installed Codex templates contain no stale `~/.claude` references unless intentionally documented as source examples.
  - Generated project artifacts are runtime-appropriate.
- **Validation**:
  - Repo-wide leak scan across installed Codex output in temp directories.

## Sprint 4: Harden Installer, Config, and Upgrade Paths for Codex
**Goal**: Make Codex install/update/uninstall behavior reliable, reversible, and easy to reason about.

**Demo/Validation**:
- Fresh install, reinstall, update, and uninstall work in isolated temp directories.
- `config.toml` merges are deterministic and do not damage user-owned settings.

### Task 4.1: Rework Codex config generation around official config semantics
- **Location**: [bin/install.js](/home/soso/get-shit-done/bin/install.js), new config helper module
- **Description**: Align generated `config.toml` with current Codex config conventions, including profiles and feature toggles where appropriate. Treat experimental/under-development flags conservatively. Avoid forcing feature keys that are not required for baseline GSD operation.
- **Dependencies**: Sprint 1, Sprint 2
- **Acceptance Criteria**:
  - `config.toml` generation cleanly separates required settings, optional settings, and user-preserved settings.
  - GSD does not hard-require under-development flags when a workflow fallback exists.
- **Validation**:
  - Golden-file tests for empty config, user config, and existing GSD-managed config merge cases.

### Task 4.2: Add runtime capability detection
- **Location**: [bin/install.js](/home/soso/get-shit-done/bin/install.js), runtime helper module
- **Description**: During install or first-run docs generation, detect whether the local Codex CLI exposes required capabilities. Warn when optional features are unavailable, and emit fallback guidance instead of silently assuming full support.
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - Installer behavior changes based on observable Codex capability state.
  - Unsupported configurations are surfaced clearly.
- **Validation**:
  - Simulated tests for feature-enabled and feature-disabled environments.

### Task 4.3: Clarify update and uninstall semantics for Codex
- **Location**: [get-shit-done/workflows/update.md](/home/soso/get-shit-done/get-shit-done/workflows/update.md), [README.md](/home/soso/get-shit-done/README.md)
- **Description**: Update the operational flows so Codex users know what gets replaced, preserved, merged, removed, and backed up. Ensure reapply-patches behavior covers skill directories and generated agent TOML files.
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - Codex update and uninstall semantics are explicit in both workflow and docs.
  - Manifest generation includes Codex-installed artifacts comprehensively.
- **Validation**:
  - Manual temp-install/update/uninstall drill with expected file diffs.

### Task 4.4: Fix Codex-specific patch backup and restore paths
- **Location**: [commands/gsd/reapply-patches.md](/home/soso/get-shit-done/commands/gsd/reapply-patches.md), update/manifest helper code, related installer logic
- **Description**: Add explicit `.codex` handling to the patch backup and restore flow. The current command enumerates OpenCode, Gemini, and Claude directories but omits `.codex`, which means Codex local modifications can be missed even if the broader update semantics are documented correctly.
- **Dependencies**: Task 4.3
- **Acceptance Criteria**:
  - `reapply-patches` searches global and local Codex patch locations.
  - Patch restore behavior for Codex is both implemented and documented.
- **Validation**:
  - Integration tests cover Codex backup discovery and restore.

## Sprint 5: Build Real Codex Test Coverage
**Goal**: Prevent regressions by testing the actual Codex path, not just helper functions.

**Demo/Validation**:
- A new Codex test suite covers install, reinstall, uninstall, conversion, manifest generation, and no-leak guarantees.

### Task 5.1: Add Codex installer integration tests
- **Location**: new `tests/codex-install.test.cjs` or an expanded test harness that intentionally includes non-`.test.cjs` suites
- **Description**: Run the installer in isolated temp homes/worktrees for both global and local Codex modes. Assert generated skills, agent TOMLs, config merge behavior, and absence of stale `.claude` references.
- **Dependencies**: Sprint 4
- **Acceptance Criteria**:
  - Tests cover `--codex --global`, `--codex --local`, `--config-dir`, and reinstall idempotency.
  - Failures point to concrete filesystem regressions.
- **Validation**:
  - `npm test` passes with new Codex integration suite enabled.

### Task 5.1b: Align the test harness with the new Codex suite structure
- **Location**: [scripts/run-tests.cjs](/home/soso/get-shit-done/scripts/run-tests.cjs), test naming conventions
- **Description**: Either keep all new tests on the existing `*.test.cjs` convention or deliberately expand the harness to include additional suite naming. Make this an explicit decision so Codex integration coverage is actually executed in CI.
- **Dependencies**: Task 5.1
- **Acceptance Criteria**:
  - The test runner executes every new Codex suite by default.
  - Naming conventions are documented and enforced.
- **Validation**:
  - Local `npm test` run shows new Codex suites executing.

### Task 5.2: Add Codex uninstall and cleanup tests
- **Location**: new `tests/codex-uninstall.test.cjs`
- **Description**: Seed mixed user/GSD configs and verify uninstall strips only GSD-managed content, removes generated artifacts, and preserves user-owned config sections.
- **Dependencies**: Task 5.1
- **Acceptance Criteria**:
  - Codex uninstall behavior is safe and deterministic.
  - Marker-based config cleanup is proven by tests.
- **Validation**:
  - Automated assertions over resulting `config.toml`, `skills/`, and `agents/`.

### Task 5.3: Add unit and snapshot tests for command/skill conversion
- **Location**: [tests/codex-config.test.cjs](/home/soso/get-shit-done/tests/codex-config.test.cjs), new snapshot fixtures if needed
- **Description**: Cover `convertClaudeCommandToCodexSkill()`, `copyCommandsAsCodexSkills()`, nested command generation, stale-skill cleanup, and path rewriting edge cases.
- **Dependencies**: Sprint 2
- **Acceptance Criteria**:
  - Direct tests exist for the command-to-skill conversion path.
  - Snapshot tests make adapter regressions obvious.
- **Validation**:
  - `npm test` passes with explicit Codex conversion coverage.

### Task 5.4: Add manifest and patch lifecycle tests for Codex
- **Location**: test files around manifest/update behavior
- **Description**: Verify `gsd-file-manifest.json` includes Codex-installed files and that update/reapply logic correctly tracks local modifications under `skills/` and `agents/`.
- **Dependencies**: Task 4.3
- **Acceptance Criteria**:
  - Codex-specific update safety is test-covered.
- **Validation**:
  - Automated filesystem assertions for manifest contents and patch metadata.

### Task 5.5: Migrate existing tests that currently hard-code Claude-first source assumptions
- **Location**: [tests/agent-frontmatter.test.cjs](/home/soso/get-shit-done/tests/agent-frontmatter.test.cjs), [tests/phase.test.cjs](/home/soso/get-shit-done/tests/phase.test.cjs), and other source-level tests asserting raw `~/.claude` content
- **Description**: Update existing tests so they validate the new runtime-neutral source model and generated runtime output separately. This prevents the Codex migration from being blocked by tests that currently assert Claude-specific literals in source files.
- **Dependencies**: Sprint 2, Sprint 3
- **Acceptance Criteria**:
  - Existing tests no longer force Claude-only source text where runtime-neutral tokens are intended.
  - Source tests and generated-output tests assert the correct layer of behavior.
- **Validation**:
  - Full test suite passes after runtime-neutral migration work lands.

### Task 5.6: Add publish-artifact smoke tests for Codex
- **Location**: test/release validation scripts, package publishing workflow if present
- **Description**: Validate Codex installation from the packaged npm artifact, not only from a git checkout. This repo ships through a `files` whitelist and prepublish build steps, so Codex support must be proven against what `npm pack` actually includes.
- **Dependencies**: Task 5.1, Task 5.4
- **Acceptance Criteria**:
  - A smoke test installs from a packed tarball into a temp Codex home/worktree.
  - The packaged artifact includes every file required for Codex install, update, and uninstall.
- **Validation**:
  - `npm pack` + install smoke test passes in CI or release validation.

## Sprint 6: Decide the Hook Story for Codex
**Goal**: Either ship a Codex-native hook/statusline story or explicitly de-scope it.

**Demo/Validation**:
- The repo no longer implies Codex gets the same hook experience as Claude when it does not.

### Task 6.1: Evaluate Codex-native equivalents for statusline/context monitoring
- **Location**: [hooks](/home/soso/get-shit-done/hooks), [docs/context-monitor.md](/home/soso/get-shit-done/docs/context-monitor.md)
- **Description**: Determine whether current Codex supports equivalent lifecycle hooks or status integrations. If yes, design a Codex-native implementation. If no, explicitly document that hooks are unsupported for Codex and prevent misleading install/docs behavior.
- **Dependencies**: Sprint 1
- **Acceptance Criteria**:
  - There is a clear supported/unsupported decision for Codex hooks.
  - Docs and installer behavior reflect that decision.
- **Validation**:
  - Official Codex docs support the conclusion, or the unsupported state is documented as an intentional limitation.

### Task 6.2: Remove misleading Codex-adjacent hook assumptions
- **Location**: [README.md](/home/soso/get-shit-done/README.md), [docs/context-monitor.md](/home/soso/get-shit-done/docs/context-monitor.md), [hooks/gsd-check-update.js](/home/soso/get-shit-done/hooks/gsd-check-update.js), [hooks/gsd-context-monitor.js](/home/soso/get-shit-done/hooks/gsd-context-monitor.js), [hooks/gsd-statusline.js](/home/soso/get-shit-done/hooks/gsd-statusline.js)
- **Description**: If hooks remain non-Codex, make that explicit and avoid accidental references to `.codex` support. If hooks become supported, extend test and install coverage accordingly.
- **Dependencies**: Task 6.1
- **Acceptance Criteria**:
  - Hook docs no longer overstate Codex parity.
- **Validation**:
  - Manual doc review and grep for Codex hook claims.

## Sprint 7: Ship Codex-First Documentation and Release Notes
**Goal**: Make Codex users successful without reading installer source.

**Demo/Validation**:
- A Codex user can install, troubleshoot, update, and uninstall GSD using docs alone.

### Task 7.1: Add a Codex-first README section
- **Location**: [README.md](/home/soso/get-shit-done/README.md)
- **Description**: Add a Codex-specific section covering install, local vs global, `$gsd-*` invocation, `config.toml` merge behavior, `CODEX_HOME`, supported feature assumptions, troubleshooting, and uninstall semantics.
- **Dependencies**: Sprint 4, Sprint 6
- **Acceptance Criteria**:
  - README answers the practical Codex questions that currently require reading installer code.
- **Validation**:
  - Fresh reader can complete install/uninstall from README alone.

### Task 7.1b: Add Codex-specific contributor and development-install instructions
- **Location**: [README.md](/home/soso/get-shit-done/README.md), contributor docs if added later
- **Description**: Update the development-install section so contributors can test Codex changes directly from the repo, not only Claude installs. Include a local Codex install example and a packaged-artifact smoke-test path for maintainers before release.
- **Dependencies**: Task 5.6
- **Acceptance Criteria**:
  - A contributor can validate Codex changes from a fresh clone without reverse-engineering installer behavior.
  - Maintainers have a documented pre-release Codex verification flow.
- **Validation**:
  - Follow the documented steps in a clean temp directory and verify Codex install succeeds.

### Task 7.2: Update user guide and command docs for Codex terminology
- **Location**: [docs/USER-GUIDE.md](/home/soso/get-shit-done/docs/USER-GUIDE.md), [commands/gsd](/home/soso/get-shit-done/commands/gsd)
- **Description**: Ensure the guide distinguishes slash-command syntax from Codex skill syntax, clarifies runtime differences, and links to Codex-specific troubleshooting.
- **Dependencies**: Task 7.1
- **Acceptance Criteria**:
  - Codex examples use `$gsd-*` consistently.
  - Runtime-specific caveats are visible, not buried in notes.
- **Validation**:
  - Spot-check guide examples against installed Codex output.

### Task 7.3: Prepare release checklist for Codex parity
- **Location**: release checklist doc or existing maintainer workflow docs
- **Description**: Add release gates for Codex: integration tests pass, no leaked `.claude` references in Codex output, docs updated, install/uninstall manually smoke-tested.
- **Dependencies**: Sprint 5, Sprint 7.2
- **Acceptance Criteria**:
  - Codex parity is part of release discipline, not a one-off effort.
- **Validation**:
  - Maintainer checklist includes Codex gates.

## Testing Strategy

- Unit tests for conversion and config merge helpers.
- Snapshot tests for generated Codex skills and agents.
- Integration tests for:
  - global/local install
  - reinstall/idempotency
  - uninstall cleanup
  - manifest/update/reapply-patches behavior
- Leak scans over installed Codex artifacts to catch stale `.claude` or slash-command references.
- Manual smoke tests:
  - `$gsd-help`
  - `$gsd-new-project`
  - `$gsd-map-codebase`
  - `$gsd-plan-phase`
  - `$gsd-execute-phase`

## Potential Risks and Gotchas

- The repo currently depends on large amounts of source text containing Claude semantics. Migrating too aggressively may break other runtimes unless the runtime-neutral layer is introduced first.
- Codex feature availability can vary by version and flag state. A safe adaptation must feature-detect or degrade gracefully rather than assuming all features exist.
- Hook parity may not be achievable in Codex. Treat this as a product decision, not an implementation detail.
- Install-time string replacement currently hides source-quality issues. Once stricter tests exist, a large number of latent path/reference leaks may surface at once.

## Rollback Plan

- Keep Codex refactors behind isolated helper modules and small PRs.
- Preserve the current installer pathway until each new path has passing tests.
- If runtime-neutral authoring proves too disruptive, stop after Sprint 4 and keep the current source format while still shipping stronger tests and docs.

## Recommended Execution Order

1. Sprint 1
2. Sprint 2
3. Sprint 3
4. Sprint 4
5. Sprint 5
6. Sprint 6
7. Sprint 7

Do not start with hook parity or docs polish. The highest-leverage first move is to define the Codex contract, then refactor the conversion layer and wrapper surface, then add real integration tests around install/uninstall/update paths.
