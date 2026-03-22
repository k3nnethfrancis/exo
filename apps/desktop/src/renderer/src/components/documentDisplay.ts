export function getDocumentDisplayTitle(filePath: string, kind: "markdown" | "text"): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  if (kind === "markdown") {
    return fileName.replace(/\.[^.]+$/, "");
  }
  return fileName;
}

export function stringifyFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function coerceFrontmatterValue(nextValue: string, previousValue: unknown): unknown {
  if (Array.isArray(previousValue)) {
    return nextValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof previousValue === "number") {
    const parsed = Number(nextValue);
    return Number.isNaN(parsed) ? previousValue : parsed;
  }
  if (typeof previousValue === "boolean") {
    const normalized = nextValue.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    return previousValue;
  }
  return nextValue;
}
