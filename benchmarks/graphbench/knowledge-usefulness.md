# Knowledge-usefulness task contract

GraphBench does not derive “knowledge quality” from a force-directed shape. A
graph helps only when it improves a task against known evidence.

Each versioned task names:

- a query
- the corpus and source revision
- evidence notes required for a grounded answer
- an expected explainable path when one exists
- expected semantic neighbors when retrieval quality is under test

Each observation records the returned evidence, path, semantic neighbors,
answer correctness, tokens loaded, tool calls, and elapsed time. Runs use one of
three explicit variants: `baseline`, `without-suggestions`, or
`with-suggestions`.

GraphBench reports each dimension separately. It does not combine correctness,
recall, latency, and token cost into one scalar. Suggested tags or links earn a
product claim only when counterfactual task runs improve evidence or path recall
without unacceptable cost or regressions.

The evaluator is implemented in `lib/knowledge-usefulness.mjs`. Real launch
claims still require a frozen, permission-safe corpus and task set; the unit
fixture proves the contract, not Exo's usefulness.
