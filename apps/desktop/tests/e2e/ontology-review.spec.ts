import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { GraphEdgeVisualClass } from "@exo/core";

import { launchExoWorkspaceFixture, relaunchExoWorkspaceFixture } from "../helpers";

test("reviews Ontology effects before publishing one persistent graph change", async ({}, testInfo) => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: "ontology-source",
    prepareWorkspace: async (workspaceRoot) => {
      await writeFile(
        path.join(workspaceRoot, "notes/test-notes/ontology-source.md"),
        "---\ntype: paper\nsupports: [ontology-target]\n---\n# Ontology source\n",
        "utf8",
      );
      await writeFile(
        path.join(workspaceRoot, "notes/test-notes/ontology-target.md"),
        "---\ntype: claim\n---\n# Ontology target\n",
        "utf8",
      );
      await writeOntology(workspaceRoot, 1);
    },
  });
  let relaunched: Awaited<ReturnType<typeof relaunchExoWorkspaceFixture>> | null = null;
  const sourcePath = path.join(fixture.workspaceRoot, "notes/test-notes/ontology-source.md");
  const targetPath = path.join(fixture.workspaceRoot, "notes/test-notes/ontology-target.md");
  const noteRoot = path.join(fixture.workspaceRoot, "notes/test-notes");

  try {
    const originalBytes = await readFile(sourcePath, "utf8");
    const originalNoteBytes = await markdownByteMap(noteRoot);
    await expectGraphContext(fixture.page, sourcePath, { ontologyRelations: 0, outgoing: 0, backlinks: 0 });
    await expect.poll(() => ontologyEdgeCount(fixture.page)).toBe(0);
    await openConnectionsGraph(fixture.page);
    await expect(fixture.page.getByTestId("connections-panel-graph")).toContainText("No neighborhood yet");

    await openWorkspaceSettings(fixture.page);
    const row = fixture.page.getByTestId("workspace-settings-ontology");
    await expect(row).toContainText("Generic");
    await expect(row).toContainText("research");
    await expect(row).toContainText("2 typed");
    await expect(row).toContainText("+1 relations");
    await expect(row).toContainText("0 findings");
    await expect(row.getByRole("button", { name: "Keep ontology" })).toBeVisible();
    await expect(row).not.toContainText(fixture.workspaceRoot);
    await fixture.page.screenshot({ path: testInfo.outputPath("ontology-review-candidate.png") });

    const changedBytes = originalBytes.replace("# Ontology source", "# Ontology source changed");
    await writeFile(sourcePath, changedBytes, "utf8");
    await expect.poll(
      () => fixture.page.evaluate((filePath) => window.exo.notes.getGraphContext(filePath).then((context) => context?.note.title), sourcePath),
      { timeout: 10_000 },
    ).toBe("Ontology source changed");

    await row.getByRole("button", { name: "Keep ontology" }).click();
    await expect(row).toContainText("Changed—review again");
    await expectGraphContext(fixture.page, sourcePath, { ontologyRelations: 0, outgoing: 0, backlinks: 0 });
    await expect.poll(() => ontologyEdgeCount(fixture.page)).toBe(0);

    await expect(row.getByRole("button", { name: "Keep ontology" })).toBeVisible();
    await row.getByRole("button", { name: "Keep ontology" }).click();
    await expect(row).toContainText("Applied");
    await expect(row.getByRole("button", { name: "Keep ontology" })).toHaveCount(0);
    await expectGraphContext(fixture.page, sourcePath, { ontologyRelations: 1, outgoing: 0, backlinks: 0 });
    await expectGraphContext(fixture.page, targetPath, { ontologyRelations: 1, outgoing: 0, backlinks: 0 });
    await expect.poll(() => ontologyEdgeCount(fixture.page)).toBe(1);
    const reviewedNoteBytes = new Map(originalNoteBytes);
    reviewedNoteBytes.set(path.relative(noteRoot, sourcePath), changedBytes);
    expect(await markdownByteMap(noteRoot)).toEqual(reviewedNoteBytes);
    const acceptedEvidence = await ontologyEvidence(fixture.page, sourcePath);
    expect(acceptedEvidence.relation).toMatchObject({
      origin: "ontology",
      predicate: "supports",
    });
    expect(acceptedEvidence.relation?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ontology-rule" }),
    ]));
    expect(acceptedEvidence.ontology).toMatchObject({ state: "active", id: "research", version: "1" });

    await fixture.page.getByTestId("workspace-settings-close").click();
    const localGraph = fixture.page.getByTestId("connections-panel-graph");
    await expect(localGraph.getByTestId("graph-neighborhood-panel")).toBeVisible();
    await expect(localGraph).toContainText("1 edges");
    await expect(localGraph.getByTestId("graph-neighborhood-canvas")).toHaveAttribute(
      "aria-label",
      /Ontology source changed, Ontology target/,
    );
    await expectCanvasPixels(localGraph.getByTestId("graph-neighborhood-canvas"));
    await fixture.page.screenshot({ path: testInfo.outputPath("ontology-review-kept-graph.png") });

    await fixture.electronApp.close();
    relaunched = await relaunchExoWorkspaceFixture(fixture);
    await relaunched.page.getByRole("button", { name: "ontology-source" }).first().click();
    await expect(relaunched.page.getByTestId("editor-title")).toHaveText("ontology-source");
    await expectGraphContext(relaunched.page, sourcePath, { ontologyRelations: 1, outgoing: 0, backlinks: 0 });
    await expect.poll(() => ontologyEdgeCount(relaunched!.page)).toBe(1);
    const restartedEvidence = await ontologyEvidence(relaunched.page, sourcePath);
    expect(restartedEvidence.ontology).toEqual(acceptedEvidence.ontology);
    expect(await markdownByteMap(noteRoot)).toEqual(reviewedNoteBytes);

    await openConnectionsGraph(relaunched.page);
    const restartedLocalGraph = relaunched.page.getByTestId("connections-panel-graph");
    await expect(restartedLocalGraph).toContainText("1 edges");
    await expectCanvasPixels(restartedLocalGraph.getByTestId("graph-neighborhood-canvas"));

    await openWorkspaceSettings(relaunched.page);
    const restartedRow = relaunched.page.getByTestId("workspace-settings-ontology");
    await expect(restartedRow).toContainText("research");
    await expect(restartedRow.getByRole("button", { name: "Keep ontology" })).toHaveCount(0);

    await writeOntology(fixture.workspaceRoot, 2);
    await expect(restartedRow).toContainText("v2");
    await restartedRow.getByRole("button", { name: "Reject ontology" }).click();
    await expect(restartedRow).toContainText("Not applied");
    await expectGraphContext(relaunched.page, sourcePath, { ontologyRelations: 1, outgoing: 0, backlinks: 0 });
    await expect.poll(() => ontologyEdgeCount(relaunched!.page)).toBe(1);
    expect(await markdownByteMap(noteRoot)).toEqual(reviewedNoteBytes);
    const afterRejectEvidence = await ontologyEvidence(relaunched.page, sourcePath);
    expect(afterRejectEvidence.ontology).toEqual(acceptedEvidence.ontology);
    expect(afterRejectEvidence.sourceSnapshotId).toBe(restartedEvidence.sourceSnapshotId);
    await relaunched.page.getByTestId("workspace-settings-close").click();
    await expect(restartedLocalGraph).toContainText("1 edges");
    await expectCanvasPixels(restartedLocalGraph.getByTestId("graph-neighborhood-canvas"));
  } finally {
    await relaunched?.electronApp.close().catch(() => {});
    await fixture.cleanup();
  }
});

async function writeOntology(workspaceRoot: string, version: number): Promise<void> {
  await writeFile(path.join(workspaceRoot, "ontology.yaml"), [
    "ontology_schema: 1",
    "id: research",
    `version: ${version}`,
    "types:",
    "  paper: {}",
    "  claim: {}",
    "properties:",
    "  supports:",
    "    value: reference[]",
    "    predicate: supports",
  ].join("\n"), "utf8");
}

async function openWorkspaceSettings(page: Page): Promise<void> {
  await page.getByTestId("workspace-menu-toggle").click();
  await page.getByTestId("workspace-menu-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-ontology").getByText("Previewing…")).toHaveCount(0, { timeout: 10_000 });
}

async function openConnectionsGraph(page: Page): Promise<void> {
  const utility = page.getByTestId("utility-pane");
  if (await utility.count() === 0 || !await utility.isVisible()) await page.getByTestId("utility-pane-toggle").click();
  await page.getByTestId("utility-pane-connections").click();
  await page.getByTestId("connections-tab-graph").click();
}

async function expectGraphContext(
  page: Page,
  filePath: string,
  expected: { ontologyRelations: number; outgoing: number; backlinks: number },
): Promise<void> {
  await expect.poll(async () => page.evaluate((target) => window.exo.notes.getGraphContext(target).then((context) => ({
    ontologyRelations: context?.neighborhoodRelations.length ?? -1,
    outgoing: context?.outgoing.length ?? -1,
    backlinks: context?.backlinks.length ?? -1,
  })), filePath), { timeout: 10_000 }).toEqual(expected);
}

async function ontologyEdgeCount(page: Page): Promise<number> {
  return page.evaluate(async (ontologyClass) => {
    const topology = await window.exo.notes.getGraphTopology();
    return Array.from(topology.edges.visualClasses).filter((visualClass) => visualClass === ontologyClass).length;
  }, GraphEdgeVisualClass.ontology);
}

async function ontologyEvidence(page: Page, filePath: string) {
  return page.evaluate(async (targetPath) => {
    const topology = await window.exo.notes.getGraphTopology();
    const lookup = await window.exo.notes.graphConceptLookup({ filePath: targetPath }, topology.sourceSnapshotId);
    if (lookup.status !== "ok" || !lookup.summary) throw new Error("Ontology source concept was not found.");
    const detail = await window.exo.notes.getGraphConceptDetailByIndex(lookup.summary.index, topology.sourceSnapshotId);
    if (detail.status !== "ok" || !detail.detail) throw new Error("Ontology source detail was not available.");
    const relation = detail.detail.relations.find((item) => item.relation.origin === "ontology")?.relation ?? null;
    return { ontology: detail.detail.ontology, relation, sourceSnapshotId: topology.sourceSnapshotId };
  }, filePath);
}

async function markdownByteMap(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.set(path.relative(root, filePath), await readFile(filePath, "utf8"));
    }
  }
  await visit(root);
  return result;
}

async function expectCanvasPixels(canvas: Locator): Promise<void> {
  await expect.poll(() => canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext("2d");
    if (!context || surface.width === 0 || surface.height === 0) return 0;
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) visible += Number((pixels[index] ?? 0) > 0);
    return visible;
  }), { timeout: 10_000 }).toBeGreaterThan(0);
}
