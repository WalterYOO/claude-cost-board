# Pricing Implementation Review

Reviewed `DESIGN-PRICING.md`, `REVIEW-PRICING.md`, `pricing.js`, `template.html`, `build.py`, `Makefile`, `tests/test_pricing.js`, `tests/test_build.py`, and `README.md`. No source or test files were modified.

Verification:

- `make test`: Python 11/11 passed; Node 20/20 passed.
- `make build`: succeeded; 381 sessions, 1,396 events, 382 segments, 1 reset.
- The generated page loaded successfully under jsdom. Book switching, DeepSeek modes, hash restoration, drawer rerender, imported-data replacement, CSV output, and current-filter KPI/button/table totals were exercised.
- ECC event aggregation matched recorded segment total to floating-point tolerance. Current DeepSeek auto (`$234.56`) lies between all-off-peak (`$140.34`) and all-peak (`$280.68`).

## Blocking Issues

1. **The data-quality panel loses the low-confidence event count in every book.**

   `reconciliation()` returns a reduced object without `lowConfidenceEvents` for both ECC and provider books (`template.html:498-516`), but `renderDq()` reads `r.lowConfidenceEvents` (`template.html:1119`). `esc()` converts `undefined` to an empty string, so the row renders as `低置信度事件` with no value. The current build has 418 low-confidence events, but the panel is blank in ECC, Claude, Codex, and DeepSeek modes. This is a regression in a required data-quality surface and should be fixed before sign-off.

## Non-Blocking Findings

- **`acc=latest` KPI labeling is still too weak.** The money is correctly a last-segment event sum, but the KPI title remains the generic `当前筛选 · 花费` (`template.html:716`). The anomaly fixture visibly shows `$1.00` in the filtered KPI versus recorded `$0.50` in the all-time KPI/reconciliation; only the distant data-quality note explains the difference (`template.html:1128`). Add a `末段事件和` subtitle or equivalent to the KPI itself.

- **DeepSeek timestamp handling has API edge inconsistencies.** `peakStatus(null, "deepseek")` treats `null` as the Unix epoch and returns a normal off-peak status, because `new Date(null)` is valid (`pricing.js:238-241`). A non-baseline event with a valid timestamp but missing `gapHours` is treated as high confidence (`pricing.js:248-255`), even though the interval is unknown. Production events currently carry valid timestamps and gaps, but the public module contract says missing/invalid numerics are tolerated.

- **`crossesBoundary` is not a pure boundary-crossing signal.** Non-baseline gaps over 48 hours return `true` without actually checking whether a peak-status transition occurred (`pricing.js:256`); a 49-hour weekend interval can therefore report boundary crossing. Baselines also return `true` at zero or missing gap (`pricing.js:253-255`). Low confidence is conservative, but the diagnostic field is inaccurate and should be documented or renamed.

- **Matching is slightly broader/different than the written boundary contract.** Claude exact rules are unanchored (`pricing.js:86-94`), while Codex rules accept `-` and `@` but not the documented `.` boundary (`pricing.js:103-121`). Current model names resolve correctly, but future or imported IDs can be classified as exact tiers when they should be tier fallbacks.

- **Ambiguity uses normalized model names, not the documented raw comparison.** `isAmbiguous()` compares `normalizeModel(modelFrom)` and `normalizeModel(modelTo)` (`pricing.js:174-179`). Four current events change only the provider prefix, so the data-quality panel reports 14 cross-model events while only 10 are marked ambiguous. This is reasonable if provider routing is considered semantically identical, but the design says `modelFrom !== modelTo` and the discrepancy is untested.

- **The data-quality panel does not fully expose the advertised DeepSeek pricing context.** It names the auto/manual mode and caveats but does not render the configured peak windows from `PRICING.meta.peak` or make source URLs clickable (`template.html:1127-1136`).

- **Browser and build import validation differ for numeric fields.** Browser parsing accepts booleans and whitespace-only numeric strings through `Number()` (`template.html:1184-1187`), while `build.py` rejects booleans and non-parsable strings (`build.py:119-129`). The same `costs.jsonl` can therefore produce different rows depending on import path.

## Missed Edge Cases and Tests

- There is no automated DOM/browser test for the pricing bar, KPI/button/table agreement, drawer rerender, hash round-trip, CSV contents, or import cache invalidation. This is why the blank data-quality value is not caught by `make test`.
- `tests/test_build.py:47-57` checks recorded reconciliation for the cost-only anomaly but does not assert the design's filtered `acc=latest` event sum of `$1.00`, nor the visible difference from the recorded latest value.
- `tests/test_pricing.js:34-40` is titled as metadata/rates integrity but does not verify defaults, positive rates for every tier, or the complete rate table.
- Missing pricing edge tests include zero-token/0-denominator coverage, `null` timestamps, valid timestamps with missing `gapHours`, invalid timestamps in manual modes, baseline `crossesBoundary`, long weekend gaps with no actual status change, dot-boundary model IDs, and normalized-equal cross-model aliases.
- Build tests do not cover a duplicate `__COST_DATA_JSON__` placeholder, the absence of price fields in the event schema, or an actual template plus `pricing.js` integration render.

## Verdict

**Blocking count: 1.**

The pricing implementation is substantially correct: rate mappings, ECC passthrough, provider fallback/coverage accounting, DeepSeek manual bounds, filtered-versus-all-time reconciliation, cache invalidation, and the active-book money surfaces are coherent, and both requested commands pass. It is not ready for final sign-off because the required data-quality panel silently drops the low-confidence event count in every mode; the remaining findings are edge-contract, labeling, and coverage improvements rather than blockers.

## Round 2

Re-ran `make test` and `make build`: 13/13 Python tests and 25/25 Node tests pass; the build succeeds with 381 sessions and 1,396 events. Rechecked the fixes in the generated page with jsdom.

- **Low-confidence count: Resolved.** `template.html:498-517` now propagates/recomputes `lowConfidenceEvents`; the data-quality panel shows `418` in ECC, Claude, Codex, and DeepSeek modes.
- **`acc=latest` KPI label: Resolved.** The active cost KPI renders `当前筛选 · 花费（末段事件和）` (`template.html:717-719`).
- **DeepSeek timestamp and missing-gap handling: Resolved.** `peakStatus(null|"")` returns `null`; missing `gapHours` marks the interval unknown and yields low auto confidence (`pricing.js:238-257`; tests at `tests/test_pricing.js:206-223`).
- **Model matching boundaries and Codex Fast: Resolved.** Claude exact rules are anchored, dot boundaries are accepted, and `gpt-5.3-codex-fast` resolves to its modeled rate before the base Codex rule (`pricing.js:86-121`; `tests/test_pricing.js:88`).
- **Peak windows in data quality: Resolved.** The panel displays both UTC peak windows and the weekday/holiday limitation (`template.html:1125`).
- **Browser numeric validation: Resolved.** Booleans and empty/whitespace-only string fields are rejected, aligning these cases with `build.py` (`template.html:1187-1195`).
- **Extended tests: Resolved.** The suite now covers rate integrity, null timestamps, missing gaps, provider-prefix aliases, zero-token coverage, a real template plus pricing render, and the no-price-fields invariant.

No new blocking contradiction was introduced. The prior blocking issue is gone.

**Round 2 verdict: GO for implementation.**
