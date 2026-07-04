# WP-078 Pi Answer Visibility Diagnostic

Date: 2026-07-03
Status: diagnostic complete; generic semantic answer read path shipped

## Fixture

Added `apps/desktop/tests/fixtures/fake-pi-repaint-tui.mjs`.

The fixture mimics a Pi-compatible TUI that:

- prints a persistent status line
- accepts stdin
- renders `PI_FIXTURE_ANSWER OK` by cursor-up, erase-line, and fixed-region rewrite
- restores the status line and erases the answer region after a deterministic delay

## Relevant Read Path

- `TerminalManager.wireProcess()` appends tmux control-mode output to the transcript store and in-memory tail cache.
- `TerminalManager.readTranscript()` flushes and reads `.exo/terminal-transcripts/*.ansi.log`.
- `exo agents read <id> --tail N --raw` calls `readTerminalTranscript(id, N)`, then slices the raw transcript tail again.
- `TerminalManager.readTail()` is separate: it captures tmux display/history and selects that over the cache when available.

## Evidence

### 1. Direct tmux pane behavior

Command shape:

```bash
tmux new-session -d -s "$SESSION" -x 63 -y 20 \
  "EXO_FAKE_PI_VISIBLE_MS=2000 node apps/desktop/tests/fixtures/fake-pi-repaint-tui.mjs"
tmux send-keys -t "$SESSION" "hello" Enter
tmux capture-pane -p -e -t "$SESSION"
tmux capture-pane -p -e -S -200 -t "$SESSION"
```

Observed:

```text
visible_has_answer=yes
visible_capture:
GA Pi-compatible fake repaint TUI
answer: PI_FIXTURE_ANSWER OK
model: fake-pi-viewport status: generating
>

history_has_answer=no
after_repaint_capture:
GA Pi-compatible fake repaint TUI
answer:
model: fake-pi-viewport status: ready
>
```

Conclusion: once this TUI repaints the answer region, tmux display/history cannot recover the generated answer. A capture-pane-only fix would be the wrong layer for this fixture class.

### 2. Exo transcript and CLI read path

Command shape:

```bash
pnpm --silent exo terminals create shell /Users/kenneth/Desktop/lab/projects/exo
pnpm --silent exo terminals diagnostics
tmux send-keys -t "$PANE" \
  "EXO_FAKE_PI_VISIBLE_MS=1000 node /Users/kenneth/Desktop/lab/projects/exo/apps/desktop/tests/fixtures/fake-pi-repaint-tui.mjs" Enter
tmux send-keys -t "$PANE" "hello" Enter
rg -a -q "PI_FIXTURE_ANSWER" "$TRANSCRIPT"
pnpm --silent exo agents read "$ID" --tail 120 --raw
```

Observed on `term-73`:

```text
transcript_has_answer=yes
history_has_answer=no
exo_agents_read_tail_120_after_has_answer=no
read_tail_120_after:

\x1b[2Kmodel: fake-pi-viewport status: generating
> \r\x1b[2K\x1b[2A\r\x1b[2Kanswer:
\x1b[2Kmodel: fake-pi-viewport status: ready
>
```

Observed on the same fixture shape with a larger transcript tail (`term-72`):

```text
exo_agents_read_tail_80_after_has_answer=no
exo_agents_read_tail_200_after_has_answer=yes
```

The 200-character tail excerpt contains the answer bytes followed by the erase/status repaint bytes. The 120-character tail starts after the answer and therefore reports only the final status repaint.

## Decision Tree Outcome

Primary outcome for the reported `exo agents read --tail 120 --raw` symptom:

```text
transcript-present/read-absent => read-tail policy bug
```

The answer reaches the pane and is persisted in `.exo/terminal-transcripts/*.ansi.log`. The specific loss happens when `agents read --tail N --raw` returns a bounded raw transcript suffix after the TUI has emitted enough erase/status repaint bytes to push the answer outside that suffix.

Secondary outcome for tmux display/history:

```text
visible-only/history-absent => viewport-widget limitation
```

After repaint, direct tmux capture no longer contains the answer. Durable "what did the agent say" behavior for Pi-style TUIs still belongs in semantic trace output, not broader tmux capture, buffering, or TUI-special casing in terminal core.

## Decision

Do not change terminal runtime capture behavior for WP-078.

`exo agents read <id> --tail N --raw` remains a raw transcript suffix. It is useful for terminal debugging, but it is not an answer extractor and can miss Pi-style answers after repaint/status bytes push the answer outside the bounded suffix.

The narrow fix is a generic semantic answer read path:

- CLI: `exo agents read <id> --semantic` reads agent message text from `.exo/traces/{id}.ndjson`.
- MCP: `read_agent` accepts `source: "trace"` for the same persisted semantic answer path.
- App command server: `GET /terminals/{id}/semantic-answer?limit=N` returns `{ answer }`.

No terminal core buffering, capture behavior, or Pi-specific TUI special casing was edited.

-- Shoshin | 2026-07-03
