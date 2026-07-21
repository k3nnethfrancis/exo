#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { runTraceAssessment } from './runner.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  const assessment = await runTraceAssessment(options);
  process.stdout.write(`Trace assessment complete: ${assessment.runs.length} runs; Workspace unchanged.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args[0] === '--') args = args.slice(1);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Expected --name value, received ${flag ?? '<end>'}`);
    values.set(flag.slice(2), value);
  }
  for (const required of ['workspace', 'skill', 'output']) {
    if (!values.get(required)) throw new Error(`Missing required --${required}`);
  }
  const runs = Number(values.get('runs') ?? '5');
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be an integer from 1 to 20');
  return {
    workspace: path.resolve(values.get('workspace')),
    skill: path.resolve(values.get('skill')),
    output: path.resolve(values.get('output')),
    runs,
    claudeExecutable: values.get('claude-executable') ?? 'claude',
    codexExecutable: values.get('codex-executable') ?? 'codex',
  };
}
