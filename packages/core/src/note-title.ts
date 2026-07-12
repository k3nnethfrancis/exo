/**
 * An explicit title is a note's alternate name. Otherwise its opening H1 is
 * the human name, with the filename as the stable fallback.
 */
export function noteTitle(filePath: string, frontmatter: Record<string, unknown>, body: string): string {
  const explicitTitle = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  if (explicitTitle) {
    return explicitTitle;
  }

  const openingLine = body.trimStart().split(/\r?\n/, 1)[0] ?? "";
  const openingHeading = openingLine.match(/^#\s+(.+?)(?:\s+#+)?\s*$/)?.[1]?.trim();
  return openingHeading || filenameTitle(filePath);
}

function filenameTitle(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath;
  return filename.replace(/\.[^.]+$/, "");
}
