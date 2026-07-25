import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultCodexAgentCommand } from "@exo/core";
import {
  normalizeOntologyDiscoveryResponse,
  runOntologyDiscovery,
} from "./ontology-discovery";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("ontology discovery", () => {
  it("runs a configured provider against a disposable Markdown snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-ontology-discovery-test-"));
    roots.push(root);
    const notePath = path.join(root, "note.md");
    const ignoredPath = path.join(root, "private.txt");
    await writeFile(notePath, "# Note\n");
    await writeFile(ignoredPath, "not copied\n");
    const executablePath = path.join(root, "fake-codex.mjs");
    await writeFile(executablePath, `#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
const outputIndex = process.argv.indexOf("--output-last-message");
const names = await readdir(process.cwd());
if (!names.includes("note.md") || names.includes("private.txt")) process.exit(7);
await new Promise((resolve) => { process.stdin.resume(); process.stdin.on("end", resolve); });
await writeFile(process.argv[outputIndex + 1], JSON.stringify(${JSON.stringify(proposal())}));
`);
    await chmod(executablePath, 0o700);

    const result = await runOntologyDiscovery({
      noteRoots: [root],
      command: createDefaultCodexAgentCommand(),
      executablePath,
      skill: {
        id: "design-workspace-ontology",
        label: "Design workspace ontology",
        path: path.join(root, "skills", "design-workspace-ontology.md"),
        revision: "a".repeat(64),
        source: "Inspect without writing.",
      },
      timeoutMs: 2_000,
    });

    expect(result.response).toMatchObject({
      outcome: "proposal",
      summary: "One observed note type.",
      features: { conceptTypes: ["note"] },
    });
    await expect(readFile(notePath, "utf8")).resolves.toBe("# Note\n");
    await expect(readFile(ignoredPath, "utf8")).resolves.toBe("not copied\n");
  });

  it("rejects invalid source and absolute evidence before host staging", () => {
    expect(() => normalizeOntologyDiscoveryResponse({
      ...proposal(),
      candidateSource: "not: [valid",
    })).toThrow("invalid Workspace Ontology");
    expect(() => normalizeOntologyDiscoveryResponse({
      ...proposal(),
      evidence: [{ path: "/private/note.md", detail: "Observed." }],
    })).toThrow("must stay relative");
  });
});

function proposal() {
  return {
    outcome: "proposal",
    summary: "One observed note type.",
    candidateSource: "ontology_schema: 1\nid: discovered\nversion: 1\ntypes:\n  note:\n    paths: ['**/*.md']\n",
    features: {
      conceptTypes: ["note"],
      properties: [],
      relations: [],
      pathDefaults: ["note:**/*.md"],
      validationRules: [],
    },
    evidence: [{ path: "note.md", detail: "Representative note." }],
    conflicts: [],
    question: null,
  };
}
