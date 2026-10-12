// Run with: node --test tests/unit/rpc-gate.test.ts   (Node 22.18+/24 strips types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcRateLimitedError, createRpcGate } from "../../lib/rpc-gate.ts";

function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
}
const base = { budget: 3, windowMs: 60_000, maxConcurrent: 2, ttlFinalMs: 45_000, ttlPendingMs: 15_000, cooldownMs: 4_000, maxAttempts: 3 };
const make = (c: ReturnType<typeof clock>, extra: object = {}) => createRpcGate({ ...base, now: c.now, sleep: c.sleep, random: () => 0.5, ...extra });

test("serves repeat reads from cache until the TTL expires", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  const read = () => gate.run("k", false, async () => { calls += 1; return calls; });
  assert.equal(await read(), 1);
  assert.equal(await read(), 1);
  c.advance(44_000); assert.equal(await read(), 1);
  c.advance(2_000); assert.equal(await read(), 2);
  assert.equal(calls, 2);
});

test("pending reads expire sooner than finalized reads", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  const read = () => gate.run("p", true, async () => (calls += 1));
  await read(); c.advance(16_000); await read();
  assert.equal(calls, 2);
});

test("identical in-flight reads share one request", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  const fn = async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return "v"; };
  const results = await Promise.all([gate.run("same", false, fn), gate.run("same", false, fn), gate.run("same", false, fn)]);
  assert.deepEqual(results, ["v", "v", "v"]);
  assert.equal(calls, 1);
});

test("never spends more than the budget in any sliding window", async () => {
  const c = clock(); const gate = make(c); const starts: number[] = [];
  await Promise.all(Array.from({ length: 8 }, (_, i) => gate.run(`k${i}`, false, async () => { starts.push(c.now()); return i; })));
  assert.equal(starts.length, 8);
  for (let i = 3; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 3] >= 60_000, `call ${i} came too soon`);
});

test("two tabs sharing one window store share one budget", async () => {
  const c = clock(); let shared: number[] = []; const granted: number[] = [];
  // Every save appends exactly one newly granted slot; record it so the invariant is checked on grants.
  const windowStore = { load: () => shared, save: (v: number[]) => { granted.push(v[v.length - 1]); shared = v; } };
  const a = make(c, { windowStore }); const b = make(c, { windowStore });
  const work = (gate: ReturnType<typeof make>, id: string) => gate.run(id, false, async () => id);
  const results = await Promise.all([work(a, "a1"), work(b, "b1"), work(a, "a2"), work(b, "b2"), work(a, "a3"), work(b, "b3")]);
  assert.equal(results.length, 6);
  assert.equal(granted.length, 6);
  const sorted = [...granted].sort((x, y) => x - y);
  for (let i = 3; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 3] >= 60_000, `slot ${i} was granted inside the window`);
});

test("a rate-limit-like failure backs off, retries, and counts every retry against the budget", async () => {
  const c = clock(); const gate = make(c); let calls = 0; const times: number[] = [];
  const value = await gate.run("r", false, async () => {
    calls += 1; times.push(c.now());
    if (calls < 3) throw new TypeError("Failed to fetch");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.ok(times[1] - times[0] >= 3_000, "first retry must wait out the cooldown");
  assert.ok(times[2] - times[1] >= 6_000, "backoff grows with each attempt");
  assert.equal(gate.spent(), 3, "retries are counted requests, never free");
});

test("gives a clear error after the attempts are exhausted", async () => {
  const c = clock(); const gate = make(c);
  await assert.rejects(() => gate.run("x", false, async () => { throw new TypeError("Failed to fetch"); }), (e: unknown) => {
    assert.ok(e instanceof RpcRateLimitedError);
    assert.match((e as Error).message, /30 per minute/);
    return true;
  });
});

test("a genuine contract error is thrown at once and never retried", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  await assert.rejects(() => gate.run("e", false, async () => { calls += 1; throw new Error("charter not found"); }), /charter not found/);
  assert.equal(calls, 1);
  assert.equal(gate.getState().phase, "ok");
});

test("a failed read is not cached", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  await assert.rejects(() => gate.run("n", false, async () => { calls += 1; throw new Error("boom"); }));
  assert.equal(await gate.run("n", false, async () => { calls += 1; return "fine"; }), "fine");
  assert.equal(calls, 2);
});

test("fresh bypasses the cache and clearCache empties it", async () => {
  const c = clock(); const gate = make(c); let calls = 0;
  const fn = async () => (calls += 1);
  await gate.run("f", false, fn);
  await gate.run("f", false, fn, { fresh: true });
  assert.equal(calls, 2);
  gate.clearCache();
  await gate.run("f", false, fn);
  assert.equal(calls, 3);
});

test("exposes pacing and cooldown state to the UI, then recovers", async () => {
  const c = clock(); const gate = make(c); const seen: string[] = [];
  gate.subscribe((s) => seen.push(s.phase));
  let calls = 0;
  await gate.run("s", false, async () => { calls += 1; if (calls === 1) throw new TypeError("Failed to fetch"); return 1; });
  assert.ok(seen.includes("cooldown"));
  assert.equal(gate.getState().phase, "ok");
});
