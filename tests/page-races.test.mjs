import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../page/app.js", import.meta.url), "utf8");
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const original = { enabled: true, tier: "priority", refreshMin: 5, phase: "armed", completedFor: 10 };

function page() {
  const reads = [];
  const writes = [];
  const timers = [];
  const intervals = [];
  let clock = 100000;
  const elements = new Map();
  const element = () => ({ dataset: {}, options: [], classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {} });
  const context = vm.createContext({
    structuredClone, Intl, Date: class extends Date { static now() { return clock; } },
    document: { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll() { return []; }, createElement: element },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval(fn) { intervals.push(fn); },
    magpie: { options: {
      get() { const d = deferred(); reads.push(d); return d.promise; },
      set(value) { const d = deferred(); writes.push({ ...d, value }); return d.promise; },
    } },
  });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, "") + `
    state = { models: [], defaultTier: 'keep', reset: ${JSON.stringify(original)} };
    globalThis.api = { watchReset, pickResetTier, commit, buildRate, resetState,
      dirty: () => resetDirty, state: () => state };
  `, context);
  context.api.watchReset();
  return { api: context.api, reads, writes, timers, poll: intervals[0], elements, advance(ms) { clock += ms; } };
}

test("poll started before user disables cannot revert selection, and commit preserves fresh hook state", async () => {
  const p = page();
  const poll = p.poll();
  p.api.pickResetTier("off");
  p.advance(10000);
  p.reads[0].resolve({ reset: original });
  await poll;
  assert.equal(p.api.resetState().enabled, false);
  const save = p.api.commit();
  p.reads[1].resolve({ reset: { ...original, completedFor: 99, phase: "idle" } });
  await flush();
  assert.equal(p.writes[0].value.reset.enabled, false);
  assert.equal(p.writes[0].value.reset.completedFor, 99);
  p.writes[0].resolve();
  await save;
  assert.equal(p.api.dirty(), false);
});

test("failed write retains dirty selection beyond the grace window", async () => {
  const p = page();
  p.api.pickResetTier("off");
  const save = p.api.commit();
  p.reads[0].resolve({ reset: original });
  await flush();
  p.writes[0].reject(new Error("write failed"));
  await save;
  p.advance(60000);
  await p.poll();
  assert.equal(p.reads.length, 1);
  assert.equal(p.api.dirty(), true);
  assert.equal(p.api.resetState().enabled, false);
});

test("selection made during merge wins; pending writes are serialized", async () => {
  const p = page();
  const first = p.api.commit();
  p.api.pickResetTier("off");
  p.reads[0].resolve({ reset: original });
  await flush();
  assert.equal(p.writes[0].value.reset.enabled, false);
  p.api.pickResetTier("ultrafast");
  await p.api.commit();
  assert.equal(p.writes.length, 1);
  p.writes[0].resolve();
  await first;
  assert.equal(p.api.dirty(), true);
  const second = p.api.commit();
  p.reads[1].resolve({ reset: p.writes[0].value.reset });
  await flush();
  assert.equal(p.writes[1].value.reset.tier, "ultrafast");
  assert.equal(p.writes[1].value.reset.enabled, true);
  p.writes[1].resolve();
  await second;
  assert.equal(p.api.dirty(), false);
});

test("refresh interval survives merge and failed merge cannot write stale hook state", async () => {
  const p = page();
  p.api.buildRate();
  const select = p.elements.get("reset-rate");
  select.value = "120";
  select.onchange();
  const save = p.api.commit();
  p.reads[0].resolve({ reset: { ...original, completedFor: 100 } });
  await flush();
  assert.equal(p.writes[0].value.reset.refreshMin, 120);
  assert.equal(p.writes[0].value.reset.completedFor, 100);
  p.writes[0].resolve();
  await save;
  p.api.pickResetTier("off");
  const failed = p.api.commit();
  p.reads[1].reject(new Error("get failed"));
  await failed;
  assert.equal(p.writes.length, 1);
  assert.equal(p.api.dirty(), true);
});
