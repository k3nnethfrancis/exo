#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightConfig = 'apps/desktop/playwright.config.ts';

export const smokeScenarios = [
  {
    name: 'fixture-hygiene',
    file: 'apps/desktop/tests/e2e/fixture-hygiene.spec.ts',
    grep: 'copies mutable fixtures without ignored runtime debris',
    timeoutMs: 30_000,
  },
  {
    name: 'shell-boot-tabs',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'boots the shell, opens notes, and manages terminal tabs',
    timeoutMs: 75_000,
  },
  {
    name: 'shell-pane-tree-input',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'accepts terminal keyboard input in pane tree',
    timeoutMs: 60_000,
  },
  {
    name: 'shell-fake-claude-render',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'keeps fake Claude render stable and interactive while preview is open',
    timeoutMs: 85_000,
  },
  {
    name: 'shell-relaunch-reattach',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'reattaches a tmux-backed shell after app relaunch',
    timeoutMs: 85_000,
  },
  {
    name: 'terminal-monitor-mode',
    file: 'apps/desktop/tests/e2e/monitor-mode.spec.ts',
    grep: 'splits live terminals in monitor mode, reconciles geometry, and persists across relaunch',
    timeoutMs: 95_000,
  },
  {
    name: 'hidden-window-command-server',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'keeps the command server available while the window is hidden',
    timeoutMs: 75_000,
  },
  {
    name: 'hidden-window-cli-mcp',
    file: 'apps/desktop/tests/e2e/shell.spec.ts',
    grep: 'supports CLI and MCP agent control while the window is hidden',
    timeoutMs: 90_000,
  },
  {
    name: 'preview-layout',
    file: 'apps/desktop/tests/e2e/preview-pane-layout.spec.ts',
    grep: 'resizes preview/editor and preview/terminal splits while a preview frame is open',
    timeoutMs: 65_000,
  },
  {
    name: 'terminal-geometry-baseline',
    file: 'apps/desktop/tests/e2e/terminal-geometry.spec.ts',
    grep: 'Terminal V4\\.1 baseline fake Ink fixture reports one unwrapped wide frame',
    timeoutMs: 75_000,
  },
  {
    name: 'terminal-geometry-reconnect',
    file: 'apps/desktop/tests/e2e/terminal-geometry.spec.ts',
    grep: 'Terminal V4\\.1 reconnect-at-wrong-size keeps fixture width aligned after reconnect',
    timeoutMs: 75_000,
  },
  {
    name: 'terminal-geometry-recoverable',
    file: 'apps/desktop/tests/e2e/terminal-geometry.spec.ts',
    grep: 'Terminal V4\\.1 reconnect-recoverable route restores a detached fake Ink bridge',
    timeoutMs: 80_000,
  },
  {
    name: 'terminal-geometry-preview-recoverable',
    file: 'apps/desktop/tests/e2e/terminal-geometry.spec.ts',
    grep: 'Terminal V4\\.1 @quarantine-preview reconnect-recoverable route restores fake Ink with preview pane open',
    timeoutMs: 90_000,
    quarantine: true,
  },
];

export function playwrightExecutable(root = repoRoot) {
  return path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
}

export function buildPlaywrightArgs(scenario) {
  return [
    'test',
    '-c',
    playwrightConfig,
    scenario.file,
    '--grep',
    scenario.grep,
  ];
}

export function formatDuration(ms) {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function selectScenarios(args, scenarios = smokeScenarios) {
  const selected = [];
  let includeQuarantine = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--include-quarantine') {
      includeQuarantine = true;
      continue;
    }
    if (arg === '--scenario') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--scenario requires a scenario name');
      }
      selected.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--scenario=')) {
      selected.push(arg.slice('--scenario='.length));
      continue;
    }
    if (arg === '--list' || arg === '--help') {
      continue;
    }
    throw new Error(`Unknown stable:smoke argument: ${arg}`);
  }

  if (selected.length === 0) {
    return scenarios.filter((scenario) => includeQuarantine || !scenario.quarantine);
  }

  const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario]));
  return selected.map((name) => {
    const scenario = byName.get(name);
    if (!scenario) {
      throw new Error(`Unknown stable:smoke scenario "${name}". Known scenarios: ${scenarios.map((candidate) => candidate.name).join(', ')}`);
    }
    return scenario;
  });
}

export function scenarioSummary(scenario) {
  const quarantineLabel = scenario.quarantine ? ' [quarantine]' : '';
  return `${scenario.name}${quarantineLabel}: ${scenario.file} --grep ${JSON.stringify(scenario.grep)} (cap ${formatDuration(scenario.timeoutMs)})`;
}

async function runScenario(scenario, { root = repoRoot, log = console.error } = {}) {
  const executable = playwrightExecutable(root);
  if (!existsSync(executable)) {
    throw new Error(`Playwright executable not found at ${path.relative(root, executable)}. Run pnpm install --frozen-lockfile before pnpm stable:smoke.`);
  }

  const startedAt = Date.now();
  const args = buildPlaywrightArgs(scenario);
  log(`[stable:smoke] START ${scenarioSummary(scenario)}`);
  log(`[stable:smoke] CMD ${path.relative(root, executable)} ${args.map(shellDisplay).join(' ')}`);

  await runCommand(executable, args, {
    cwd: root,
    timeoutMs: scenario.timeoutMs,
    scenarioName: scenario.name,
  });

  log(`[stable:smoke] PASS ${scenario.name} in ${formatDuration(Date.now() - startedAt)}`);
}

function runCommand(command, args, { cwd, timeoutMs, scenarioName }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      process.stderr.write(`\n[stable:smoke] TIMEOUT ${scenarioName} exceeded ${formatDuration(timeoutMs)}; terminating Playwright process group.\n`);
      killChild(child, 'SIGTERM');
      setTimeout(() => {
        if (!settled) {
          process.stderr.write(`[stable:smoke] TIMEOUT ${scenarioName} still running after SIGTERM; sending SIGKILL.\n`);
          killChild(child, 'SIGKILL');
        }
      }, 5_000).unref();
    }, timeoutMs);
    timeout.unref();

    child.on('error', (error) => {
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timeout);
      if (code === 0 && !timedOut) {
        resolve();
        return;
      }
      const reason = timedOut
        ? `timed out after ${formatDuration(timeoutMs)}`
        : signal
          ? `failed with signal ${signal}`
          : `failed with exit code ${code}`;
      reject(new Error(`stable:smoke scenario "${scenarioName}" ${reason}`));
    });
  });
}

function killChild(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The child may have exited between timeout handling and the signal.
  }
}

function shellDisplay(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.error('Usage: pnpm stable:smoke [-- --list] [-- --include-quarantine] [-- --scenario <name> ...]');
    console.error('');
    console.error('Scenarios:');
    for (const scenario of smokeScenarios) {
      console.error(`  ${scenarioSummary(scenario)}`);
    }
    return;
  }
  if (args.includes('--list')) {
    for (const scenario of smokeScenarios) {
      console.log(scenarioSummary(scenario));
    }
    return;
  }

  const scenarios = selectScenarios(args);
  const startedAt = Date.now();
  console.error(`[stable:smoke] running ${scenarios.length} scenario(s) serially with per-scenario process caps`);
  for (const scenario of scenarios) {
    await runScenario(scenario);
  }
  console.error(`[stable:smoke] all ${scenarios.length} scenario(s) passed in ${formatDuration(Date.now() - startedAt)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[stable:smoke] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
