import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve(
  import.meta.dirname,
  "review-map.mjs",
);

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function run(root, ...args) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  }));
}

test("tracks imports, tests, documentation, review hashes, and bounded frontiers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "exograph-review-map-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "review-map@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Review Map"], { cwd: root });
  write(root, "AGENTS.md", "# Instructions\n");
  write(root, "README.md", "[Architecture](docs/architecture.md)\n");
  write(root, "docs/architecture.md", "# Architecture\n");
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true }));
  write(root, "src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
  write(root, "src/b.ts", "export const b = 1;\n");
  write(root, "src/a.test.ts", 'import { a } from "./a";\nvoid a;\n');
  write(root, "src/__tests__/b.test.ts", 'import { b } from "../b";\nvoid b;\n');
  write(root, "src/c.ts", 'import type { D } from "./d";\nexport type C = D;\n');
  write(root, "src/d.ts", 'import type { C } from "./c";\nexport type D = C;\n');
  write(root, "src/e.ts", 'import { f } from "./f";\nexport const e = f;\n');
  write(root, "src/f.ts", 'import { e } from "./e";\nexport const f = e;\n');
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  const initialized = run(root, "init");
  assert.equal(initialized.files, 12);
  assert.ok(initialized.edges >= 8);

  const frontier = run(root, "frontier", "--from", "src/a.ts", "--depth", "2", "--page-size", "2");
  assert.equal(frontier.candidates.length, 2);
  assert.ok(frontier.candidates.some((candidate) => candidate.path === "src/a.test.ts" || candidate.path === "src/b.ts"));
  assert.ok(frontier.candidates.every((candidate) => candidate.lookahead.byRelationship));
  assert.ok(frontier.nextCursor);
  const importsOnly = run(
    root,
    "frontier",
    "--from",
    "src/a.ts",
    "--relation",
    "imports",
    "--depth",
    "1",
  );
  assert.deepEqual(importsOnly.relationships, ["imports"]);
  assert.ok(importsOnly.candidates.every((candidate) => candidate.reason.edge.kind === "imports"));
  const bTests = run(
    root,
    "frontier",
    "--from",
    "src/b.ts",
    "--direction",
    "in",
    "--relation",
    "tests",
    "--depth",
    "1",
  );
  assert.ok(bTests.candidates.some((candidate) => candidate.path === "src/__tests__/b.test.ts"));

  run(
    root,
    "mark",
    "--file",
    "src/a.ts",
    "--status",
    "reviewed",
    "--reason",
    "Traced its importer and dependency",
    "--evidence",
    "node --test",
  );
  const report = run(root, "report");
  assert.equal(report.coverage.statuses.reviewed, 1);
  assert.deepEqual(report.importCycles, [["src/e.ts", "src/f.ts"]]);
  assert.equal(report.exitReady, false);

  write(root, "src/a.ts", 'import { b } from "./b";\nexport const a = b + 1;\n');
  const reinitialized = run(root, "init");
  assert.equal(reinitialized.coverage.statuses.stale, 1);
});

test("resolves local package export subpaths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "exograph-review-map-packages-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "review-map@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Review Map"], { cwd: root });
  write(root, "AGENTS.md", "# Instructions\n");
  write(root, "package.json", JSON.stringify({ private: true }));
  write(root, "packages/core/package.json", JSON.stringify({
    name: "@fixture/core",
    exports: {
      ".": "./src/index.ts",
      "./value": "./src/value.ts",
    },
  }));
  write(root, "packages/core/src/index.ts", 'export * from "./value";\n');
  write(root, "packages/core/src/value.ts", "export const value = 1;\n");
  write(root, "apps/client.ts", 'import { value } from "@fixture/core/value";\nvoid value;\n');
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  run(root, "init");
  const frontier = run(root, "frontier", "--from", "apps/client.ts", "--direction", "out", "--depth", "1");
  assert.equal(frontier.candidates[0].path, "packages/core/src/value.ts");
  assert.equal(frontier.candidates[0].reason.edge.kind, "imports");
});

test("includes untracked source files without admitting ignored local state", () => {
  const root = mkdtempSync(path.join(tmpdir(), "exograph-review-map-untracked-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "review-map@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Review Map"], { cwd: root });
  write(root, ".gitignore", "ignored/\ndocs/internal/\n");
  write(root, "AGENTS.md", "# Instructions\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  write(root, "src/new-owner.ts", "export const value = 1;\n");
  write(root, "ignored/local.ts", "export const privateValue = 1;\n");

  const initialized = run(root, "init");
  const state = JSON.parse(readFileSync(path.join(root, "docs/internal/code-quality-review/state.json"), "utf8"));

  assert.equal(initialized.files, 3);
  assert.ok(state.nodes.some((node) => node.path === "src/new-owner.ts"));
  assert.ok(!state.nodes.some((node) => node.path === "ignored/local.ts"));
});
