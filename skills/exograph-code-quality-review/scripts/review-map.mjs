#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const VERSION = 1;
const DEFAULT_STATE = "docs/internal/code-quality-review/state.json";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const values = new Map();
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, [...(values.get(key) ?? []), "true"]);
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), next]);
    index += 1;
  }
  return {
    command,
    positionals,
    one(key, fallback) {
      return values.get(key)?.at(-1) ?? fallback;
    },
    many(key) {
      return values.get(key) ?? [];
    },
  };
}

function repositoryRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function reviewableFiles(root) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function contentInfo(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const content = readFileSync(absolutePath);
  const binary = content.includes(0);
  const text = binary ? "" : content.toString("utf8");
  return {
    hash: sha256(content),
    binary,
    lines: binary ? 0 : text === "" ? 0 : text.split(/\r?\n/).length,
    text,
  };
}

function classify(relativePath, binary) {
  if (binary) return "binary";
  const base = path.basename(relativePath);
  const extension = path.extname(base).toLowerCase();
  if (/(\.test|\.spec)\.[cm]?[jt]sx?$/.test(base) || relativePath.startsWith("fixtures/")) return "test";
  if (base === "AGENTS.md") return "instructions";
  if (extension === ".md") return relativePath.startsWith("docs/") ? "documentation" : "markdown";
  if (relativePath.startsWith(".github/workflows/")) return "workflow";
  if (base === "package.json" || base.startsWith("tsconfig") || [".yml", ".yaml", ".json"].includes(extension)) return "configuration";
  if (CODE_EXTENSIONS.has(extension)) return relativePath.includes("/scripts/") || relativePath.startsWith("scripts/") ? "script" : "source";
  if (relativePath.startsWith("skills/")) return "skill-resource";
  return "other";
}

function ownerFor(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] === "apps" && parts[1]) return parts.slice(0, 2).join("/");
  if (parts[0] === "packages" && parts[1]) return parts.slice(0, 2).join("/");
  if (parts[0] === "evals" && parts[1]) return parts.slice(0, 2).join("/");
  if (parts[0] === "skills" && parts[1]) return parts.slice(0, 2).join("/");
  return parts[0] || "root";
}

function nearestInstructions(relativePath, fileSet) {
  let directory = path.posix.dirname(relativePath);
  while (directory && directory !== ".") {
    const candidate = path.posix.join(directory, "AGENTS.md");
    if (fileSet.has(candidate)) return candidate;
    directory = path.posix.dirname(directory);
  }
  return fileSet.has("AGENTS.md") ? "AGENTS.md" : null;
}

function resolveTrackedSpecifier(from, specifier, fileSet, packageEntrypoints) {
  if (packageEntrypoints.has(specifier)) return packageEntrypoints.get(specifier);
  if (!specifier.startsWith(".")) return null;
  const sourceDirectory = path.posix.dirname(from);
  const candidate = path.posix.normalize(path.posix.join(sourceDirectory, specifier));
  const attempts = [candidate];
  const extension = path.posix.extname(candidate);
  if (extension) {
    const stem = candidate.slice(0, -extension.length);
    attempts.push(...RESOLUTION_EXTENSIONS.map((item) => `${stem}${item}`));
  } else {
    attempts.push(...RESOLUTION_EXTENSIONS.map((item) => `${candidate}${item}`));
    attempts.push(...RESOLUTION_EXTENSIONS.map((item) => `${candidate}/index${item}`));
  }
  return attempts.find((item) => fileSet.has(item)) ?? null;
}

function codeEdges(node, fileSet, packageEntrypoints) {
  const sourceFile = ts.createSourceFile(
    node.path,
    node.text,
    ts.ScriptTarget.Latest,
    true,
    node.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges = [];
  const add = (specifier, kind) => {
    const target = resolveTrackedSpecifier(node.path, specifier, fileSet, packageEntrypoints);
    if (target) edges.push({ from: node.path, to: target, kind, detail: specifier });
  };
  const visit = (item) => {
    if ((ts.isImportDeclaration(item) || ts.isExportDeclaration(item)) && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(item)
        ? item.importClause?.isTypeOnly === true
        : item.isTypeOnly === true;
      add(
        item.moduleSpecifier.text,
        ts.isImportDeclaration(item)
          ? typeOnly ? "imports-type" : "imports"
          : typeOnly ? "re-exports-type" : "re-exports",
      );
    } else if (ts.isCallExpression(item) && item.arguments.length === 1 && ts.isStringLiteral(item.arguments[0])) {
      if (item.expression.kind === ts.SyntaxKind.ImportKeyword) add(item.arguments[0].text, "dynamic-imports");
      if (ts.isIdentifier(item.expression) && item.expression.text === "require") add(item.arguments[0].text, "requires");
    }
    ts.forEachChild(item, visit);
  };
  visit(sourceFile);
  return edges;
}

function markdownEdges(node, fileSet) {
  const edges = [];
  const pattern = /!?\[[^\]]*]\(([^)\s#]+)(?:#[^)]*)?\)/g;
  for (const match of node.text.matchAll(pattern)) {
    const raw = match[1];
    if (/^[a-z]+:/i.test(raw)) continue;
    const decoded = decodeURIComponent(raw);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(node.path), decoded));
    if (fileSet.has(target)) edges.push({ from: node.path, to: target, kind: "documents", detail: raw });
  }
  return edges;
}

function resolveManifestTarget(directory, target, fileSet) {
  if (typeof target !== "string") return null;
  const candidate = path.posix.normalize(path.posix.join(directory, target));
  const attempts = [candidate];
  if (!path.posix.extname(candidate)) attempts.push(...RESOLUTION_EXTENSIONS.map((extension) => `${candidate}${extension}`));
  return attempts.find((item) => fileSet.has(item)) ?? null;
}

function packageEntrypoints(nodes, fileSet) {
  const result = new Map();
  for (const node of nodes) {
    if (path.basename(node.path) !== "package.json" || node.binary) continue;
    try {
      const manifest = JSON.parse(node.text);
      if (typeof manifest.name !== "string") continue;
      const directory = path.posix.dirname(node.path);
      const rootExport = typeof manifest.exports === "string"
        ? manifest.exports
        : manifest.exports?.["."];
      const target = resolveManifestTarget(directory, rootExport, fileSet)
        ?? [path.posix.join(directory, "src/index.ts"), path.posix.join(directory, "src/index.tsx")]
          .find((candidate) => fileSet.has(candidate));
      if (target) result.set(manifest.name, target);
      if (manifest.exports && typeof manifest.exports === "object") {
        for (const [key, value] of Object.entries(manifest.exports)) {
          if (key === "." || !key.startsWith("./")) continue;
          const exportTarget = resolveManifestTarget(directory, value, fileSet);
          if (exportTarget) result.set(`${manifest.name}/${key.slice(2)}`, exportTarget);
        }
      }
    } catch {
      // Invalid JSON is reported by the repository's own validation gates.
    }
  }
  return result;
}

function inferredTestEdges(nodes, fileSet) {
  const edges = [];
  for (const node of nodes) {
    const match = node.path.match(/^(.*?)(?:\.test|\.spec)(\.[cm]?[jt]sx?)$/);
    if (!match) continue;
    const candidates = [
      `${match[1]}${match[2]}`,
      `${match[1].replace(/\/__tests__\//, "/")}${match[2]}`,
    ];
    const source = candidates.find((candidate) => fileSet.has(candidate));
    if (source) {
      edges.push({
        from: node.path,
        to: source,
        kind: "tests",
        detail: source === candidates[0] ? "co-located" : "__tests__ sibling",
      });
    }
  }
  return edges;
}

function deduplicateEdges(edges) {
  const unique = new Map();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.detail ?? ""}`;
    unique.set(key, edge);
  }
  return [...unique.values()].sort((left, right) =>
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind),
  );
}

function changedFiles(root, base) {
  if (!base) return new Set();
  try {
    const mergeBase = git(root, ["merge-base", "HEAD", base]);
    return new Set(git(root, ["diff", "--name-only", `${mergeBase}...HEAD`]).split("\n").filter(Boolean));
  } catch {
    throw new Error(`Could not resolve review base: ${base}`);
  }
}

function rootFiles(nodes) {
  const preferred = new Set([
    "AGENTS.md",
    "README.md",
    "docs/architecture.md",
    "packages/core/src/index.ts",
    "packages/cli/src/index.ts",
    "apps/desktop/src/main/index.ts",
    "apps/desktop/src/renderer/src/main.tsx",
  ]);
  for (const node of nodes) if (path.basename(node.path) === "package.json") preferred.add(node.path);
  return [...preferred].filter((item) => nodes.some((node) => node.path === item)).sort();
}

function createState(root, prior, base) {
  const files = reviewableFiles(root);
  const fileSet = new Set(files);
  const changed = changedFiles(root, base);
  const nodes = files.map((relativePath) => {
    const info = contentInfo(root, relativePath);
    return {
      path: relativePath,
      kind: classify(relativePath, info.binary),
      owner: ownerFor(relativePath),
      instructions: nearestInstructions(relativePath, fileSet),
      hash: info.hash,
      binary: info.binary,
      lines: info.lines,
      changed: changed.has(relativePath),
      text: info.text,
    };
  });
  const entrypoints = packageEntrypoints(nodes, fileSet);
  const edges = [];
  for (const node of nodes) {
    if (CODE_EXTENSIONS.has(path.extname(node.path))) edges.push(...codeEdges(node, fileSet, entrypoints));
    if (path.extname(node.path) === ".md") edges.push(...markdownEdges(node, fileSet));
    if (node.instructions && node.instructions !== node.path) {
      edges.push({ from: node.path, to: node.instructions, kind: "governed-by", detail: "nearest AGENTS.md" });
    }
  }
  edges.push(...inferredTestEdges(nodes, fileSet));
  const reviews = {};
  for (const node of nodes) {
    const old = prior?.reviews?.[node.path];
    if (old && old.hash === node.hash) reviews[node.path] = old;
    else if (old) reviews[node.path] = { ...old, status: "stale", currentHash: node.hash };
  }
  return {
    version: VERSION,
    repositoryRoot: root,
    head: git(root, ["rev-parse", "HEAD"]),
    base: base ?? null,
    generatedAt: new Date().toISOString(),
    roots: rootFiles(nodes),
    nodes: nodes.map(({ text: _text, ...node }) => node),
    edges: deduplicateEdges(edges),
    reviews,
  };
}

function statePath(root, value) {
  return path.resolve(root, value ?? DEFAULT_STATE);
}

function readState(filePath) {
  if (!existsSync(filePath)) throw new Error(`Review state does not exist: ${filePath}. Run init first.`);
  const state = JSON.parse(readFileSync(filePath, "utf8"));
  if (state.version !== VERSION) throw new Error(`Unsupported review state version: ${state.version}`);
  return state;
}

function writeState(filePath, state) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function adjacency(state, direction, allowedKinds = null) {
  const map = new Map(state.nodes.map((node) => [node.path, []]));
  for (const edge of state.edges) {
    if (allowedKinds && !allowedKinds.has(edge.kind)) continue;
    if (direction !== "in") map.get(edge.from)?.push({ node: edge.to, edge, direction: "out" });
    if (direction !== "out") map.get(edge.to)?.push({ node: edge.from, edge, direction: "in" });
  }
  for (const neighbors of map.values()) {
    neighbors.sort((left, right) =>
      relationshipPriority(left.edge.kind) - relationshipPriority(right.edge.kind)
      || left.node.localeCompare(right.node),
    );
  }
  return map;
}

function relationshipPriority(kind) {
  return {
    tests: 0,
    imports: 1,
    "imports-type": 1,
    requires: 1,
    "dynamic-imports": 2,
    "re-exports": 3,
    "re-exports-type": 3,
    documents: 4,
    "governed-by": 5,
  }[kind] ?? 6;
}

function reviewStatus(state, node) {
  return state.reviews[node.path]?.status ?? "unseen";
}

function riskScore(node, degree) {
  return (node.changed ? 1000 : 0)
    + (node.kind === "source" ? 150 : 0)
    + Math.min(node.lines, 1500) / 10
    + Math.min(degree, 20) * 3;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid frontier cursor.");
  }
}

function traversalPage(state, options) {
  const nodeByPath = new Map(state.nodes.map((node) => [node.path, node]));
  const allowedKinds = options.relationships.length > 0 ? new Set(options.relationships) : null;
  const graph = adjacency(state, options.direction, allowedKinds);
  const explicitRoot = options.from ?? null;
  const starts = explicitRoot ? [explicitRoot] : state.roots;
  for (const start of starts) if (!nodeByPath.has(start)) throw new Error(`Unknown tracked file: ${start}`);
  const distance = new Map();
  const pathTo = new Map();
  const reason = new Map();
  const queue = [];
  for (const start of starts) {
    distance.set(start, 0);
    pathTo.set(start, [start]);
    queue.push(start);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    const currentDistance = distance.get(current);
    if (currentDistance >= options.depth) continue;
    for (const neighbor of graph.get(current) ?? []) {
      if (distance.has(neighbor.node)) continue;
      distance.set(neighbor.node, currentDistance + 1);
      pathTo.set(neighbor.node, [...pathTo.get(current), neighbor.node]);
      reason.set(neighbor.node, neighbor);
      queue.push(neighbor.node);
    }
  }
  const candidates = [...distance.entries()]
    .filter(([candidate, candidateDistance]) => !(explicitRoot && candidateDistance === 0 && candidate === explicitRoot))
    .map(([candidate, candidateDistance]) => {
      const node = nodeByPath.get(candidate);
      const neighbors = graph.get(candidate) ?? [];
      const unseenByNode = new Map();
      for (const item of neighbors) {
        const related = nodeByPath.get(item.node);
        if (!related || ["reviewed", "excluded"].includes(reviewStatus(state, related))) continue;
        const previous = unseenByNode.get(item.node);
        if (!previous || relationshipPriority(item.edge.kind) < relationshipPriority(previous.edge.kind)) {
          unseenByNode.set(item.node, item);
        }
      }
      const unseen = [...unseenByNode.values()];
      const byRelationship = {};
      const byOwner = {};
      for (const item of unseen) {
        byRelationship[item.edge.kind] = (byRelationship[item.edge.kind] ?? 0) + 1;
        const relatedOwner = nodeByPath.get(item.node)?.owner ?? "unknown";
        byOwner[relatedOwner] = (byOwner[relatedOwner] ?? 0) + 1;
      }
      return {
        path: candidate,
        kind: node.kind,
        owner: node.owner,
        lines: node.lines,
        changed: node.changed,
        status: reviewStatus(state, node),
        distance: candidateDistance,
        reason: reason.get(candidate) ?? null,
        pathFromRoot: pathTo.get(candidate),
        lookahead: {
          unseenNeighborCount: unseen.length,
          byRelationship,
          byOwner,
          preview: unseen.slice(0, 5).map((item) => ({
            path: item.node,
            relationship: item.edge.kind,
          })),
        },
        score: riskScore(node, neighbors.length),
      };
    })
    .sort((left, right) => {
      const leftComplete = ["reviewed", "excluded"].includes(left.status) ? 1 : 0;
      const rightComplete = ["reviewed", "excluded"].includes(right.status) ? 1 : 0;
      const leftRelationship = relationshipPriority(left.reason?.edge.kind);
      const rightRelationship = relationshipPriority(right.reason?.edge.kind);
      return leftComplete - rightComplete
        || left.distance - right.distance
        || leftRelationship - rightRelationship
        || right.score - left.score
        || left.path.localeCompare(right.path);
    });
  const cursor = decodeCursor(options.cursor);
  const fingerprint = `${state.head}:${state.nodes.length}:${state.edges.length}`;
  const relationshipKey = options.relationships.join(",");
  if (cursor && (
    cursor.fingerprint !== fingerprint
    || cursor.from !== explicitRoot
    || cursor.direction !== options.direction
    || cursor.depth !== options.depth
    || cursor.relationships !== relationshipKey
  )) {
    throw new Error("Frontier cursor does not match this graph query.");
  }
  const offset = cursor?.offset ?? 0;
  const page = candidates.slice(offset, offset + options.pageSize);
  const nextOffset = offset + page.length;
  return {
    snapshot: fingerprint,
    root: explicitRoot,
    seedRoots: explicitRoot ? undefined : starts,
    direction: options.direction,
    relationships: options.relationships,
    depth: options.depth,
    totalCandidates: candidates.length,
    offset,
    candidates: page,
    nextCursor: nextOffset < candidates.length
      ? encodeCursor({
        fingerprint,
        from: explicitRoot,
        direction: options.direction,
        depth: options.depth,
        relationships: relationshipKey,
        offset: nextOffset,
      })
      : null,
  };
}

function stronglyConnectedComponents(state) {
  const dependencyKinds = new Set(["imports", "re-exports", "dynamic-imports", "requires"]);
  const dependencyState = {
    ...state,
    edges: state.edges.filter((edge) => dependencyKinds.has(edge.kind)),
  };
  const graph = adjacency(dependencyState, "out");
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const low = new Map();
  const components = [];
  const visit = (node) => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (!indices.has(neighbor.node)) {
        visit(neighbor.node);
        low.set(node, Math.min(low.get(node), low.get(neighbor.node)));
      } else if (onStack.has(neighbor.node)) {
        low.set(node, Math.min(low.get(node), indices.get(neighbor.node)));
      }
    }
    if (low.get(node) !== indices.get(node)) return;
    const component = [];
    while (stack.length > 0) {
      const current = stack.pop();
      onStack.delete(current);
      component.push(current);
      if (current === node) break;
    }
    if (component.length > 1) components.push(component.sort());
  };
  for (const node of state.nodes) if (!indices.has(node.path)) visit(node.path);
  return components.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
}

function coverageReport(state) {
  const totals = {};
  const byKind = {};
  const byOwner = {};
  for (const node of state.nodes) {
    const status = reviewStatus(state, node);
    totals[status] = (totals[status] ?? 0) + 1;
    byKind[node.kind] ??= {};
    byKind[node.kind][status] = (byKind[node.kind][status] ?? 0) + 1;
    byOwner[node.owner] ??= {};
    byOwner[node.owner][status] = (byOwner[node.owner][status] ?? 0) + 1;
  }
  const complete = (totals.reviewed ?? 0) + (totals.excluded ?? 0);
  const degree = new Map(state.nodes.map((node) => [node.path, 0]));
  for (const edge of state.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const isolated = [...degree.entries()].filter(([, value]) => value === 0).map(([file]) => file);
  return {
    repositoryRoot: state.repositoryRoot,
    head: state.head,
    generatedAt: state.generatedAt,
    files: state.nodes.length,
    edges: state.edges.length,
    coverage: {
      complete,
      total: state.nodes.length,
      percent: state.nodes.length === 0 ? 100 : Number(((complete / state.nodes.length) * 100).toFixed(2)),
      statuses: totals,
    },
    byKind,
    byOwner,
    isolatedFiles: isolated,
    importCycles: stronglyConnectedComponents(state).slice(0, 20),
    exitReady: complete === state.nodes.length && !(totals.stale || totals.blocked || totals.unseen),
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `Exograph review map

Commands:
  init [--state PATH] [--base REF]
  frontier [--state PATH] [--from FILE] [--direction in|out|both]
           [--relation KIND ...] [--depth N] [--page-size N] [--cursor CURSOR]
  mark --file FILE --status reviewed|excluded|blocked --reason TEXT
       [--evidence TEXT ...] [--finding ID ...] [--state PATH]
  report [--state PATH]
`;
}

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    process.stdout.write(usage());
    return;
  }
  const root = repositoryRoot(cwd);
  const filePath = statePath(root, args.one("state"));
  if (args.command === "init") {
    const prior = existsSync(filePath) ? readState(filePath) : null;
    const state = createState(root, prior, args.one("base"));
    writeState(filePath, state);
    print({ state: filePath, ...coverageReport(state) });
    return;
  }
  const state = readState(filePath);
  if (path.resolve(state.repositoryRoot) !== path.resolve(root)) throw new Error("Review state belongs to another repository.");
  if (args.command === "frontier") {
    const direction = args.one("direction", "both");
    if (!["in", "out", "both"].includes(direction)) throw new Error("direction must be in, out, or both.");
    print(traversalPage(state, {
      from: args.one("from"),
      direction,
      relationships: args.many("relation"),
      depth: positiveInteger(args.one("depth"), "depth", 2),
      pageSize: positiveInteger(args.one("page-size"), "page-size", 12),
      cursor: args.one("cursor"),
    }));
    return;
  }
  if (args.command === "mark") {
    const relativePath = args.one("file");
    const status = args.one("status");
    const reason = args.one("reason");
    if (!relativePath || !state.nodes.some((node) => node.path === relativePath)) throw new Error("mark requires a tracked --file.");
    if (!["reviewed", "excluded", "blocked"].includes(status)) throw new Error("mark requires --status reviewed, excluded, or blocked.");
    if (!reason?.trim()) throw new Error("mark requires a concrete --reason.");
    const node = state.nodes.find((item) => item.path === relativePath);
    state.reviews[relativePath] = {
      status,
      reason: reason.trim(),
      evidence: args.many("evidence"),
      findingIds: args.many("finding"),
      reviewedAt: new Date().toISOString(),
      head: state.head,
      hash: node.hash,
    };
    writeState(filePath, state);
    print({ file: relativePath, review: state.reviews[relativePath] });
    return;
  }
  if (args.command === "report") {
    print(coverageReport(state));
    return;
  }
  throw new Error(usage());
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    run();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
