import { describe, expect, it } from "vitest";

import { isMarkdownFilePath, markdownFilePathsFromCommandLine } from "./markdown-file-open";

describe("Markdown OS file opens", () => {
  it("recognizes common Markdown extensions case-insensitively", () => {
    expect(isMarkdownFilePath("/tmp/readme.md")).toBe(true);
    expect(isMarkdownFilePath("/tmp/guide.MARKDOWN")).toBe(true);
    expect(isMarkdownFilePath("/tmp/component.mdx")).toBe(false);
    expect(isMarkdownFilePath("/tmp/readme.txt")).toBe(false);
  });

  it("extracts Markdown paths while ignoring app flags", () => {
    expect(markdownFilePathsFromCommandLine([
      "/Applications/Exograph.app/Contents/MacOS/Exograph",
      "--some-electron-flag",
      "/tmp/one.md",
      "/tmp/two.markdown",
      "/tmp/not-a-note.txt",
    ])).toEqual(["/tmp/one.md", "/tmp/two.markdown"]);
  });
});
