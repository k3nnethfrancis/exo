# Semantic and model-space projections

Exo's spatial renderer should visualize more than one kind of graph without collapsing them into one ontology. Markdown links, embedding similarity, and model internals describe different relationships with different truth conditions.

## Projection contract

Every visualization consumes a derived projection with an explicit descriptor:

```ts
interface SpatialProjectionDescriptor {
  id: string;
  version: string;
  kind: "structural" | "semantic" | "model-internal" | "composite";
  sourceRevision: string;
  canonical: false;
  nodeSchema: string;
  relationSchema: string;
  coordinateMethod: string;
  parameters: Record<string, string | number | boolean>;
  provenance: Array<{ source: string; revision?: string }>;
}
```

The hot renderer receives compact nodes, edges, coordinates, and presentation attributes. Labels, evidence, note paths, embedding metadata, and model metadata remain cold details fetched on demand. No projection becomes canonical knowledge merely because it is visible.

## Embedding-index projection

An embeddings view is the most direct extension of the Exo graph:

- one node per indexed note or chunk
- weighted edges for top-k semantic neighbors above a configured threshold
- structural wikilinks, tags, and folders available as separate edge layers
- cluster membership computed from the similarity graph, never inferred from screen position alone
- note path, model ID, embedding dimension, source hash, and index revision recorded as provenance

The useful interaction is comparison. A user can see where explicit structure agrees with semantic proximity, where near-duplicates exist without links, and where a note is structurally connected but semantically isolated. Suggested tags or links must be proposals backed by similarity evidence; Exo never writes them automatically.

Quality gates include neighborhood preservation after dimensionality reduction, trustworthiness/continuity, cluster stability across index revisions, retrieval recall on known-note tasks, and incremental-update displacement. A beautiful 2D/3D shape is insufficient evidence that the semantic projection is faithful.

## Open-model internal projection

Model weights are large tensors, not naturally useful as one-node-per-scalar graphs. Useful projections choose a meaningful unit of analysis:

- layers, attention heads, MLP blocks, or learned features as nodes
- token embeddings or residual-stream states as points
- activation trajectories across layers for one prompt
- similarity, influence, attention, attribution, or causal-intervention effects as typed relations
- Jacobian-derived relationships when “J-space” means local input/output sensitivity

Each view must identify the model checkpoint, tokenizer, prompt/dataset, hook locations, precision, reduction method, and sampling policy. Activation and attribution views are run-specific. Weight-derived views are checkpoint-specific. Neither should masquerade as the user's durable wiki graph.

Open-weight models make this feasible locally through model-specific capture adapters. The adapter emits bounded typed arrays and cold metadata into the same renderer-neutral projection contract. Exo should begin with offline snapshots rather than coupling the UI directly to a live inference process.

## Composite exploration

A composite view may connect notes to model behavior—for example, note chunks to the features they activate—but it must preserve layer identity:

- structural relation: authored or filesystem-derived
- semantic relation: embedding-model-derived
- model-internal relation: checkpoint/run-derived
- evaluation relation: task/evidence-derived

Visual styling can distinguish those layers. Filters can remove any derived layer. The renderer may blend them; the data model may not.

## Engineering sequence

1. Finish the current GraphBench suite and settle the open graph metadata,
   Knowledge Profile, and renderer-neutral projection contracts.
2. Verify that the configured index exposes vectors or a bounded top-k neighbor
   graph through a supported provider seam. Do not read QMD's private database.
3. If that seam is straightforward, add the smallest note-level embedding-index
   projection with model, source-hash, and index-revision provenance.
4. Benchmark 10K–1M semantic-neighbor edges, incremental index updates,
   projection fidelity, and semantic-only versus authored-only versus hybrid
   task utility.
5. Define a portable offline model-snapshot format using typed arrays plus a
   small descriptor.
6. Build one open-model tracer: token/residual activation trajectory for a
   single prompt.
7. Add task-conditioned evaluations before making claims about interpretability
   or agent usefulness.
