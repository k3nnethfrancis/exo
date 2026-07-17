export const exoAdapter = Object.freeze({
  id: 'exo',
  version: 'stellar-1',
  available: true,
  contract: '__exoStellarLab',
  surface: '#stellar-shell',
  capabilities: { render: true, layout: true, product: true, resilience: true, dimensions: 3 },
  url(baseUrl, track, { presentationProfile = 'benchmark-v1' } = {}) {
    const staticLayout = track === 'layout' ? '' : '&layout=static';
    const labels = track === 'product' ? '1' : '0';
    return `${baseUrl}/benchmarks/graphbench/public/exo/stellar.html?benchmark=1&profile=${encodeURIComponent(presentationProfile)}&topology=/__graphbench_fixture__.json${staticLayout}&labels=${labels}`;
  },
});
