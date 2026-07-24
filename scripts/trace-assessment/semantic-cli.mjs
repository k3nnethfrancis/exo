#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { defaultSentenceTransformerModel, enrichAssessmentFile } from './semantic-enrichment.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  const assessment = await enrichAssessmentFile(options);
  process.stdout.write(`Semantic alignment added with ${assessment.semanticAlignment.model}.\n`);
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
  if (!values.get('assessment')) throw new Error('Missing required --assessment');
  return {
    assessmentPath: path.resolve(values.get('assessment')),
    outputPath: values.get('output') ? path.resolve(values.get('output')) : undefined,
    model: values.get('model') ?? defaultSentenceTransformerModel,
    uvExecutable: values.get('uv-executable') ?? 'uv',
  };
}
