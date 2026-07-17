export const sigmaAdapter = Object.freeze({
  id: 'sigma',
  version: '3.0.3',
  available: true,
  contract: '__graphBenchSigma',
  surface: '#sigma-root',
  capabilities: { render: true, layout: false, product: false, dimensions: 2 },
  url(baseUrl, track, { presentationProfile = 'benchmark-v1' } = {}) {
    const labels = track === 'product' ? '1' : '0';
    return `${baseUrl}/benchmarks/graphbench/public/sigma.html?topology=/__graphbench_fixture__.json&labels=${labels}&profile=${encodeURIComponent(presentationProfile)}`;
  },
});
