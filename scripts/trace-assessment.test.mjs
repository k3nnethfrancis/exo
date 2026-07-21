import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'trace-assessment', 'cli.mjs');

test('mini trace assessment runs fresh Claude and Codex sessions without changing the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'exo-trace-assessment-'));
  const workspace = path.join(root, 'workspace');
  const output = path.join(root, 'output');
  const bin = path.join(root, 'bin');
  await mkdir(workspace);
  await mkdir(bin);
  await writeFile(path.join(workspace, 'one.md'), '# One\n\n[[two]]\n');
  await writeFile(path.join(workspace, 'two.md'), '# Two\n');
  const skill = path.join(root, 'SKILL.md');
  await writeFile(skill, '# Design workspace ontology\n\nInspect only. Write nothing.\n');

  const claude = path.join(bin, 'claude-fixture');
  const codex = path.join(bin, 'codex-fixture');
  await writeExecutable(claude, claudeFixture());
  await writeExecutable(codex, codexFixture());

  const result = spawnSync(process.execPath, [
    cliPath,
    '--',
    '--workspace', workspace,
    '--skill', skill,
    '--output', output,
    '--runs', '2',
    '--claude-executable', claude,
    '--codex-executable', codex,
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const assessment = JSON.parse(await readFile(path.join(output, 'assessment.json'), 'utf8'));
  assert.equal(assessment.runs.length, 4);
  assert.deepEqual(assessment.runs.map((run) => run.provider), ['claude', 'claude', 'codex', 'codex']);
  assert.equal(new Set(assessment.runs.map((run) => run.sessionId)).size, 4);
  assert.equal(assessment.runs.every((run) => run.status === 'completed'), true);
  const claudeRun = assessment.runs.find((run) => run.provider === 'claude');
  const codexRun = assessment.runs.find((run) => run.provider === 'codex');
  assert.ok(claudeRun);
  assert.ok(codexRun);
  assert.deepEqual(claudeRun.command.argv.slice(claudeRun.command.argv.indexOf('--tools'), claudeRun.command.argv.indexOf('--tools') + 2), ['--tools', 'Read,Glob,Grep']);
  assert.equal(claudeRun.command.argv.includes('--no-session-persistence'), true);
  assert.deepEqual(codexRun.command.argv.slice(codexRun.command.argv.indexOf('--sandbox'), codexRun.command.argv.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.equal(codexRun.command.argv.includes('--ephemeral'), true);
  assert.equal(assessment.runs.every((run) => run.events.every((event) => Number.isFinite(event.atMs))), true);
  assert.equal(assessment.runs.every((run) => run.events.every((event, index) => index === 0 || event.atMs >= run.events[index - 1].atMs)), true);
  assert.equal(assessment.workspace.unchanged, true);
  assert.equal(assessment.workspace.beforeSha256, assessment.workspace.afterSha256);
  assert.equal(await readFile(path.join(workspace, 'one.md'), 'utf8'), '# One\n\n[[two]]\n');
  assert.equal(await readFile(path.join(workspace, 'two.md'), 'utf8'), '# Two\n');
  assert.equal(assessment.agreement.overall.pairwiseMeanJaccard > 0, true);
  assert.equal(assessment.agreement.overall.pairwiseMeanJaccard < 1, true);
  const dashboard = await readFile(path.join(output, 'dashboard.html'), 'utf8');
  assert.match(dashboard, /Claude 01/);
  assert.match(dashboard, /Codex 02/);
  assert.match(dashboard, /Trace overlay/);
  assert.match(dashboard, /Pairwise Jaccard/);
  assert.match(dashboard, /Inter-run agreement/);
  assert.match(dashboard, /Session fixture-/);
  assert.match(dashboard, /Evidence/);
  assert.match(dashboard, /one\.md/);
  assert.match(dashboard, /links to two\.md/);
  assert.match(dashboard, /Observed ambiguity/);
});

test('mini trace assessment stops before the next run when a harness changes the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'exo-trace-mutation-'));
  const workspace = path.join(root, 'workspace');
  const output = path.join(root, 'output');
  const bin = path.join(root, 'bin');
  await mkdir(workspace);
  await mkdir(bin);
  await writeFile(path.join(workspace, 'note.md'), '# Note\n');
  const skill = path.join(root, 'SKILL.md');
  await writeFile(skill, '# Inspect only\n');
  const claude = path.join(bin, 'claude-mutating');
  const codex = path.join(bin, 'codex-must-not-run');
  await writeExecutable(claude, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('mutation.md', 'changed');\n${claudeFixture().split('\n').slice(1).join('\n')}`);
  await writeExecutable(codex, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(root, 'codex-called'))}, 'yes');\n`);

  const result = spawnSync(process.execPath, [
    cliPath, '--workspace', workspace, '--skill', skill, '--output', output,
    '--runs', '1', '--claude-executable', claude, '--codex-executable', codex,
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Workspace changed during claude-01: mutation\.md/);
  await assert.rejects(readFile(path.join(root, 'codex-called')), /ENOENT/);
});

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source);
  await chmod(filePath, 0o755);
}

function claudeFixture() {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
const sessionId = args[args.indexOf('--session-id') + 1];
const proposal = ${JSON.stringify(fixtureProposal('claude'))};
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fixture-claude' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'Inspecting workspace' }] } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', session_id: sessionId, structured_output: proposal, result: JSON.stringify(proposal) }) + '\\n');
`;
}

function codexFixture() {
  return `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outputPath = args[args.indexOf('--output-last-message') + 1];
const proposal = ${JSON.stringify({
  ...fixtureProposal('codex'),
  features: { ...fixtureProposal('codex').features, properties: ['title', 'tags'] },
})};
writeFileSync(outputPath, JSON.stringify(proposal));
const threadId = 'fixture-' + Math.random().toString(16).slice(2);
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'Inspecting workspace' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n');
`;
}

function fixtureProposal(provider) {
  return {
    outcome: 'proposal',
    summary: `${provider} proposal`,
    candidateSource: 'ontology_schema: 1\\n',
    features: {
      conceptTypes: ['note'],
      properties: ['title'],
      relations: ['links-to'],
      pathDefaults: [],
      validationRules: [],
    },
    evidence: [{ path: 'one.md', detail: 'links to two.md' }],
    conflicts: ['Observed ambiguity'],
    question: null,
  };
}
