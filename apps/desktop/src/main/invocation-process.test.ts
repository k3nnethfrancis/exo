import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DirectInvocationProcessFactory, type InvocationProcessExit, type InvocationProcessOutput } from "./invocation-process";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("direct invocation process", () => {
  it("streams output facts while retaining bounded exit output", async () => {
    const process = launch("read line; printf 'first:%s\\n' \"$line\"; printf 'warn\\n' >&2; printf 'last\\n'");
    const output: InvocationProcessOutput[] = [];
    process.onOutput?.((event) => output.push(event));
    const exited = exitOf(process);

    await process.send("hello\n");
    const result = await exited;

    expect(result).toMatchObject({ exitCode: 0, stdout: "first:hello\nlast\n", stderr: "warn\n" });
    expect(output).toEqual(expect.arrayContaining([
      { channel: "stdout", chunk: expect.stringContaining("first:hello") },
      { channel: "stderr", chunk: "warn\n" },
    ]));
  });

  it("retains only the bounded tail of large process output", async () => {
    const process = launch(`${shellQuote(globalThis.process.execPath)} -e ${shellQuote("process.stdout.write('x'.repeat(300000) + 'tail-marker')")}`);
    const result = await exitOf(process);

    expect(result.stdout.length).toBe(256_000);
    expect(result.stdout.endsWith("tail-marker")).toBe(true);
  });

  it.runIf(process.platform !== "win32")("stops the shell and its descendant process group", async () => {
    const root = await temporaryRoot("exo-invocation-process-tree-");
    const childReadyPath = path.join(root, "child-ready");
    const childStoppedPath = path.join(root, "child-stopped");
    const scriptPath = path.join(root, "agent.mjs");
    await writeFile(scriptPath, `
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["-e", ${JSON.stringify(`
  const { writeFileSync } = require("node:fs");
  writeFileSync(${JSON.stringify(childReadyPath)}, String(process.pid));
  process.on("SIGTERM", () => {
    writeFileSync(${JSON.stringify(childStoppedPath)}, "stopped");
    process.exit(0);
  });
  setInterval(() => {}, 1000);
`)}], { stdio: "inherit" });
child.on("exit", () => process.exit(0));
setInterval(() => {}, 1000);
`, "utf8");
    const process = launch(`${shellQuote(globalThis.process.execPath)} ${shellQuote(scriptPath)}`);
    const exited = exitOf(process);
    await waitForFile(childReadyPath);

    await process.stop();

    await expect(exited).resolves.toMatchObject({ exitCode: null });
    await expect(readFile(childStoppedPath, "utf8")).resolves.toBe("stopped");
  });

  it("settles stop against natural exit exactly once", async () => {
    const process = launch(`${shellQuote(globalThis.process.execPath)} -e ${shellQuote("process.stdout.write('done')")}`);
    const exits: InvocationProcessExit[] = [];
    process.onExit((event) => exits.push(event));
    let stop: Promise<void> | undefined;
    process.onOutput?.(() => {
      stop ??= process.stop();
    });

    await exitOf(process);
    expect(stop).toBeDefined();
    await stop;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(exits).toHaveLength(1);
    expect(exits[0]?.stdout).toBe("done");
  });

  it("returns one idempotent Stop operation", async () => {
    const process = launch(`${shellQuote(globalThis.process.execPath)} -e ${shellQuote("setInterval(() => {}, 1000)")}`);
    const exits: InvocationProcessExit[] = [];
    process.onExit((event) => exits.push(event));

    const first = process.stop();
    const second = process.stop();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(exits).toHaveLength(1);
  });

  it.runIf(process.platform !== "win32")("escalates when the process group ignores graceful Stop", async () => {
    const root = await temporaryRoot("exo-invocation-process-escalation-");
    const readyPath = path.join(root, "ready");
    const termPath = path.join(root, "term-seen");
    const scriptPath = path.join(root, "stubborn.mjs");
    await writeFile(scriptPath, `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(readyPath)}, "ready");
process.on("SIGTERM", () => writeFileSync(${JSON.stringify(termPath)}, "term"));
setInterval(() => {}, 1000);
`, "utf8");
    const process = launch(
      `${shellQuote(globalThis.process.execPath)} ${shellQuote(scriptPath)}`,
      new DirectInvocationProcessFactory({ stopGraceMs: 40 }),
    );
    const exited = exitOf(process);
    await waitForFile(readyPath);

    await process.stop();

    await expect(readFile(termPath, "utf8")).resolves.toBe("term");
    await expect(exited).resolves.toMatchObject({ exitCode: null });
  });

  it("never emits output callbacks after close", async () => {
    const process = launch("printf 'final-output'");
    const output: string[] = [];
    process.onOutput?.((event) => output.push(event.chunk));

    await exitOf(process);
    const atClose = [...output];
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(atClose.join("")).toBe("final-output");
    expect(output).toEqual(atClose);
  });
});

function launch(command: string, factory = new DirectInvocationProcessFactory()) {
  return factory.launch({ command, cwd: processCwd(), env: globalThis.process.env });
}

function exitOf(process: ReturnType<DirectInvocationProcessFactory["launch"]>): Promise<InvocationProcessExit> {
  return new Promise((resolve) => process.onExit(resolve));
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function processCwd(): string {
  return globalThis.process.cwd();
}
