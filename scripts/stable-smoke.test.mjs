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
    'note-open-save',
    'settings-open-no-terminal',
    'command-note-invocation',
    'shell-boot-tabs',
    'shell-pane-tree-input',
    'utility-destination-isolation',
    'hidden-window-command-server',
    'preview-layout',
  ]);
  assert.equal(smokeScenarios.every((scenario) => scenario.timeoutMs > 0), true);
  assert.equal(smokeScenarios.every((scenario) => scenario.file.startsWith('apps/desktop/tests/e2e/')), true);
});

test('buildPlaywrightArgs preserves the focused grep and config', () => {
  const scenario = smokeScenarios.find((candidate) => candidate.name === 'utility-destination-isolation');
  assert.ok(scenario);
  const args = buildPlaywrightArgs(scenario);

  assert.deepEqual(args.slice(0, 3), ['test', '-c', 'apps/desktop/playwright.config.ts']);
  assert.equal(args[3], 'apps/desktop/tests/e2e/preview-pane-layout.spec.ts');
  assert.equal(args[4], '--grep');
  assert.match(args[5], /switches one utility pane/);
  assert.doesNotMatch(args[5], /uses one full-width preview surface/);
});

test('every stable smoke target collects exactly one Playwright test', () => {
  for (const scenario of smokeScenarios) {
    const result = spawnSync(playwrightExecutable(), [...buildPlaywrightArgs(scenario), '--list'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;

    assert.equal(result.status, 0, `${scenario.name}:\n${output}`);
    assert.match(output, /Total: 1 test\b/, `${scenario.name}:\n${output}`);
  }
});

test('stable smoke rejects a skipped or fixme Playwright target', () => {
  const result = spawnSync(playwrightExecutable(), [
    'test',
    '-c',
    'scripts/fixtures/stable-smoke.playwright.config.mjs',
    '--reporter',
    './scripts/stable-smoke-reporter.mjs',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /\[stable:smoke\].*skipped or fixme/i);
});

test('selectScenarios filters by name and rejects unknown scenario names', () => {
  assert.deepEqual(
    selectScenarios(['--scenario', 'preview-layout', '--scenario=command-note-invocation']).map((scenario) => scenario.name),
    ['preview-layout', 'command-note-invocation'],
  );
  assert.deepEqual(selectScenarios(['--', '--scenario', 'fixture-hygiene']).map((scenario) => scenario.name), ['fixture-hygiene']);
  assert.deepEqual(
    selectScenarios([]).map((scenario) => scenario.name),
    smokeScenarios.map((scenario) => scenario.name),
  );

  assert.throws(() => selectScenarios(['--scenario', 'missing']), /Unknown stable:smoke scenario "missing"/);
  assert.throws(() => selectScenarios(['--scenario']), /requires a scenario name/);
  assert.throws(() => selectScenarios(['--include-quarantine']), /Unknown stable:smoke argument/);
});

test('scenarioSummary includes attribution fields operators need after a timeout', () => {
  const scenario = smokeScenarios.find((candidate) => candidate.name === 'hidden-window-command-server');
  assert.ok(scenario);
  const summary = scenarioSummary(scenario);

  assert.match(summary, /hidden-window-command-server/);
  assert.match(summary, /shell\.spec\.ts/);
  assert.match(summary, /keeps the command server available/);
  assert.match(summary, /cap 75\.0s/);
});

test('formatDuration favors seconds for smoke phase logs', () => {
  assert.equal(formatDuration(250), '250ms');
  assert.equal(formatDuration(65_000), '65.0s');
});
