import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const runtime = path.join(
  repositoryRoot,
  "dist",
  "plugins",
  "claude",
  "runtime",
  "mcp-server.mjs",
);

it("rejects an oversized stdio frame with only a fixed diagnostic", async () => {
  await expect(access(runtime)).resolves.toBeUndefined();
  const child = spawn(process.execPath, [runtime], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.on("error", () => {
    // The bounded server may close before Node finishes flushing the test frame.
  });

  const close = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  child.stdin.end(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "oversized-test", version: "1.0.0" },
      },
      ignored: "MCP_INPUT_CANARY".repeat(150_000),
    })}\n`,
  );

  await expect(close).resolves.toBe(1);
  expect(Buffer.concat(stdout).toString("utf8")).toBe("");
  const diagnostic = Buffer.concat(stderr).toString("utf8");
  expect(diagnostic).toBe('{"code":"E_SIZE_LIMIT","message":"Size limit exceeded."}\n');
  expect(diagnostic).not.toContain("MCP_INPUT_CANARY");
});
