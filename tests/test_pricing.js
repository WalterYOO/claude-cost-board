"use strict";

const assert = require("assert");
const P = require("../pricing.js");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function event(overrides) {
  const e = Object.assign(
    {
      ts: "2026-11-02T02:00:00Z",
      session: "s1",
      segment: 0,
      kind: "delta",
      modelFrom: "same",
      modelTo: "same",
      modelDisplay: "same",
      in: 0,
      out: 0,
      cacheWrite: 0,
      cacheRead: 0,
      cost: 0,
      gapHours: 0,
    },
    overrides || {}
  );
  if (overrides && overrides.modelTo && !("modelFrom" in overrides)) e.modelFrom = overrides.modelTo;
  return e;
}

test("book ids and metadata", () => {
  assert.deepStrictEqual(P.BOOK_IDS, ["ecc", "claude", "codex", "deepseek"]);
  for (const id of P.BOOK_IDS) assert.ok(P.books[id], id + " book missing");
  assert.strictEqual(P.meta.sources.length, 3);
  assert.strictEqual(P.meta.peak.tz, "UTC");
  assert.ok(P.meta.updatedAt);
});

test("every provider book has a valid default and positive rates", () => {
  for (const id of ["claude", "codex", "deepseek"]) {
    const book = P.books[id];
    assert.ok(book.models[book.defaultModel], id + " default missing");
    for (const [modelId, model] of Object.entries(book.models)) {
      const variants = id === "deepseek" ? [model.peak, model.offPeak] : [model];
      for (const rates of variants) {
        for (const key of ["in", "out", "cacheWrite", "cacheRead"]) {
          assert.ok(rates[key] > 0, id + "/" + modelId + " " + key);
        }
      }
    }
  }
});

test("normalization strips provider prefix and @date", () => {
  assert.strictEqual(
    P.normalizeModel("hk-h20-deepseek-v4-1-flash/deepseek-v4-1-flash"),
    "deepseek-v4-1-flash"
  );
  assert.strictEqual(P.normalizeModel("gpt-5.1@20250819"), "gpt-5.1");
  assert.strictEqual(P.normalizeModel("deepseek-v4-1-flash@20250819"), "deepseek-v4-1-flash");
  assert.strictEqual(P.normalizeModel(""), "unknown");
});

test("Claude matching and fallback", () => {
  assert.strictEqual(P.resolve("claude", "claude-opus-5-5").modelId, "opus-5-5");
  assert.strictEqual(P.resolve("claude", "claude-sonnet-5-5").modelId, "sonnet-5-5");
  assert.strictEqual(P.resolve("claude", "claude-haiku-5-5").modelId, "haiku-5-5");
  assert.strictEqual(P.resolve("claude", "claude-fable-5-1").modelId, "fable-5-1");
  assert.strictEqual(P.resolve("claude", "claude-future").tierFallback, true);
  const legacyOpus = P.resolve("claude", "claude-opus-4-1@20250819");
  assert.strictEqual(legacyOpus.modelId, "opus-5-5");
  assert.strictEqual(legacyOpus.tierFallback, true);
  const foreign = P.resolve("claude", "deepseek-v4-1-flash");
  assert.strictEqual(foreign.modelId, "sonnet-5-5");
  assert.strictEqual(foreign.native, false);
});

test("Codex matching precedence and dated ids", () => {
  assert.strictEqual(P.resolve("codex", "gpt-5.4-mini").modelId, "gpt-5.4-mini");
  assert.strictEqual(P.resolve("codex", "gpt-5.4").modelId, "gpt-5.4");
  assert.strictEqual(P.resolve("codex", "gpt-5-mini").modelId, "gpt-5-mini");
  assert.strictEqual(P.resolve("codex", "gpt-5").modelId, "gpt-5");
  assert.strictEqual(P.resolve("codex", "gpt-5.5-pro").modelId, "gpt-5.5-pro");
  assert.strictEqual(P.resolve("codex", "gpt-5.3-codex").modelId, "gpt-5.3-codex");
  assert.strictEqual(P.resolve("codex", "gpt-5.3-codex-fast").modelId, "gpt-5.3-codex-fast");
  assert.strictEqual(P.resolve("codex", "gpt-5.1@20250819").modelId, "gpt-5.1");
  assert.strictEqual(P.resolve("codex", "codex-unknown").tierFallback, true);
  assert.strictEqual(P.resolve("codex", "qwen3-8-27b-fp8").native, false);
});

test("DeepSeek matching and dated ids", () => {
  assert.strictEqual(P.resolve("deepseek", "deepseek-v4-pro").modelId, "v4-pro");
  assert.strictEqual(P.resolve("deepseek", "deepseek-v4-1-flash").modelId, "flash");
  assert.strictEqual(P.resolve("deepseek", "deepseek-v4-flash-0731").modelId, "flash");
  assert.strictEqual(P.resolve("deepseek", "deepseek-v4-1-flash@20250819").modelId, "flash");
  assert.strictEqual(P.resolve("deepseek", "deepseek-future").tierFallback, true);
  assert.strictEqual(P.resolve("deepseek", "qwen3.6-27b").native, false);
});

test("Claude sample cost", () => {
  const e = event({ in: 1e6, out: 1e6, cacheWrite: 1e6, cacheRead: 1e6, modelTo: "claude-sonnet-5-5" });
  assert.ok(Math.abs(P.priceEvent(e, "claude", "auto").cost - 14.6) < 1e-9);
});

test("Codex sample cost uses cached input for cacheRead", () => {
  const e = event({
    in: 1e6,
    out: 1e6,
    cacheWrite: 1e6,
    cacheRead: 1e6,
    modelTo: "gpt-5.3-codex",
  });
  assert.ok(Math.abs(P.priceEvent(e, "codex", "auto").cost - 17.675) < 1e-9);
});

test("DeepSeek peak/off-peak sample costs", () => {
  const e = event({
    in: 1e6,
    out: 1e6,
    cacheWrite: 1e6,
    cacheRead: 1e6,
    modelTo: "deepseek-v4-1-flash",
  });
  const peak = P.priceEvent(e, "deepseek", "peak");
  const off = P.priceEvent(e, "deepseek", "offpeak");
  assert.strictEqual(peak.peak, true);
  assert.strictEqual(off.peak, false);
  assert.ok(Math.abs(peak.cost - 1.806) < 1e-9);
  assert.ok(Math.abs(off.cost - 0.903) < 1e-9);
});

test("DeepSeek auto uses Stop time", () => {
  const peak = P.priceEvent(event({ ts: "2026-11-02T02:00:00Z" }), "deepseek", "auto");
  const off = P.priceEvent(event({ ts: "2026-11-02T05:00:00Z" }), "deepseek", "auto");
  assert.strictEqual(peak.peak, true);
  assert.strictEqual(off.peak, false);
});

test("peak boundary semantics", () => {
  const at = (ts) => P.peakStatus(ts, "deepseek");
  assert.strictEqual(at("2026-11-02T01:00:00Z"), true);
  assert.strictEqual(at("2026-11-02T03:59:59Z"), true);
  assert.strictEqual(at("2026-11-02T04:00:00Z"), false);
  assert.strictEqual(at("2026-11-02T06:00:00Z"), true);
  assert.strictEqual(at("2026-11-02T09:59:59Z"), true);
  assert.strictEqual(at("2026-11-02T10:00:00Z"), false);
  assert.strictEqual(at("2026-11-07T02:00:00Z"), false); // Saturday
  assert.strictEqual(at("2026-11-02T09:00:00+08:00"), true); // 01:00 UTC
  assert.strictEqual(at("not-a-date"), null);
  assert.strictEqual(P.peakStatus("2026-11-02T02:00:00Z", "claude"), null);
});

test("manual peak modes ignore timestamps", () => {
  const e = event({ ts: "2026-11-07T02:00:00Z" }); // Saturday
  const peak = P.priceEvent(e, "deepseek", "peak");
  const off = P.priceEvent(e, "deepseek", "offpeak");
  assert.strictEqual(peak.peak, true);
  assert.strictEqual(peak.peakConfidence, "manual");
  assert.strictEqual(off.peak, false);
  assert.strictEqual(off.peakConfidence, "manual");
});

test("peak confidence marks baselines and crossing intervals low", () => {
  const baseline = P.priceEvent(
    event({ kind: "first-baseline", ts: "2026-11-02T02:00:00Z" }),
    "deepseek",
    "auto"
  );
  assert.strictEqual(baseline.peakConfidence, "low");

  const crossing = P.priceEvent(
    event({ ts: "2026-11-02T04:15:00Z", gapHours: 0.5 }),
    "deepseek",
    "auto"
  );
  assert.strictEqual(crossing.crossesBoundary, true);
  assert.strictEqual(crossing.peakConfidence, "low");

  const sameWindow = P.priceEvent(
    event({ ts: "2026-11-02T02:30:00Z", gapHours: 0.5 }),
    "deepseek",
    "auto"
  );
  assert.strictEqual(sameWindow.crossesBoundary, false);
  assert.strictEqual(sameWindow.peakConfidence, "high");

  const fullWindow = P.priceEvent(
    event({ ts: "2026-11-02T05:00:00Z", gapHours: 5 }),
    "deepseek",
    "auto"
  );
  assert.strictEqual(fullWindow.crossesBoundary, true);
});

test("non-DeepSeek books have no peak semantics", () => {
  const p = P.priceEvent(event({ modelTo: "gpt-5.3-codex" }), "codex", "peak");
  assert.strictEqual(p.peak, null);
  assert.strictEqual(p.peakConfidence, null);
  assert.strictEqual(p.peakValid, null);
  assert.strictEqual(p.crossesBoundary, null);
});

test("invalid timestamp in DeepSeek auto falls to off-peak with low confidence", () => {
  const p = P.priceEvent(event({ ts: "not-a-date" }), "deepseek", "auto");
  assert.strictEqual(p.peak, false);
  assert.strictEqual(p.peakConfidence, "low");
  assert.strictEqual(p.peakValid, false);
  const manual = P.priceEvent(event({ ts: "not-a-date" }), "deepseek", "peak");
  assert.strictEqual(manual.peak, true);
  assert.strictEqual(manual.peakConfidence, "manual");
  assert.strictEqual(manual.peakValid, false);
  assert.strictEqual(P.peakStatus(null, "deepseek"), null);
});

test("missing gapHours is an unknown interval", () => {
  const e = event({ ts: "2026-11-02T02:00:00Z" });
  delete e.gapHours;
  assert.strictEqual(P.intervalCrossesBoundary(e), true);
  assert.strictEqual(P.priceEvent(e, "deepseek", "auto").peakConfidence, "low");
});

test("long weekend gap with no peak transition is not crossing", () => {
  assert.strictEqual(
    P.intervalCrossesBoundary(event({ ts: "2026-11-07T11:00:00Z", gapHours: 24 })),
    false
  );
});

test("normalized provider-prefix alias is not ambiguous", () => {
  assert.strictEqual(
    P.isAmbiguous(
      event({
        modelFrom: "hk-h20-deepseek-v4-1-flash/deepseek-v4-1-flash",
        modelTo: "deepseek-v4-1-flash",
      })
    ),
    false
  );
});

test("zero-token aggregate has no coverage denominator", () => {
  const a = P.aggregate([event({ modelTo: "deepseek-v4-1-flash" })], {
    book: "deepseek",
    dsMode: "auto",
  });
  assert.strictEqual(a.tokens, 0);
  assert.strictEqual(a.nativeCoverage, null);
  assert.strictEqual(a.ambiguousShare, null);
});

test("ambiguity for baselines and cross-model deltas", () => {
  assert.strictEqual(P.isAmbiguous(event({ kind: "first-baseline" })), true);
  assert.strictEqual(P.isAmbiguous(event({ kind: "reset-baseline" })), true);
  assert.strictEqual(
    P.isAmbiguous(event({ modelFrom: "deepseek-v4-pro", modelTo: "deepseek-v4-1-flash" })),
    true
  );
  assert.strictEqual(
    P.isAmbiguous(event({ modelFrom: "deepseek-v4-1-flash", modelTo: "deepseek-v4-1-flash" })),
    false
  );
  assert.strictEqual(P.isAmbiguous(event({ kind: "anomaly" })), false);
});

test("aggregate coverage excludes ambiguous tokens", () => {
  const events = [
    event({ in: 100, modelTo: "deepseek-v4-1-flash" }),
    event({ in: 50, modelTo: "qwen3.6-27b" }),
    event({ in: 25, modelFrom: "deepseek-v4-pro", modelTo: "deepseek-v4-1-flash" }),
  ];
  const a = P.aggregate(events, { book: "deepseek", dsMode: "auto" });
  assert.strictEqual(a.tokens, 175);
  assert.strictEqual(a.nativeTokens, 100);
  assert.strictEqual(a.fallbackTokens, 50);
  assert.strictEqual(a.ambiguousTokens, 25);
  assert.ok(Math.abs(a.nativeCoverage - 100 / 150) < 1e-12);
  assert.ok(Math.abs(a.ambiguousShare - 25 / 175) < 1e-12);
});

test("aggregate tier fallback is native", () => {
  const a = P.aggregate(
    [event({ in: 100, modelTo: "deepseek-future" })],
    { book: "deepseek", dsMode: "auto" }
  );
  assert.strictEqual(a.nativeTokens, 100);
  assert.strictEqual(a.tierFallbackTokens, 100);
  assert.strictEqual(a.nativeCoverage, 1);
});

test("ECC is an exact passthrough", () => {
  const e = event({ cost: 5.948973000000002 });
  const p = P.priceEvent(e, "ecc", "peak");
  assert.strictEqual(p.cost, 5.948973000000002);
  assert.strictEqual(p.native, null);
  assert.strictEqual(p.peak, null);
  const a = P.aggregate([e, event({ cost: 1.1 })], { book: "ecc" });
  assert.strictEqual(a.cost, 5.948973000000002 + 1.1);
  assert.strictEqual(a.nativeCoverage, null);
});

test("invalid book and numeric fields stay finite", () => {
  const p = P.priceEvent(event({ in: NaN, out: Infinity, cacheWrite: -5, cacheRead: undefined }), "nope");
  assert.strictEqual(p.book, "ecc");
  assert.ok(Number.isFinite(p.cost));
  const q = P.priceEvent(
    event({ in: NaN, out: Infinity, cacheWrite: -5, cacheRead: undefined, modelTo: "gpt-5.3-codex" }),
    "codex"
  );
  assert.ok(Number.isFinite(q.cost));
  assert.ok(q.cost >= 0);
});

test("provider totals equal sum of per-event prices", () => {
  const events = [
    event({ in: 1234567, out: 76543, cacheRead: 9999999, modelTo: "deepseek-v4-1-flash" }),
    event({
      in: 222222,
      out: 11111,
      cacheWrite: 3333,
      cacheRead: 444444,
      modelTo: "deepseek-v4-pro",
      ts: "2026-11-02T03:00:00Z",
    }),
    event({ in: 99, out: 1, modelTo: "qwen3.6-27b" }),
  ];
  for (const book of ["claude", "codex", "deepseek"]) {
    const sum = events.reduce((s, e) => s + P.priceEvent(e, book, "auto").cost, 0);
    const agg = P.aggregate(events, { book, dsMode: "auto" });
    assert.ok(Math.abs(sum - agg.cost) < 1e-12, book);
  }
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log("ok - " + t.name);
  } catch (err) {
    failed++;
    console.error("FAIL - " + t.name);
    console.error(err && err.stack ? err.stack : err);
  }
}
console.log("\n" + (tests.length - failed) + "/" + tests.length + " passed");
if (failed) process.exit(1);
