// codex-tiers.middleware.js
// 在 magpie 网关进程内（moejs）运行，只做一件事：
// 按「模型 → 档位」映射，决定真正发往供应商的请求体里 service_tier 是什么。

// 四个档位：
//   keep     保持客户端原样，一个字节都不改
//   none     不加速：把客户端带的 service_tier 去掉
//   priority Fast
//   ultrafast Ultrafast
const TIERS = ["keep", "none", "priority", "ultrafast"];

// 只处理 OpenAI 的两种协议。Anthropic 的 fast 是 speed: "fast"，语义与
// service_tier 不同；Gemini 没有档位概念。Codex 走 responses，
// OpenCode 一类客户端可能走 chat。
const TIER_PROTOCOLS = ["chat", "responses"];

// 去掉 "provider/" 前缀，让配置里的模型名既能写 gpt-5.6-terra，
// 也能写 codex/gpt-5.6-terra。
function bare(id) {
  if (typeof id !== "string") return "";
  const s = id.trim();
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

// 插件只管 gpt-* 系列。o3、claude、gemini 这些即使被写进规则也不碰：
// 它们要么没有档位概念，要么档位字段不叫 service_tier。
function isGpt(id) {
  return /^gpt-/i.test(id);
}

function isTier(v) {
  return TIERS.indexOf(v) >= 0;
}

// 旧版本只有 priority / ultrafast，且用 overrideClientTier 决定要不要盖掉
// 客户端点名的档位。新语义里 keep 就是那个开关，所以旧配置的
// overrideClientTier: false 要折成 keep，否则升级一次就悄悄改变了行为。
function isLegacy(opts) {
  const raw = opts && opts.models;
  return !!raw && !Array.isArray(raw) && Array.isArray(raw.list);
}

function ruleTier(raw) {
  if (!isTier(raw)) return "";
  if (raw === "keep") return "keep";
  return raw;
}

// modelRules 把 options.models 归一成 [{model, tier}]。
function modelRules(opts) {
  const out = [];
  const raw = opts && opts.models;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (!r) continue;
      const model = bare(r.model);
      const tier = ruleTier(r.tier);
      if (model && tier && isGpt(model)) out.push({ model: model, tier: tier });
    }
    return out;
  }
  if (isLegacy(opts)) {
    const tier = ruleTier(opts.defaultTier);
    if (!tier) return out;
    for (let i = 0; i < raw.list.length; i++) {
      const model = bare(raw.list[i]);
      if (model && isGpt(model)) out.push({ model: model, tier: tier });
    }
  }
  return out;
}

// defaultTier 是规则之外的 gpt-* 模型走什么。
// 旧配置里 "" 表示"不碰"，正好就是 keep。
function defaultTierOf(opts) {
  if (isLegacy(opts)) return "";
  const v = opts && opts.defaultTier;
  if (v === "" || v === undefined || v === null) return "keep";
  return isTier(v) ? v : "keep";
}

// 重置预告生效时的临时档位。reset 由 reset.hooks.js 维护：它在有预告时
// 把 phase 置为 armed，重置兑现后置回 idle。这里只读，不改。
// 返回 "" 表示没有生效中的预告。
function resetTier(opts) {
  const r = opts && opts.reset;
  if (!r || r.enabled !== true) return "";
  if (r.phase !== "armed") return "";
  // hook 停摆时也必须到期退出；上限为最长刷新间隔 120 分钟加 30 分钟失败宽限。
  const now = Date.now();
  if (!Number.isFinite(r.deadline) || now >= r.deadline) return "";
  if (!Number.isFinite(r.sourceOkAt) || r.sourceOkAt > now) return "";
  if (!Number.isFinite(r.sourceValidUntil) || now >= r.sourceValidUntil
    || r.sourceValidUntil > r.sourceOkAt + 150 * 60 * 1000) return "";
  return isTier(r.tier) ? r.tier : "";
}

// tierOf 返回这个请求该走的档位。
// 同时比对客户端请求的模型名和供应商侧的模型 id：网关会把别名、
// 分组成员换成一个具体的 provider/model，两者可能不同。
function tierOf(opts, asked, served) {
  const a = bare(asked);
  const s = bare(served);
  // 两侧只要有一个是 gpt-* 就继续：客户端可能发别名，供应商侧才是真模型。
  if (!isGpt(a) && !isGpt(s)) return "";
  // 重置预告优先级最高：它盖过所有按模型的规则和全局档位。
  const rt = resetTier(opts);
  if (rt) return rt;
  const rules = modelRules(opts);
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].model === a || rules[i].model === s) return rules[i].tier;
  }
  return defaultTierOf(opts);
}

export function onProvider(body, ctx) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const opts = (ctx && ctx.options) || {};
  if (opts.enabled === false) return;

  const proto = ctx && ctx.protocol;
  if (TIER_PROTOCOLS.indexOf(proto) < 0) return;

  const provider = (ctx && ctx.provider) || {};
  const tier = tierOf(opts, ctx && ctx.model, provider.model);
  if (!tier || tier === "keep") return;

  if (tier === "none") {
    if (!("service_tier" in body)) return;
    delete body.service_tier;
    return body;
  }

  body.service_tier = tier;
  return body;
}
