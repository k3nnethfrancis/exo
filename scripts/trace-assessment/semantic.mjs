const featureCategories = [
  ['type', 'conceptTypes'],
  ['property', 'properties'],
  ['relation', 'relations'],
  ['path-default', 'pathDefaults'],
  ['validation', 'validationRules'],
];

export async function calculateSemanticAlignment(runs, embed, options = {}) {
  const completed = runs.filter((run) => run.status === 'completed' && run.response);
  const runFeatures = completed.map((run) => ({
    id: run.id,
    provider: run.provider,
    features: semanticFeatures(run.response),
  }));
  const texts = [...new Set(runFeatures.flatMap((run) => run.features.map((feature) => feature.value)))];
  const vectors = texts.length === 0 ? [] : await embed(texts);
  if (vectors.length !== texts.length) {
    throw new Error(`Sentence transformer returned ${vectors.length} vectors for ${texts.length} texts`);
  }
  const byText = new Map(texts.map((text, index) => [text, normalizeVector(vectors[index])]));
  for (const run of runFeatures) {
    for (const feature of run.features) feature.vector = byText.get(feature.value);
  }

  return {
    model: options.model ?? 'sentence-transformer',
    featureScope: featureCategories.map(([kind]) => kind),
    overall: summarizePairs(runFeatures),
    claude: summarizePairs(runFeatures.filter((run) => run.provider === 'claude')),
    codex: summarizePairs(runFeatures.filter((run) => run.provider === 'codex')),
    crossProvider: summarizePairs(runFeatures, (left, right) => left.provider !== right.provider),
  };
}

function summarizePairs(runs, includePair = () => true) {
  const pairs = [];
  for (let left = 0; left < runs.length; left += 1) {
    for (let right = left + 1; right < runs.length; right += 1) {
      if (!includePair(runs[left], runs[right])) continue;
      const comparison = compareFeatureSets(runs[left].features, runs[right].features);
      pairs.push({
        left: runs[left].id,
        right: runs[right].id,
        similarity: comparison.similarity,
        matches: comparison.matches,
      });
    }
  }
  const matches = deduplicateMatches(pairs.flatMap((pair) => pair.matches));
  return {
    runCount: runs.length,
    pairCount: pairs.length,
    pairwiseMeanSimilarity: pairs.length === 0 ? null : mean(pairs.map((pair) => pair.similarity)),
    matches,
    pairs,
  };
}

function compareFeatureSets(left, right) {
  if (left.length === 0 && right.length === 0) return { similarity: 1, matches: [] };
  const forward = directionalMatches(left, right);
  const backward = directionalMatches(right, left);
  return {
    similarity: mean([...forward.scores, ...backward.scores]),
    matches: deduplicateMatches([...forward.matches, ...backward.matches]),
  };
}

function directionalMatches(source, target) {
  const scores = [];
  const matches = [];
  for (const feature of source) {
    const candidates = target.filter((candidate) => candidate.kind === feature.kind);
    let best = null;
    for (const candidate of candidates) {
      const score = cosine(feature.vector, candidate.vector);
      if (!best || score > best.score) best = { candidate, score };
    }
    scores.push(best?.score ?? 0);
    if (best && lexicalSignature(feature.value) !== lexicalSignature(best.candidate.value)) {
      matches.push(canonicalMatch(feature, best.candidate, best.score));
    }
  }
  return { scores, matches };
}

function semanticFeatures(response) {
  const features = [];
  for (const [kind, key] of featureCategories) {
    for (const value of response.features?.[key] ?? []) {
      const normalized = normalizeText(value);
      if (normalized) features.push({ kind, value: normalized });
    }
  }
  return features;
}

function canonicalMatch(left, right, score) {
  const [first, second] = left.value.localeCompare(right.value) <= 0 ? [left, right] : [right, left];
  return { kind: left.kind, left: first.value, right: second.value, similarity: score };
}

function deduplicateMatches(matches) {
  const unique = new Map();
  for (const match of matches) {
    const key = `${match.kind}\0${match.left}\0${match.right}`;
    const current = unique.get(key);
    if (!current || match.similarity > current.similarity) unique.set(key, match);
  }
  return [...unique.values()].sort((left, right) => right.similarity - left.similarity
    || left.kind.localeCompare(right.kind)
    || left.left.localeCompare(right.left));
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function lexicalSignature(value) {
  return value
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function normalizeVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Sentence transformer returned an invalid embedding vector');
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (magnitude === 0) throw new Error('Sentence transformer returned a zero-length embedding vector');
  return vector.map((value) => value / magnitude);
}

function cosine(left, right) {
  if (left.length !== right.length) throw new Error('Sentence transformer returned inconsistent embedding dimensions');
  return Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + (value * right[index]), 0)));
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
