import path from "node:path";

const MARKDOWN_FILE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".mkdn",
  ".mdwn",
  ".mdtext",
  ".mdtxt",
]);

export function isMarkdownFilePath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function markdownFilePathsFromCommandLine(commandLine: readonly string[]): string[] {
  return commandLine
    .filter((argument) => !argument.startsWith("-") && isMarkdownFilePath(argument))
    .map((argument) => path.resolve(argument));
}
