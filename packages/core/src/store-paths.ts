export function safeStoreSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("Store id segment must be a non-empty identifier.");
  }

  return trimmed.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^\.+$/, "-");
}

export function safeStoreFileName(value: string): string {
  if (value.includes("/") || value.includes("\\")) {
    throw new Error("Store filename must not contain path separators.");
  }
  return safeStoreSegment(value);
}
