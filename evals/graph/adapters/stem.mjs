export const stemAdapter = Object.freeze({
  id: 'stem',
  version: 'stellar-1',
  available: true,
  contract: '__stemStellarLab',
  surface: '#stellar-shell',
  capabilities: { render: true, layout: true, product: true, resilience: true, incremental: true, dimensions: 3 },
  url(baseUrl, track, { presentationProfile = 'evaluation-v1' } = {}) {
    const staticLayout = track === 'layout' || track === 'incremental' ? '' : '&layout=static';
    const labels = track === 'product' ? '1' : '0';
    return `${baseUrl}/evals/graph/public/harness/stellar.html?profile=${encodeURIComponent(presentationProfile)}&topology=/__graph_eval_fixture__.json${staticLayout}&labels=${labels}`;
  },
});
