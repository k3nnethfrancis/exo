import { summarize } from './metrics.mjs';

const VARIANTS = new Set(['baseline', 'without-suggestions', 'with-suggestions']);

export function evaluateKnowledgeUsefulness(tasks, observations) {
  validateTasks(tasks);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set();
  const results = observations.map((observation) => {
    const task = taskById.get(observation.taskId);
    if (!task) throw new Error(`Observation references unknown task: ${observation.taskId}`);
    const variant = observation.variant || 'baseline';
    if (!VARIANTS.has(variant)) throw new Error(`Unknown knowledge-usefulness variant: ${variant}`);
    const key = `${observation.taskId}:${variant}`;
    if (seen.has(key)) throw new Error(`Duplicate observation: ${key}`);
    seen.add(key);
    return {
      taskId: task.id,
      variant,
      answerCorrect: observation.answerCorrect === true,
      evidenceRecall: recall(task.expectedEvidenceNoteIds, observation.evidenceNoteIds),
      pathRecall: recall(task.expectedPathNodeIds || [], observation.pathNodeIds || []),
      semanticNeighborRecall: recall(task.expectedSemanticNeighborIds || [], observation.semanticNeighborIds || []),
      tokensLoaded: finiteNonNegative(observation.tokensLoaded, 'tokensLoaded'),
      toolCalls: finiteNonNegative(observation.toolCalls, 'toolCalls'),
      elapsedMs: finiteNonNegative(observation.elapsedMs, 'elapsedMs'),
    };
  });
  return {
    schemaVersion: 1,
    taskCount: tasks.length,
    observationCount: results.length,
    variants: summarizeVariants(results),
    counterfactuals: compareCounterfactuals(results),
    results,
  };
}

export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('Knowledge-usefulness tasks must be a non-empty array');
  const ids = new Set();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !task.id) throw new Error('Every task requires an id');
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (typeof task.query !== 'string' || !task.query) throw new Error(`Task ${task.id} requires a query`);
    if (!Array.isArray(task.expectedEvidenceNoteIds) || !task.expectedEvidenceNoteIds.length) {
      throw new Error(`Task ${task.id} requires expectedEvidenceNoteIds`);
    }
  }
  return true;
}

function summarizeVariants(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.variant)) groups.set(result.variant, []);
    groups.get(result.variant).push(result);
  }
  return Object.fromEntries([...groups].map(([variant, values]) => [variant, {
    count: values.length,
    answerSuccessRate: mean(values.map((value) => value.answerCorrect ? 1 : 0)),
    evidenceRecall: summarize(values.map((value) => value.evidenceRecall)),
    pathRecall: summarize(values.map((value) => value.pathRecall).filter((value) => value !== null)),
    semanticNeighborRecall: summarize(values.map((value) => value.semanticNeighborRecall).filter((value) => value !== null)),
    tokensLoaded: summarize(values.map((value) => value.tokensLoaded)),
    toolCalls: summarize(values.map((value) => value.toolCalls)),
    elapsedMs: summarize(values.map((value) => value.elapsedMs)),
  }]));
}

function compareCounterfactuals(results) {
  const byTask = new Map();
  for (const result of results) {
    if (!byTask.has(result.taskId)) byTask.set(result.taskId, new Map());
    byTask.get(result.taskId).set(result.variant, result);
  }
  const comparisons = [];
  for (const [taskId, variants] of byTask) {
    const baseline = variants.get('baseline');
    const suggested = variants.get('with-suggestions');
    if (!baseline || !suggested) continue;
    comparisons.push({
      taskId,
      answerCorrectDelta: Number(suggested.answerCorrect) - Number(baseline.answerCorrect),
      evidenceRecallDelta: suggested.evidenceRecall - baseline.evidenceRecall,
      pathRecallDelta: nullableDelta(suggested.pathRecall, baseline.pathRecall),
      semanticNeighborRecallDelta: nullableDelta(suggested.semanticNeighborRecall, baseline.semanticNeighborRecall),
      tokensLoadedDelta: suggested.tokensLoaded - baseline.tokensLoaded,
      toolCallsDelta: suggested.toolCalls - baseline.toolCalls,
      elapsedMsDelta: suggested.elapsedMs - baseline.elapsedMs,
    });
  }
  return comparisons;
}

function recall(expected, observed) {
  if (!expected.length) return null;
  const uniqueExpected = new Set(expected);
  const found = new Set(observed || []);
  let matches = 0;
  for (const id of uniqueExpected) if (found.has(id)) matches += 1;
  return matches / uniqueExpected.size;
}

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a finite non-negative number`);
  return number;
}

function nullableDelta(next, previous) {
  return next === null || previous === null ? null : next - previous;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
