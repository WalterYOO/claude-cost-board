# Pricing Design Review

Reviewed `DESIGN-PRICING.md`, with feasibility checks against `build.py` and `template.html`. The current snapshot has 1,362 events, 371 sessions, 408 low-confidence events, 13 cross-model deltas, a 23.56% baseline share, and one reset. No existing source code was modified.

## Blocking Issues

1. **The proposed `latest` reconciliation is not compatible with the existing anomaly semantics.**

   `DESIGN-PRICING.md:199-204` defines `latest` as the sum of priced events in each session's last segment. The current `latestTotal` is instead the last row's recorded cumulative `estimated_cost_usd` (`build.py:375-390`). When only ECC cost drops while tokens grow, `build.py` records an `anomaly` with `cost = 0` (`build.py:303-311`). In the existing fixture, `segments = 1.0`, recorded `latest = 0.5`, but the proposed formula gives `latest = 1.0` and `diff = 0`; `tests/test_build.py:47-57` already asserts the opposite.

   This means `book=ecc` cannot both reproduce today's reconciliation and use the proposed generic last-segment sum. Also, for provider books, a last-segment event sum is not a "latest snapshot" value; it is repriced usage in that segment. Define two explicitly named reconciliations:

   - recorded ECC reconciliation: use the existing `meta.reconciliation` and each session's recorded final snapshot;
   - repriced reconciliation: use `sum(eventCost)` and, if `latest` is wanted, label it as "last-segment repriced usage", not "latest snapshot".

   Define how time filters and `acc=latest` interact with reconciliation. A filtered range can contain only part of a last segment, so the implementation must either compute the last segment before applying the time filter or explicitly define a filtered reconciliation. Add anomaly, reset-plus-anomaly, and partial-range fixtures.

2. **ECC exactness contradicts the proposed rounding contract.**

   `DESIGN-PRICING.md:215-216` says to sum in full precision, round per-event values to 9 decimals, and remain "byte-for-byte numerically identical". Those requirements are inconsistent. Existing event costs are raw floats, for example `5.948973000000002`; rounding every event before aggregation changes ECC totals and CSV values. Floating-point addition order can also differ between trend, board, ranking, KPI, and drawer paths.

   Keep an unrounded ECC passthrough for `priceEvent(e, "ecc", ...)`. If 9-decimal values are needed for CSV, expose a separate export/display value and sum the raw values. State whether ECC equality is exact or tolerance-based, and test the recorded fixture plus canonical sums from every surface.

3. **Model matching is underspecified, and cross-model deltas are silently assigned to only one model.**

   The matching table at `DESIGN-PRICING.md:46-61` does not define normalization, anchoring, or precedence. A family rule can swallow a more specific rule: `gpt-5.4` before `gpt-5.4-mini`, `gpt-5` before `gpt-5-mini/nano`, or `deepseek-v4-flash*` in a way that also matches unintended suffixes. Provider-prefixed names such as `hk-h20-.../deepseek-v4-1-flash` require a single documented normalization rule. "Other Claude names" also conflates "provider is native" with "exact tier matched"; native coverage and `tierFallback` must have different definitions.

   More importantly, a delta straddling a model switch has no per-model token split. The current data contains 13 cross-model events, including `2026-08-19T06:53:11Z` from `deepseek-v4-pro` to `deepseek-v4-flash-0731` with 40,320,704 input tokens, 5,364,800 cache-read tokens, and `$124.959117` recorded ECC cost. The design prices the whole event using `modelTo`; under a DeepSeek book the Flash-versus-Pro price difference is large. Baselines can likewise contain prior models while carrying only the last row's model.

   Define a conservative attribution policy. At minimum, mark such events as pricing-ambiguous, exclude them from native coverage, and surface the limitation in the card/drawer/CSV. Without transcript-level splitting or an explicit user override, do not claim the provider total is exact.

4. **DeepSeek `auto` peak pricing is not valid for interval-based events or the stated holiday rule.**

   `DESIGN-PRICING.md:63-73` applies peak status from the event's Stop timestamp. That is not a request interval. A first baseline can represent an unknown earlier period; a long delta can cross one or more peak windows. In the current snapshot, 408 events are already low-confidence and represent about `$1,025` of ECC cost; 143 deltas span at least an hour, and 81 adjacent endpoints change peak status. Assigning the entire delta to the Stop-time window can materially change the DeepSeek total.

   The design also says the official rule excludes Chinese public holidays, then says v1 does not model holidays. Therefore `auto` is not the advertised official-rule calculation. Either:

   - rename it to "Stop-time attribution", expose per-event peak confidence, and make manual all-peak/all-offpeak the authoritative bounds; or
   - extend the event with enough interval information and implement a documented interval/calendar policy.

   The pure `priceEvent(event, ...)` API currently receives only one timestamp, so it cannot implement interval-aware peak pricing without an API change. Add crossing-window, baseline, holiday, and timezone-offset tests.

5. **The module and UI contracts do not yet guarantee one active-book source of truth.**

   Four modes are promised, but `CostPricing.books` at `DESIGN-PRICING.md:146` lists only Claude, Codex, and DeepSeek; the test plan says "four books" at line 222. ECC needs an explicit passthrough pseudo-book, including its `resolve`, coverage, `peak`, and fallback behavior.

   `eventCost(e)` with only the active state cannot calculate the inactive comparison buttons without either mutating state or calling a second pricing path. Make the canonical API accept `(event, bookId, dsMode)` and make `agg`, `eventMetric`, and `costFor` accept the same scope. Cache keys must include the book, mode, and dataset generation/fingerprint.

   Existing surfaces that will otherwise retain ECC values include:

   - `template.html:562` for the all-time KPI;
   - `template.html:575-583` for reconciliation;
   - `template.html:542` through `eventMetric` and the trend chart/table;
   - `template.html:862-867` for drawer segment totals, timeline heights, and event rows;
   - `template.html:922-946` for the data-quality panel;
   - `template.html:1114-1118` for CSV;
   - `template.html:815` and `template.html:872-873` for ECC fallback labels that must be replaced when a provider book is active.

   Segment totals are also precomputed as ECC values in the data (`build.py:351-352`, `build.py:375-390`). They must be recomputed from the active book, ignored, or clearly labeled as ECC-only.

   `renderAll()` does not refresh an already open drawer (`template.html:958-969`), so changing the book or hash while the drawer is open can leave stale money values. Close or rerender it on every pricing/state change. Also make the fallback/card badge depend on the filtered session events, not the session's full global model list.

   The build contract needs one source of truth too. A missing `__PRICING_JS__` placeholder must fail the build rather than be tolerated (`DESIGN-PRICING.md:234-237`), because the resulting page would have no `CostPricing`. Inject exactly once, insert the module before the main script, and reject or safely escape `</script>` in the injected source.

## Non-Blocking Suggestions

- Show native coverage or a "counterfactual/fallback" marker on every comparison button, not only for the active book. With the current dataset, an inactive Claude or Codex button is 100% fallback and is otherwise easy to mistake for a bill. When tiers are mixed, say "mixed native tiers" instead of naming one model.
- If DeepSeek is not the active book, show the retained `auto|peak|offpeak` mode on the DeepSeek comparison button or in its tooltip; otherwise its displayed total has no visible explanation.
- Document the source bucket contract precisely. In particular, state whether `input_tokens` excludes `cache_read_tokens` in this ECC feed. Codex/OpenAI often reports cached input as a subset of input, while the proposed formula treats cache-read as a separate bucket. The `cache_write -> cache-miss/input` mapping is an assumption that should be validated for every source.
- Document that cache-creation TTL tiers and context-length tiers are not recoverable from the event schema. The current non-goal covers context tiers but not the cache-creation-rate ambiguity.
- Keep rates as a small, versioned source-of-truth table with source URLs, retrieval date, and ideally a captured excerpt or checksum. Add a review step for rate changes so the HTML cannot silently ship a stale book.
- Define behavior for invalid `book` and `ds` hash values, unknown book IDs, missing timestamps, invalid timestamps, `NaN`/`Infinity`, and negative token fields. Validation today accepts any nonempty timestamp string in the browser import path (`template.html:986-998`); peak pricing would then silently classify an invalid date as off-peak.
- Make `peak` `null` or explicitly inapplicable for non-DeepSeek books rather than implying an off-peak rate.
- Define whether CSV `ecc_cost_usd` is the recorded event delta or a cumulative snapshot value. The current CSV emits `e.cost` under the name `estimated_cost_usd`; the new schema should make the delta semantics explicit.
- Consider a model-tier selector for Claude/Codex later. Fixed defaults are acceptable for v1 only if the default, fallback share, and counterfactual nature are prominent.

## Missed Edge Cases and Tests

- Reconciliation fixtures: cost-only anomaly, anomaly followed by recovery, reset plus anomaly, multiple segments, single-event sessions, partial time ranges, and empty data. Assert that ECC recorded totals and provider repriced totals each satisfy their own stated invariant.
- Current-dataset invariant: sum `priceEvent(e, "ecc")` in event order equals the recorded ECC segment total within an explicit tolerance, and the per-session last-segment calculation is tested separately.
- Matching collisions and precedence: `gpt-5.4-mini` versus `gpt-5.4`, `gpt-5-mini/nano` versus `gpt-5`, version/date suffixes, provider-prefixed names, unknown names within a known provider, and unknown providers. Test both `native` and `tierFallback`.
- Cross-model events: one Pro-to-Flash event, one native-to-foreign event, and one baseline with an unknown prior model. Assert that ambiguous tokens are not counted as confidently native and that the UI/CSV exposes the ambiguity.
- Coverage: token-weighted calculation across all four buckets, zero-token data, 0/0 denominator, mixed native and fallback tokens, and mixed native tiers.
- Peak: UTC boundaries at 01:00, 03:59, 04:00, 06:00, 09:59, and 10:00; Friday/Monday transitions; weekends; UTC-offset ISO timestamps; invalid timestamps; intervals crossing one and multiple windows; first/reset baselines; holidays and the explicit v1 limitation.
- Manual modes: all-peak and all-offpeak differ from auto when appropriate; manual modes ignore timestamps; non-DeepSeek books ignore `dsMode`; changing `state.ds` does not invalidate ECC/Claude/Codex totals.
- UI consistency: switch all four books with a drawer open, with `acc=latest`, with a time filter that cuts a segment, and after a hash change/back-forward. Compare KPI, comparison strip, trend, table, board, ranking, drawer, data-quality panel, and CSV against one canonical total.
- Badge/coverage tests: a session with one fallback event and one native event; fallback models outside the current filter; ECC fallback badge only in ECC mode; active-book badge only when the filtered events warrant it.
- Import/cache tests: selecting DeepSeek, importing mixed peak/off-peak data, and verifying the cache is cleared and totals change; failed/empty import preserves the old dataset; sequence numbers and cache keys cannot collide after replacement.
- Build tests: missing and duplicate placeholders, module injection order, `</script>` in injected pricing source, no remaining `__PRICING_JS__`, and exactly the same `pricing.js` source exercised by Node and emitted into HTML.
- Precision tests: raw ECC values, 9-decimal display/export values, canonical summation, and finite output for huge/zero/empty inputs.
- Import validation tests: malformed timestamps, timezone offsets, negative tokens, `NaN`, and Infinity. The current browser parser checks numeric token fields but not timestamp parseability.
- The acceptance statement at `DESIGN-PRICING.md:256` should be split: manual all-peak versus all-offpeak differ whenever there are positive tokens; `auto` differs from the bounds only when the selected data has both peak and off-peak attribution.

## Verdict

Blocking count: **5**.

The architectural direction is sound: a dependency-free JavaScript pricing module is appropriate for the build path and browser imports, and the four-mode UI is feasible without a backend. The design is not ready to implement as written because its reconciliation invariant fails on an existing supported anomaly class, ECC exactness is contradicted by the rounding rule, cross-model/model-matching attribution is not safe, DeepSeek auto pricing does not model event intervals or holidays, and the active-book money path is not defined completely enough to prevent mixed or stale values. Resolve the five blocking items and add the fixtures above before implementation.

## Round 2

Reviewed `DESIGN-PRICING.md` v2 (329 lines) against the five prior blockers only. No source code was changed.

### Per-Blocker Verdict

1. **Blocker 1: Not resolved.**

   The ECC/provider split itself is correct: recorded ECC reconciliation and provider `lastSegmentTotal` are now distinct, and all-time reconciliation is explicitly unfiltered (`DESIGN-PRICING.md:207-222`). However, the current-filter ECC `acc=latest` path is still undefined in a way that can contradict the recorded result.

   The design says an ECC comparison button uses the current filter and accounting mode (`DESIGN-PRICING.md:233`), while all money goes through `costFor(e, scope)` and `agg` (`DESIGN-PRICING.md:245-249`). With `acc=latest`, events are filtered by `session.lastSegment` (`DESIGN-PRICING.md:222`), so the anomaly fixture still yields an event sum of `1.0` while recorded `latestTotal` is `0.5`. At `range=all` with no other filters, the ECC comparison button/current KPI would therefore differ from the all-time recorded KPI. A per-event `costFor(e, scope)` cannot return a session-level recorded snapshot.

   Define the filtered ECC `latest` result explicitly. Either use a session-level recorded snapshot for every filtered result, disallow event-level latest for ECC, or document that it is last-segment event-sum repricing and stop claiming it reproduces recorded ECC latest. Add an all-range plus filtered-range anomaly assertion across comparison, KPI, drawer, and reconciliation.

2. **Blocker 2: Resolved.**

   ECC is now an explicit unrounded passthrough; provider costs remain unrounded per event; display and CSV round only (`DESIGN-PRICING.md:187-201`). The tolerance distinction is explicit. The only remaining ECC mismatch is the session-level filtered-latest issue above, not rounding.

3. **Blocker 3: Not resolved.**

   The cross-model ambiguity policy is now sound: `modelTo` pricing is disclosed, baselines and cross-model deltas are marked ambiguous, and confident coverage excludes them (`DESIGN-PRICING.md:70-83`). The matching contract still does not cover the dated model syntax promised by its tests.

   Normalization only strips the provider prefix, and exact-match boundaries are `(?:$|[-.])` (`DESIGN-PRICING.md:52-54`). It does not accept an `@YYYYMMDD` suffix, while the test plan claims dated-suffix coverage (`DESIGN-PRICING.md:276`) and existing `build.py:61` already recognizes `@`-dated model IDs. For example, `gpt-5.1@20250819` will not match the exact `gpt-5.1` rule and will fall to the GPT-5.3 Codex tier fallback; DeepSeek IDs have the same risk. Define the accepted suffix grammar or strip known date suffixes before matching, and make the dated-suffix test explicit.

4. **Blocker 4: Resolved.**

   `auto` is now explicitly Stop-time attribution rather than an official per-request calculation; manual peak/off-peak modes are the authoritative bounds; baselines and boundary-crossing intervals receive low confidence; and holiday omission is explicit (`DESIGN-PRICING.md:85-95`). This is an implementable approximation with the required caveat.

5. **Blocker 5: Resolved.**

   ECC is now an explicit pseudo-book, the public pricing/aggregation API accepts a scope, the WeakMap cache is replaced with the dataset, the active-book surface list covers the previously missed paths, the drawer rerenders on state changes, badges use filtered events, and the build placeholder contract is strict (`DESIGN-PRICING.md:156-201`, `245-257`).

### New Blocking Issues

1. **The peak-status API is internally contradictory.**

   `peakStatus(ts): boolean | null` is documented as returning `null` for non-DeepSeek contexts, but it takes no book or scope argument (`DESIGN-PRICING.md:172`). A one-argument function cannot know the active book. `isPeak(ts): boolean` (`DESIGN-PRICING.md:173`) also has no scope. The intended behavior is partially recoverable from `priceEvent.peak: null` for non-DeepSeek books (`DESIGN-PRICING.md:185`), but the public API remains ambiguous for callers and tests.

   Either remove `peakStatus` and keep `isPeak(ts): boolean` plus `priceEvent.peak`, or make it `peakStatus(ts, bookId): boolean | null`. Define what `null` means for invalid timestamps versus non-DeepSeek books. Add a direct API test.

### Round 2 Final Verdict

Two original blockers remain unresolved: ECC filtered `latest` totals and complete dated-model matching. One new blocking API contradiction remains in `peakStatus`. The core design is otherwise implementable and the revised contracts are substantially cleaner; after these three items are made explicit, there is no remaining architectural objection from this review.

## Round 3

Reviewed only the three Round 2 items and any contradiction they introduce.

1. **ECC filtered `latest`: Resolved.** `DESIGN-PRICING.md:217-228` now explicitly defines filtered `acc=latest` as a last-segment event sum, separates it from recorded snapshots, labels the distinction in the UI, documents the anomaly divergence, and adds the corresponding fixture.

2. **`@YYYYMMDD` matching: Resolved.** `DESIGN-PRICING.md:50-57` now strips one trailing `@YYYYMMDD` suffix before ordered matching and requires dated-suffix coverage for all three providers.

3. **`peakStatus` scope: Resolved.** `DESIGN-PRICING.md:175-196` now gives `peakStatus` an explicit `bookId`, defines `null` for non-DeepSeek and invalid timestamps, and specifies DeepSeek auto behavior plus non-DeepSeek/manual result fields.

No new blocking contradiction was introduced. One minor contract omission remains: `peakValid` is described as a `priceEvent` result field (`DESIGN-PRICING.md:195`) but is absent from the API shape at `DESIGN-PRICING.md:177-180`; add it to the return contract before implementation. This does not change pricing semantics.

**Final verdict: GO for implementation**, conditional only on documenting `peakValid` in the public return shape.
