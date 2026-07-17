import assert from 'node:assert/strict';
import { evaluateKnowledgeUsefulness, validateTasks } from './lib/knowledge-usefulness.mjs';

const tasks = [{
  id: 'find-design-rationale',
  query: 'Why was the graph projection made non-canonical?',
  expectedEvidenceNoteIds: ['projection-contract', 'graph-report'],
  expectedPathNodeIds: ['question', 'projection-contract', 'graph-report'],
  expectedSemanticNeighborIds: ['projection-contract'],
}];
const evaluation = evaluateKnowledgeUsefulness(tasks, [
  {
    taskId: tasks[0].id,
    variant: 'baseline',
    answerCorrect: false,
    evidenceNoteIds: ['projection-contract'],
    pathNodeIds: ['question', 'projection-contract'],
    semanticNeighborIds: [],
    tokensLoaded: 2400,
    toolCalls: 5,
    elapsedMs: 1800,
  },
  {
    taskId: tasks[0].id,
    variant: 'with-suggestions',
    answerCorrect: true,
    evidenceNoteIds: ['projection-contract', 'graph-report'],
    pathNodeIds: ['question', 'projection-contract', 'graph-report'],
    semanticNeighborIds: ['projection-contract'],
    tokensLoaded: 1600,
    toolCalls: 3,
    elapsedMs: 1200,
  },
]);

assert.equal(evaluation.variants.baseline.evidenceRecall.p50, 0.5);
assert.equal(evaluation.variants['with-suggestions'].answerSuccessRate, 1);
assert.equal(evaluation.counterfactuals[0].evidenceRecallDelta, 0.5);
assert.equal(evaluation.counterfactuals[0].tokensLoadedDelta, -800);
assert.throws(() => validateTasks([]), /non-empty/);
assert.throws(() => evaluateKnowledgeUsefulness(tasks, [{ taskId: 'missing' }]), /unknown task/);

console.log(JSON.stringify({ status: 'passed', evaluation }, null, 2));
