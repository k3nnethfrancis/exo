export function calculateAgreement(runs) {
  const completed = runs.filter((run) => run.status === 'completed' && run.response);
  return {
    overall: summarizePairs(completed),
    claude: summarizePairs(completed.filter((run) => run.provider === 'claude')),
    codex: summarizePairs(completed.filter((run) => run.provider === 'codex')),
    crossProvider: summarizePairs(completed, (left, right) => left.provider !== right.provider),
    featureMatrix: featureMatrix(completed),
  };
}

function summarizePairs(runs, includePair = () => true) {
  const vectors = runs.map((run) => ({ id: run.id, features: featureSet(run.response) }));
  const pairs = [];
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      const leftRun = runs[left];
      const rightRun = runs[right];
      if (!includePair(leftRun, rightRun)) continue;
      const score = jaccard(vectors[left].features, vectors[right].features);
      pairs.push({ left: vectors[left].id, right: vectors[right].id, jaccard: score, exact: score === 1 });
    }
  }
  const pairwiseMeanJaccard = pairs.length === 0 ? null : mean(pairs.map((pair) => pair.jaccard));
  const exactPairRate = pairs.length === 0 ? null : mean(pairs.map((pair) => pair.exact ? 1 : 0));
  return {
    runCount: runs.length,
    pairCount: pairs.length,
    pairwiseMeanJaccard,
    exactPairRate,
    interRunAgreement: nominalBinaryAgreement(vectors.map((vector) => vector.features)),
    pairs,
  };
}

function featureMatrix(runs) {
  const vectors = runs.map((run) => ({ id: run.id, features: featureSet(run.response) }));
  const features = [...new Set(vectors.flatMap((vector) => [...vector.features]))].sort();
  return {
    runs: vectors.map((vector) => vector.id),
    rows: features.map((feature) => ({
      feature,
      present: vectors.map((vector) => vector.features.has(feature)),
      count: vectors.filter((vector) => vector.features.has(feature)).length,
    })),
  };
}

function featureSet(response) {
  const result = new Set([`outcome:${normalize(response.outcome)}`]);
  const categories = [
    ['type', response.features?.conceptTypes],
    ['property', response.features?.properties],
    ['relation', response.features?.relations],
    ['path-default', response.features?.pathDefaults],
    ['validation', response.features?.validationRules],
  ];
  for (const [category, values] of categories) {
    for (const value of values ?? []) result.add(`${category}:${normalize(value)}`);
  }
  for (const evidence of response.evidence ?? []) result.add(`evidence:${normalize(evidence.path)}`);
  return result;
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

// Exploratory Fleiss-style agreement over binary feature inclusion. Runs are
// stochastic samples, not independent human raters; the dashboard labels this
// as descriptive rather than a quality score.
function nominalBinaryAgreement(vectors) {
  if (vectors.length < 2) return null;
  const features = [...new Set(vectors.flatMap((vector) => [...vector]))];
  if (features.length === 0) return null;
  const raters = vectors.length;
  let observed = 0;
  let yes = 0;
  for (const feature of features) {
    const yesCount = vectors.filter((vector) => vector.has(feature)).length;
    const noCount = raters - yesCount;
    yes += yesCount;
    observed += ((yesCount * yesCount) + (noCount * noCount) - raters) / (raters * (raters - 1));
  }
  observed /= features.length;
  const pYes = yes / (features.length * raters);
  const expected = (pYes * pYes) + ((1 - pYes) * (1 - pYes));
  if (Math.abs(1 - expected) < Number.EPSILON) return observed === 1 ? 1 : null;
  return (observed - expected) / (1 - expected);
}

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
