# Public graph interoperability fixtures

These fixtures freeze the smallest public inputs needed to verify Exo's OKF
Format boundary without a renderer, runtime download, or second graph path.
Every copied or derived file is pinned in `manifest.json`.

## Google Knowledge Catalog

`google-knowledge-catalog/bundle/` is an unmodified five-file slice of the
public `crypto_bitcoin` OKF bundle. The selection omits unrelated concepts;
that omission is the only Exo-side change. The source is Apache-2.0 and the
repository's root `LICENSE` supplies the complete license text.

## LangChain OpenWiki

`langchain-openwiki/wiki/` is the deterministic output described by OpenWiki's
public `creates deterministic indexes for every directory` test at the pinned
release. It contains that test's two concept inputs plus the root/nested indexes
the pinned generator renders and the reserved log input from its public test.
The complete MIT notice is included beside the fixture.

The OpenWiki repository's checked-in `openwiki/index.md` at this revision is
not used as conformance evidence: it has Concept frontmatter and lacks the root
`okf_version`, contrary to the pinned generator and README. This fixture claims
only compatibility with the deterministic output recorded here, not full
OpenWiki writer conformance.

## Local boundary case

`format-ontology-boundary/` is Exo-authored test data. It proves that OKF
compatibility preserves open types and producer fields while an explicitly kept
Workspace Ontology may separately interpret one property as a typed Relation.
