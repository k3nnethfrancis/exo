export interface InvocationAwareQuitOptions {
  flushDirtyDocuments: () => Promise<unknown>;
  stopInvocations: () => Promise<unknown>;
  flushTimeoutMs?: number;
  onError?: (phase: "renderer-flush" | "invocation-stop", error: unknown) => void;
}

/** Wait for durable editor state and exact invocation settlement before quit. */
export async function awaitInvocationAwareQuit(options: InvocationAwareQuitOptions): Promise<void> {
  const timeoutMs = options.flushTimeoutMs ?? 5_000;
  try {
    // Settlement must precede renderer saves. Otherwise a dirty human buffer
    // can be attributed to the agent or become the proposal Reject restores.
    await options.stopInvocations();
  } catch (error) {
    options.onError?.("invocation-stop", error);
    throw error;
  }
  try {
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      options.flushDirtyDocuments().then(() => "flushed" as const),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (outcome === "timed-out") {
      options.onError?.("renderer-flush", new Error(`Renderer flush exceeded ${timeoutMs}ms.`));
    }
  } catch (error) {
    options.onError?.("renderer-flush", error);
  }
}
