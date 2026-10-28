#!/usr/bin/env node
/**
 * `npm run dev`: starts the API, the pg-boss worker and the web app together with prefixed,
 * colored output, and stops all of them when any one exits or on Ctrl+C.
 */
import { spawn } from "node:child_process";

const procs = [
  { name: "api", color: 36, cmd: ["npm", "run", "dev", "--workspace", "server"] },
  { name: "worker", color: 35, cmd: ["npm", "run", "dev:worker", "--workspace", "server"] },
  { name: "web", color: 32, cmd: ["npm", "run", "dev", "--workspace", "web"] },
];

const width = Math.max(...procs.map((p) => p.name.length));
const children = [];
let stopping = false;

function pipe(stream, prefix, out) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) out.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => buf && out.write(`${prefix} ${buf}\n`));
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM"); // whole process group (npm -> sh -> tsx/next)
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const p of procs) {
  const prefix = `\x1b[${p.color}m${p.name.padEnd(width)} |\x1b[0m`;
  const child = spawn(p.cmd[0], p.cmd.slice(1), {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  children.push(child);
  pipe(child.stdout, prefix, process.stdout);
  pipe(child.stderr, prefix, process.stderr);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.stderr.write(`${prefix} exited (${signal ?? code}); stopping the others\n`);
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
