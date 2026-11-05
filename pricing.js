/* Provider price books for the Claude Code cost board.
 *
 * Pure, dependency-free. In the browser build.py injects this file inline and
 * it defines globalThis.CostPricing; under Node it exports the same object.
 *
 * All rates are USD per 1M tokens. Tokens in a costs.jsonl event are treated as
 * four additive, non-overlapping buckets, matching ECC's own cost formula.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CostPricing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BOOK_IDS = ["ecc", "claude", "codex", "deepseek"];
  const DS_MODES = ["auto", "peak", "offpeak"];

  const PEAK = {
    tz: "UTC",
    days: [1, 2, 3, 4, 5], // Mon-Fri, getUTCDay()
    windows: [[1, 4], [6, 10]], // half-open, UTC hours
    offPeakMultiplier: 0.5,
    holidayNote: "未扣除中国法定节假日；用全峰/全谷作为上下界",
  };

  // Claude: in / out / cacheWrite / cacheRead.
  const CLAUDE = {
    "fable-5-1": { label: "Fable 5.1", in: 10, out: 50, cacheWrite: 12.5, cacheRead: 0.25 },
    "opus-5-5": { label: "Opus 5.5", in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
    "sonnet-5-5": { label: "Sonnet 5.5", in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 },
    "haiku-5-5": { label: "Haiku 5.5", in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  };

  // Codex/OpenAI: in / out / cacheWrite(=input) / cacheRead(=cached input).
  const CODEX = {
    "gpt-5.3-codex": { label: "GPT-5.3 Codex", in: 1.75, out: 14, cacheWrite: 1.75, cacheRead: 0.175 },
    "gpt-5.3-codex-fast": { label: "GPT-5.3 Codex Fast", in: 3.5, out: 28, cacheWrite: 3.5, cacheRead: 0.35 },
    "gpt-5.6-sol": { label: "GPT-5.6 Sol", in: 4, out: 20, cacheWrite: 4, cacheRead: 0.4 },
    "gpt-5.6-terra": { label: "GPT-5.6 Terra", in: 2, out: 12, cacheWrite: 2, cacheRead: 0.2 },
    "gpt-5.6-luna": { label: "GPT-5.6 Luna", in: 0.2, out: 1.2, cacheWrite: 0.2, cacheRead: 0.02 },
    "gpt-5.5": { label: "GPT-5.5", in: 5, out: 30, cacheWrite: 5, cacheRead: 0.5 },
    "gpt-5.5-pro": { label: "GPT-5.5 Pro", in: 30, out: 180, cacheWrite: 30, cacheRead: 30 },
    "gpt-5.4": { label: "GPT-5.4", in: 2.5, out: 15, cacheWrite: 2.5, cacheRead: 0.25 },
    "gpt-5.4-mini": { label: "GPT-5.4 mini", in: 0.75, out: 4.5, cacheWrite: 0.75, cacheRead: 0.075 },
    "gpt-5.4-nano": { label: "GPT-5.4 nano", in: 0.2, out: 1.25, cacheWrite: 0.2, cacheRead: 0.02 },
    "gpt-5.4-pro": { label: "GPT-5.4 Pro", in: 30, out: 180, cacheWrite: 30, cacheRead: 30 },
    "gpt-5.2": { label: "GPT-5.2", in: 1.75, out: 14, cacheWrite: 1.75, cacheRead: 0.175 },
    "gpt-5.2-pro": { label: "GPT-5.2 Pro", in: 21, out: 168, cacheWrite: 21, cacheRead: 21 },
    "gpt-5.1": { label: "GPT-5.1", in: 1.25, out: 10, cacheWrite: 1.25, cacheRead: 0.125 },
    "gpt-5": { label: "GPT-5", in: 1.25, out: 10, cacheWrite: 1.25, cacheRead: 0.125 },
    "gpt-5-mini": { label: "GPT-5 mini", in: 0.25, out: 2, cacheWrite: 0.25, cacheRead: 0.025 },
    "gpt-5-nano": { label: "GPT-5 nano", in: 0.05, out: 0.4, cacheWrite: 0.05, cacheRead: 0.005 },
    "gpt-5-pro": { label: "GPT-5 Pro", in: 15, out: 120, cacheWrite: 15, cacheRead: 15 },
  };

  // DeepSeek: peak / off-peak. cacheWrite is billed at the miss rate.
  const DEEPSEEK = {
    flash: {
      label: "DeepSeek V4.1 Flash",
      peak: { in: 0.3, out: 1.2, cacheWrite: 0.3, cacheRead: 0.006 },
      offPeak: { in: 0.15, out: 0.6, cacheWrite: 0.15, cacheRead: 0.003 },
    },
    "v4-pro": {
      label: "DeepSeek V4 Pro",
      peak: { in: 1.32, out: 3.96, cacheWrite: 1.32, cacheRead: 0.044 },
      offPeak: { in: 0.66, out: 1.98, cacheWrite: 0.66, cacheRead: 0.022 },
    },
  };

  const BOOKS = {
    ecc: {
      id: "ecc",
      label: "ECC 原始",
      kind: "recorded",
      defaultModel: "recorded",
      models: {
        recorded: { label: "ECC 记录值" },
      },
    },
    claude: {
      id: "claude",
      label: "Claude",
      defaultModel: "sonnet-5-5",
      models: CLAUDE,
      match: [
        { re: /(?:^|[-.])(?:fable|mythos)-5(?:$|[-.])/, model: "fable-5-1", exact: true },
        { re: /(?:^|[-.])haiku-5(?:$|[-.])/, model: "haiku-5-5", exact: true },
        { re: /(?:^|[-.])opus-5(?:$|[-.])/, model: "opus-5-5", exact: true },
        { re: /(?:^|[-.])sonnet-5(?:$|[-.])/, model: "sonnet-5-5", exact: true },
        { re: /fable|mythos/, model: "fable-5-1", tierFallback: true },
        { re: /haiku/, model: "haiku-5-5", tierFallback: true },
        { re: /opus/, model: "opus-5-5", tierFallback: true },
        { re: /sonnet/, model: "sonnet-5-5", tierFallback: true },
      ],
      providerRe: /claude/,
    },
    codex: {
      id: "codex",
      label: "Codex",
      defaultModel: "gpt-5.3-codex",
      models: CODEX,
      match: [
        { re: /^gpt-5\.6-sol(?:$|[-.@])/, model: "gpt-5.6-sol", exact: true },
        { re: /^gpt-5\.6-terra(?:$|[-.@])/, model: "gpt-5.6-terra", exact: true },
        { re: /^gpt-5\.6-luna(?:$|[-.@])/, model: "gpt-5.6-luna", exact: true },
        { re: /^gpt-5\.5-pro(?:$|[-.@])/, model: "gpt-5.5-pro", exact: true },
        { re: /^gpt-5\.5(?:$|[-.@])/, model: "gpt-5.5", exact: true },
        { re: /^gpt-5\.4-mini(?:$|[-.@])/, model: "gpt-5.4-mini", exact: true },
        { re: /^gpt-5\.4-nano(?:$|[-.@])/, model: "gpt-5.4-nano", exact: true },
        { re: /^gpt-5\.4-pro(?:$|[-.@])/, model: "gpt-5.4-pro", exact: true },
        { re: /^gpt-5\.4(?:$|[-.@])/, model: "gpt-5.4", exact: true },
        { re: /^gpt-5\.3-codex-fast(?:$|[-.@])/, model: "gpt-5.3-codex-fast", exact: true },
        { re: /^gpt-5\.3-codex(?:$|[-.@])/, model: "gpt-5.3-codex", exact: true },
        { re: /^gpt-5\.2-pro(?:$|[-.@])/, model: "gpt-5.2-pro", exact: true },
        { re: /^gpt-5\.2(?:$|[-.@])/, model: "gpt-5.2", exact: true },
        { re: /^gpt-5\.1(?:$|[-.@])/, model: "gpt-5.1", exact: true },
        { re: /^gpt-5-mini(?:$|[-.@])/, model: "gpt-5-mini", exact: true },
        { re: /^gpt-5-nano(?:$|[-.@])/, model: "gpt-5-nano", exact: true },
        { re: /^gpt-5-pro(?:$|[-.@])/, model: "gpt-5-pro", exact: true },
        { re: /^gpt-5(?:$|[-.@])/, model: "gpt-5", exact: true },
      ],
      providerRe: /gpt|codex/,
    },
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      defaultModel: "flash",
      models: DEEPSEEK,
      match: [
        { re: /^deepseek-v4-pro(?:$|[-.@])/, model: "v4-pro", exact: true },
        { re: /^deepseek-v4-1-flash(?:$|[-.@])/, model: "flash", exact: true },
        { re: /^deepseek-flash(?:$|[-.@])/, model: "flash", exact: true },
        { re: /^deepseek-v4-flash(?:$|[-.@])/, model: "flash", exact: true },
      ],
      providerRe: /deepseek/,
    },
  };

  const META = {
    updatedAt: "2026-11-04",
    sources: [
      { book: "claude", label: "Claude pricing", url: "https://claude.com/pricing" },
      { book: "codex", label: "OpenAI API pricing", url: "https://developers.openai.com/api/docs/pricing" },
      { book: "deepseek", label: "DeepSeek API pricing", url: "https://api-docs.deepseek.com/quick_start/pricing" },
    ],
    peak: PEAK,
    caveats: [
      "金额按 token 数估算，不是账单。",
      "未建模上下文长度分档、缓存 TTL、批处理/快速模式折扣。",
      "跨模型事件和 baseline 使用 Stop 行模型整段计价，标记为计价歧义。",
      "DeepSeek 自动峰谷按 Stop 时刻归属，未扣中国法定节假日；全峰/全谷为上下界。",
    ],
  };

  function normalizeModel(raw) {
    let s = String(raw == null ? "" : raw).split("/").pop().trim().toLowerCase();
    s = s.replace(/@\d{8}$/, "");
    return s || "unknown";
  }

  function finite(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function tokenCount(e) {
    return ["in", "out", "cacheWrite", "cacheRead"].reduce(
      (sum, key) => sum + Math.max(0, finite(e && e[key])),
      0
    );
  }

  function isAmbiguous(e) {
    if (!e) return false;
    if (/baseline$/.test(String(e.kind || ""))) return true;
    const from = e.modelFrom == null ? "" : normalizeModel(e.modelFrom);
    const to = normalizeModel(e.modelTo || e.model);
    return Boolean(from && to && from !== to);
  }

  function ratesFor(bookId, modelId, mode) {
    const book = BOOKS[bookId];
    if (!book || book.kind === "recorded") return null;
    const model = book.models[modelId];
    if (!model) return null;
    if (bookId === "deepseek") return mode === "peak" ? model.peak : model.offPeak;
    return model;
  }

  function resolve(bookId, model) {
    const book = BOOKS[bookId] || BOOKS.ecc;
    const fallbackId = book.defaultModel;
    const fallback = book.models[fallbackId];
    if (book.kind === "recorded") {
      return { modelId: "recorded", label: "ECC 记录值", native: null, tierFallback: false, rates: null };
    }
    const s = normalizeModel(model);
    for (const rule of book.match || []) {
      if (rule.re.test(s)) {
        const m = book.models[rule.model];
        return {
          modelId: rule.model,
          label: m.label,
          native: true,
          tierFallback: Boolean(rule.tierFallback),
          rates: ratesFor(bookId, rule.model, "peak"),
        };
      }
    }
    if (book.providerRe && book.providerRe.test(s)) {
      return {
        modelId: fallbackId,
        label: fallback.label,
        native: true,
        tierFallback: true,
        rates: ratesFor(bookId, fallbackId, "peak"),
      };
    }
    return {
      modelId: fallbackId,
      label: fallback.label,
      native: false,
      tierFallback: false,
      rates: ratesFor(bookId, fallbackId, "peak"),
    };
  }

  function utcHours(d) {
    return (
      d.getUTCHours() +
      d.getUTCMinutes() / 60 +
      d.getUTCSeconds() / 3600 +
      d.getUTCMilliseconds() / 3600000
    );
  }

  function peakStatus(ts, bookId) {
    if (bookId !== "deepseek") return null;
    if (ts == null || ts === "") return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const day = d.getUTCDay();
    if (!PEAK.days.includes(day)) return false;
    const h = utcHours(d);
    return (h >= 1 && h < 4) || (h >= 6 && h < 10);
  }

  function intervalCrossesBoundary(e) {
    if (!e || typeof e.ts !== "string") return true;
    const end = new Date(e.ts);
    if (isNaN(end.getTime())) return true;
    const gapRaw = e.gapHours;
    if (gapRaw == null || gapRaw === "") return true;
    const gap = Number(gapRaw);
    if (!Number.isFinite(gap) || gap < 0) return true;
    if (gap === 0) return /baseline$/.test(String(e.kind || ""));
    if (gap > 48) return true;
    const startMs = end.getTime() - gap * 3600000;
    let prev = peakStatus(new Date(startMs).toISOString(), "deepseek");
    let t = Math.floor(startMs / 3600000) * 3600000 + 3600000;
    while (t < end.getTime()) {
      const cur = peakStatus(new Date(t).toISOString(), "deepseek");
      if (cur !== prev) return true;
      prev = cur;
      t += 3600000;
    }
    return peakStatus(e.ts, "deepseek") !== prev;
  }

  function costFrom(rates, e) {
    if (!rates) return 0;
    const inTokens = Math.max(0, finite(e && e["in"]));
    const outTokens = Math.max(0, finite(e && e.out));
    const cw = Math.max(0, finite(e && e.cacheWrite));
    const cr = Math.max(0, finite(e && e.cacheRead));
    return (inTokens * rates.in + outTokens * rates.out + cw * rates.cacheWrite + cr * rates.cacheRead) / 1e6;
  }

  function priceEvent(e, bookId, dsMode) {
    const id = BOOK_IDS.includes(bookId) ? bookId : "ecc";
    if (id === "ecc") {
      return {
        cost: finite(e && e.cost),
        book: "ecc",
        modelId: "recorded",
        modelLabel: "ECC 记录值",
        native: null,
        tierFallback: false,
        ambiguous: false,
        peak: null,
        peakConfidence: null,
        peakValid: null,
        crossesBoundary: null,
      };
    }

    const rawModel = (e && (e.modelTo || e.model)) || "unknown";
    const matched = resolve(id, rawModel);
    let peak = null;
    let peakConfidence = null;
    let peakValid = null;
    let crossesBoundary = null;
    let mode = null;

    if (id === "deepseek") {
      mode = DS_MODES.includes(dsMode) ? dsMode : "auto";
      const status = peakStatus(e && e.ts, id);
      peakValid = status !== null;
      if (mode === "peak") {
        peak = true;
        peakConfidence = "manual";
      } else if (mode === "offpeak") {
        peak = false;
        peakConfidence = "manual";
      } else if (status === null) {
        peak = false;
        peakConfidence = "low";
      } else {
        crossesBoundary = intervalCrossesBoundary(e);
        peak = status;
        peakConfidence = crossesBoundary ? "low" : "high";
      }
    }

    const rates = ratesFor(id, matched.modelId, peak ? "peak" : "offpeak");
    return {
      cost: costFrom(rates, e),
      book: id,
      modelId: matched.modelId,
      modelLabel: matched.label,
      native: matched.native,
      tierFallback: matched.tierFallback,
      ambiguous: isAmbiguous(e),
      peak,
      peakConfidence,
      peakValid,
      crossesBoundary,
    };
  }

  function aggregate(events, scope) {
    const s = scope || {};
    const book = BOOK_IDS.includes(s.book) ? s.book : "ecc";
    const dsMode = DS_MODES.includes(s.dsMode) ? s.dsMode : "auto";
    const acc = {
      cost: 0,
      tokens: 0,
      nativeTokens: 0,
      fallbackTokens: 0,
      tierFallbackTokens: 0,
      ambiguousTokens: 0,
      nativeCoverage: null,
      ambiguousShare: null,
    };
    const list = events || [];
    for (const e of list) {
      const p = priceEvent(e, book, dsMode);
      const t = tokenCount(e);
      acc.cost += p.cost;
      acc.tokens += t;
      if (book === "ecc") continue;
      if (p.ambiguous) acc.ambiguousTokens += t;
      else if (p.native) {
        acc.nativeTokens += t;
        if (p.tierFallback) acc.tierFallbackTokens += t;
      } else acc.fallbackTokens += t;
    }
    const confident = acc.nativeTokens + acc.fallbackTokens;
    acc.nativeCoverage = confident ? acc.nativeTokens / confident : null;
    acc.ambiguousShare = acc.tokens ? acc.ambiguousTokens / acc.tokens : null;
    return acc;
  }

  return {
    BOOK_IDS,
    DS_MODES,
    books: BOOKS,
    meta: META,
    normalizeModel,
    resolve,
    ratesFor,
    peakStatus,
    intervalCrossesBoundary,
    tokenCount,
    isAmbiguous,
    priceEvent,
    aggregate,
  };
});
