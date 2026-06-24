# Terminal Code Review — 2026-06-23

Multi-angle review of `apps/desktop/src/main/terminal-*.ts` and associated tests.
Verified against HEAD `8f53cb8` (latest commit touches CSS/docs only — none of these findings are addressed).

Findings are ranked most-severe first. "Must fix" findings are correctness bugs that affect real user workflows today.

---

## Must Fix

### 1. Multiple queued `delayedSubmit` writes send multiple Enter presses on flush
**File:** `apps/desktop/src/main/terminal-manager.ts:704`

`flushPendingWrites` loops over all queued writes and calls `writePendingData` for each. When `delayedSubmit=true`, each call schedules its own `setTimeout(() => record.process.write('\r'), agentSubmitDelayMs)`. Two queued agent messages → two timers → two Enter keypresses sent to the agent.

**Trigger:** Queue two semantic messages to a Codex terminal during `starting` readiness. When readiness resolves, both flush and each independently schedules `\r`. The agent receives a spurious empty submit or re-fires the first prompt.

**Fix:** Only schedule the `\r` timer for the last pending write in the flush loop, or move the `\r` into the flush orchestrator rather than per-write.

---

### 2. `sendKeys()` throws unhandled on a dead pane, crashing the IPC handler
**File:** `apps/desktop/src/main/terminal-tmux.ts:173`

`sendKeys` calls `execFileSync` with no `try/catch`. If tmux is momentarily unresponsive or the pane has exited, `execFileSync` throws `TmuxCommandError`. The error propagates through `TmuxControlModeProcess.write()` → `TerminalManager.flushRawInput()` / `writePendingData()` — neither has a catch — up to the IPC handler.

**Trigger:** Hold an arrow key or send input while the pane exits. Every keystroke fires `sendKeys` → throws. The Electron main-process IPC handler sees an unhandled rejection; subsequent writes to the terminal fail silently.

**Fix:** Wrap `execFileSync` in `sendKeys` (and `pasteLiteral`) in a try/catch. On failure, mark `bridgeDetached = true` and return a `delivery: "not-found"` result rather than throwing.

---

### 3. `flushPendingWrites` doesn't check `bridgeDetached`; queued messages silently drop
**File:** `apps/desktop/src/main/terminal-manager.ts:694`

`write()` guards on `bridgeDetached` and returns `delivery: "not-found"`. But `flushPendingWrites` only checks `status !== "exited"`. If the bridge detaches between queue-time and readiness-timer fire (e.g. sleep/wake during Codex startup), `writePendingData` writes to the noop process, the message is lost, and no error is surfaced — the caller already received `delivery: "queued"`.

**Trigger:** Queue a semantic message to a Codex terminal during startup. macOS sleep/wake before readiness resolves. On wake, startup grace timer fires `markReady` → `flushPendingWrites` → `record.process.write(...)` on the noop process. Message gone.

**Fix:** Add `&& !record.bridgeDetached` to the `flushPendingWrites` loop condition (or log a warning and discard cleanly).

---

### 4. `clearReadinessTimer()` silently drops buffered raw keystrokes on kill
**File:** `apps/desktop/src/main/terminal-manager.ts:723`

`clearReadinessTimer()` clears both `readinessTimer` and `rawInputTimer` without flushing `rawInputBuffer`. `kill()` calls `clearReadinessTimer()` at line 460 before deleting the session. `markExited()` also calls it. Any coalesced keystrokes sitting in `rawInputBuffer` at that moment are dropped with no error returned to the `write()` caller.

**Trigger:** User types several printable characters (coalesced by `queueRawInput`) then `kill()` fires before the coalesce timer elapses. Keystrokes lost.

**Fix:** Either flush `rawInputBuffer` before clearing `rawInputTimer` in `clearReadinessTimer`, or give it a `{ flushBuffer: boolean }` option so `kill()` can choose to discard cleanly while other paths flush first.

---

## Fix When Touched

### 5. Live-tail freshness uses string length after screen clear, returning stale content permanently
**File:** `apps/desktop/src/main/terminal-live-tail-policy.ts:22`

The unbounded path picks between tmux capture and the in-memory cache using `captured.length > buffered.length`. After a `clear` command, tmux capture returns a blank screen (~few hundred bytes) while `tailCache` holds the full session history (potentially many KB). `captured.length < buffered.length` → cache is returned, `cacheCapturedTail=false`. The cache is never refreshed. CLI tail reads and UI restore show pre-clear history until new output exceeds the old buffer size.

**Fix:** Use explicit cache invalidation (e.g. a `cacheSeq` counter incremented on each live output event) rather than length comparison, or always prefer tmux capture when it's non-null and cache was last populated before the capture.

---

### 6. `readFileTail` byte offset may split a multibyte UTF-8 sequence, producing U+FFFD
**File:** `apps/desktop/src/main/terminal-transcripts.ts:107`

```ts
readSync(fd, buffer, 0, bytesToRead, stats.size - bytesToRead);
return buffer.toString("utf8").slice(-tailChars);
```

The read starts at `stats.size - bytesToRead`, a raw byte offset with no UTF-8 alignment guarantee. If that offset lands inside a multi-byte glyph (box-drawing chars, emoji), `buffer.toString("utf8")` emits U+FFFD for the partial bytes. The returned tail has a replacement character where the glyph should be.

**Fix:** After `buffer.toString("utf8")`, strip any leading `�` characters that resulted from the split boundary before applying the `slice(-tailChars)` trim.

---

## Cleanup / Reliability

### 7. `detectTmux()` runs a blocking `spawnSync` on every call with no caching
**File:** `apps/desktop/src/main/terminal-runtime-tmux.ts:27`

`availability()`, `requireTmux()`, and `runnerOrNull()` each call `detectTmux()` unconditionally. `detectTmux` runs `spawnSync` for each candidate path until one succeeds. On a power-resume with 5 running sessions: `reconcileTmuxState()` (1 call) + each `reconnect()` internally calling `reconcileTmuxState()` (5 calls) = 6 blocking `spawnSync` calls on the Electron main thread.

**Fix:** Cache the `TmuxAvailable` result at module or instance level and invalidate only on `EXO_TMUX_PATH` change or explicit reset. A stale path from a deleted tmux binary is an acceptable edge case.

---

### 8. `terminalHealth` test suite covers only 2 of 5 return paths
**File:** `apps/desktop/src/main/terminal-health.test.ts:1`

`terminalHealth()` has five distinct return paths: `"exited"`, `"unhealthy"` (pane missing/dead/bridgeDetached), `"unhealthy"` (unresponsive), `"idle"`, `"healthy"`. The test file has two cases covering pane-missing→unhealthy and unresponsive→unhealthy. `bridgeDetached=true`, idle (no recent output), and healthy (recent I/O) have no coverage.

**Fix:** Add three test cases:
- `bridgeDetached: true` → `"unhealthy"` with the bridge-detached detail string
- `lastOutputAt` set but older than `idleThresholdMs` → `"idle"`
- `lastOutputAt` recent → `"healthy"`

---

*Generated by Shoshin code review — 2026-06-23*
