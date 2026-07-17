(async function bootSigmaGraphBench() {
  const startedAt = performance.now();
  const query = new URLSearchParams(location.search);
  const response = await fetch(query.get('topology') || '/__graphbench_fixture__.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Fixture failed to load (${response.status})`);
  const fixture = await response.json();
  const Graph = globalThis.graphology?.Graph;
  const SigmaRenderer = globalThis.Sigma;
  if (!Graph || !SigmaRenderer) throw new Error('Pinned Graphology or Sigma bundle did not load');

  const graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
  for (const node of fixture.nodes) {
    graph.addNode(String(node.id), {
      x: Number(node.x),
      y: Number(node.y),
      size: 1.8,
      color: '#6b9189',
      label: node.label || String(node.id),
    });
  }
  for (let index = 0; index < fixture.edges.length; index += 1) {
    const edge = fixture.edges[index];
    graph.addUndirectedEdgeWithKey(String(index), String(edge.source), String(edge.target), {
      size: 0.28,
      color: '#c9cec8',
    });
  }

  const renderer = new SigmaRenderer(graph, document.querySelector('#sigma-root'), {
    renderLabels: query.get('labels') !== '0',
    renderEdgeLabels: false,
    hideEdgesOnMove: false,
    allowInvalidContainer: false,
    enableEdgeEvents: false,
    zIndex: false,
  });
  let frameCount = 0;
  renderer.on('afterRender', () => { frameCount += 1; });
  renderer.refresh();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  globalThis.__graphBenchSigma = {
    snapshot() {
      return {
        engine: 'sigma',
        version: '3.0.3',
        renderer: 'webgl',
        ready: true,
        readyMs: performance.now() - startedAt,
        nodeCount: graph.order,
        edgeCount: graph.size,
        frameCount,
        labels: { supported: query.get('labels') !== '0' },
        layout: { supported: false },
      };
    },
    actions: {
      render: () => renderer.refresh(),
      positions: () => {
        const values = new Array(graph.order * 2);
        let offset = 0;
        graph.forEachNode((node, attributes) => {
          values[offset++] = attributes.x;
          values[offset++] = attributes.y;
        });
        return { dimensions: 2, values };
      },
      select: (index) => {
        const key = String(index);
        if (!graph.hasNode(key)) return false;
        graph.updateEachNodeAttributes((node, attributes) => ({
          ...attributes,
          color: node === key ? '#bf6840' : '#6b9189',
          size: node === key ? 4 : 1.8,
        }));
        renderer.refresh();
        return true;
      },
      destroy: () => renderer.kill(),
    },
  };
})().catch((error) => {
  console.error(error);
  globalThis.__graphBenchSigma = {
    snapshot: () => ({ engine: 'sigma', renderer: 'webgl', ready: false, error: error.message }),
    actions: {},
  };
});
