import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceSettings } from "@exo/core";
import { resolvePreviewTarget } from "./preview-target";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("resolvePreviewTarget", () => {
  it("turns absolute local HTML paths inside project roots into file URLs", async () => {
    const fixture = await previewFixture();
    const target = path.join(fixture.projectRoot, "docs", "artifacts", "core-plugin-boundary.html");

    await expect(resolvePreviewTarget(target, fixture.settings)).resolves.toEqual({
      ok: true,
      url: pathToFileURL(target).toString(),
      source: "file",
    });
  });

  it("turns workspace-relative local HTML paths into file URLs", async () => {
    const fixture = await previewFixture();
    const relativeTarget = "projects/exo/docs/artifacts/core-plugin-boundary.html";
    const absoluteTarget = path.join(fixture.workspaceRoot, relativeTarget);

    await expect(resolvePreviewTarget(relativeTarget, fixture.settings)).resolves.toEqual({
      ok: true,
      url: pathToFileURL(absoluteTarget).toString(),
      source: "file",
    });
  });

  it("validates file URLs through the same local preview path rules", async () => {
    const fixture = await previewFixture();
    const target = path.join(fixture.projectRoot, "docs", "artifacts", "core-plugin-boundary.html");

    await expect(resolvePreviewTarget(pathToFileURL(target).toString(), fixture.settings)).resolves.toEqual({
      ok: true,
      url: pathToFileURL(target).toString(),
      source: "file",
    });
  });

  it("passes through http and https URLs", async () => {
    const fixture = await previewFixture();

    await expect(resolvePreviewTarget("https://localhost.test/report.html", fixture.settings)).resolves.toEqual({
      ok: true,
      url: "https://localhost.test/report.html",
      source: "url",
    });
  });

  it("rejects local files outside configured roots", async () => {
    const fixture = await previewFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "exo-preview-outside-"));
    tempPaths.push(outsideRoot);
    const target = path.join(outsideRoot, "report.html");
    await writeFile(target, "<!doctype html><title>Outside</title>", "utf8");

    await expect(resolvePreviewTarget(target, fixture.settings)).rejects.toThrow(
      "Local preview files must be inside the workspace, note roots, or project roots.",
    );
  });
});

async function previewFixture(): Promise<{
  workspaceRoot: string;
  projectRoot: string;
  settings: WorkspaceSettings;
}> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-preview-workspace-"));
  tempPaths.push(workspaceRoot);

  const noteRoot = path.join(workspaceRoot, "notes");
  const projectRoot = path.join(workspaceRoot, "projects", "exo");
  const artifactRoot = path.join(projectRoot, "docs", "artifacts");
  await mkdir(noteRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    path.join(artifactRoot, "core-plugin-boundary.html"),
    "<!doctype html><title>Core Plugin Boundary</title>",
    "utf8",
  );

  return {
    workspaceRoot,
    projectRoot,
    settings: {
      workspaceRoot,
      defaultTerminalCwd: workspaceRoot,
      noteRoots: [noteRoot],
      projectRoots: [projectRoot],
      indexedRoots: [],
      indexing: { enabled: false, mode: "lexical", backend: "qmd" },
      appearanceMode: "system",
      colorThemeId: "exo-neutral",
      editorFontSize: 15,
      terminalFontSize: 13,
      terminalHistoryLines: 100_000,
      terminalTranscriptRetention: "forever",
      terminalTranscriptRetentionDays: 14,
      explorerScale: 1,
      exploreIndexSearchOnEnter: false,
      indexUpdateStrategy: "manual",
    },
  };
}
