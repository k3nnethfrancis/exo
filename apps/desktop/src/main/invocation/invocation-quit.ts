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
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      options.flushDirtyDocuments(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Renderer flush exceeded ${timeoutMs}ms.`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    options.onError?.("renderer-flush", error);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
