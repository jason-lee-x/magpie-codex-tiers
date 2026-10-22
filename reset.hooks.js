// reset.hooks.js
// 唯一能上网的地方：拉重置预告，判断重置是否真的发生。
//
// 为什么是 hook 而不是中间件：moejs 里没有 fetch、没有 require、也没有
// process（internal/middleware/points_test.go 的 TestPointsHaveNoNetwork
// 就在守这条），所以中间件碰不到网络。页面更不行，它的 CSP 是
// connect-src 'none'。Bun hook 是唯一有网络的地方。
//
// 结果怎么交给中间件：写回 plugins.json 里本插件的 options.reset。
// 中间件每秒按 plugins.json 的 mtime 重读一次 options（internal/middleware
// /middleware.go:138 的 stamp），页面 options.get 读的也是同一份。
// 这是三方唯一都通的通道。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// didcodexreset 比 codex-reset 更适合排程：reset_scheduled 事件直接给
// effectiveAt + scheduleGraceHours，不用从推文正文里猜时间。
const STATUS_URL = "https://didcodexreset.com/api/status.json";

// 两次拉取之间的间隔由页面上的「预告刷新」决定（options.reset.refreshMin，
// 单位分钟）。默认 5 分钟：预告是小时级的事，更密没有意义，只是多打接口。
// 上下限用来兜住手写配置：小于 1 分钟会变成刷接口，大于 2 小时则可能错过
// 预告的兑现时刻。
const DEFAULT_REFRESH_MIN = 5;
const MIN_REFRESH_MIN = 1;
const MAX_REFRESH_MIN = 120;

// 拉取连续失败超过这个时间，就不再拿旧数据去调档位。
const STALE_MS = 30 * 60 * 1000;

// refreshMin 是用户设置，可能被写成字符串或越界值；这里统一折成毫秒。
function refreshEvery(prev) {
  const n = Number(prev && prev.refreshMin);
  const min = Number.isFinite(n) ? Math.min(MAX_REFRESH_MIN, Math.max(MIN_REFRESH_MIN, n)) : DEFAULT_REFRESH_MIN;
  return min * 60 * 1000;
}

// ---- 路径 --------------------------------------------------------------

// 本插件目录。用它反查 plugins.json 里的条目：hook 的 ctx 里没有 spec。
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

// 上游 host.go 用 settings.Dir() 启动 Bun；提前捕获，避免其他插件 chdir。
// 这也覆盖 portable 的 data 目录，但必须核对插件归属，不能盲信 cwd。
const HOST_DIR = process.cwd();

function magpieDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const installed = xdg && path.isAbsolute(xdg)
    ? path.join(xdg, "magpie")
    : path.join(os.homedir(), ".config", "magpie");
  for (const candidate of [HOST_DIR, installed]) {
    if (findEntry(readJSON(path.join(candidate, "plugins.json")), PLUGIN_DIR, candidate)) {
      return candidate;
    }
  }
  // 无法证明归属时停止读写，避免把另一个实例的配置当成自己的。
  throw new Error("无法定位当前插件所属的 Magpie 配置目录");
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// 和 magpie 自己的 save() 一样整体替换，但必须原子：先写临时文件再 rename，
// 否则中间件可能读到半个文件。plugins.json 是 magpie 的，写坏了会丢插件列表。
function writeJSONAtomic(file, data) {
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function samePath(a, b) {
  if (typeof a !== "string" || !a || typeof b !== "string" || !b) return false;
  try {
    // realpath 同时处理 Bun 的链接布局与本地 symlink；Linux 路径保持大小写。
    const left = fs.realpathSync(a);
    const right = fs.realpathSync(b);
    return process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  } catch {
    return false;
  }
}

// 和上游 store.go 一致：git spec 通过 Bun dependencies 的值反查包名，
// npm spec 去掉版本；不能拿仓库名或 package name 猜配置条目的身份。
function entryTarget(spec, configDir) {
  if (typeof spec !== "string" || !spec) return null;
  if (/^(?:file:\/\/|[.\/\\]|[A-Za-z]:[\\/])/.test(spec) || path.isAbsolute(spec)) {
    try {
      return spec.startsWith("file://") ? fileURLToPath(spec) : path.resolve(configDir, spec);
    } catch {
      return null;
    }
  }
  const git = /^(?:(?:github|gitlab|bitbucket):|git\+[a-z]+:\/\/|git:\/\/)\S+$|^https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)\/\S+$|^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+(?:#\S+)?$/.test(spec);
  let name;
  if (git) {
    const dependencies = readJSON(path.join(configDir, "plugins", "package.json"))?.dependencies;
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return null;
    name = Object.keys(dependencies).find((key) => dependencies[key] === spec);
  } else {
    const at = spec.lastIndexOf("@");
    name = at > 0 ? spec.slice(0, at) : spec;
  }
  // 包名必须合法，防止损坏的 dependencies 把解析结果带出 node_modules。
  if (typeof name !== "string" || !/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) return null;
  return path.join(configDir, "plugins", "node_modules", ...name.split("/"));
}

// 可显式提供候选配置目录，以便 magpieDir 校验归属而不递归调用自身。
function findEntry(list, dir, configDir) {
  if (!list || !Array.isArray(list.plugins)) return null;
  const base = configDir ?? magpieDir();
  return list.plugins.find((entry) => entry && samePath(entryTarget(entry.spec, base), dir)) || null;
}

// ---- 数据源 ------------------------------------------------------------

// 和中间件、页面一致的四个档位。这里只用来校验用户选的 tier 是否合法，
// 非法值退回 ultrafast（页面默认值）。
const TIERS = ["keep", "none", "priority", "ultrafast"];

function isTier(v) {
  return TIERS.indexOf(v) >= 0;
}

// 一次预告可能有多条（root 推文 + 回复），它们的 effectiveAt 相同。
// 按 effectiveAt 去重，同组里留置信度最高的一条。
// 已经过了 grace 还没兑现的预告不再据此调档。
export function nextScheduled(events, now) {
  if (!Array.isArray(events)) return null;
  const byAt = new Map();
  for (const e of events) {
    if (!e || e.kind !== "reset_scheduled" || typeof e.effectiveAt !== "string") continue;
    const at = Date.parse(e.effectiveAt);
    if (!Number.isFinite(at)) continue;
    const rawGrace = typeof e.scheduleGraceHours === "number" || typeof e.scheduleGraceHours === "string"
      ? Number(e.scheduleGraceHours) : NaN;
    // 公开预告只允许最多一周宽限，异常大值不能无限延长临时提速。
    const grace = Number.isFinite(rawGrace) && rawGrace > 0 ? Math.min(rawGrace, 168) : 3;
    const deadline = at + grace * 3600 * 1000;
    if (!Number.isFinite(deadline)) continue;
    if (deadline <= now) continue;
    const hit = {
      at,
      deadline,
      precision: e.schedulePrecision === "date" ? "date" : "datetime",
      timezone: typeof e.scheduleTimezone === "string" ? e.scheduleTimezone : "",
      confidence: typeof e.confidence === "number" && Number.isFinite(e.confidence) ? e.confidence : 0,
      url: e.source && typeof e.source.url === "string" ? e.source.url : "",
    };
    const prev = byAt.get(at);
    if (!prev || hit.confidence > prev.confidence) byAt.set(at, hit);
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at)[0] || null;
}

// ---- 额度 --------------------------------------------------------------

// 数据多久之后就不能再当作"当前观测"。quotas.json 里不用的账号会停在
// 很久以前的值上，拿它和基线比会把一周前的旧数字当成刚刚发生的事。
const USAGE_FRESH_MS = 24 * 60 * 60 * 1000;

// magpie 把每个 Codex 账号的额度写在 quotas.json，键是 "codex/<email>"。
// used 是百分比（0-100），不是 token 数。
// 取 used 最大的窗口作为主窗口：Codex 的 5 小时窗口和 30 天窗口里，
// 先耗尽的那个才是真正的瓶颈。
// readAt 一起带出来：判断重置时只认"武装之后重新读到的"数据。
function readCodexUsage(now) {
  const data = readJSON(path.join(magpieDir(), "quotas.json"));
  if (!data) return null;
  const out = {};
  for (const [key, entry] of Object.entries(data)) {
    if (!key.startsWith("codex/")) continue;
    const q = entry && entry.quota;
    if (!q || !Array.isArray(q.windows)) continue;
    const readAt = Date.parse((q.readAt || (entry && entry.at) || "")) || 0;
    if (!readAt || now - readAt > USAGE_FRESH_MS) continue;
    let used = null;
    let resetsAt = 0;
    for (const w of q.windows) {
      const u = Number(w && w.used);
      if (!Number.isFinite(u)) continue;
      if (used === null || u > used) {
        used = u;
        resetsAt = Date.parse((w && w.resetsAt) || "") || 0;
      }
    }
    if (used === null) continue;
    out[key] = { used, resetsAt, readAt };
  }
  return Object.keys(out).length ? out : null;
}

// 重置完成的判定。用户要的信号是"归零"，不是"回落"：正常消耗会让 used
// 下降（比如 5 小时窗口滚动），那不算重置。所以只认两个明确的证据：
//   - used 从有量掉到接近零（>= 20% 掉到 <= 5%）：额度被清空了
//   - resetsAt 往前跳了超过 1 小时：窗口被重置了
// 而且必须是一次新观测（readAt 比基线新）：同一个旧数字反复比，
// 会把已经过去的重置当成正在发生的。
function resetHappened(armed, now) {
  if (!armed || !now) return false;
  let emptied = false;
  let reset = false;
  for (const [key, a] of Object.entries(armed)) {
    const n = now[key];
    if (!n || n.used > a.used) continue;
    // 没有新读数就没有新事实
    if (a.readAt && n.readAt && n.readAt <= a.readAt) continue;
    if (a.used >= 20 && n.used <= 5) emptied = true;
    if (a.resetsAt && n.resetsAt && n.resetsAt > a.resetsAt + 3600 * 1000) reset = true;
  }
  return emptied || reset;
}

// ---- 状态机 ------------------------------------------------------------
//
// idle    没有生效中的预告，按用户自己的规则跑
// armed   有预告还没兑现，临时用用户指定的档位
//
// armed 结束只有两条路：额度确认回落，或者过了 deadline + grace。
// 后者是兜底：数据源没说完成、账号也没用（额度不动）时，不能一直
// 卡在最高档上烧钱。
//
// baseline 只在武装那一刻记录一次，之后不再改写 —— 否则每消耗一点
// 额度都要写 plugins.json，会把 host 反复重启。
//
// armed 为 false 时仍然记录 next（页面要展示预告时间），但绝不武装。
// 用户关掉这个功能不等于不让页面知道下次什么时候重置。
// 注意 armed 与 enabled 是两件事：enabled 是用户的选择，会原样写回；
// armed 还要看 tier 是否合法（非法档位不该让请求升到最贵那档）。
//
// 页面要常驻一条"什么时候恢复的"提示，所以恢复时记下 restoredAt 和
// restoredFrom（当时生效的临时档位）。这条记录只在下一次武装时清掉：
// 用户看到它才明白临时档位已经退出，而不是以为一直在烧钱。

// 恢复提示要写"从哪一档恢复的"。tier 是用户设置，可能缺失或被命令行写成
// 非法值，而 tickOnce 是在 tick 之后才补默认值的——直接用 state.tier 会在
// 第一次恢复时拿到 undefined，页面就只能显示"从  恢复"。这里统一兜底，
// 和 tickOnce 里的默认值保持同一个来源。
function tierInEffect(state) {
  return isTier(state && state.tier) ? state.tier : "ultrafast";
}

export function tick(prev, sched, usage, now, armed, fresh = true) {
  const state = { ...(prev || {}) };
  const was = state.phase === "armed";
  state.enabled = !!(prev && prev.enabled === true);
  // 用户的设置原样保留，状态机不解释它
  if (prev && Number.isFinite(Number(prev.refreshMin))) state.refreshMin = Number(prev.refreshMin);

  state.next = sched
    ? {
        at: sched.at,
        deadline: sched.deadline,
        precision: sched.precision,
        timezone: sched.timezone,
        confidence: sched.confidence,
        url: sched.url,
      }
    : null;

  // 用户关闭、档位不合法或数据失效时立刻解除，不等预告截止。
  if (!armed || !fresh) {
    if (was) {
      state.restoredAt = now;
      state.restoredBy = armed ? "stale" : "off";
      state.restoredFrom = tierInEffect(state);
    }
    // 无论如何都写回 idle：命令行整体替换 options 时 phase 会丢掉，
    // 让它一直有个明确值，页面和中间件都不用处理 undefined
    state.phase = "idle";
    state.armedAt = 0;
    state.armedFor = 0;
    state.deadline = 0;
    state.baseline = null;
    return state;
  }

  if (!was) {
    if (!sched || sched.at <= (state.completedFor || 0)) {
      state.phase = "idle";
      return state;
    }
    // 武装：记下此刻的额度作为回落基线
    state.phase = "armed";
    state.armedAt = now;
    state.armedFor = sched.at;
    state.deadline = sched.deadline;
    state.baseline = usage || null;
    // 新一次预告开始，上一次的恢复记录就该退场了
    delete state.restoredAt;
    delete state.restoredBy;
    delete state.restoredFrom;
    return state;
  }

  const done = resetHappened(state.baseline, usage);
  const passed = now >= (state.deadline || state.armedFor || 0);
  if (done || passed || !sched) {
    // 同一预告已兑现后不能再次武装；数据失效只解除，恢复可信数据后仍可重试。
    if (done || passed) state.completedFor = Math.max(state.completedFor || 0, state.armedFor || 0);
    state.phase = "idle";
    state.restoredAt = now;
    state.restoredBy = done ? "quota" : "deadline";
    state.restoredFrom = tierInEffect(state);
    state.armedAt = 0;
    state.armedFor = 0;
    state.deadline = 0;
    state.baseline = null;
    return state;
  }
  // 基线只在武装时写一次：每消耗一点额度都改写它，会让回落永远判不出来
  if (!state.baseline && usage) state.baseline = usage;
  // 预告时间被推后了，跟着走
  if (sched) {
    state.armedFor = sched.at;
    state.deadline = sched.deadline;
  }
  return state;
}

// ---- 写回 --------------------------------------------------------------

// 只动 options.reset 一个键，其余原样。返回是否真的写了盘。
// 写盘会让 magpie 认为 plugins.json 变了，下一次请求时重启 host，
// 所以调用方必须只在状态真的变了时才调这里。
function persist(dir, reset, expected) {
  const file = path.join(magpieDir(), "plugins.json");
  const list = readJSON(file);
  const entry = findEntry(list, dir);
  if (!entry) return false;
  const opts = entry.options && typeof entry.options === "object" ? entry.options : {};
  // 用户在计算期间改过设置时放弃本次写入，下一轮依据最新状态重算。
  if (JSON.stringify(opts.reset || null) !== JSON.stringify(expected || null)) return false;
  opts.reset = reset;
  entry.options = opts;
  try {
    writeJSONAtomic(file, list);
    return true;
  } catch {
    return false;
  }
}

// 决定要不要写：phase 变了、预告时间变了、或者从武装回到空闲。
// refreshMin 也在这里比：用户在页面上改了预告刷新，要落盘一次让下一次
// tick 用上；值没变时不动，免得每分钟写一次 plugins.json 重启 host。
function changed(prev, next) {
  if (!prev) return true;
  if (prev.enabled !== next.enabled) return true;
  if (prev.phase !== next.phase) return true;
  const a = prev.next && prev.next.at;
  const b = next.next && next.next.at;
  if (a !== b) return true;
  // 武装中预告被推后
  if (prev.armedFor !== next.armedFor) return true;
  if (Number(prev.refreshMin) !== Number(next.refreshMin)) return true;
  for (const key of ["completedFor", "deadline", "sourceOkAt", "sourceValidUntil", "baseline", "next"]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) return true;
  }
  return false;
}

// ---- 拉取 --------------------------------------------------------------

let lastFetchAt = 0;
let lastOkAt = 0;
let cached = null;
let inflight = null;
let cacheLoaded = false;

// 状态接口应很小；同时限制传输字节和事件数，避免外部数据耗尽 host 内存。
const MAX_STATUS_BYTES = 1024 * 1024;
const MAX_EVENTS = 2000;
const FETCH_TIMEOUT_MS = 10000;

function validStatus(data) {
  return !!data && typeof data === "object" && !Array.isArray(data)
    && Array.isArray(data.events) && data.events.length <= MAX_EVENTS
    && data.events.every((e) => e && typeof e === "object" && !Array.isArray(e)
      && typeof e.kind === "string"
      && (e.kind !== "reset_scheduled" || (typeof e.effectiveAt === "string"
        && Number.isFinite(Date.parse(e.effectiveAt)))));
}

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const file = path.join(magpieDir(), "codex-tiers-status.json");
  try {
    if (fs.statSync(file).size > MAX_STATUS_BYTES + 1024) return;
    const saved = readJSON(file);
    if (!saved || !Number.isFinite(saved.okAt) || saved.okAt > Date.now()
      || !validStatus(saved.data)) return;
    cached = saved.data;
    lastOkAt = saved.okAt;
    lastFetchAt = saved.okAt;
  } catch {
    // 缓存不存在或损坏时从空状态启动，不能把文件时间当作有效数据时间。
  }
}

async function readStatus(res) {
  if (!res.ok) throw new Error("status " + res.status);
  if (Number(res.headers.get("content-length")) > MAX_STATUS_BYTES) throw new Error("status too large");
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_STATUS_BYTES) throw new Error("status too large");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!validStatus(data)) throw new Error("invalid status events");
  return data;
}

// 后台刷新有独立超时，包含响应体读取；即使 fetch 不响应 abort 也会结束等待。
// 有效缓存另存文件，避免 plugins.json 引发 host 重启后每次都丢失可信数据。
function refresh(every) {
  if (inflight) return inflight;
  if (lastFetchAt && Date.now() - lastFetchAt < every) return Promise.resolve(cached);
  lastFetchAt = Date.now();
  inflight = (async () => {
    const controller = new AbortController();
    let timeout;
    try {
      const expired = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("status timeout"));
        }, FETCH_TIMEOUT_MS);
        if (typeof timeout.unref === "function") timeout.unref();
      });
      // 只有此处访问公开状态 API，请求处理本身不会等待它。
      const request = Promise.resolve().then(() => fetch(STATUS_URL, {
        headers: { accept: "application/json", "user-agent": "magpie-codex-tiers" },
        signal: controller.signal,
      })).then(readStatus);
      const data = await Promise.race([request, expired]);
      cached = data;
      lastOkAt = Date.now();
      try {
        writeJSONAtomic(path.join(magpieDir(), "codex-tiers-status.json"), { okAt: lastOkAt, data });
      } catch {
        // 缓存不可写仍可服务本进程；重启后按失效处理，不能无限保留武装状态。
      }
      return cached;
    } catch {
      return cached;
    } finally {
      clearTimeout(timeout);
      controller.abort();
      inflight = null;
    }
  })();
  return inflight;
}

// ---- 主循环 ------------------------------------------------------------

// 走一遍状态机：读自己的 options、读缓存的预告、读额度、必要时写回。
// 不 await 网络：请求路径上等一次抓取会把延迟加给用户，而重置预告是
// 小时级的事，晚一个请求没影响。刷新永远在后台跑。
async function tickOnce() {
  const now = Date.now();
  const file = path.join(magpieDir(), "plugins.json");
  const entry = findEntry(readJSON(file), PLUGIN_DIR);
  // 找不到自己的条目说明路径推算错了，写不了盘；但不影响别的插件的
  // options，所以静默返回，不要抛给 host 记一条无用的 warn
  if (!entry) return;

  const opts = entry.options || {};
  const prev = opts.reset && typeof opts.reset === "object" ? opts.reset : null;
  // 档位不合法就不武装：命令行里写错一个词不该悄悄把请求升到最贵那档
  const enabled = !!prev && prev.enabled === true && isTier(prev.tier);

  // 冷启动也只在后台刷新，外部服务不能阻塞供应商请求。
  const every = refreshEvery(prev);
  loadCache();
  void refresh(every);

  // 按用户间隔刷新，并给失败重试保留 30 分钟；失败不能续期。
  const sourceValidUntil = lastOkAt ? lastOkAt + every + STALE_MS : 0;
  const fresh = cached && now >= lastOkAt && now < sourceValidUntil ? cached : null;
  const sched = fresh ? nextScheduled(fresh.events || [], now) : null;
  // 关掉时不读额度：没有要判定的东西，少一次文件读
  const usage = enabled ? readCodexUsage(now) : null;

  const next = tick(prev, sched, usage, now, enabled, !!fresh);
  next.sourceOkAt = lastOkAt;
  next.sourceValidUntil = sourceValidUntil;
  next.updatedAt = now;
  // tier 是用户的设置，状态机不碰它；第一次写时给个默认值，
  // 免得页面读到 undefined 后要自己兜底
  next.tier = prev && isTier(prev.tier) ? prev.tier : "ultrafast";
  // 同理给 refreshMin 一个明确值，页面不用自己兜底
  next.refreshMin = Math.round(refreshEvery(prev) / 60000);

  if (changed(prev, next)) persist(PLUGIN_DIR, next, prev);
}

// ---- 对外 --------------------------------------------------------------

// 请求前跑一次，让中间件读到的是刚推进过的状态。
// 即使 reset 还没被用户配置过也照跑：第一次装好插件时 options 里
// 没有 reset 这个键，页面要靠这里把预告时间填出来。
export async function onRequest(body, ctx) {
  try {
    await tickOnce();
  } catch {
    // 本地配置不可读时不阻断正常请求；中间件仍按有效期拒绝陈旧状态。
  }
}

// 只有请求驱动是不够的：用户可能开着插件页面干等，一个请求都不发，
// 那样预告永远填不出来。所以模块加载后自己起一个定时器。
// host 是常驻进程，定时器跟着它活；magpie 把插件关掉时 host 会退出，
// 这里也就跟着停了。
const TICK_MS = 60 * 1000;

const timer = setInterval(() => {
  tickOnce().catch(() => {});
}, TICK_MS);
// 不让定时器成为 host 不退出的理由
if (typeof timer.unref === "function") timer.unref();

// 加载即跑一次，别让用户等一个周期
tickOnce().catch(() => {});
