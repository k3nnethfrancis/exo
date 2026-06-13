#!/usr/bin/env node

import readline from "node:readline";

const profile = process.argv.includes("--codex") ? "codex" : "claude";
const label = profile.toUpperCase();

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

write(`FAKE_${label}_READY`);
write("\x1b[1mA few key takeaways:\x1b[0m");
write("Their framing was: \"Glean is knowledge discovery; ChatGTM is sales workflows.\"");
write("This line is intentionally long enough to wrap inside a narrow terminal pane so Exo can exercise xterm wrapping, resize, and scrollback behavior without calling live inference.");
write("\x1b[2mstatus: streaming deterministic fake-agent output\x1b[0m");

for (let i = 1; i <= 80; i += 1) {
  write(`fake-agent-scrollback-${String(i).padStart(3, "0")} :: ${"chunk ".repeat(12)}`);
}

process.stdout.write("\r\x1b[33mthinking\x1b[0m .");
setTimeout(() => process.stdout.write("\r\x1b[33mthinking\x1b[0m .."), 20);
setTimeout(() => process.stdout.write("\r\x1b[33mthinking\x1b[0m ...\n"), 40);
setTimeout(() => write("FAKE_AGENT_PROMPT ready for input"), 60);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  write(`FAKE_AGENT_INPUT ${line}`);
  write("FAKE_AGENT_PROMPT ready for input");
});
