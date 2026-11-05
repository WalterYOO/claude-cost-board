# Provider Price Books — Design v2

Status: approved after codex design and code review, 2026-11-05
Reviews: `REVIEW-PRICING.md`, `REVIEW-PRICING-CODE.md`
Scope: make the cost board's money totals recomputable under Claude / Codex / DeepSeek price books, with DeepSeek peak/off-peak pricing, switchable in the page.

## 1. Problem

`~/.claude/metrics/costs.jsonl` stores, per session Stop:

- cumulative token counters (`input_tokens`, `output_tokens`, `cache_write_tokens`, `cache_read_tokens`)
- `estimated_cost_usd`, computed by ECC's single hard-coded table

That table only knows Claude families; every other model falls back to Sonnet rates. In the current data all 14 models are non-Claude (DeepSeek, Qwen, GLM, Doubao), so the recorded dollar figure is not a native price for what actually ran.

We can reprice the same token deltas under three explicit provider price books and compare totals, without changing tokens, sessions, filters, or accounting modes.

## 2. Goals / non-goals

Goals:

- Four selectable money modes: **ECC 原始**, **Claude**, **Codex**, **DeepSeek**.
- DeepSeek: peak / off-peak rates, with **Stop-time auto attribution** plus manual **all-peak** / **all-off-peak** bounds.
- Every money surface follows the active book: KPI, comparison strip, trend chart/table, board cards, ranking, drawer, reconciliation, CSV.
- Switching is instant, works on drag-imported `costs.jsonl`, and is encoded in the URL hash.
- Show native model coverage, tier fallback, pricing ambiguity, and peak-time confidence, so a counterfactual total is not mistaken for a bill.

Non-goals:

- No live price fetching at runtime; rates are compiled into the HTML.
- No per-request context-length tiers (Haiku >100K, GPT long-context), cache-TTL tiers, batch/fast-mode discounts, taxes, credits, or CNY conversion.
- No Chinese public-holiday calendar in v1. Manual all-peak/all-off-peak are the authoritative DeepSeek bounds.
- No per-model switch splitting. Cross-model events are priced with the Stop-row model and flagged ambiguous.
- Not a bill; all figures remain estimates.

## 3. Pricing semantics

Each event is a token delta at a Stop. Repricing applies the selected book's rates to the event's four buckets. Token counts and event boundaries never change.

The four buckets are treated as additive and non-overlapping. This mirrors ECC's own formula (`cost-tracker.js`: `input*in + output*out + cacheWrite*cw + cacheRead*cr`) and the event schema, not an assumption that OpenAI-style cached input is a subset of input.

| Book | input (`in`) | cache write | cache read | output |
|---|---|---|---|---|
| Claude | input rate | cache-write rate | cache-read rate | output rate |
| Codex | input rate | input rate | cached-input rate | output rate |
| DeepSeek | cache-miss rate | cache-miss rate | cache-hit rate | output rate |

Context tiers are intentionally ignored because an event delta does not carry the per-request context length. Claude Haiku uses the ≤100K rate; Codex uses short-context rates.

### Model normalization and matching

Normalize once:

1. `String(raw).split("/").pop().trim().toLowerCase()` — handles provider prefixes such as `hk-h20-deepseek-v4-1-flash/deepseek-v4-1-flash`.
2. Strip one trailing `@YYYYMMDD` snapshot suffix — handles IDs such as `gpt-5.1@20250819` and `deepseek-v4-1-flash@20250819`.

Rules are evaluated **most-specific first**, with token boundaries (`(?:$|[-.])`) so `gpt-5.4-mini` cannot be swallowed by `gpt-5.4` and `gpt-5-mini` cannot be swallowed by `gpt-5`. The dated-suffix strip is tested explicitly for all three providers.

| Book | Native exact tier | Provider-native but tier fallback | Foreign fallback |
|---|---|---|---|
| Claude | fable/mythos → Fable 5.1; haiku → Haiku 5.5; opus → Opus 5.5; sonnet → Sonnet 5.5 | other names containing `claude` → Sonnet 5.5 | Sonnet 5.5 |
| Codex | gpt-5.6-sol/terra/luna; gpt-5.5; gpt-5.4-mini/nano/5.4; gpt-5.3-codex; gpt-5.2; gpt-5.1; gpt-5-mini/nano/5 | other names containing `gpt` or `codex` → GPT-5.3 Codex | GPT-5.3 Codex |
| DeepSeek | `deepseek-v4-pro` → Pro; `deepseek-v4-1-flash`, `deepseek-flash`, `deepseek-v4-flash*` → Flash | other names containing `deepseek` → Flash | Flash |

Three independent flags per priced event:

- `native`: the model belongs to the selected provider.
- `tierFallback`: native, but no exact tier rule matched.
- `ambiguous`: the event's token attribution is uncertain (see below).

For this dataset Claude and Codex have 0% native coverage (all events repriced as Sonnet 5.5 / GPT-5.3 Codex). The UI must say so explicitly.

### Pricing ambiguity

An event's tokens can come from more than one model:

- normalized `modelFrom !== modelTo` (cross-model delta; no per-model split). A provider-prefix-only change on the same model is not ambiguous.
- `first-baseline` / `reset-baseline` (tokens accumulated before the snapshot; the previous model is unknown).

Policy: still price the whole event with `modelTo` (the Stop-row model), but set `ambiguous=true`, and surface it. Confident coverage is computed over unambiguous tokens only:

- `nativeTokens` / `(nativeTokens + fallbackTokens)`, excluding ambiguous tokens.
- `ambiguousTokens` shown separately as a share of all tokens.
- `tierFallbackTokens` shown separately among native tokens.

This avoids claiming a provider total is exact when a Pro→Flash delta is priced entirely as Flash.

### DeepSeek peak / off-peak

Official rule for the current price page: peak is **01:00–04:00 and 06:00–10:00 UTC, Monday–Friday**, excluding Chinese public holidays. Off-peak is everything else and is **half the peak rate**.

- Interval semantics: `[01:00, 04:00)` and `[06:00, 10:00)`.
- Modes:
  - `auto`: each event uses peak/off-peak from its **Stop timestamp**. This is not an official per-request calculation. `peakConfidence` is `low` for baselines and for events whose `[ts - gapHours, ts]` interval contains a peak-status boundary; otherwise `high`. `auto` is always labelled "Stop 时刻归属".
  - `peak`: all events at peak (upper bound).
  - `offpeak`: all events at off-peak (lower bound).
- Manual modes ignore timestamps and are the authoritative bounds for comparison.
- Chinese public holidays are not modeled; the UI says so.

## 4. Rates

USD per 1M tokens, retrieved 2026-11-04. Sources:

- Claude: https://claude.com/pricing
- Codex: https://developers.openai.com/api/docs/pricing
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing

### Claude

| Model | in | out | cache write | cache read |
|---|---:|---:|---:|---:|
| Fable 5.1 | 10.00 | 50.00 | 12.50 | 0.25 |
| Opus 5.5 | 4.00 | 20.00 | 5.00 | 0.20 |
| Sonnet 5.5 (default) | 2.00 | 10.00 | 2.50 | 0.10 |
| Haiku 5.5 (≤100K) | 0.10 | 0.50 | 0.125 | 0.01 |

### Codex / OpenAI

| Model | in | cached input | out |
|---|---:|---:|---:|
| gpt-5.3-codex (default) | 1.75 | 0.175 | 14.00 |
| gpt-5.3-codex-fast | 3.50 | 0.35 | 28.00 |
| gpt-5.6-sol | 4.00 | 0.40 | 20.00 |
| gpt-5.6-terra | 2.00 | 0.20 | 12.00 |
| gpt-5.6-luna | 0.20 | 0.02 | 1.20 |
| gpt-5.5 | 5.00 | 0.50 | 30.00 |
| gpt-5.5-pro | 30.00 | 30.00 | 180.00 |
| gpt-5.4 | 2.50 | 0.25 | 15.00 |
| gpt-5.4-pro | 30.00 | 30.00 | 180.00 |
| gpt-5.4-mini | 0.75 | 0.075 | 4.50 |
| gpt-5.4-nano | 0.20 | 0.02 | 1.25 |
| gpt-5.2 | 1.75 | 0.175 | 14.00 |
| gpt-5.2-pro | 21.00 | 21.00 | 168.00 |
| gpt-5.1 / gpt-5 | 1.25 | 0.125 | 10.00 |
| gpt-5-mini | 0.25 | 0.025 | 2.00 |
| gpt-5-nano | 0.05 | 0.005 | 0.40 |
| gpt-5-pro | 15.00 | 15.00 | 120.00 |

Short-context rates only. `gpt-5.3-codex-fast` is modeled; other fast/priority variants are not.

### DeepSeek

| Model | Mode | cache miss (in) | cache hit | out |
|---|---|---:|---:|---:|
| Flash (default) | peak | 0.30 | 0.006 | 1.20 |
| Flash | off-peak | 0.15 | 0.003 | 0.60 |
| V4 Pro | peak | 1.32 | 0.044 | 3.96 |
| V4 Pro | off-peak | 0.66 | 0.022 | 1.98 |

## 5. Architecture

### One implementation, in JavaScript

Pricing math lives in a new `pricing.js`: a dependency-free UMD module exported as `CostPricing` in the browser and `module.exports` under Node.

Reasons:

- Drag-import rebuilds data in the browser; pricing must work there.
- Python and JS implementations would drift.
- Node can unit-test the exact module the page uses.

`build.py` reads `pricing.js` and injects it into `template.html` at a new `__PRICING_JS__` placeholder, before the main script. It does **not** reimplement rates or math.

Build contract:

- Both `__COST_DATA_JSON__` and `__PRICING_JS__` must occur exactly once in the template; otherwise the build fails.
- The injected pricing source must not contain `</script`; if it does, fail the build rather than escape it (our own module never should).
- `render(template, data, pricing_source)` performs both substitutions. Tests may call a lower-level path, but `main()` never emits a page without `CostPricing`.

### Module API

```js
CostPricing = {
  meta: { updatedAt, sources, peak: {...}, caveats: [...] },
  books: { ecc: {...}, claude: {...}, codex: {...}, deepseek: {...} },
  normalizeModel(raw): string,
  resolve(bookId, model): {
    modelId, label, native, tierFallback, rates
  },
  peakStatus(ts, bookId): boolean | null, // null for non-DeepSeek or invalid ts
  ratesFor(bookId, modelId, mode): { in, out, cacheWrite, cacheRead },
  priceEvent(event, bookId, dsMode): {
    cost, book, modelId, modelLabel, native, tierFallback, ambiguous,
    peak, peakConfidence, peakValid, crossesBoundary
  },
  aggregate(events, scope): {
    cost, tokens, nativeTokens, fallbackTokens, tierFallbackTokens,
    ambiguousTokens, nativeCoverage, ambiguousShare
  },
}
```

`scope` is `{book, dsMode}`. `priceEvent` and `aggregate` are pure and tolerate missing/zero/invalid numeric fields. `dsMode` is ignored by non-DeepSeek books and `peak` is `null` for them.

`peakStatus(ts, bookId)` returns:

- `true|false` only for `bookId === "deepseek"` and a parseable timestamp;
- `null` for every other book, and for an unparseable timestamp.

In `priceEvent`, DeepSeek `auto` with `peakStatus === null` charges the off-peak rate but returns `peak:false`, `peakConfidence:"low"`, `peakValid:false`, because the bucket is unknown. Non-DeepSeek books return `peak:null`, `peakConfidence:null`, `crossesBoundary:null`. Manual `peak|offpeak` returns `peakConfidence:"manual"`.

ECC is an explicit pseudo-book:

- `resolve("ecc", model)` returns `{modelId:"recorded", label:"ECC 原始", native:null, tierFallback:false, rates:null}`.
- `priceEvent(e, "ecc", ...)` returns the raw recorded `e.cost`, unrounded, with `peak:null`, `ambiguous:false`.
- `aggregate` in ECC mode sums raw `e.cost`.

### No per-event price fields

Event JSON stays unchanged. Costs are computed live and memoized in a `WeakMap` keyed by the event object, with an inner `Map` keyed by `${book}|${dsMode}`. Replacing `DATA` drops the whole WeakMap, so imported sequence numbers cannot collide.

### ECC exactness vs provider rounding

- ECC mode is an exact passthrough: raw `e.cost`, no rounding, same summation order as today.
- Provider modes compute full precision and do not round per event. Only display (`fmtUSD`) and CSV serialization round.
- "ECC identical" means exact across the existing aggregation paths; provider totals are tolerance-based because they are new computations.

## 6. Reconciliation

Two explicitly different concepts:

### ECC recorded

`book=ecc` uses the recorded `meta.reconciliation` for the all-time KPI and reconciliation bar, and each session's recorded `latestTotal`. This preserves the anomaly semantics: a cost-only drop is recorded as an `anomaly` with cost 0, so `segments=1.0`, recorded `latest=0.5`, `diff=0.5` in the existing fixture.

**ECC filtered `acc=latest` is a last-segment event sum, not a recorded snapshot.** This is today's behavior: `currentEvents()` keeps events whose `segment === session.lastSegment`, then `agg` sums them. In the anomaly fixture that sum is `1.0`, while the recorded latest snapshot is `0.5`. The UI keeps this behavior but labels it precisely:

- KPI "当前筛选 · 花费" under `acc=latest` is "last-segment event sum" for every book, including ECC.
- The all-time KPI and the reconciliation bar in ECC mode use recorded snapshots.
- The data-quality panel states that ECC `latest` filtering can differ from recorded latest when an anomaly or a cost-only drop exists.
- Provider books use the same last-segment event-sum semantics, labelled `末段累计（重计价）`.

No event-level function pretends to reproduce a session-level recorded snapshot.

### Repriced

For provider books, compute:

- `segmentTotal` = sum of `priceEvent` over all events
- `lastSegmentTotal` = sum over events whose `event.segment === session.lastSegment`
- `diff = segmentTotal - lastSegmentTotal`
- `baselineTotal` = sum over baseline events; share of `segmentTotal`

`lastSegmentTotal` is **not** an ECC snapshot and includes anomaly events repriced from their token deltas. Label it `末段累计（重计价）` and add a note. Do not compare it numerically to ECC's `最新快照`.

Reconciliation is all-time and unfiltered; only the accounting mode (`segments|latest`) selects which total the KPI "全部时间" uses. A time filter can cut a segment for charts/tables, but never changes reconciliation. `acc=latest` continues to filter events by `session.lastSegment` as today.

## 7. UI

New pricing bar between KPI cards and the reconciliation bar:

```
计价  [ECC 原始 $3,375.50] [Claude $…] [Codex $…] [DeepSeek $…]
      DeepSeek 峰谷 [自动|全峰|全谷]   Sonnet 5.5 · $2/$10 · 原生 0% · 回退 100%
```

- The four buttons show the **current filter + current accounting mode** totals, so provider totals are directly comparable without switching.
- Each inactive button carries a small fallback/coverage marker. With this dataset Claude and Codex are 100% fallback; DeepSeek shows native + ambiguous shares.
- DeepSeek sub-control appears for the DeepSeek book; the retained mode is shown in the DeepSeek button title even when inactive.
- Active-book line names the pricing model, rates, native coverage, tier fallback, and ambiguous share. If native coverage is 0%, it says all tokens were repriced with the fallback model.
- On narrow screens the bar wraps.

State and URL hash:

- `state.book`: `ecc|claude|codex|deepseek`, default `ecc`. Invalid hash values fall back to `ecc`.
- `state.ds`: `auto|peak|offpeak`, default `auto`. Invalid values fall back to `auto`.
- Hash keys: `book`, `ds`.

All money rendering goes through `costFor(e, scope)` where scope defaults to the active state:

- `agg(events, scope)` accumulates `cost`, token buckets, native/fallback/tierFallback/ambiguous token counts.
- trend chart/table, board columns/cards, ranking rows, drawer timeline/segment/event tables.
- KPI "全部时间（该口径）": ECC uses recorded reconciliation; providers use repriced segmentTotal or lastSegmentTotal.
- reconciliation bar: ECC recorded vs provider repriced labels.
- CSV gains `pricing_book`, `priced_as`, `cost_usd`, `pricing_ambiguous`, `peak`, `peak_confidence`, and keeps recorded `ecc_cost_usd`.

Card badge: when the card's filtered events contain fallback tokens, add `按 Sonnet 5.5 计价` (or the active fallback label); mixed native/fallback says `部分按 … 计价`. When they contain ambiguous tokens, add `跨模型计价不确定`. The old ECC `priceClass` badge is shown only in ECC mode.

Drawer: changing book, ds mode, or hash while a drawer is open must rerender it for the current session (or close it). No stale money values. Drawer segment totals are recomputed from events, not the precomputed ECC `segments[].total`.

Data-quality panel adds: price book version, source links and retrieval date, peak windows, native/tier/ambiguous coverage, and limitations (context tiers, cache TTL, holidays, Stop-time attribution).

## 8. Edge cases

- Unknown model → provider default model, `native=false`; never $0 and never silently excluded.
- Zero tokens → $0.
- Missing model → `unknown`, fallback.
- `NaN`/`Infinity`/negative token fields in imported data → skip/coerce as today; pricing must never return non-finite.
- Invalid timestamp → DeepSeek auto charges off-peak, returns `peak:false`, `peakConfidence:"low"`, `peakValid:false`; `peakStatus` returns `null`. The import parser is tightened to reject unparseable timestamps.
- `cache_write_tokens` is 0 throughout the current dataset, but must still be priced for future data.
- Peak boundaries: exactly 01:00/06:00 peak; 04:00/10:00 off-peak; weekends off-peak.
- Floating point: sums in full precision; display/CSV round only.
- ECC mode remains numerically identical to today.

## 9. Tests

`tests/test_pricing.js` (Node, no dependencies):

- rates table integrity: four books including ECC, defaults present, positive rates, source metadata
- normalization and matching precedence: `gpt-5.4-mini` vs `gpt-5.4`, `gpt-5-mini/nano` vs `gpt-5`, `@YYYYMMDD` dated suffixes for all three providers, provider prefixes, unknown provider
- native / tierFallback / foreign-fallback flags
- Claude 1M-token bucket sample including cache write/read
- Codex cached-input mapping; cache write priced as input
- DeepSeek miss/hit/output mapping, peak and off-peak; ECC passthrough untouched
- peak boundaries: Mon 01:00/03:59 peak, 04:00 off; 06:00 peak, 10:00 off; Sat/Sun off; UTC-offset ISO input; invalid timestamp; `peakStatus(ts, "claude") === null`
- peak confidence: baseline low; interval crossing a boundary low; same-window high
- manual `peak`/`offpeak` ignores timestamps; non-DeepSeek books return `peak:null`
- ambiguity: cross-model event true; baseline true; ordinary delta false
- aggregate coverage: native/fallback/tier/ambiguous token math, 0/0 denominator, zero-token data
- ECC aggregate equals recorded fixture; provider aggregate equals sum of `priceEvent`
- invalid/missing numeric fields never produce NaN/Infinity

`tests/test_build.py` additions:

- `render()` injects `pricing.js` exactly once and leaves no `__PRICING_JS__`
- missing/duplicate placeholder fails
- `</script` in pricing source fails
- existing data schema still has no price fields
- ECC reconciliation fixture (cost-only anomaly) still preserved: all-time KPI `0.5`, filtered `acc=latest` event sum `1.0`, and the documented divergence is asserted

Makefile:

- `make test` runs Python tests and `node tests/test_pricing.js`
- Node is test-only; `build.py` remains Python-stdlib-only

Browser smoke (headless Chrome / agent-browser):

- switching ECC → Claude → Codex → DeepSeek changes KPI, comparison buttons, chart, tables, cards
- DeepSeek all-peak ≠ all-off-peak whenever tokens > 0; auto lies between them on mixed data
- active book + ds mode survive reload via hash
- drawer open while switching, `acc=latest`, and a range that cuts a segment show no stale/mixed values
- CSV, drawer segment totals, and KPI agree
- no console errors

## 10. Acceptance criteria

1. `book=ecc` reproduces today's totals, recorded reconciliation, and anomaly fixture exactly; the documented filtered-latest divergence is covered by a fixture.
2. All three provider books show finite totals; Claude/Codex show explicit 0% native coverage; DeepSeek shows native, tier, fallback, and ambiguous shares.
3. DeepSeek all-peak and all-off-peak differ whenever positive tokens exist; auto is between the bounds and is labelled Stop-time attribution.
4. Every money surface agrees with the active book (no mixed ECC/provider numbers), including an open drawer.
5. Peak boundary and ambiguity unit tests pass.
6. Importing a costs.jsonl re-runs pricing correctly without reloading the page.
7. No URL/hash or theme regressions.

## 11. Review resolution

| Review blocker | Resolution |
|---|---|
| 1. `latest` reconciliation vs anomaly semantics | Split ECC recorded from provider repriced reconciliation; rename provider `latest` to `末段累计（重计价）`; reconciliation stays all-time/unfiltered; anomaly fixtures added. |
| 2. ECC exactness vs rounding | ECC is an unrounded passthrough; providers compute full precision, round only at display/CSV; equality stated as exact for ECC, tolerance for providers. |
| 3. Model matching / cross-model attribution | Normalization + ordered boundary rules; separate `native`/`tierFallback`; `ambiguous` flag for cross-model and baseline events; confident coverage excludes ambiguous tokens. |
| 4. DeepSeek auto interval/holidays | Renamed to Stop-time attribution; `peakConfidence` low for baselines and boundary-crossing intervals; manual bounds authoritative; holidays explicitly unmodeled. |
| 5. Active-book single source of truth | ECC pseudo-book; scope-passing `priceEvent`/`aggregate`; WeakMap cache reset on data replacement; drawer rerender; complete surface list; strict build placeholder contract. |

Round 2 resolutions:

| Round 2 item | Resolution |
|---|---|
| ECC filtered `acc=latest` vs recorded snapshot | Kept today's last-segment event-sum semantics, labelled it explicitly, and limited recorded snapshots to the all-time KPI/reconciliation; anomaly fixture added. |
| Dated model suffixes | Normalization strips one trailing `@YYYYMMDD`; tests cover `gpt-5.1@…` and DeepSeek dated IDs. |
| `peakStatus` scope contradiction | Replaced with `peakStatus(ts, bookId)`; `null` for non-DeepSeek and invalid timestamps; invalid DeepSeek auto is off-peak with low confidence and `peakValid:false`. |
