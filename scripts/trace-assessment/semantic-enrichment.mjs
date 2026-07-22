import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renderDashboard } from './dashboard.mjs';
import { calculateSemanticAlignment } from './semantic.mjs';

export const defaultSentenceTransformerModel = 'sentence-transformers/all-MiniLM-L6-v2';

export async function enrichSemanticAssessment(assessment, options = {}) {
  const model = options.model ?? defaultSentenceTransformerModel;
  const embed = options.embed ?? ((texts) => sentenceTransformerEmbeddings(texts, {
    model,
    uvExecutable: options.uvExecutable,
  }));
  const semanticAlignment = await calculateSemanticAlignment(assessment.runs, embed, { model });
  return { ...assessment, semanticAlignment };
}

export async function enrichAssessmentFile(options) {
  const assessmentPath = path.resolve(options.assessmentPath);
  const outputPath = path.resolve(options.outputPath ?? assessmentPath);
  const assessment = JSON.parse(await readFile(assessmentPath, 'utf8'));
  const enriched = await enrichSemanticAssessment(assessment, options);
  await writeFile(outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
  await writeFile(path.join(path.dirname(outputPath), 'dashboard.html'), renderDashboard(enriched));
  return enriched;
}

async function sentenceTransformerEmbeddings(texts, options) {
  const bridge = path.join(import.meta.dirname, 'sentence-transformer.py');
  const result = await execute(
    options.uvExecutable ?? 'uv',
    ['run', '--quiet', '--with', 'sentence-transformers', 'python', bridge, options.model],
    `${JSON.stringify({ texts })}\n`,
  );
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Sentence transformer returned invalid JSON: ${result.stdout.slice(0, 240)}`);
  }
  if (!Array.isArray(payload.embeddings)) throw new Error('Sentence transformer response omitted embeddings');
  return payload.embeddings;
}

function execute(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HF_HUB_DISABLE_PROGRESS_BARS: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Sentence transformer failed (${signal ?? code}): ${stderr.trim() || stdout.trim()}`));
    });
    child.stdin.end(input);
  });
}
