import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildPlaywrightArgs,
  formatDuration,
  playwrightExecutable,
  repoRoot,
  scenarioSummary,
  selectScenarios,
  smokeScenarios,
} from './stable-smoke.mjs';

test('stable smoke scenarios keep one named Playwright target per bounded phase', () => {
  assert.deepEqual(smokeScenarios.map((scenario) => scenario.name), [
    'fixture-hygiene',
    'shell-boot-tabs',
    'shell-pane-tree-input',
    'shell-preview-terminal-input',
    'shell-relaunch-reattach',
    'terminal-monitor-mode',
    'hidden-window-command-server',
    'hidden-window-cli',
    'preview-layout',
    'terminal-geometry-baseline',
    'terminal-geometry-reconnect',
    'terminal-geometry-recoverable',
    'terminal-geometry-preview-recoverable',
  ]);
  assert.equal(smokeScenarios.every((scenario) => scenario.timeoutMs > 0), true);
  assert.equal(smokeScenarios.every((scenario) => scenario.file.startsWith('apps/desktop/tests/e2e/')), true);
});

test('buildPlaywrightArgs preserves the focused grep and config', () => {
  const args = buildPlaywrightArgs(smokeScenarios[1]);

  assert.deepEqual(args.slice(0, 3), ['test', '-c', 'apps/desktop/playwright.config.ts']);
  assert.equal(args[3], 'apps/desktop/tests/e2e/shell.spec.ts');
  assert.equal(args[4], '--grep');
  assert.match(args[5], /boots the shell/);
  assert.doesNotMatch(args[5], /accepts terminal keyboard input/);
});

test('shell preview smoke target collects exactly one Playwright test', () => {
  const scenario = smokeScenarios.find((candidate) => candidate.name === 'shell-preview-terminal-input');
  assert.ok(scenario, 'Expected a shell-only preview input smoke scenario.');

  const result = spawnSync(playwrightExecutable(), [...buildPlaywrightArgs(scenario), '--list'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Total: 1 test\b/);
});

test('selectScenarios filters by name and rejects unknown scenario names', () => {
  assert.deepEqual(
    selectScenarios(['--scenario', 'preview-layout', '--scenario=terminal-geometry-baseline']).map((scenario) => scenario.name),
    ['preview-layout', 'terminal-geometry-baseline'],
  );
  assert.deepEqual(selectScenarios(['--', '--scenario', 'fixture-hygiene']).map((scenario) => scenario.name), ['fixture-hygiene']);
  assert.deepEqual(
    selectScenarios([]).map((scenario) => scenario.name),
    smokeScenarios.filter((scenario) => !scenario.quarantine).map((scenario) => scenario.name),
  );
  assert.equal(selectScenarios([]).some((scenario) => scenario.name === 'terminal-geometry-preview-recoverable'), false);
  assert.equal(selectScenarios(['--include-quarantine']).some((scenario) => scenario.name === 'terminal-geometry-preview-recoverable'), true);
  assert.deepEqual(
    selectScenarios(['--scenario', 'terminal-geometry-preview-recoverable']).map((scenario) => scenario.name),
    ['terminal-geometry-preview-recoverable'],
  );

  assert.throws(() => selectScenarios(['--scenario', 'missing']), /Unknown stable:smoke scenario "missing"/);
  assert.throws(() => selectScenarios(['--scenario']), /requires a scenario name/);
});

test('scenarioSummary includes attribution fields operators need after a timeout', () => {
  const scenario = smokeScenarios.find((candidate) => candidate.name === 'hidden-window-cli');
  assert.ok(scenario);
  const summary = scenarioSummary(scenario);

  assert.match(summary, /hidden-window-cli/);
  assert.match(summary, /shell\.spec\.ts/);
  assert.match(summary, /supports CLI agent control/);
  assert.match(summary, /cap 75\.0s/);
});

test('formatDuration favors seconds for smoke phase logs', () => {
  assert.equal(formatDuration(250), '250ms');
  assert.equal(formatDuration(65_000), '65.0s');
});
