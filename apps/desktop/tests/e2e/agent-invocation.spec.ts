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
import { appendFile, writeFile } from "node:fs/promises";
const notePath = process.argv[2];
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
await writeFile(notePath + ".prompt", prompt, "utf8");
await new Promise((resolve) => setTimeout(resolve, 500));
await appendFile(notePath, "\\nagent appended line\\n", "utf8");
`,
  });

  try {
    await invokeConfiguredAgent(fixture.page, "append");

    await expect(fixture.page.getByTestId("invocation-review-banner")).toContainText("@append finished", { timeout: 10_000 });
    await expect(fixture.page.getByTestId("editor-panel")).toContainText("agent appended line", { timeout: 10_000 });
    await expect(fixture.page.getByTestId("invocation-review-proposal")).toContainText("agent appended line");
    await expect(fixture.page.getByTestId("invocation-keep-review")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-reject-review")).toBeVisible();
    await expect(fixture.page.locator('[data-testid^="terminal-tab-"]')).toHaveCount(0);

    const record = await latestInvocationRecord(fixture.workspaceRoot);
    expect(record).toMatchObject({
      status: "process-exited",
      command: { handle: "append" },
      changedFileRefs: [expect.objectContaining({ attribution: "likely" })],
    });
    expect(record).not.toHaveProperty("terminalSessionId");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("Document snapshot at invocation:");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("# Agent Invocation");
    await expect.poll(() => readFile(`${fixture.notePath}.prompt`, "utf8")).toContain("Review this document.");
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
      "Disk changed while this editor has unsaved edits.",
      { timeout: 10_000 },
    );
    await expect(fixture.page.getByTestId("invocation-keep-dirty-buffer")).toBeVisible();
    await expect(fixture.page.getByTestId("invocation-reload-disk")).toBeVisible();
    await expect(fixture.page.getByTestId("editor-panel")).toContainText("local unsaved line");
    await expect(fixture.page.getByTestId("editor-panel")).not.toContainText("agent disk line");

    await fixture.page.getByTestId("invocation-keep-dirty-buffer").click();
    await expect(fixture.page.getByTestId("invocation-review-banner")).not.toContainText("Disk changed while this editor has unsaved edits.");
    await expect(fixture.page.getByTestId("editor-panel")).toContainText("local unsaved line");
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

test("live Claude receives the current document context through a headless invocation", async () => {
  test.skip(process.env.EXO_LIVE_CLAUDE_E2E !== "1", "Set EXO_LIVE_CLAUDE_E2E=1 to run the live Claude pointer-prompt gate.");
  const fixture = await launchLiveClaudeInvocationFixture();

  try {
    await invokeConfiguredAgent(fixture.page, "claude");
    await expect.poll(async () => latestInvocationRecord(fixture.workspaceRoot), { timeout: 120_000 }).toMatchObject({
      status: "process-exited",
      command: { handle: "claude" },
    });
    const record = await latestInvocationRecord(fixture.workspaceRoot);
    expect(record).not.toHaveProperty("terminalSessionId");
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
  let scriptPath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    env: process.env.HOME ? { HOME: process.env.HOME } : {},
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      const projectRoot = path.join(workspaceRoot, "projects/sample-project");
      notePath = path.join(noteRoot, "agent-invocation.md");
      scriptPath = path.join(projectRoot, "live-claude-agent.mjs");
      await mkdir(projectRoot, { recursive: true });
      await writeFile(notePath, "# Live Claude Pointer\n\n@claude read this document and reply with EXO_LIVE_CLAUDE_POINTER_OK plus the H1 text.\n", "utf8");
      await writeFile(scriptPath, `
import { spawn } from "node:child_process";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.once("end", run);

function run() {
  if (!input.includes("Document snapshot at invocation:") || !input.includes("# Live Claude Pointer")) {
    process.exit(1);
  }
  const prompt = input + "\\n\\nReply with exactly one line containing EXO_LIVE_CLAUDE_POINTER_OK and the document H1.";
  const child = spawn("claude", ["--print", "--permission-mode", "bypassPermissions", prompt], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}
`.trimStart(), "utf8");
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
          command: `${shellQuote(process.execPath)} ${shellQuote(scriptPath)}`,
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

async function invokeConfiguredAgent(page: Awaited<ReturnType<typeof launchExoWorkspaceFixture>>["page"], handle: string): Promise<void> {
  await appendEditorText(page, `\n@${handle}`);
  await expect(page.getByTestId(`agent-suggestion-${handle}`)).toBeVisible();
  await page.keyboard.press("Enter");
  const composer = page.getByTestId("inline-agent-composer");
  await expect(composer).toHaveCount(1);
  await page.keyboard.type("Review this document.");
  await page.keyboard.press("Shift+Enter");
  const authorization = page.getByRole("dialog", { name: `Run @${handle}?` });
  await expect(authorization).toBeVisible();
  await authorization.getByRole("button", { name: `Run @${handle}` }).click();
  await expect(page.getByTestId("invocation-review-banner")).toContainText(`Running @${handle}`);
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
