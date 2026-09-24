# Breadth V2c2 — Dividend basis + canonical UCT start — FINAL PRE-GRIND VALIDATION (2026-09-24)

Scope: owner decision 2026-09-23 (F4 = the live DIVIDEND-ADJUSTED basis, independently implemented;
canonical `uct` begins 2026-03-23; `uct_backtest` stays research). The full grind was NOT started.
Nothing pushed, merged or cut over. Production stores, Main Trading, Intraday and Historical
Fundamentals untouched. The frozen V2c artifact is unmodified (sha256 ad8c157f…e8e8, 0444).

Code: correction `breadth/v2c-correction` @ a04b6683e (C:/w/v2cc) · independent validator
`breadth/v2c-validation` = 9fabd6a64 + additive tools @ HEAD (oracle.py/common.py untouched; oracle2.py
two parametrisations only) · merge design `breadth/v2c2-merge-design` @ 34ad18e20. All local only.

## 1. The canonical dividend basis (div-basis-v6), precisely

For name t, measured session D, frame F = the 380 sessions before D (last bar D−1):

    A_D(t, d) = S(t, d) · Π { r_e : d < sess(e) ≤ D−1 }        for d ∈ F
    r_e       = 1 − cash_e(USD) / R(t, prev(e))
    S         = provider grouped ADJUSTED close (split-adjusted, single vintage)
    R         = provider grouped RAW close of the same vintage
    prev(e)   = last session < sess(e) with a raw close, within 5 sessions
    sess(e)   = the first session ≥ the ex-date

* Same-day ex-dates (sess(e) = D) are not applied: the last bar stays raw (the collector's
  effective semantics at its 16:15 run).
* cash_e = Σ over distinct distributions on the ex-date, after these resolutions (every one measured):
  - share-class spelling: the ledgers write `BFB`/`HEIA`; resolved to the traded `BF.B`/`HEI.A`
    (both traded → ambiguous → both withheld). 49 mappings, 1,975 records.
  - several distinct amounts (regular + special/supplemental/variable) ADD — Yahoo sums them 80:4
    in a split-adjusted common-stock sample.
  - one amount twice under one symbol → WITHHELD (Yahoo 17 collapse vs 23 sum: unprovable).
  - two same-type amounts < 2 % apart → restatement → WITHHELD.
  - non-USD: converted at the ECB reference rate (USD/EUR ÷ CUR/EUR) of the latest ECB day ≤
    prev(e), ≤ 5 days old, ONLY for reference type CS (Canadian interlisted, direct foreign
    ordinaries). ADRs, missing/stale rates, mixed currencies → WITHHELD. (Yahoo converts: BMO
    CAD 1.71 → USD 1.218, implied yield = cash_usd / prior close exactly.)
* A dividend the provider's split-adjusted series already carries (scrip: BP, HSBC, AEG, PHG,
  BCS, TEF, NGG…; adj/raw steps by 1/r at the ex-session) is ABSORBED — applied once, not twice.
* A cash dividend on a split session is applied only if its unit ambiguity (1−r)·|1−1/K| ≤ 0.1 %.
* A dividend before the ticker's first-ever raw close touches no level → skipped (MPT, ADAM).
* WITHHELD (fail closed) when r ≤ 0.5, no prior close with earlier closes existing (a gap),
  or any rule above; the name gets no levels in frames straddling it.

## 2. Results (final code a04b6683e, pins ab0e140c4, vintage v20260924a)

* Vintage v20260924a: ONE window 2026-09-24T00:22:33Z → 00:35:58Z (grouped 00:22:33–00:31:53, 10,520 files;
  splits 28,498; dividends 2,063,166 by yearly ex-date ranges; ECB FX 44 currencies; reference
  snapshot 36,650 records; identity 2,689). Every object sha256 in INPUT_MANIFEST.json.
* Dividend table div-basis-v6: 434,551 applied · 2,217 FX-converted · 132 absorbed-by-provider ·
  183 split-session (units immaterial) · 38,907 multi-amount groups summed · 1,975 respelled records ·
  1,449,482 skipped (no priced bar before the ex-date) · 122,701 withheld sessions (fail closed).
* Guard adj-guard-v4: 25 UNAPPLIED_SPLIT events (all dual-class: HEI.A ×6, CIG.C ×4, BF.A/BF.B ×3 …);
  independent guard oracle identical (618 names). Dividend oracle identical (434,551 / 122,701).
* Bounded matrix (20 anchors + 8 dividend/split anchors, 267 sessions, 5 universes): 0 failed,
  integrity ok, 34,409 rows, 0 invariant violations, geometry exact except the 4 COVID halt days (376).
  Independent golden: 34,407/34,409 exact; the 2 non-exact cells (pct_above_20ema 2018-12-11 NYSE h,
  2018-12-12 US o) are the demonstrated CCH float tie (price 9.63; EMA 9.629999999999999 vs 9.63).
* Canonical PIT uct (127 live sessions 2026-03-23 … 09-22): 0 failed, 4,432/4,432 golden-exact.
* Sensitivity: 27 dividend-sensitive / 8 insensitive; empirical rail (factors off, withholding kept):
  0 violations over 210 matrix + 26 PIT sessions.
* Attribution v2 (20 anchors): OTHER = 0 (S0=frozen, S6=S6', S9=artifact).
* Convergence vs live, 92 clean sessions: pct metrics median 0.0 (200-SMA +0.1), p95 ≤ 0.2, max ≤ 0.9;
  vs the collector's own code on 40 fully covered sessions: pct max ≤ 0.5. Residual attributed to
  ~12–16 fail-closed names + provider-vs-Yahoo price source. 35 sessions are live-store incidents
  (26 self-heal substitutions, Aug 12–20 + 09-02 collapse), proven by re-running the collector code.
* Boundary: uct rows only from 2026-03-23 (real inputs, 03-16…03-25); merge design refuses earlier rows
  and any artifact without the v2c2-div methodology + div-basis-v6 + dividend input key.
* Preflight on the final vintage: problems = [] (valid until 2026-09-24T13:30Z); STALE after the open.
