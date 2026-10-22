// page/app.js
// 只通过 bridge 读选项、写选项；模型的候选列表来自 usage:summary
// （magpie 只开放 usage:summary 和 providers:list 两个读，后者没有模型维度）。

// 四个档位，顺序就是界面上的顺序。
//   keep      保持：请求一个字节都不改
//   none      移除：删掉客户端带的 service_tier
//   priority  Fast
//   ultrafast Ultrafast
const TIERS = ["keep", "none", "priority", "ultrafast"];

// Fast / Ultrafast 是 OpenAI 的产品名，不翻译；前两个用本地语言。
const TIER_LABEL_KEY = {
  keep: "tierKeep",
  none: "tierNone",
  priority: "tierPriority",
  ultrafast: "tierUltrafast",
};

// 档位在徽标、tooltip 里也要按名字出现，统一从这里取。
function tierLabel(tier) {
  return t(TIER_LABEL_KEY[tier] || "tierKeep");
}

const I18N = {
  zh: {
    globalTitle: "全局",
    modelsTitle: "按模型设定 service_tier",
    tierKeep: "保持",
    tierNone: "移除",
    tierPriority: "Fast",
    tierUltrafast: "Ultrafast",
    add: "添加",
    addPlaceholder: "输入模型名，或从已有模型里搜",
    emptyRules: "还没有规则，全部走全局。",
    notGpt: "只处理 gpt- 开头的模型。",
    dup: "这个模型已经在规则里了。",
    remove: "删除规则",
    saved: "已保存",
    unsaved: "保存中…",
    failed: "保存失败：{msg}",

    globalTip: "没有单独规则的 gpt-* 模型都走这里。",
    modelsTip: "给单个模型单独指定档位，优先级高于全局。只认 gpt-* 开头的模型。",

    tipKeep:
      "保持：请求原样发出，一个字节都不改。客户端自己带了 service_tier 就按客户端的来，没带就什么都不加。",
    tipNone:
      "移除：把请求里已有的 service_tier 删掉，回到标准速度。客户端本来没带就什么都不做。",
    tipPriority: "Fast：写入 service_tier: priority。",
    tipUltrafast:
      "Ultrafast：写入 service_tier: ultrafast，比 Fast 更快。只有 ChatGPT 后端提供，其他供应商会拒绝。",

    resetTitle: "重置预告",
    resetNone: "暂时没有重置预告。",
    resetMode: "收到预告时",
    resetSource: "来源",
    resetSourceTip: "插件页在沙箱里，打不开外部链接。点一下把来源链接复制到剪贴板，再粘到浏览器打开。",
    resetCopied: "链接已复制，粘到浏览器打开：{url}",
    resetCopyFailed: "复制不了，请手动复制：{url}",
    resetActive: "{tier} 生效中",
    resetWhen: "{clock}（{until}）",
    resetOff: "关闭",
    resetTipOff: "关闭：收到预告也不改档位，一切照你自己的规则跑。",
    resetTipPriority:
      "Fast：从收到预告起，所有 gpt-* 请求临时改用 Fast；额度重置完成后自动恢复你自己的规则。",
    resetTipUltrafast:
      "Ultrafast：从收到预告起，所有 gpt-* 请求临时改用 Ultrafast；额度重置完成后自动恢复。优先级最高，会盖过按模型的规则和全局。",

    noteArmed: "{tier} 临时生效中，额度重置后自动恢复。",
    noteArmedAt: "{clock} 收到重置预告，临时切换到 {tier}，额度重置后自动恢复。",
    noteQuota: "{clock} 额度已重置，已从 {tier} 恢复到你自己的规则。",
    noteDeadline: "{clock} 预告已过期，已从 {tier} 恢复到你自己的规则。",
    noteOff: "{clock} 已关闭临时提速，恢复到你自己的规则。",
    noteStale: "{clock} 预告数据已失效，恢复到你自己的规则。",

    resetRate: "预告刷新",
    resetRateTip: "多久向 didcodexreset.com 拉一次重置预告。只管这一个网络请求：越密越及时，请求也越多；预告是小时级的事，5 分钟足够。\n额度是否已经重置不走网络，读的是 magpie 本地的 quotas.json，每分钟判一次，不受这里影响。",
    resetRateMin: "{n} 分钟",
    resetRateHour: "{n} 小时",
    resetCredit: "数据来自",
    resetCreditTip: "重置预告来自 didcodexreset.com 的公开接口。点一下复制网址，用浏览器打开。",
  },
  en: {
    globalTitle: "Global",
    modelsTitle: "service_tier per model",
    tierKeep: "Keep",
    tierNone: "Remove",
    tierPriority: "Fast",
    tierUltrafast: "Ultrafast",
    add: "Add",
    addPlaceholder: "Type a model, or search the ones you have",
    emptyRules: "No rules yet; everything follows Global.",
    notGpt: "Only gpt- models are handled.",
    dup: "That model already has a rule.",
    remove: "Delete rule",
    saved: "Saved",
    unsaved: "Saving…",
    failed: "Not saved: {msg}",

    globalTip: "Every gpt-* model without a rule of its own follows this.",
    modelsTip: "Gives one model its own tier; this beats Global. gpt- models only.",

    tipKeep:
      "Keep: the request goes out exactly as the client wrote it. A tier the client named stays; nothing is added.",
    tipNone:
      "Remove: any service_tier in the request is deleted, back to standard speed. Nothing to delete, nothing done.",
    tipPriority: "Fast: writes service_tier: priority.",
    tipUltrafast:
      "Ultrafast: writes service_tier: ultrafast, faster than Fast. ChatGPT's backend only; other providers reject it.",

    resetTitle: "Reset forecast",
    resetNone: "No reset forecast right now.",
    resetMode: "On a forecast",
    resetSource: "Source",
    resetSourceTip: "A plugin page runs sandboxed and can't open links. Click to copy the source URL, then paste it into a browser.",
    resetCopied: "Link copied; paste it into a browser: {url}",
    resetCopyFailed: "Couldn't copy; copy it by hand: {url}",
    resetActive: "{tier} active",
    resetWhen: "{clock} ({until})",
    resetOff: "Off",
    resetTipOff: "Off: a forecast changes nothing; your own rules stay in charge.",
    resetTipPriority:
      "Fast: from the forecast on, every gpt-* request is switched to Fast until the quota actually resets, then your own rules come back.",
    resetTipUltrafast:
      "Ultrafast: from the forecast on, every gpt-* request is switched to Ultrafast until the quota actually resets. Highest priority; it overrides per-model rules and Global.",

    noteArmed: "{tier} is on for now; your own rules come back once the quota resets.",
    noteArmedAt: "Forecast received at {clock}; {tier} is on for now, back to your own rules once the quota resets.",
    noteQuota: "Quota reset at {clock}; back to your own rules from {tier}.",
    noteDeadline: "The forecast lapsed at {clock}; back to your own rules from {tier}.",
    noteOff: "Temporary speed-up turned off at {clock}; back to your own rules.",
    noteStale: "Forecast data expired at {clock}; back to your own rules.",

    resetRate: "Forecast refresh",
    resetRateTip: "How often the forecast is fetched from didcodexreset.com. This governs that one network request: tighter is fresher and costs more requests, and forecasts are hours ahead, so 5 minutes is plenty.\nWhether the quota has reset needs no network: it reads magpie's local quotas.json, checked once a minute, and is not affected by this.",
    resetRateMin: "{n} min",
    resetRateHour: "{n} h",
    resetCredit: "Data from",
    resetCreditTip: "Forecasts come from didcodexreset.com's public API. Click to copy the address and open it in a browser.",
  },
  ja: {
    globalTitle: "グローバル",
    modelsTitle: "モデルごとの service_tier",
    tierKeep: "維持",
    tierNone: "削除",
    tierPriority: "Fast",
    tierUltrafast: "Ultrafast",
    add: "追加",
    addPlaceholder: "モデル名を入力、または既存のモデルから検索",
    emptyRules: "ルールはまだありません。すべてグローバルに従います。",
    notGpt: "gpt- で始まるモデルのみ対象です。",
    dup: "このモデルには既にルールがあります。",
    remove: "ルールを削除",
    saved: "保存しました",
    unsaved: "保存中…",
    failed: "保存できません: {msg}",

    globalTip: "個別ルールのない gpt-* モデルはすべてここに従います。",
    modelsTip: "モデル単位でティアを指定します。グローバルより優先されます。gpt- のみ。",

    tipKeep:
      "維持：リクエストはそのまま送られます。クライアントが指定したティアは残り、何も追加しません。",
    tipNone:
      "削除：リクエスト内の service_tier を削除し、標準速度に戻します。元から無ければ何もしません。",
    tipPriority: "Fast：service_tier: priority を書き込みます。",
    tipUltrafast:
      "Ultrafast：service_tier: ultrafast を書き込みます。Fast より高速。ChatGPT バックエンド専用で、他のプロバイダは拒否します。",

    resetTitle: "リセット予告",
    resetNone: "現在リセット予告はありません。",
    resetMode: "予告を受けたら",
    resetSource: "出典",
    resetSourceTip: "プラグインのページはサンドボックス内で動くため、外部リンクを開けません。クリックで URL をコピーし、ブラウザに貼り付けてください。",
    resetCopied: "コピーしました。ブラウザに貼り付けて開いてください：{url}",
    resetCopyFailed: "コピーできません。手動でコピーしてください：{url}",
    resetActive: "{tier} 適用中",
    resetWhen: "{clock}（{until}）",
    resetOff: "オフ",
    resetTipOff: "オフ：予告を受けてもティアは変えません。自分のルールどおりに動きます。",
    resetTipPriority:
      "Fast：予告を受けた時点から gpt-* のリクエストを一時的に Fast にします。クォータが実際にリセットされたら自分のルールに戻ります。",
    resetTipUltrafast:
      "Ultrafast：予告を受けた時点から一時的に Ultrafast にします。リセット後に自分のルールへ戻ります。最優先で、モデル別ルールとグローバルを上書きします。",

    noteArmed: "{tier} を一時適用中です。クォータのリセット後に自分のルールへ戻ります。",
    noteArmedAt: "{clock} にリセット予告を受信し、一時的に {tier} に切り替えました。クォータのリセット後に戻ります。",
    noteQuota: "{clock} にクォータがリセットされ、{tier} から自分のルールに戻りました。",
    noteDeadline: "{clock} に予告が期限切れとなり、{tier} から自分のルールに戻りました。",
    noteOff: "{clock} に一時的な高速化をオフにし、自分のルールに戻りました。",
    noteStale: "{clock} に予告データが失効し、自分のルールに戻りました。",

    resetRate: "予告の更新",
    resetRateTip: "didcodexreset.com から予告を取得する間隔です。対象はこの通信だけです。短いほど早く反映されますがリクエストも増えます。予告は時間単位なので 5 分で十分です。\nクォータがリセットされたかは通信せず、magpie のローカル quotas.json を 1 分ごとに確認します。ここには影響されません。",
    resetRateMin: "{n} 分",
    resetRateHour: "{n} 時間",
    resetCredit: "データ提供",
    resetCreditTip: "予告は didcodexreset.com の公開 API から取得しています。クリックで URL をコピーし、ブラウザで開けます。",
  },
};

let lang = "zh";
let t = (k, v) => {
  let s = (I18N[lang] && I18N[lang][k]) || I18N.zh[k] || k;
  if (v) for (const key of Object.keys(v)) s = s.split("{" + key + "}").join(String(v[key]));
  return s;
};

// keep 就是"不干预"，所以默认值必须是 keep，而不是某个加速档。
// 没有 enabled 开关：插件的启停交给 magpie 自己的 plugin on/off。
const DEFAULT_STATE = {
  models: [],
  defaultTier: "keep",
};

// reset 是 reset.hooks.js 维护的状态，页面只读不写。这里保留它原样，
// 因为页面每次保存都是整体替换 options，丢掉它等于把 hook 的成果清零。
function keepReset(raw) {
  const r = raw && typeof raw === "object" ? raw : null;
  return r ? structuredClone(r) : null;
}

let state = structuredClone(DEFAULT_STATE);
// 可搜的模型池，来自 usage:summary；拿不到就是空数组，输入框仍可自由填写。
let catalog = [];

// ---- 选项归一 ----------------------------------------------------------

function bare(id) {
  if (typeof id !== "string") return "";
  const s = id.trim();
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function isTier(v) {
  return TIERS.indexOf(v) >= 0;
}

// 插件只管 gpt-* 系列的模型。Claude、Gemini 的档位语义不同（Anthropic 是
// speed: "fast"），写 service_tier 没有意义，所以这里直接挡在配置之外，
// 中间件那侧也有一道同样的门。
function isGpt(model) {
  return /^gpt-/i.test(model);
}

// 把任意版本的旧配置折成 {models:[{model,tier}], defaultTier}。
// 旧版本用 overrideClientTier 表达"要不要盖掉客户端点名的档位"，新语义里
// 这件事就是 keep 档本身，所以这个键不再保留；旧版空字符串的 defaultTier
// 也正好等于 keep。
// 旧版 models:{mode,list} 里的 defaultTier 只作用于那个列表，不是全局兜底：
// 折算成规则后必须把 defaultTier 归位成 keep，否则保存一次就改变了语义。
function normalize(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const legacy = !!src.models && !Array.isArray(src.models) && Array.isArray(src.models.list);
  const out = {
    models: [],
    defaultTier: !legacy && isTier(src.defaultTier) ? src.defaultTier : "keep",
  };
  // 界面上已经没有总开关了，但命令行仍可能把 enabled 设成 false。
  // 保留这个值，否则用户在页面上随便改一次就会把它悄悄打开。
  if (src.enabled === false) out.enabled = false;
  // reset 由 hook 维护，页面原样带回去。少了这一句，页面上改一次档位
  // 就会把 hook 写的 phase/baseline 抹掉，正在生效的临时档位当场失效。
  const r = keepReset(src.reset);
  if (r) out.reset = r;
  const seen = new Set();
  const push = (model, tier) => {
    const m = bare(model);
    if (!m || !isGpt(m) || !isTier(tier) || seen.has(m)) return;
    seen.add(m);
    out.models.push({ model: m, tier: tier });
  };
  if (Array.isArray(src.models)) {
    for (const r of src.models) if (r) push(r.model, r.tier);
  } else if (legacy) {
    const tier = isTier(src.defaultTier) ? src.defaultTier : "";
    for (const m of src.models.list) push(m, tier);
  }
  return out;
}

// ---- 保存 --------------------------------------------------------------
// bridge 限制每个页面每秒最多写一次 options，且写入是整体替换而非合并，
// 所以永远提交完整对象，并把短时间内的多次改动合并成一次。

let lastSaveAt = 0;
let saveTimer = null;
let saveSeq = 0;

// 用户刚点过重置档位后，写盘和 hook 的读之间有延迟，这段时间以本地为准。
// 放在这里而不是重置段，是因为 mergeReset 在 commit 里先用到它。
const RESET_LOCAL_GRACE_MS = 4000;
let resetPickedAt = 0;
let resetRevision = 0;
let resetDirty = false;
let saveRevision = 0;
let saving = false;

// 节流而不是防抖：连续点击时也要按秒落盘，不能一直往后推。
function scheduleSave() {
  saveRevision++;
  setStatus(t("unsaved"), "pending");
  if (saving || saveTimer) return;
  const wait = Math.max(0, 1000 - (Date.now() - lastSaveAt));
  saveTimer = setTimeout(() => {
    saveTimer = null;
    commit();
  }, wait);
}

// 写之前先读一次磁盘上的 reset：页面是整体替换 options，如果本地那份
// reset 是打开页面时读的、而 hook 中途武装过，直接提交会把刚写好的
// phase/baseline 覆盖掉，正在生效的临时档位当场失效。
// 只合并 hook 拥有的字段，用户刚选的 enabled/tier 以本地为准。
async function mergeReset() {
  const revision = resetRevision;
  // 合并失败必须中止保存，不能把旧的 phase/baseline 整体写回磁盘。
  const raw = await magpie.options.get();
  const disk = keepReset(raw && raw.reset);
  const local = resetState();
  // await 期间也可能发生选择；只保护本地未保存的用户字段，状态字段始终取最新读取。
  if (local && (resetDirty || revision !== resetRevision)) {
    state.reset = { ...(disk || {}), enabled: local.enabled, tier: local.tier, refreshMin: local.refreshMin };
  } else if (disk) {
    state.reset = disk;
  } else {
    delete state.reset;
  }
}

async function commit() {
  if (saving) return;
  saving = true;
  ++saveSeq;
  let revision = saveRevision;
  try {
    const before = resetState();
    await mergeReset();
    if (!sameReset(before, resetState())) {
      buildResetTier();
      renderReset();
    }
    revision = saveRevision;
    const picked = resetRevision;
    const snapshot = structuredClone(state);
    lastSaveAt = Date.now();
    await magpie.options.set(snapshot);
    // 只确认实际写入的版本；后续点击和失败写入始终保留 dirty，不能被轮询覆盖。
    if (picked === resetRevision) resetDirty = false;
    if (revision === saveRevision) setStatus(t("saved"), "ok");
  } catch (e) {
    setStatus(t("failed", { msg: e && e.message ? e.message : e }), "bad");
  } finally {
    saving = false;
    // 写入串行化，旧请求绝不能在新请求之后落盘。
    if (revision !== saveRevision) scheduleSave();
  }
}

function setStatus(text, kind) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind || "";
}

// ---- 重置预告 ----------------------------------------------------------
//
// 数据全部来自 options.reset，由 reset.hooks.js 写。页面只做两件事：
// 展示下一次重置时间，以及让用户选"收到预告时用哪个档位"。
// 后者写回 options.reset.tier，hook 下次跑的时候会保留它。

// 相对时间。用户问的是"还有多久"，不是绝对时间戳。
// 用 Intl.RelativeTimeFormat 让浏览器按系统时区/语言出词。
function untilText(at) {
  const ms = at - Date.now();
  const abs = Math.abs(ms);
  const units = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
  ];
  let unit = "minute";
  let value = Math.round(ms / 60000);
  for (const [u, size] of units) {
    if (abs >= size) {
      unit = u;
      value = Math.round(ms / size);
      break;
    }
  }
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(value, unit);
  } catch {
    return value + " " + unit;
  }
}

// 预告的绝对时间按用户系统时区显示：hook 存的是 UTC 毫秒，
// 这里交给 Intl 换算，不做任何手动偏移。
function clockText(at, precision) {
  const d = new Date(at);
  const date = new Intl.DateTimeFormat(lang, {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(d);
  // 只到日粒度的预告不该显示一个假的具体时刻
  if (precision === "date") return date;
  const time = new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return date + " " + time;
}

function resetState() {
  const r = state.reset;
  return r && typeof r === "object" ? r : null;
}

// 页面在 sandbox iframe 里，CSP 是 connect-src 'none'、没有 allow-popups，
// 所以既打不开链接也调不了 navigator.clipboard（它要求安全上下文 + 权限）。
// 唯一还能用的复制路径是 document.execCommand("copy")，它要求有选区，
// 所以先塞一个临时 textarea。失败就返回 false，让调用方把 URL 摊开给
// 用户手抄，而不是假装成功。
function copyText(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// 复制结果就地反馈一行，不弹窗。文案里带上 URL：即便复制失败，用户也
// 能直接从这行里选中抄走。
let copiedTimer = null;
function flashCopied(url) {
  const el = document.getElementById("reset-copied");
  if (!el) return;
  const ok = copyText(url);
  el.textContent = t(ok ? "resetCopied" : "resetCopyFailed", { url: url });
  el.dataset.kind = ok ? "ok" : "bad";
  el.hidden = false;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    el.hidden = true;
    copiedTimer = null;
  }, ok ? 6000 : 15000);
}

// 恢复提示：一条常驻的灰字，只在下一次武装时被 hook 清掉。
// 四种来源各一句：额度确认重置、预告过期兜底、用户自己关掉，以及正在生效。
function noteText(r) {
  if (!r) return "";
  if (r.enabled === true && r.phase === "armed") {
    const tier = isTier(r.tier) ? r.tier : "ultrafast";
    const at = Number(r.armedAt);
    // 收到预告的那一刻也要有一句，用户才知道档位是被临时改掉的
    return Number.isFinite(at) && at
      ? t("noteArmedAt", { clock: clockText(at, "datetime"), tier: tierLabel(tier) })
      : t("noteArmed", { tier: tierLabel(tier) });
  }
  const at = Number(r.restoredAt);
  if (!Number.isFinite(at) || !at) return "";
  const tier = isTier(r.restoredFrom) ? tierLabel(r.restoredFrom) : "";
  const clock = clockText(at, "datetime");
  const key = r.restoredBy === "quota" ? "noteQuota" : r.restoredBy === "off" ? "noteOff"
    : r.restoredBy === "stale" ? "noteStale" : "noteDeadline";
  // 没有 restoredFrom 的旧记录（升级前留下的）不该显示成"从  恢复"
  if (!tier && key !== "noteOff") return "";
  return t(key, { clock: clock, tier: tier });
}

function renderReset() {
  const r = resetState();
  const armed = !!r && r.enabled === true && r.phase === "armed";
  const next = r && r.next ? r.next : null;

  const badge = document.getElementById("reset-badge");
  const when = document.getElementById("reset-when");
  const none = document.getElementById("reset-none");
  const note = document.getElementById("reset-note");

  // active 徽标：这是用户能感知"临时档位正在生效"的唯一信号
  badge.hidden = !armed;
  if (armed) {
    const tier = isTier(r.tier) ? r.tier : "ultrafast";
    badge.textContent = t("resetActive", { tier: tierLabel(tier) });
    badge.dataset.tier = tier;
  }

  const showNext = !!next && Number.isFinite(next.at);
  when.hidden = !showNext;
  // 已武装但预告时间被清掉（grace 边界）时，也不能说"没有预告"——
  // 徽标还在说正在生效，两句话会互相打脸
  none.hidden = showNext || armed;
  if (showNext) {
    when.textContent = t("resetWhen", {
      clock: clockText(next.at, next.precision),
      until: untilText(next.at),
    });
  }

  const text = noteText(r);
  note.hidden = !text;
  note.textContent = text;

  // 来源按钮：只在有 URL 时出现，点一下复制而不是打开
  const url = next && next.url ? String(next.url) : "";
  const copy = document.getElementById("reset-copy");
  copy.hidden = !url;
  copy.dataset.url = url;

  renderResetTier();
  renderRate();
}

// 关闭不是"没有选择"，而是一个选项：功能没开时高亮"关闭"这一格，
// 否则三个按钮全灰，用户看不出当前是什么状态。
function resetTierKey() {
  const r = resetState();
  if (!r || r.enabled !== true) return "off";
  return isTier(r.tier) ? r.tier : "ultrafast";
}

function renderResetTier() {
  const cur = resetTierKey();
  for (const b of document.querySelectorAll("#reset-tier button")) {
    const on = b.dataset.tier === cur;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

// 重置档位只给三个：关闭（不介入）、Fast、Ultrafast。
// 没有 keep/移除 —— 预告生效时要么加速要么什么都不做，中间档没有意义。
const RESET_TIERS = ["off", "priority", "ultrafast"];

function buildResetTier() {
  const host = document.getElementById("reset-tier");
  const cur = resetTierKey();
  host.replaceChildren();
  for (const key of RESET_TIERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tier = key;
    b.textContent = key === "off" ? t("resetOff") : tierLabel(key);
    attachTip(b, t("resetTip" + key[0].toUpperCase() + key.slice(1)));
    b.setAttribute("aria-pressed", String(cur === key));
    if (cur === key) b.classList.add("on");
    b.onclick = () => pickResetTier(key);
    host.append(b);
  }
}

// 页面只改 enabled 和 tier 两个字段，phase / next / baseline 归 hook 所有。
// 中间件的 resetTier() 要求 enabled === true 才生效，所以关掉这一下
// 立刻就能止住加速，不用等 hook 跑。
function pickResetTier(key) {
  const prev = resetState() || {};
  const next = { ...prev };
  if (key === "off") {
    // 关掉时保留 tier：下次打开还是用户上次选的档位
    next.enabled = false;
  } else {
    next.enabled = true;
    next.tier = key;
  }
  state.reset = next;
  resetPickedAt = Date.now();
  resetRevision++;
  resetDirty = true;
  renderReset();
  scheduleSave();
}

// ---- 预告刷新 ----------------------------------------------------------

// 和 hook 里的上下限保持一致。选项故意给得很稀：预告是小时级的事，
// 1 分钟那档是给"想盯着看"的人用的，不是默认。
const RATE_OPTIONS = [1, 2, 5, 10, 15, 30, 60, 120];
const DEFAULT_RATE_MIN = 5;

function rateMin() {
  const r = resetState();
  const n = Number(r && r.refreshMin);
  if (!Number.isFinite(n)) return DEFAULT_RATE_MIN;
  return Math.min(120, Math.max(1, Math.round(n)));
}

function rateLabel(min) {
  return min >= 60 && min % 60 === 0 ? t("resetRateHour", { n: min / 60 }) : t("resetRateMin", { n: min });
}

// 下拉只搭一次，之后靠 renderRate 同步选中值。值来自 hook 写回的
// refreshMin，所以别的窗口改过也能跟上。
function buildRate() {
  const sel = document.getElementById("reset-rate");
  if (!sel || sel.dataset.built === "1") return;
  sel.replaceChildren();
  for (const min of RATE_OPTIONS) {
    const o = document.createElement("option");
    o.value = String(min);
    o.textContent = rateLabel(min);
    sel.append(o);
  }
  sel.dataset.built = "1";
  sel.onchange = () => {
    const min = Number(sel.value);
    if (!Number.isFinite(min)) return;
    const prev = resetState() || {};
    // 频率是用户设置，和 enabled/tier 一样由页面拥有；其余字段留给 hook
    state.reset = { ...prev, refreshMin: min };
    resetPickedAt = Date.now();
    resetRevision++;
    resetDirty = true;
    scheduleSave();
  };
}

function renderRate() {
  buildRate();
  const sel = document.getElementById("reset-rate");
  if (!sel) return;
  const cur = String(rateMin());
  // 语言变了选项文案要重写；顺便把用户设的、不在预设里的值补进去
  for (const o of sel.options) {
    const min = Number(o.value);
    const want = rateLabel(min);
    if (o.textContent !== want) o.textContent = want;
  }
  if (![...sel.options].some((o) => o.value === cur)) {
    const o = document.createElement("option");
    o.value = cur;
    o.textContent = rateLabel(Number(cur));
    sel.append(o);
  }
  sel.value = cur;
}

// ---- 渲染 --------------------------------------------------------------

// 全局分段控件是现搭的：档位的文案和 tooltip 都跟语言走，切语言要重建。
function buildGlobal() {
  const host = document.getElementById("global-tier");
  host.replaceChildren(tierSeg(state.defaultTier, (tier) => {
    if (state.defaultTier === tier) return;
    state.defaultTier = tier;
    renderGlobal();
    scheduleSave();
  }));
}

function renderGlobal() {
  for (const b of document.querySelectorAll("#global-tier button")) {
    const on = b.dataset.tier === state.defaultTier;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

let tipSeq = 0;

// 给元素挂一条悬浮提示。气泡是真实节点、aria-hidden，说明用 aria-describedby
// 关联，读屏念的是"Ultrafast，按钮"+ 描述，而不是把描述当成按钮名。
function attachTip(el, text) {
  const id = "tip-" + ++tipSeq;
  const bubble = document.createElement("span");
  bubble.className = "tip-bubble";
  bubble.id = id;
  bubble.setAttribute("aria-hidden", "true");
  bubble.textContent = text;
  el.classList.add("tip");
  el.append(bubble);
  el.setAttribute("aria-describedby", id);
  watchTipPlacement(el);
  return el;
}

// 气泡和视口边缘之间至少留这么多像素，免得贴着边看不出边界。
const TIP_GAP = 8;
// 气泡和触发元素之间的间距。
const TIP_OFFSET = 7;

// 把气泡摆到触发元素旁边，并夹在视口内。
//
// 为什么不用纯 CSS：页面跑在 iframe 里，magpie 把 iframe 压到内容高度，
// 任何超出边界的像素都被直接裁掉；而"居中 + 左/右对齐"这种按类写死的
// 规则，只要元素位置变一次（换语言、窄窗口换行、行尾按钮）就漏一个。
// 这里改成用 position: fixed 加视口坐标，先量真实尺寸再夹一次，水平和
// 垂直两个方向同时成立，不用给每类元素单独写规则。
function placeTip(el) {
  const bubble = el.querySelector(".tip-bubble");
  if (!bubble) return;
  // 气泡平时是 display: none，量不到尺寸；临时显示一次再收回去。
  // 同一帧内完成，不会闪。
  const was = bubble.style.display;
  bubble.style.display = "block";
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  bubble.style.display = was;

  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 水平：默认居中对齐触发元素，放不下就往里推
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.min(Math.max(left, TIP_GAP), vw - bw - TIP_GAP);

  // 垂直：默认弹在下方，下方放不下就翻到上方；上方也放不下时取空间
  // 大的那一侧，并夹进视口——宁可盖住触发元素，也不让它被裁掉。
  const below = r.bottom + TIP_OFFSET;
  const above = r.top - TIP_OFFSET - bh;
  let top;
  if (below + bh <= vh - TIP_GAP) top = below;
  else if (above >= TIP_GAP) top = above;
  else top = Math.min(Math.max(below, TIP_GAP), vh - bh - TIP_GAP);

  bubble.style.left = Math.round(left) + "px";
  bubble.style.top = Math.round(top) + "px";
}

// 指针进入、键盘聚焦时定位一次；显示期间窗口尺寸或滚动变了要重算，
// 否则气泡会停在旧坐标上。
function watchTipPlacement(el) {
  // setTitleTip 会摘掉旧气泡再重新 attachTip；监听器挂在宿主元素上，
  // 重复挂就会累积，所以每个元素只挂一次。
  if (el.dataset.tipWatch === "1") return;
  el.dataset.tipWatch = "1";
  el.addEventListener("pointerenter", () => placeTip(el));
  el.addEventListener("focus", () => placeTip(el));
}

// 档位分段控件。每个按钮带一条 tooltip，说明这一档具体改请求的哪个字段；
// 说明放在悬浮提示里而不是铺在页面上，页面才不至于全是灰字。
function tierSeg(current, onPick) {
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  for (const tier of TIERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tier = tier;
    b.textContent = t(TIER_LABEL_KEY[tier]);
    attachTip(b, t("tip" + tier[0].toUpperCase() + tier.slice(1)));
    b.setAttribute("aria-pressed", String(current === tier));
    if (current === tier) b.classList.add("on");
    b.onclick = () => onPick(tier);
    seg.append(b);
  }
  return seg;
}

function renderRules() {
  const list = document.getElementById("rules");
  list.replaceChildren();
  document.getElementById("rules-empty").hidden = state.models.length > 0;

  state.models.forEach((rule, idx) => {
    const li = document.createElement("li");
    li.className = "rule";

    const name = document.createElement("span");
    name.className = "rule-name";
    name.textContent = rule.model;
    name.title = rule.model;

    const seg = tierSeg(rule.tier, (tier) => {
      if (state.models[idx].tier === tier) return;
      state.models[idx].tier = tier;
      renderRules();
      scheduleSave();
    });

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "rule-remove";
    rm.textContent = "×";
    rm.title = t("remove");
    rm.setAttribute("aria-label", t("remove") + " " + rule.model);
    rm.onclick = () => {
      state.models.splice(idx, 1);
      renderRules();
      scheduleSave();
    };

    li.append(name, seg, rm);
    list.append(li);
  });
}

// 添加框下方的提示平时隐藏，只在校验失败时出现，避免常驻一行灰字。
function setAddHint(text, kind) {
  const el = document.getElementById("add-hint");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.kind = kind || "";
}

function addModel(raw) {
  const model = bare(raw);
  if (!model) return false;
  if (!isGpt(model)) {
    setAddHint(t("notGpt"), "bad");
    return false;
  }
  if (state.models.some((r) => r.model === model)) {
    setAddHint(t("dup"), "bad");
    return false;
  }
  // 新规则从全局档位起步：用户既然已经选了全局，多半就是这个意图。
  state.models.push({ model: model, tier: state.defaultTier });
  setAddHint("");
  renderRules();
  scheduleSave();
  return true;
}

// ---- 模糊搜索 ----------------------------------------------------------
// 子序列匹配 + 连续命中加权：输入 "56t" 能命中 gpt-5.6-terra。
// 连续命中的加分让 "terra" 这类整词命中排在松散命中之前。

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let run = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      qi++;
      run++;
      score += 1 + run * 2;
      if (i === 0) score += 4;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return -1;
  // 完全相等、或以查询开头，明显更贴近意图
  if (s === q) score += 100;
  else if (s.startsWith(q)) score += 40;
  return score;
}

let activeOption = -1;

function closeCombo() {
  const list = document.getElementById("combo-list");
  list.hidden = true;
  list.replaceChildren();
  activeOption = -1;
  document.getElementById("add-input").setAttribute("aria-expanded", "false");
  document.getElementById("add-input").removeAttribute("aria-activedescendant");
}

function openCombo() {
  const input = document.getElementById("add-input");
  const list = document.getElementById("combo-list");
  const q = input.value.trim();

  const taken = new Set(state.models.map((r) => r.model));
  const hits = catalog
    .filter((m) => !taken.has(m))
    .map((m) => ({ model: m, score: fuzzyScore(q, m) }))
    .filter((h) => h.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  list.replaceChildren();
  activeOption = -1;
  if (!hits.length) {
    closeCombo();
    return;
  }

  hits.forEach((hit, i) => {
    const li = document.createElement("li");
    li.className = "combo-item";
    li.id = "combo-" + i;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.textContent = hit.model;
    // pointerdown 而不是 click：click 之前 input 会先 blur，列表已经关了
    li.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pickOption(i);
    });
    list.append(li);
  });

  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  setActive(0);
}

function setActive(i) {
  const list = document.getElementById("combo-list");
  const items = list.querySelectorAll(".combo-item");
  if (!items.length) return;
  activeOption = (i + items.length) % items.length;
  items.forEach((el, n) => {
    const on = n === activeOption;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
  const input = document.getElementById("add-input");
  input.setAttribute("aria-activedescendant", items[activeOption].id);
  // 列表向上弹，用最近的边滚；block:center 会在小列表里把首项顶出可视区
  items[activeOption].scrollIntoView({ block: "nearest" });
}

function pickOption(i) {
  const list = document.getElementById("combo-list");
  const items = list.querySelectorAll(".combo-item");
  const el = items[i];
  if (!el) return;
  const model = el.textContent;
  closeCombo();
  const input = document.getElementById("add-input");
  input.value = "";
  if (addModel(model)) input.focus();
}

// ---- i18n --------------------------------------------------------------

// 标题的提示要能随语言重建：先摘掉旧气泡和 aria-describedby 再挂新的。
function setTitleTip(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = el.querySelector(".tip-bubble");
  if (old) old.remove();
  el.removeAttribute("aria-describedby");
  el.classList.remove("tip");
  attachTip(el, text);
}

function applyLang() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  document.getElementById("add-input").placeholder = t("addPlaceholder");
  document.getElementById("rules-empty").textContent = t("emptyRules");
  // 卡片标题的说明也走 tooltip，不占版面
  setTitleTip("global-title", t("globalTip"));
  setTitleTip("models-title", t("modelsTip"));
  // 档位按钮的文案和 tooltip 都跟语言走，切语言要重建；重建完再刷一次
  // 徽标和预告时间，否则它们还停在旧语言上。
  buildResetTier();
  // 频率下拉的选项文案和"数据来自"两个 tooltip 同理
  const sel = document.getElementById("reset-rate");
  if (sel) delete sel.dataset.built;
  setTitleTip("reset-copy", t("resetSourceTip"));
  setTitleTip("reset-credit", t("resetCreditTip"));
  setTitleTip("reset-rate-label", t("resetRateTip"));
  renderReset();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
}

function pickLang(themeLang) {
  const l = String(themeLang || "").toLowerCase();
  if (l.startsWith("zh")) return "zh";
  if (l.startsWith("ja")) return "ja";
  return "en";
}

// ---- 事件 --------------------------------------------------------------

function bind() {
  // 来源和"数据来自"都走复制：沙箱页面打不开外链，复制后让用户自己粘。
  // tooltip 由 applyLang 挂（它要跟着语言重建），这里只接行为。
  const copyBtn = document.getElementById("reset-copy");
  copyBtn.onclick = () => {
    const url = copyBtn.dataset.url || "";
    if (url) flashCopied(url);
  };

  document.getElementById("reset-credit").onclick = () => flashCopied("https://didcodexreset.com");

  const input = document.getElementById("add-input");
  document.getElementById("add-form").onsubmit = (e) => {
    e.preventDefault();
    closeCombo();
    if (addModel(input.value)) input.value = "";
    input.focus();
  };

  input.oninput = () => {
    setAddHint("");
    openCombo();
  };

  input.onfocus = () => openCombo();

  input.onblur = () => {
    // 让 pointerdown 有机会先跑完
    setTimeout(closeCombo, 0);
  };

  input.onkeydown = (e) => {
    const list = document.getElementById("combo-list");
    const open = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openCombo();
        return;
      }
      setActive(activeOption + (e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        closeCombo();
      }
      return;
    }
    if (e.key === "Enter" && open && activeOption >= 0) {
      // 有高亮项时回车选它，而不是提交表单
      e.preventDefault();
      pickOption(activeOption);
    }
  };
}

// ---- 启动 --------------------------------------------------------------

// 候选模型来自 usage:summary。它只列出用过的模型（最多 20 个），并且已经
// 按用量降序，所以这里保持原序：最常用的排在最前面。这是一个提示池，
// 不是全量目录；输入框仍然接受任意模型名。
async function loadCatalog() {
  try {
    const s = await magpie.read("usage:summary", { period: "30d" });
    const models = (s && Array.isArray(s.models)) ? s.models : [];
    const seen = new Set();
    for (const m of models) {
      const name = bare(m && m.model);
      if (!name || !isGpt(name) || seen.has(name)) continue;
      seen.add(name);
      catalog.push(name);
    }
  } catch (e) {
    catalog = [];
  }
}

// hook 是异步武装的：页面打开时可能还没有预告，几十秒后才写进 options。
// 只轮询 reset 这一块，其余字段一律不碰，否则会把用户刚点下但还没保存
// 的档位改回去。5 秒一次是因为 options.get 只读 plugins.json，不写盘、
// 不重启 host。
const RESET_POLL_MS = 5000;

function sameReset(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

function watchReset() {
  let busy = false;
  setInterval(async () => {
    if (busy || document.hidden || resetDirty || saving || saveTimer) return;
    if (Date.now() - resetPickedAt < RESET_LOCAL_GRACE_MS) return;
    const revision = resetRevision;
    const seq = saveSeq;
    busy = true;
    try {
      const raw = await magpie.options.get();
      // 读取期间发生点击或保存就丢弃旧响应；开始读取时的时间窗检查不足以防竞态。
      if (revision !== resetRevision || seq !== saveSeq || resetDirty || saving || saveTimer) return;
      const r = keepReset(raw && raw.reset);
      if (sameReset(r, resetState())) return;
      if (r) state.reset = r;
      else delete state.reset;
      buildResetTier();
      renderReset();
    } catch (e) {
      // 读失败就等下一轮，不打扰用户
    } finally {
      busy = false;
    }
  }, RESET_POLL_MS);
}

async function main() {
  let theme = null;
  try {
    theme = await magpie.ready;
  } catch (e) {
    theme = null;
  }
  lang = pickLang(theme && theme.lang);

  if (theme) {
    magpie.onTheme((next) => {
      const l = pickLang(next && next.lang);
      if (l === lang) return;
      lang = l;
      applyLang();
      buildGlobal();
      renderRules();
    });
  }

  try {
    state = normalize(await magpie.options.get());
  } catch (e) {
    state = normalize(null);
  }

  applyLang();
  buildGlobal();
  bind();
  renderRules();
  watchReset();

  await loadCatalog();
}

main();
