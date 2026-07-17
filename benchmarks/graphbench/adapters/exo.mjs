export const exoAdapter = Object.freeze({
  id: 'exo',
  version: 'stellar-1',
  available: true,
  contract: '__exoStellarLab',
  surface: '#stellar-shell',
  capabilities: { render: true, layout: true, product: true, dimensions: 3 },
  url(baseUrl, track) {
    const staticLayout = track === 'layout' ? '' : '&layout=static';
    const labels = track === 'product' ? '1' : '0';
    return `${baseUrl}/benchmarks/graphbench/public/exo/stellar.html?benchmark=1&profile=benchmark-v1&topology=/__graphbench_fixture__.json${staticLayout}&labels=${labels}`;
  },
});
