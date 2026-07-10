# Note-Native Invocation Prototype Evidence

Last updated: 2026-07-08

Status: WP0.5 local evidence artifact. This does not implement invocation code. It uses repository/vault scans and cheap local fake commands only. No live Claude/Fable pointer-prompt invocations were run.

## Summary

Recommendation:

- V1 mention syntax: editor-owned only, normal paragraph line start, configured handle only: `^ {0,3}@<configured-handle>\s+\S`, for example `@claude please turn this into an implementation plan`.
- V1 prompt delivery for terminal/tmux-launched configured commands: `terminalInputAfterLaunch`.
- Keep `stdin` and `argv` as future/noninteractive command-template modes only if the implementation explicitly supports them; do not make V1 auto-detect prompt delivery.
- V1 direct-write attribution should mark any file touched by both user and agent during the invocation window as `ambiguous`.

Why:

- Raw `@handle` syntax is extremely noisy in the vault and repo.
- Line-start configured-handle syntax has low observed false positives: 0 in the vault for `@claude|@codex|@pi`, and 1 intentional Exo planning example in the repo.
- `stdin` and `argv` preserve the pointer prompt in local fake commands, but they are poor defaults for interactive terminal commands such as Claude Code or Codex.
- Terminal input after launch can preserve the prompt through a PTY fake command and matches interactive command UX, but it still needs Exo app/tmux QA because launch readiness and focus/input timing are the risky part.

## 1. Mention False-Positive Scan

Paths scanned:

- Vault: `/Users/kenneth/Desktop/lab/notes/shoshin-codex`
- Repo: `/Users/kenneth/Desktop/lab/projects/exo`

### Raw Mention-Like Tokens

Command:

```bash
rg -o --glob '*.md' '(^|[^[:alnum:]_])@[A-Za-z][A-Za-z0-9_-]{1,31}\b' /Users/kenneth/Desktop/lab/notes/shoshin-codex | wc -l
rg -l --glob '*.md' '(^|[^[:alnum:]_])@[A-Za-z][A-Za-z0-9_-]{1,31}\b' /Users/kenneth/Desktop/lab/notes/shoshin-codex | wc -l
rg -o --glob '*.md' '(^|[^[:alnum:]_])@[A-Za-z][A-Za-z0-9_-]{1,31}\b' /Users/kenneth/Desktop/lab/projects/exo | wc -l
rg -l --glob '*.md' '(^|[^[:alnum:]_])@[A-Za-z][A-Za-z0-9_-]{1,31}\b' /Users/kenneth/Desktop/lab/projects/exo | wc -l
```

Results:

- Vault: 1,381 raw mention-like tokens across 112 Markdown files.
- Repo: 140 raw mention-like tokens across 31 Markdown files.

Observed likely false-positive classes:

- npm/package scopes such as `@exo/core`, `@tobilu/qmd`, and `@modelcontextprotocol/sdk`.
- Twitter/X handles in bookmark archives and research notes.
- CSS at-rules such as `@import` and `@media`.
- Existing Exo docs examples that intentionally mention `@claude`.

Conclusion: raw `@handle` detection is not viable for watcher-owned auto-run and is too noisy without editor ownership, configured-handle filtering, and syntax constraints.

### Line-Start Any-Handle Syntax

Command:

```bash
rg -n --glob '*.md' '^\s{0,3}@[a-z][a-z0-9_-]{1,31}\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex
rg -n --glob '*.md' '^\s{0,3}@[a-z][a-z0-9_-]{1,31}\s+\S' /Users/kenneth/Desktop/lab/projects/exo
rg -n --glob '*.md' '^\s{0,3}@[a-z][a-z0-9_-]{1,31}\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex | wc -l
rg -n --glob '*.md' '^\s{0,3}@[a-z][a-z0-9_-]{1,31}\s+\S' /Users/kenneth/Desktop/lab/projects/exo | wc -l
```

Results:

- Vault: 2 matches.
- Repo: 1 match.

Vault matches were both CSS false positives in archived HTML email templates:

- `@import url(...)`
- `@import url(...)`

Repo match was the intentional invocation example in `docs/pivot-product-definition.md`:

```text
@claude please turn the above into a crisp implementation plan
```

Conclusion: line-start syntax cuts noise sharply, but any-handle parsing can still hit CSS at-rules. Configured-handle filtering matters.

### Line-Start Known-Handle Syntax

Command:

```bash
rg -n --glob '*.md' '^\s{0,3}@(claude|codex|pi)\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex
rg -n --glob '*.md' '^\s{0,3}@(claude|codex|pi)\s+\S' /Users/kenneth/Desktop/lab/projects/exo
rg -n --glob '*.md' '^\s{0,3}@(claude|codex|pi)\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex | wc -l
rg -n --glob '*.md' '^\s{0,3}@(claude|codex|pi)\s+\S' /Users/kenneth/Desktop/lab/projects/exo | wc -l
```

Results:

- Vault: 0 matches.
- Repo: 1 match, the intentional planning example above.

Conclusion: for V1, parse only configured handles, at normal paragraph line start, in the editor, with user confirmation. Do not auto-run from watcher-observed Markdown.

### Colon Form

Command:

```bash
rg -n --glob '*.md' '^\s{0,3}(?:[-*]\s+(?:\[[ xX]\]\s+)?)?@[a-z][a-z0-9_-]{1,31}:\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex
rg -n --glob '*.md' '^\s{0,3}(?:[-*]\s+(?:\[[ xX]\]\s+)?)?@[a-z][a-z0-9_-]{1,31}:\s+\S' /Users/kenneth/Desktop/lab/projects/exo
rg -n --glob '*.md' '^\s{0,3}(?:[-*]\s+(?:\[[ xX]\]\s+)?)?@[a-z][a-z0-9_-]{1,31}:\s+\S' /Users/kenneth/Desktop/lab/notes/shoshin-codex | wc -l
rg -n --glob '*.md' '^\s{0,3}(?:[-*]\s+(?:\[[ xX]\]\s+)?)?@[a-z][a-z0-9_-]{1,31}:\s+\S' /Users/kenneth/Desktop/lab/projects/exo | wc -l
```

Results:

- Vault: 0 matches.
- Repo: 0 matches.

Conclusion: `@handle: request` is clean, but it diverges from the current Exo planning examples and common natural mention style. It remains a good fallback if real dogfooding shows line-start `@handle request` is too ambiguous.

## 2. Prompt Delivery Prototypes

Pointer prompt used:

```text
You have been tagged in the following document:
/tmp/example-note.md

Message:
@claude please summarize the note and append a next step.
```

### `stdin`

Command:

```bash
printf '%s' "$prompt" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.stringify({method:"stdin", length:data.length, includesBlankLine:data.includes("\n\nMessage:"), firstLine:data.split("\n")[0]})))'
```

Result:

```json
{"method":"stdin","length":137,"includesBlankLine":true,"firstLine":"You have been tagged in the following document:"}
```

Tradeoff:

- Best for noninteractive commands and scripts.
- Avoids command-line quoting and process-list leakage.
- Poor V1 default for terminal/tmux-launched interactive commands because the command's stdin is the terminal and many harnesses expect the user prompt after startup, not piped at process creation.

### `argv`

Command:

```bash
node -e 'const data=process.argv[1] ?? ""; console.log(JSON.stringify({method:"argv", length:data.length, includesBlankLine:data.includes("\n\nMessage:"), firstLine:data.split("\n")[0]}))' "$prompt"
```

Result:

```json
{"method":"argv","length":137,"includesBlankLine":true,"firstLine":"You have been tagged in the following document:"}
```

Tradeoff:

- Easy for simple scripts.
- Bad default for private note prompts because args can appear in process lists, shell history, logs, crash reports, and transcripts.
- Brittle for long prompts and shell quoting.
- Many interactive tools do not accept an initial multiline prompt as a positional arg.

### Terminal Input After Launch

First tmux paste attempt:

```bash
tmux new-session -d -s "$session" "cat > '$out'"
tmux set-buffer -b "${session}-prompt" "$prompt"
tmux paste-buffer -t "$session" -b "${session}-prompt"
tmux send-keys -t "$session" C-d
```

Result in this non-app shell:

```text
server exited unexpectedly
```

That result is not sufficient evidence against Exo's tmux path because Exo uses its own terminal runtime and bridge. It does show that raw tmux paste evidence is not portable enough to treat as app QA.

PTY fake-command command:

```bash
python3 -c 'import os,pty,subprocess,sys,time
out=sys.argv[1]
prompt=sys.argv[2]
master, slave = pty.openpty()
proc = subprocess.Popen(["python3", "-c", "import sys,pathlib; data=sys.stdin.read(); pathlib.Path(sys.argv[1]).write_text(data)", out], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
os.write(master, prompt.encode())
time.sleep(0.1)
os.close(master)
proc.wait(timeout=5)
' "$out" "$prompt"
node -e 'const fs=require("fs"); const p=process.argv[1]; const data=fs.existsSync(p)?fs.readFileSync(p,"utf8"):""; console.log(JSON.stringify({method:"terminal-input-after-launch-via-pty", length:data.length, includesBlankLine:data.includes("\n\nMessage:"), firstLine:data.split("\n")[0], hasCR:data.includes("\r")}))' "$out"
```

Result:

```json
{"method":"terminal-input-after-launch-via-pty","length":137,"includesBlankLine":true,"firstLine":"You have been tagged in the following document:","hasCR":false}
```

Tradeoff:

- Best fit for terminal/tmux-launched interactive configured commands.
- Matches the user-visible model: open a terminal, run the command, inject the pointer prompt.
- Does not put private prompt text in argv.
- Requires app-level QA for readiness, focus, multiline paste, submit behavior, transcript capture, and failure handling.
- V1 should avoid deep harness readiness assumptions. Use a simple configured delivery delay/readiness policy and surface failure honestly if prompt injection is not confirmed.

## 3. Concurrent Direct-Write Simulation

This was simulated with temp files outside the repo.

Command:

```bash
tmpdir=$(mktemp -d /tmp/exo-wp05-concurrency.XXXXXX)
note="$tmpdir/note.md"
before_file="$tmpdir/note.before.md"
printf '# Prototype Note\n\nOriginal line.\n' > "$note"
cp "$note" "$before_file"
before=$(shasum -a 256 "$note" | awk '{print $1}')
(
  sleep 0.1
  printf '\nUser edit while invocation is running.\n' >> "$note"
) &
user_pid=$!
(
  sleep 0.2
  printf '\nAgent direct write during same invocation window.\n' >> "$note"
) &
agent_pid=$!
wait "$user_pid" "$agent_pid"
after=$(shasum -a 256 "$note" | awk '{print $1}')
git diff --no-index -- "$before_file" "$note" || true
```

Result:

```text
before=974a7711704d0ce7f81b058a9ad995ca89233e7c1787789d9c51df2c24386fa6
after=b839f580b14e529ae5dea741d715f3354fe1d798e474575d92a890e8b82e344b
```

Diff:

```diff
@@ -1,3 +1,7 @@
 # Prototype Note

 Original line.
+
+User edit while invocation is running.
+
+Agent direct write during same invocation window.
```

Evidence this gives:

- A pre-snapshot plus final diff is enough to show that the file changed during the invocation window.
- Without app/editor writer identity, the combined diff cannot prove which hunk came from the user versus the agent.
- The correct V1 label for this case is `ambiguous`, not `likely`.

What still needs app-level QA:

- Dirty Exo editor buffer plus disk write must not clobber unsaved user text.
- Watcher event ordering and grace period behavior.
- Diff banner and attribution label after an actual invocation record is created.
- Restart/orphan handling.

## 4. V1 Decisions

### Strict Mention Syntax

Use:

```text
@claude please turn the above into a crisp implementation plan
```

Parser constraints:

- editor-owned only in V1;
- user-confirmed before launch;
- only configured handles, not arbitrary `@handle`;
- normal paragraph line start: at most three leading spaces, then `@handle`, then at least one whitespace character and non-empty request text;
- ignore fenced code blocks, inline code, frontmatter, and rendered HTML/style blocks;
- no watcher-owned auto-run in V1.

Implementation regex shape:

```text
^ {0,3}@(?<handle>[a-z][a-z0-9_-]{1,31})\s+(?<message>\S.*)$
```

Then validate `handle` against configured `AgentCommand.handle`.

### Prompt Delivery

Use `terminalInputAfterLaunch` for V1 note-native terminal invocation.

Rationale:

- The target default commands are interactive terminal commands.
- The prompt is private enough that argv should not be the default.
- stdin is clean for scripts but changes the launch model away from normal terminal interaction.
- Terminal input after launch is the only tested option that both preserves prompt bytes in a PTY fake command and matches the user-facing "terminal opens/runs normally" acceptance criterion.

V1 caveat:

- This evidence does not prove Exo's tmux bridge timing. WP5b and WP6 must still include fake-command app QA for launch, multiline input, transcript ref, changed-file diff, concurrent edit ambiguity, dirty-buffer protection, and orphaned invocation.

## Remaining WP0.5 Gap

The plan asks for 10 real pointer-prompt invocations against representative notes. Those were not run because this task explicitly said to avoid expensive live Claude/Fable calls unless the lead/user asked for them. Leave that task unchecked until a lead approves live dogfooding or provides a cheap configured real command target.

-- Exo | 2026-07-08
