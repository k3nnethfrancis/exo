#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const answer = process.env.EXO_FAKE_PI_ANSWER ?? "PI_FIXTURE_ANSWER OK";
const visibleMs = Number.parseInt(process.env.EXO_FAKE_PI_VISIBLE_MS ?? "1200", 10);
const status = process.env.EXO_FAKE_PI_STATUS ?? "model: fake-pi-viewport status: ready";
const includePrompt = process.env.EXO_FAKE_PI_INCLUDE_PROMPT === "1";
const tracePath = process.env.EXO_FAKE_PI_TRACE_PATH;
const traceSessionId = process.env.EXO_FAKE_PI_TRACE_SESSION_ID ?? "fake-pi-session";
const traceHarnessId = process.env.EXO_FAKE_PI_TRACE_HARNESS_ID ?? "fake-pi";

let input = "";
let rendering = false;
let cleanedUp = false;

function write(data) {
  process.stdout.write(data);
}

function renderInitial() {
  write("\x1b[2J\x1b[H");
  write("GA Pi-compatible fake repaint TUI\n");
  write("answer: \n");
  write(`${status}\n`);
  write("> ");
}

function renderAnswer(prompt) {
  rendering = true;
  void emitTraceEvent({
    type: "assistant-text",
    sessionId: traceSessionId,
    harnessId: traceHarnessId,
    turnId: "turn-1",
    text: answer,
    payload: { prompt },
  });
  write("\r\x1b[2K");
  write("\x1b[2A\r\x1b[2K");
  write(`answer: ${answer}${includePrompt ? ` prompt=${prompt}` : ""}\n`);
  write("\x1b[2Kmodel: fake-pi-viewport status: generating\n");
  write("> ");

  setTimeout(() => {
    write("\r\x1b[2K");
    write("\x1b[2A\r\x1b[2K");
    write("answer: \n");
    write(`\x1b[2K${status}\n`);
    write("> ");
    rendering = false;
  }, Number.isFinite(visibleMs) && visibleMs >= 0 ? visibleMs : 1200);
}

async function emitTraceEvent(event) {
  if (!tracePath) {
    return;
  }
  await mkdir(path.dirname(tracePath), { recursive: true });
  await appendFile(tracePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
}

function handleChunk(chunk) {
  for (const char of chunk.toString("utf8")) {
    if (char === "\u0003") {
      cleanup();
      process.exit(130);
    }
    if (char === "\r" || char === "\n") {
      const prompt = input.trim();
      input = "";
      if (prompt.length > 0 && !rendering) {
        renderAnswer(prompt);
      }
      continue;
    }
    if (char === "\u007f") {
      input = input.slice(0, -1);
      write("\b \b");
      continue;
    }
    input += char;
    write(char);
  }
}

function cleanup() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  write("\n");
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.on("exit", cleanup);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", handleChunk);
renderInitial();
