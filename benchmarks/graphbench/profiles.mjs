export const PROFILES = Object.freeze({
  smoke: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['exo', 'sigma'],
    tracks: ['render', 'product'],
    repetitions: 1,
    viewport: 'desktop',
  }),
  compare: Object.freeze({
    cases: [
      { nodes: 10_000, edgeRatio: 2 },
      { nodes: 10_000, edgeRatio: 10 },
      { nodes: 50_000, edgeRatio: 2 },
    ],
    engines: ['exo', 'sigma', 'graphwagu'],
    tracks: ['render'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  'layout-smoke': Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['exo'],
    tracks: ['layout'],
    repetitions: 1,
    viewport: 'desktop',
  }),
  standard: Object.freeze({
    cases: [10_000, 50_000].flatMap((nodes) => [2, 5, 10].map((edgeRatio) => ({ nodes, edgeRatio }))),
    engines: ['exo', 'sigma'],
    tracks: ['render', 'layout', 'product'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  full: Object.freeze({
    cases: [10_000, 50_000, 100_000, 200_000]
      .flatMap((nodes) => [2, 5, 10, 20].map((edgeRatio) => ({ nodes, edgeRatio }))),
    engines: ['exo', 'sigma', 'graphwagu'],
    tracks: ['render', 'layout', 'product'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  million: Object.freeze({
    cases: [500_000, 1_000_000].map((nodes) => ({ nodes, edgeRatio: 2 })),
    engines: ['exo'],
    tracks: ['render', 'product'],
    repetitions: 3,
    viewport: 'desktop',
  }),
  mobile: Object.freeze({
    cases: [{ nodes: 10_000, edgeRatio: 2 }],
    engines: ['exo'],
    tracks: ['product'],
    repetitions: 3,
    viewport: 'mobile',
  }),
});

export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 960, deviceScaleFactor: 1 }),
  mobile: Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2 }),
});
export const SEED = 'exo-graphbench-v1';
