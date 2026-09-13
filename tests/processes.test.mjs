import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { processTools, runShell, closeProcesses } from "../src/processes.mjs";

const tool = name => processTools.find(t => t.name === name);
afterEach(closeProcesses);

test("managed process accepts stdin, exposes incremental output and reports exit", async () => {
  const started = await tool("exec_command").run({ command: "read line; echo \"reply:$line\"", yield_time_ms: 0 });
  assert.equal(started.running, true);
  const result = await tool("write_stdin").run({ session_id: started.session_id, chars: "ciao\n", yield_time_ms: 1000 });
  assert.equal(result.running, false); assert.equal(result.exit_code, 0); assert.match(result.output, /reply:ciao/);
  const last = await tool("write_stdin").run({ session_id: started.session_id, offset: result.next_offset });
  assert.equal(last.output, "");
});
test("shell failure, timeout and cancellation are visible", async () => {
  assert.match(await runShell({ command: "echo error >&2; exit 7" }), /error\n\[exit code 7/);
  assert.match(await runShell({ command: "sleep 30", timeout_ms: 20 }), /timed out/);
  const controller = new AbortController();
  const running = runShell({ command: "sleep 30" }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  assert.match(await running, /cancelled/);
});
test("termination stops a process and returns its final status", async () => {
  const started = await tool("exec_command").run({ command: "sleep 30", yield_time_ms: 0 });
  const stopped = await tool("terminate_process").run({ session_id: started.session_id });
  assert.equal(stopped.running, false); assert.match(stopped.reason, /terminated/);
});
test("output bounds preserve the tail and mark truncation", async () => {
  const start = await tool("exec_command").run({ command: "head -c 120000 /dev/zero | tr '\\0' a", yield_time_ms: 1000 });
  assert.equal(start.truncated, true); assert.equal(start.output.length, 100000); assert.equal(start.next_offset, 120000);
});
