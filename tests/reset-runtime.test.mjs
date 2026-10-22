import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { onProvider } from "../codex-tiers.middleware.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const hookSource = fs.readFileSync(new URL("../reset.hooks.js", import.meta.url), "utf8");
const now = Date.parse("2030-01-01T00:00:00Z");
const event = { kind: "reset_scheduled", effectiveAt: new Date(now + 3600000).toISOString() };
const flush = () => new Promise((resolve) => setImmediate(resolve));

// 所有配置读写和网络均替换为内存实现；测试不会触碰真实用户目录。
function runtime({ files = new Map(), fetcher = () => new Promise(() => {}), time = now } = {}) {
  const dir = path.join(root, "synthetic-config");
  const config = path.join(dir, "plugins.json");
  if (!files.has(config)) files.set(config, JSON.stringify({ plugins: [{ spec: root, options: { reset: { enabled: true, tier: "priority", refreshMin: 5, phase: "idle" } } }] }));
  const timers = [];
  let clock = time;
  const context = vm.createContext({
    fs: {
      readFileSync(file) { if (!files.has(file)) throw new Error("missing"); return files.get(file); },
      writeFileSync(file, data) { files.set(file, data); },
      renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
      statSync(file) { if (!files.has(file)) throw new Error("missing"); return { size: Buffer.byteLength(files.get(file)) }; },
      realpathSync(file) { if (typeof file !== "string") throw new Error("invalid"); return path.resolve(file); },
    },
    path, os: { homedir: () => path.join(root, "synthetic-home") }, fileURLToPath,
    process: { cwd: () => dir, env: {}, platform: process.platform, pid: 1 },
    Date: class extends Date { static now() { return clock; } },
    fetch: fetcher, AbortController, Uint8Array, TextDecoder,
    setInterval() { return { unref() {} }; },
    setTimeout(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
  });
  const source = hookSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export function", "function")
    .replaceAll("export async function", "async function").replace("import.meta.url", JSON.stringify(new URL("../reset.hooks.js", import.meta.url).href))
    .replace(/\ntickOnce\(\)\.catch\(\(\) => \{\}\);/, "");
  vm.runInContext(source + "\nglobalThis.api = { tick, nextScheduled, tickOnce, refresh, persist, onRequest, validStatus, readStatus, changed };", context);
  return { api: context.api, files, timers, config, dir, advance(ms) { clock += ms; },
    read() { return JSON.parse(files.get(config)).plugins[0].options.reset; },
    write(reset) { files.set(config, JSON.stringify({ plugins: [{ spec: root, options: { reset } }] })); },
  };
}

test("quota completion survives another runtime and does not re-arm the same forecast", async () => {
  const r = runtime({ fetcher: async () => new Response(JSON.stringify({ events: [event] })) });
  await r.api.refresh(0);
  const quota = (used, readAt) => JSON.stringify({ "codex/test@example.invalid": { quota: { readAt: new Date(readAt).toISOString(), windows: [{ used }] } } });
  r.files.set(path.join(r.dir, "quotas.json"), quota(80, now));
  await r.api.tickOnce();
  assert.equal(r.read().phase, "armed");
  r.advance(1000);
  r.files.set(path.join(r.dir, "quotas.json"), quota(0, now + 1000));
  await r.api.tickOnce();
  assert.equal(r.read().phase, "idle");
  assert.equal(r.read().completedFor, now + 3600000);
  const restarted = runtime({ files: r.files, time: now + 2000, fetcher() { throw new Error("cache should prevent fetch"); } });
  await restarted.api.tickOnce();
  assert.equal(restarted.read().phase, "idle");
  assert.equal(restarted.read().restoredBy, "quota");
});

test("request never waits for network; a late refresh preserves user disable", async () => {
  let finish;
  const r = runtime({ fetcher: () => new Promise((resolve) => { finish = resolve; }) });
  await r.api.onRequest({}, {});
  r.write({ ...r.read(), enabled: false, refreshMin: 120 });
  finish(new Response(JSON.stringify({ events: [event] })));
  await flush();
  await r.api.onRequest({}, {});
  assert.equal(r.read().enabled, false);
  assert.equal(r.read().refreshMin, 120);
  assert.equal(r.read().phase, "idle");
});

test("cache survives host restart without toggling armed; stale cache disarms", async () => {
  const r = runtime({ fetcher: async () => new Response(JSON.stringify({ events: [event] })) });
  await r.api.refresh(0);
  await r.api.tickOnce();
  assert.equal(r.read().phase, "armed");
  const restarted = runtime({ files: r.files, time: now + 1000 });
  await restarted.api.tickOnce();
  assert.equal(restarted.read().phase, "armed");
  const stale = runtime({ files: r.files, time: now + 2100000 });
  await stale.api.tickOnce();
  assert.equal(stale.read().phase, "idle");
  assert.equal(stale.read().restoredBy, "stale");
  await stale.api.tickOnce();
  assert.equal(stale.read().phase, "idle");
});

test("120 minute refresh respects user interval and expires only after 150 minutes without success", async () => {
  let calls = 0;
  const r = runtime({ fetcher: async () => {
    calls++;
    if (calls > 1) throw new Error("offline");
    return new Response(JSON.stringify({ events: [event] }));
  } });
  r.write({ ...r.read(), refreshMin: 120 });
  await r.api.refresh(0);
  await r.api.tickOnce();
  assert.equal(r.read().sourceValidUntil, now + 150 * 60000);
  r.advance(31 * 60000);
  await r.api.tickOnce();
  assert.equal(r.read().phase, "armed");
  assert.equal(calls, 1);
  r.advance(89 * 60000);
  await r.api.tickOnce();
  await flush();
  assert.equal(calls, 2);
  assert.equal(r.read().phase, "armed");
  r.advance(30 * 60000);
  await r.api.tickOnce();
  assert.equal(r.read().phase, "idle");
  assert.equal(r.read().sourceValidUntil, now + 150 * 60000);
});

test("timeout releases inflight even when fetch ignores abort, and retries are throttled", async () => {
  let calls = 0;
  const r = runtime({ fetcher() { calls++; return new Promise(() => {}); } });
  const pending = r.api.refresh(60000);
  await flush();
  r.timers.find((timer) => timer.ms === 10000).fn();
  assert.equal(await pending, null);
  await r.api.refresh(60000);
  assert.equal(calls, 1);
  r.advance(60000);
  const retry = r.api.refresh(60000);
  await flush();
  assert.equal(calls, 2);
  r.timers.at(-1).fn();
  await retry;
});

test("response body stalls time out and invalid refresh never renews source freshness", async () => {
  let response = () => new Response(JSON.stringify({ events: [event] }));
  const r = runtime({ fetcher: async () => response() });
  await r.api.refresh(0);
  await r.api.tickOnce();
  const acceptedAt = r.read().sourceOkAt;
  r.advance(60000);
  response = () => new Response(JSON.stringify({ events: "invalid" }));
  await r.api.refresh(0);
  await r.api.tickOnce();
  assert.equal(r.read().sourceOkAt, acceptedAt);
  response = () => new Response(new ReadableStream({ start() {} }));
  const pending = r.api.refresh(0);
  await flush();
  r.timers.at(-1).fn();
  await pending;
  r.advance(2100000);
  await r.api.tickOnce();
  assert.equal(r.read().phase, "idle");
  assert.equal(r.read().sourceOkAt, acceptedAt);
});

test("malformed events are non-throwing and response schema/size are bounded", async () => {
  const r = runtime();
  const malformed = JSON.parse('[null,4,{"kind":"reset_scheduled","effectiveAt":{"toString":1}},{"kind":"reset_scheduled","effectiveAt":"2030-01-01T01:00:00Z","scheduleGraceHours":{"valueOf":null},"confidence":{"toString":null}}]');
  assert.doesNotThrow(() => r.api.nextScheduled(malformed, now));
  assert.equal(r.api.validStatus({ events: malformed }), false);
  const hugeGrace = r.api.nextScheduled([{ ...event, scheduleGraceHours: 1e100 }], now);
  assert.equal(hugeGrace.deadline - hugeGrace.at, 168 * 3600000);
  await assert.rejects(r.api.readStatus(new Response(JSON.stringify({ events: "bad" }))));
  await assert.rejects(r.api.readStatus(new Response(" ".repeat(1024 * 1024 + 1))));
  await assert.rejects(r.api.readStatus(new Response("{}", { headers: { "content-length": "9999999" } })));
  assert.equal(r.api.validStatus({ events: Array(2001).fill(event) }), false);
});

test("optimistic persistence refuses changed settings and no matching config never escapes onRequest", async () => {
  const r = runtime();
  const before = r.read();
  r.write({ ...before, enabled: false });
  assert.equal(r.api.persist(root, { ...before, phase: "armed" }, before), false);
  assert.equal(r.read().enabled, false);
  r.files.delete(r.config);
  await assert.doesNotReject(r.api.onRequest({}, {}));
});

test("middleware requires a live deadline and recent source independently of hook execution", () => {
  const time = Date.now();
  const active = { enabled: true, phase: "armed", tier: "priority", deadline: time + 60000, sourceOkAt: time, sourceValidUntil: time + 2100000 };
  const apply = (reset) => {
    const body = { model: "gpt-test" };
    onProvider(body, { protocol: "responses", model: "gpt-test", options: { defaultTier: "keep", reset } });
    return body.service_tier;
  };
  assert.equal(apply(active), "priority");
  for (const reset of [{ ...active, deadline: time - 1 }, { ...active, sourceValidUntil: time - 1 }, { ...active, sourceValidUntil: Infinity }, { ...active, sourceValidUntil: time + 151 * 60000 }, { ...active, sourceOkAt: undefined }, { ...active, sourceOkAt: time + 60000 }, { ...active, enabled: false }]) {
    assert.equal(apply(reset), undefined);
  }
});
