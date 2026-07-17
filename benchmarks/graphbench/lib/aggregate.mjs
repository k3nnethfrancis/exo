import { summarize } from './metrics.mjs';

export function resolveRepetitions(raw, fallback = 1) {
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error('--repetitions must be an integer from 1 to 20');
  }
  return value;
}

export function aggregateResults(results) {
  const groups = new Map();
  for (const result of results) {
    const key = [result.engine, result.track, result.fixture.checksum].join(':');
    let group = groups.get(key);
    if (!group) {
      group = {
        engine: result.engine,
        engineVersion: result.engineVersion,
        track: result.track,
        fixture: result.fixture,
        trials: [],
      };
      groups.set(key, group);
    }
    group.trials.push(result);
  }
  return [...groups.values()].map((group) => {
    const measured = group.trials.filter((trial) => trial.status === 'measured');
    const primaryValues = measured.map(primaryMetric).filter(Number.isFinite);
    return {
      engine: group.engine,
      engineVersion: group.engineVersion,
      track: group.track,
      fixture: group.fixture,
      attempted: group.trials.length,
      measured: measured.length,
      failed: group.trials.length - measured.length,
      primaryMetric: group.track === 'render' ? 'frame-p95-ms' : group.track === 'product' ? 'input-to-frame-p95-ms' : group.track === 'resilience' ? 'recovery-ms' : 'settled-ms',
      distribution: summarize(primaryValues),
    };
  });
}

function primaryMetric(result) {
  if (result.track === 'render') return result.measurements?.frame?.p95;
  if (result.track === 'product') return result.measurements?.inputToFrame?.p95;
  if (result.track === 'resilience') return result.measurements?.recoveryMs;
  return result.measurements?.settledMs;
}
