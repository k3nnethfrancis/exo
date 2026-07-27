export const PROFILES = Object.freeze({
  smoke: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['stem'],
    tracks: ['render', 'layout', 'product'],
    repetitions: 1,
    viewport: 'desktop',
  }),
  standard: Object.freeze({
    cases: [10_000, 50_000].flatMap((nodes) => [2, 5].map((edgeRatio) => ({ nodes, edgeRatio }))),
    engines: ['stem'],
    tracks: ['render', 'layout', 'product'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  mobile: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['stem'],
    tracks: ['product'],
    repetitions: 3,
    viewport: 'mobile',
  }),
  resilience: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['stem'],
    tracks: ['resilience'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  incremental: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['stem'],
    tracks: ['incremental'],
    repetitions: 3,
    viewport: 'desktop',
  }),
});

export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 960, deviceScaleFactor: 1 }),
  mobile: Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2 }),
});
export const SEED = 'stem-graph-eval-v1';
