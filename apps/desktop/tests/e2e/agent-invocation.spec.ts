import { expect, test } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  launchExoWorkspaceFixture,
  relaunchExoWorkspaceFixture,
} from "../helpers";

test("runs a configured note invocation, refreshes the note, and highlights the changed note", async () => {
  const fixture = await launchInvocationFixture("append", {
    scriptBody: `
import { readFile, writeFile } from "node:fs/promises";
const notePath = process.argv[2];
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
await writeFile(notePath + ".prompt", prompt, "utf8");
await new Promise((resolve) => setTimeout(resolve, 500));
const current = await readFile(notePath, "utf8");
await writeFile(notePath, current.replace("# Agent Invocation", "# Agent Revision") + "\\nagent appended line\\n", "utf8");
`,
  });

  try {
    await invokeConfiguredAgent(fixture.page, "append");

    await expect(fixture.page.getByTestId("invocation-review-banner")).toContainText("Review @append changes", { timeout: 10_000 });
    await expect(fixture.page.getByTestId("editor-panel")).toContainText("agent appended line", { timeout: 10_000 });
    await expect(fixture.page.getByTestId("invocation-review-proposal")).toContainText("Saved to disk.");
    await expect(fixture.page.getByTestId("invocation-review-proposal")).toContainText("Review changes inline.");
    await expect(fixture.page.locator(".editor-surface--invocation-review .cm-changedLine").first()).toBeVisible();
    const deletedText = fixture.page.locator(".editor-surface--invocation-review .cm-deletedText").filter({ visible: true }).first();
    await expect(deletedText).toContainText("Invocation");
    await expect(fixture.page.getByTestId("invocation-review-proposal").locator("pre")).toHaveCount(0);
    await expect(fixture.page.getByTestId("invocation-keep-review")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-reject-review")).toBeVisible();
    await expect(fixture.page.locator('[data-testid^="terminal-tab-"]')).toHaveCount(0);

    await fixture.page.getByTestId("toggle-markdown-mode").click();
    await expect(fixture.page.locator(".editor-surface--invocation-review")).toHaveCount(0);
    await expect(fixture.page.locator(".cm-deletedText")).toHaveCount(0);
    await fixture.page.getByTestId("toggle-markdown-mode").click();

    const record = await latestInvocationRecord(fixture.workspaceRoot);
    expect(record).toMatchObject({
      status: "process-exited",
      command: { handle: "append" },
      changedFileRefs: [expect.objectContaining({ attribution: "likely" })],
    });
    expect(record).not.toHaveProperty("terminalSessionId");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("Document snapshot at invocation:");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("Exo document-agent protocol:");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("# Agent Invocation");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("Review this document.");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain('<exo-invocation id="');
    await expect(readFile(path.join(fixture.workspaceRoot, ".exo/invocations", record.id, "before.md"), "utf8"))
      .resolves.toContain('agent="append" status="sent">');
  } finally {
    await fixture.cleanup();
  }
});

test("keeps an inline agent draft available when focus moves through the editor", async () => {
  const fixture = await launchInvocationFixture("draft", {
    scriptBody: "await new Promise((resolve) => setTimeout(resolve, 30_000));",
  });

  try {
    await moveEditorCursorToEnd(fixture.page);
    await fixture.page.keyboard.press("Enter");
    await fixture.page.keyboard.type("@draft");
    await expect(fixture.page.getByTestId("agent-suggestion-draft")).toBeVisible();
    await fixture.page.keyboard.press("Enter");
    const composer = fixture.page.getByTestId("inline-agent-composer");
    await expect(composer).toHaveCount(1);
    await fixture.page.keyboard.type("Keep this draft available.");
    await fixture.page.keyboard.press("Enter");
    await expect(fixture.page.locator(".cm-content")).toContainText("Keep this draft available.");
    await expect(fixture.page.getByTestId("invocation-review-banner")).toHaveCount(0);

    await fixture.page.locator(".cm-content").click();
    await expect(composer).toHaveCount(1);
    await expect(fixture.page.locator(".cm-content")).toContainText("Keep this draft available.");

    await fixture.page.keyboard.press("Escape");
    await expect(composer).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("renders a sent Claude invocation as highlighted prose without its source envelope", async () => {
  const fixture = await launchInvocationFixture("claude", {
    scriptBody: "await new Promise((resolve) => setTimeout(resolve, 30_000));",
  });

  try {
    await moveEditorCursorToEnd(fixture.page);
    await fixture.page.keyboard.press("Enter");
    await fixture.page.keyboard.type("@claude");
    await expect(fixture.page.getByTestId("agent-suggestion-claude")).toBeVisible();
    await fixture.page.keyboard.press("Enter");
    await fixture.page.keyboard.type("what task should I work on first?");
    await fixture.page.keyboard.press("Shift+Enter");

    await expect(fixture.page.getByRole("dialog", { name: "Run @claude?" })).toBeVisible();
    const openingEnvelope = fixture.page.locator(".cm-line").filter({ hasText: '<exo-invocation id="' });
    const closingEnvelope = fixture.page.locator(".cm-line").filter({ hasText: "</exo-invocation>" });
    await expect(openingEnvelope).toBeHidden();
    await expect(closingEnvelope).toBeHidden();
    const mention = fixture.page.locator(".inline-agent-composer__mention--claude").filter({ hasText: "@claude" }).last();
    await expect(mention).toBeVisible();
    await expect(mention).toHaveCSS("color", "rgb(184, 79, 36)");

    await fixture.page.evaluate(() => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) throw new Error("Unable to resolve CodeMirror view");
      const text = view.state.doc.toString();
      const invocationOpening = text.match(/<exo-invocation\b[^>]*>/)?.[0];
      const invocationId = invocationOpening?.match(/\bid="([^"]+)"/)?.[1];
      if (!invocationId) throw new Error("Missing protocol invocation id");
      view.dispatch({ changes: {
        from: text.length,
        insert: `\n\n<exo-agent-response invocation="${invocationId}" agent="claude">\nDurable Claude result.\n</exo-agent-response>`,
      } });
    });
    const responseEnvelope = fixture.page.locator(".cm-line").filter({ hasText: '<exo-agent-response invocation="' });
    await expect(responseEnvelope).toBeHidden();
    await expect(fixture.page.locator(".inline-agent-response__mark--claude").filter({ hasText: "Durable Claude result." })).toBeVisible();

    await fixture.page.getByRole("button", { name: "Cancel" }).click();
    await fixture.page.getByTestId("toggle-markdown-mode").click();
    await expect(openingEnvelope).toBeVisible();
    await expect(closingEnvelope).toBeVisible();
    await expect(responseEnvelope).toBeVisible();
    expect(await fixture.page.locator(".cm-content").evaluate((content) => ({
      opening: (content.textContent?.match(/<exo-invocation/g) ?? []).length,
      closing: (content.textContent?.match(/<\/exo-invocation>/g) ?? []).length,
    }))).toEqual({ opening: 1, closing: 1 });
    await fixture.page.getByTestId("toggle-markdown-mode").click();
    await expect(openingEnvelope).toBeHidden();
    await expect(closingEnvelope).toBeHidden();

    await fixture.page.evaluate(() => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) throw new Error("Unable to resolve CodeMirror view");
      const text = view.state.doc.toString();
      const opening = text.match(/<exo-invocation id="[^"]+" agent="claude" status="sent">\n/)?.[0];
      if (!opening) throw new Error("Missing protocol invocation envelope");
      const first = text.indexOf(opening);
      const close = text.indexOf("\n</exo-invocation>", first);
      view.dispatch({ changes: [
        { from: first, insert: opening },
        { from: close + "\n</exo-invocation>".length, insert: "\n</exo-invocation>" },
      ] });
    });
    await expect(openingEnvelope).toHaveCount(2);
    await expect(closingEnvelope).toHaveCount(2);
    await expect.poll(async () => openingEnvelope.evaluateAll((lines) => lines.every((line) => getComputedStyle(line).display === "none"))).toBe(true);
    await expect.poll(async () => closingEnvelope.evaluateAll((lines) => lines.every((line) => getComputedStyle(line).display === "none"))).toBe(true);
    await expect(fixture.page.locator(".inline-agent-composer__mention--claude").filter({ hasText: "@claude" }).last()).toHaveCSS("color", "rgb(184, 79, 36)");
  } finally {
    await fixture.cleanup();
  }
});

test("shows a dirty-buffer conflict choice when an invocation changes the open note", async () => {
  const fixture = await launchInvocationFixture("conflict", {
    scriptBody: `
import { appendFile } from "node:fs/promises";
const notePath = process.argv[2];
await new Promise((resolve) => setTimeout(resolve, 700));
await appendFile(notePath, "\\nagent disk line\\n", "utf8");
`,
  });

  try {
    await invokeConfiguredAgent(fixture.page, "conflict");
    await appendEditorText(fixture.page, "\nlocal unsaved line");

    await expect(fixture.page.getByTestId("invocation-review-banner")).toContainText(
      "Unsaved editor changes conflict with the agent's version.",
      { timeout: 10_000 },
    );
    await expect(fixture.page.getByTestId("invocation-keep-dirty-buffer")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-reload-disk")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-review-proposal")).toContainText("Showing changes against your current buffer.");
    await expect(fixture.page.getByTestId("invocation-keep-review")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-reject-review")).toBeDisabled();
    await expect(fixture.page.locator(".cm-content")).toContainText("local unsaved line");
    await expect(fixture.page.locator(".cm-content")).not.toContainText("agent disk line");

    await fixture.page.getByTestId("invocation-keep-dirty-buffer").click();
    await expect(fixture.page.getByTestId("invocation-review-banner")).not.toContainText("Unsaved editor changes conflict with the agent's version.");
    await expect(fixture.page.getByTestId("editor-panel")).toContainText("local unsaved line");
  } finally {
    await fixture.cleanup();
  }
});

test("hands a failed Claude session to Terminal and dismisses its document status", async () => {
  const sessionId = "ce4b9e26-2574-4433-a054-1110cd403792";
  const fixture = await launchInvocationFixture("claude", {
    scriptBody: `
const sessionId = ${JSON.stringify(sessionId)};
const resumeIndex = process.argv.indexOf("--resume");
if (resumeIndex >= 0) {
  console.log("EXO_RESUME_OK " + process.argv[resumeIndex + 1]);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
} else {
  for await (const _chunk of process.stdin) { /* consume the prompt */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.stdout.write(JSON.stringify([{
    type: "result",
    subtype: "success",
    session_id: sessionId,
    permission_denials: [{ tool_name: "Edit" }],
  }]));
}
`,
  });

  try {
    await invokeConfiguredAgent(fixture.page, "claude", "Update this note.");

    const authorization = fixture.page.getByRole("dialog", { name: "Run @claude?" });
    const banner = fixture.page.getByTestId("invocation-review-banner");
    await expect(authorization).toHaveCount(0);
    await expect(banner).toContainText("@claude failed", { timeout: 10_000 });
    await expect(banner).toContainText("write permission was denied");
    const resume = fixture.page.getByTestId("invocation-resume-terminal");
    await expect(resume).toContainText(`--resume '${sessionId}'`);
    await expect(fixture.page.locator('[data-testid^="terminal-tab-"]')).toHaveCount(0);

    await resume.click();

    await expect(banner).toHaveCount(0);
    await expect(fixture.page.getByTestId("utility-pane-terminal")).toHaveAttribute("aria-pressed", "true");
    await expect(fixture.page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect(fixture.page.locator(".xterm-rows")).toContainText(`EXO_RESUME_OK ${sessionId}`, { timeout: 10_000 });
  } finally {
    await fixture.cleanup();
  }
});

test("marks a running invocation orphaned when the app relaunches", async () => {
  const fixture = await launchInvocationFixture("orphan", {
    scriptBody: `
await new Promise((resolve) => setTimeout(resolve, 30_000));
`,
  });
  let relaunched: Awaited<ReturnType<typeof relaunchExoWorkspaceFixture>> | null = null;

  try {
    await invokeConfiguredAgent(fixture.page, "orphan");
    const before = await latestInvocationRecord(fixture.workspaceRoot);
    expect(before).toMatchObject({ status: "running", command: { handle: "orphan" } });

    await fixture.electronApp.close();
    relaunched = await relaunchExoWorkspaceFixture(fixture);

    await expect.poll(async () => latestInvocationRecord(fixture.workspaceRoot)).toMatchObject({
      id: before.id,
      status: "orphaned",
      attribution: {
        status: "ambiguous",
        reason: "Attribution incomplete because Exo restarted during this invocation.",
      },
    });
  } finally {
    if (relaunched) {
      await relaunched.cleanup();
      await fixture.cleanup();
    } else {
      await fixture.cleanup();
    }
  }
});

test("dogfoods ten real pointer-prompt invocations through the note UI", async () => {
  const fixture = await launchInvocationFixture("dogfood", {
    scriptBody: `
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const notePath = process.argv[2];
const counterPath = path.join(path.dirname(new URL(import.meta.url).pathname), "dogfood-counter.txt");
const previous = Number(await readFile(counterPath, "utf8").catch(() => "0"));
const next = previous + 1;
await writeFile(counterPath, String(next), "utf8");
await new Promise((resolve) => setTimeout(resolve, 150));
await appendFile(notePath, "\\ndogfood pointer prompt run " + next + "\\n", "utf8");
`,
  });

  try {
    for (let index = 1; index <= 10; index += 1) {
      await invokeConfiguredAgent(fixture.page, "dogfood");
      await expect(fixture.page.getByTestId("editor-panel")).toContainText(`dogfood pointer prompt run ${index}`, {
        timeout: 10_000,
      });
      await expect.poll(async () => (await invocationRecords(fixture.workspaceRoot)).length).toBeGreaterThanOrEqual(index);
      await expect.poll(async () => latestInvocationRecord(fixture.workspaceRoot)).toMatchObject({
        status: "process-exited",
        command: { handle: "dogfood" },
      });
    }

    const records = await invocationRecords(fixture.workspaceRoot);
    expect(records.filter((record) => record.command?.handle === "dogfood")).toHaveLength(10);
  } finally {
    await fixture.cleanup();
  }
});

test("live Claude edits the tagged document and produces a resumable review", async () => {
  test.skip(process.env.EXO_LIVE_CLAUDE_E2E !== "1", "Set EXO_LIVE_CLAUDE_E2E=1 to run the live Claude pointer-prompt gate.");
  const fixture = await launchLiveClaudeInvocationFixture();

  try {
    await invokeConfiguredAgent(
      fixture.page,
      "claude",
      "Append a section named Claude Verification containing the exact text EXO_LIVE_CLAUDE_EDIT_OK.",
    );
    await expect.poll(async () => latestInvocationRecord(fixture.workspaceRoot), { timeout: 120_000 }).toMatchObject({
      status: "process-exited",
      command: { handle: "claude" },
      review: { status: "pending" },
    });
    const record = await latestInvocationRecord(fixture.workspaceRoot);
    expect(record.providerSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(record.changedFileRefs).toEqual([expect.objectContaining({ path: fixture.notePath, kind: "modified" })]);
    expect(record).not.toHaveProperty("terminalSessionId");
    await expect.poll(async () => readFile(fixture.notePath, "utf8")).toContain("EXO_LIVE_CLAUDE_EDIT_OK");
    const artifactRoot = path.join(fixture.workspaceRoot, ".exo/invocations", record.id);
    const [before, after] = await Promise.all([
      readFile(path.join(artifactRoot, "before.md"), "utf8"),
      readFile(path.join(artifactRoot, "after.md"), "utf8"),
    ]);
    expect(before).toContain('<exo-invocation id="');
    expect(before.match(/EXO_LIVE_CLAUDE_EDIT_OK/g)).toHaveLength(1);
    expect(after.match(/EXO_LIVE_CLAUDE_EDIT_OK/g)).toHaveLength(2);
    await expect(fixture.page.locator('[data-testid^="terminal-tab-"]')).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

async function launchInvocationFixture(
  handle: string,
  options: { scriptBody: string },
): Promise<Awaited<ReturnType<typeof launchExoWorkspaceFixture>> & { notePath: string }> {
  let notePath = "";
  let scriptPath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      notePath = path.join(noteRoot, "agent-invocation.md");
      scriptPath = path.join(workspaceRoot, "projects/sample-project", `${handle}-agent.mjs`);
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(notePath, `# Agent Invocation\n\n@${handle} update this note\n`, "utf8");
      await writeFile(scriptPath, options.scriptBody.trimStart(), "utf8");
    },
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [path.join(workspaceRoot, "projects/sample-project")],
        agentCommands: [{
          id: handle,
          label: `@${handle}`,
          handle,
          command: `${shellQuote(process.execPath)} ${shellQuote(scriptPath)} ${shellQuote(notePath)}`,
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: true,
        }],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });
  await fixture.page.getByRole("button", { name: "agent-invocation, file" }).first().click();
  await expect(fixture.page.getByTestId("editor-title")).toHaveText("agent-invocation");
  return { ...fixture, notePath };
}

async function launchCommandInvocationFixture(
  handle: string,
  options: { command: string; noteBody: string },
): Promise<Awaited<ReturnType<typeof launchExoWorkspaceFixture>> & { notePath: string }> {
  let notePath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      notePath = path.join(noteRoot, "agent-invocation.md");
      await writeFile(notePath, options.noteBody, "utf8");
    },
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [path.join(workspaceRoot, "projects/sample-project")],
        agentCommands: [{
          id: handle,
          label: `@${handle}`,
          handle,
          command: options.command,
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: true,
        }],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });
  await fixture.page.getByRole("button", { name: "agent-invocation, file" }).first().click();
  await expect(fixture.page.getByTestId("editor-title")).toHaveText("agent-invocation");
  return { ...fixture, notePath };
}

async function launchLiveClaudeInvocationFixture(): Promise<Awaited<ReturnType<typeof launchExoWorkspaceFixture>> & { notePath: string }> {
  let notePath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    env: process.env.HOME ? { HOME: process.env.HOME } : {},
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      notePath = path.join(noteRoot, "agent-invocation.md");
      await writeFile(notePath, "# Live Claude Edit\n\nThis fixture proves Exo can authorize a real headless document edit.\n", "utf8");
    },
    prepareSettings: async ({ settingsPath, workspaceRoot }) => {
      await writeFile(settingsPath, JSON.stringify({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes/test-notes")],
        projectRoots: [path.join(workspaceRoot, "projects/sample-project")],
        agentCommands: [{
          id: "claude",
          label: "@claude",
          handle: "claude",
          command: "claude -p --permission-mode acceptEdits",
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: true,
        }],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, null, 2), "utf8");
    },
  });
  await fixture.page.getByRole("button", { name: "agent-invocation, file" }).first().click();
  await expect(fixture.page.getByTestId("editor-title")).toHaveText("agent-invocation");
  return { ...fixture, notePath };
}

async function invokeConfiguredAgent(
  page: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["page"],
  handle: string,
  message = "Review this document.",
): Promise<void> {
  await appendEditorText(page, `\n@${handle}`);
  await expect(page.getByTestId(`agent-suggestion-${handle}`)).toBeVisible();
  await page.keyboard.press("Enter");
  const composer = page.getByTestId("inline-agent-composer");
  await expect(composer).toHaveCount(1);
  await page.keyboard.type(message);
  await page.keyboard.press("Shift+Enter");
  const authorization = page.getByRole("dialog", { name: `Run @${handle}?` });
  await expect(authorization).toBeVisible();
  await authorization.getByRole("button", { name: `Run @${handle}` }).click();
  await expect(authorization).toHaveCount(0);
  await expect(page.getByTestId("invocation-review-banner")).toBeVisible();
}

async function appendEditorText(page: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["page"], text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.evaluate((insert) => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const position = view.state.doc.length + insert.length;
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert,
      },
      selection: { anchor: position },
    });
    view.focus();
  }, text);
}

async function moveEditorCursorToEnd(page: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["page"]): Promise<void> {
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
}

async function latestInvocationRecord(workspaceRoot: string): Promise<Record<string, any>> {
  const records = await invocationRecords(workspaceRoot);
  if (records.length === 0) {
    throw new Error("No invocation records found");
  }
  return records.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))).at(-1)!;
}

async function invocationRecords(workspaceRoot: string): Promise<Array<Record<string, any>>> {
  const invocationsRoot = path.join(workspaceRoot, ".exo/invocations");
  const entries = await readdir(invocationsRoot, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => JSON.parse(await readFile(path.join(invocationsRoot, entry.name, "record.json"), "utf8")) as Record<string, any>),
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
