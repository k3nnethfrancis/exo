import { describe, expect, it } from "vitest";

import { DirectInvocationProcessFactory, type InvocationProcessExit, type InvocationProcessOutput } from "./invocation-process";

describe("direct invocation process", () => {
  it("streams output facts while retaining bounded exit output", async () => {
    const process = new DirectInvocationProcessFactory().launch({
      command: "read line; printf 'first:%s\\n' \"$line\"; printf 'warn\\n' >&2; printf 'last\\n'",
      cwd: processCwd(),
      env: globalThis.process.env,
    });
    const output: InvocationProcessOutput[] = [];
    process.onOutput?.((event) => output.push(event));
    const exited = new Promise<InvocationProcessExit>((resolve) => process.onExit(resolve));

    await process.send("hello\n");
    const result = await exited;

    expect(result).toMatchObject({ exitCode: 0, stdout: "first:hello\nlast\n", stderr: "warn\n" });
    expect(output).toEqual(expect.arrayContaining([
      { channel: "stdout", chunk: expect.stringContaining("first:hello") },
      { channel: "stderr", chunk: "warn\n" },
    ]));
  });
});

function processCwd(): string {
  return globalThis.process.cwd();
}
