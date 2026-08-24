# OI Update — Clean-Data Design (daily OI + volume tracker)

**Date:** 2026-08-24 · **Status:** DRAFT (card is built + deployed **dark**; no Discord
posts) · **Owner area:** shared OI infrastructure (`api/oi_snapshots.py`) — coordinate
with Patrick/Ravi before merging.

---

## 1. Context

The Morning **OI Update** card (`api/oi_morning.py`, flow-worker, 08:00 ET, gated
`OI_MORNING_ENABLED` — currently **unset = dark**) ranks flow-confirmed contracts by
overnight ΔOI and is meant to show *"heavy volume that carried into open interest."*
The card renders, but the **CARRY %** column is unusable — it reads >100% almost
everywhere (e.g. KEEL 16294%, MDT 2447%, PFE 182%). Do **not** ship / arm until the
data is clean.

## 2. The problem (evidenced)

CARRY% = ΔOI ÷ volume. A net OI increase can never exceed the volume that created it,
so carry >100% is proof the numerator and denominator cover **different windows**.

Concrete case — **PFE $27P 9/18** (Massive daily volume, pulled directly):

| 8/18 | 8/19 | 8/20 | 8/21 (flow day) |
|---|---|---|---|
| 339 | **50,331** | 6,600 | 25,043 |

Card showed First OI **6.2K** → Last OI **51.9K** = ΔOI **+45.7K**, VOLUME **25,043**
→ carry **182%**. A +45.7K OI build cannot come from 25K of one-day volume; it built
over **multiple sessions** (note 8/19's 50K). The card divided a multi-day ΔOI by a
single day's volume.

### Root causes (all in the OI data layer, not the card)

1. **Sparse OI snapshots.** `daily_snapshot_job` (5:30 ET) snapshots only contracts
   with flow in the last 30d, and only their **OI**. Coverage has gaps → a contract
   often has **no prior-day OI** to diff against.
2. **Stale baseline fallback.** When the prior snapshot is missing, `oi_morning`'s
   "First OI" falls back to the **flow-print OI** (the `OI` column on the tape row),
   which can be days stale (PFE 6.2K vs a real ~50K). → ΔOI spans an **undefined**
   multi-day window.
3. **No stored daily volume.** Carry% needs volume over *exactly* the ΔOI window.
   Volume is only fetched ad-hoc at card time and cannot be aligned to an undefined
   window. (`contract_oi_snapshots` stores OI only.)
4. **T+1 / date-labeling.** OI is a once-daily OCC figure published next morning;
   `snap_date` is effectively the **capture** date, not the trading day the OI is
   *for*. Any ΔOI must be anchored to the trading day, and volume matched to it.

## 2b. Ground truth (UnusualWhales "Contract OI", Friday 8/21 — validation oracle)

UW's pre-open board is the clean target. For **PFE $27P 9/18**: Prev Vol **25,058**,
ΔOI **+21,231** → carry **85%**. Our card matched the **volume** (25,043 ✓) but our
ΔOI was **+45.7K** (stale) → carry 182% ✗. UW's carry is sane everywhere (ASST 91%,
XOM 91%, CG 96%, GOOGL 65%, SOFI 25%) because its ΔOI is a **clean single-day**
Thu-close→Fri-close change, always ≤ that day's volume.

Two consequences confirmed:
- **Volume source is correct** (Massive daily agg = UW Prev Vol).
- **Both our carry% AND our ΔOI *ranking* are wrong** — UW's clean top list (PFE,
  ASST, XOM, GOOGL, CG, SHEL, PDD…) barely overlaps ours (PFE, PR, MDT, AMZN…),
  because the stale baseline inflates ΔOI and reorders the board.

**Sharpened root cause:** `_oi_deltas` diffs the two most-recent *global* snapshot
dates; a contract absent from the prior batch falls back to the stale tape OI. The fix
must read each contract's **own prior-*trading*-day** OI (daily coverage), not a global
second-latest date.

**Acceptance test:** the rebuilt card must reproduce UW's numbers within tolerance —
e.g. PFE $27P 9/18 → ΔOI ≈ +21K, carry ≈ 85% (not +45.7K / 182%). Keep this UW board
as the validation set.

## 3. Goal / non-goals

**Goal:** a per-contract **daily** series of `(oi, volume)` keyed to the **trading
day** they represent, so that for any session D:
`ΔOI(D) = OI(D) − OI(D−1)` (guaranteed adjacent baseline) and
`CARRY%(D) = ΔOI(D) / volume(D)` — bounded 0–~100%, honest.

**Non-goals:** market-wide OI (this stays flow-confirmed); changing the card's ranking
(owner: rank by ΔOI); options-Greeks/IV; touching Discord (stays dark until clean).

## 4. Current state (what exists)

- **Table** `contract_oi_snapshots(contract_key, snap_date, oi, source, created_at)`
  in `/data/oi_snapshots.db` (moved out of flow.db 2026-07-17). OI **only**.
- **`daily_snapshot_job()`** (5:30 ET, weekdays; registered on flow-worker AND web):
  selects active contracts (flow in last `DAYS_BACK_TO_SNAPSHOT=30`, min-trades
  filter, drops adjusted/expired/malformed), fetches OI via
  `schwab_router.options_quotes_batch` (Schwab + UW fallback), `record_batch(
  [(ck, oi, "schwab")], today_iso)`.
- **Consumers of the OI table (must not break):**
  - `oi_snapshots.confirm_trade_direction` — B-side OI-growth confirmation
    (`oi_growth / volume ≥ 0.50`; volume today comes from flow.db, not the table).
  - `weekly_flow` still-open board (`get_latest_oi_batch`, peak-OI query).
  - OptionsFlow **OI Check** tab (client-side ΔOI via `/enrich-oi` + batch fetch).
  - `oi_morning` (this card) via `get_latest_oi_batch` / a two-date delta.
- **Massive daily aggs work for options** (proven): `/v2/aggs/ticker/O:…/range/1/day/…`
  returns per-day `v` (volume). Flow-worker must use **stdlib urllib** (httpx MIA).

## 5. Design

### 5.1 Schema (additive)
`ALTER TABLE contract_oi_snapshots ADD COLUMN volume INTEGER;` — nullable, defaults
NULL for existing rows. **No existing consumer reads `volume`, so this is safe.**
Keep `snap_date`. Add an explicit **`session_date`** column (the trading day the OI +
volume are *for*) so ΔOI/volume anchor to the session, decoupled from capture time.
(Alternatively redefine `snap_date` semantics — **rejected**: other consumers may
assume capture-date; adding a column is the non-breaking path.)

### 5.2 Volume capture
In `daily_snapshot_job`, after resolving each active contract, fetch its **completed
session** volume from the **Massive daily agg** (NOT the live 5:30 quote, whose
same-day volume is ~0). Store `(contract_key, session_date, oi, volume)`.
- Bounded: active-contract count post-filter (~hundreds). Batch/throttle; the job is
  off-request. Fail-soft per contract (volume NULL on error — OI still recorded).
- Reuse a shared OCC builder (`O:{TICKER}{YYMMDD}{C/P}{strike*1000:08d}`).

### 5.3 Daily coverage / adjacent baseline
The job already runs daily for active contracts, so OI(D) and OI(D−1) both exist **as
long as the contract was active both days**. Remaining gaps:
- **New contracts** (first flow day → no D−1): mark **State=NEW**, carry **N/A** (do
  not divide multi-day-accumulated OI by one day). The card already flags NEW.
- **Weekend/holiday:** D−1 = prior *trading* day (not calendar). Baseline lookup must
  use the trading calendar, not `date−1`.
- **Coverage backfill:** on the card's read path, if D−1 OI is missing for a displayed
  contract, backfill it (Massive can't give OCC OI, but the daily job going forward
  guarantees it; for launch, accept NEW/N-A until two clean days exist).

### 5.4 Carry definition (card)
For each displayed contract, read the stored daily series:
- `ΔOI = OI(session_last) − OI(prior_trading_day)` — both from the table (no flow-row
  fallback).
- `carry% = round(ΔOI / volume(session_last) * 100)` — volume from the table.
- If prior-day OI or volume missing → carry **N/A** (show "—"), never a fabricated
  ratio. Rank still by ΔOI.

### 5.5 Backfill (history)
One-shot: for the last ~10 trading days, backfill `volume` via Massive aggs for all
contracts already in the table (OI stays as recorded). Gives immediate carry for
contracts with ≥2 clean OI days. New-contract carry fills in naturally over 2 sessions.

## 6. Compatibility & risk

- **Additive column** — existing OI-only reads (`get_latest_oi_batch`, weekly-flow,
  OI Check, confirmation) are untouched.
- **Shared infra + two services.** `daily_snapshot_job` runs on flow-worker and web;
  the volume fetch adds external calls to that job → validate runtime/timeout budget,
  and that it doesn't contend with the tape on flow-worker.
- **`oi_morning.py` watch-path gap** (ops): it isn't in flow-worker's Railway watch
  paths, so edits need a `flow_worker_main.py` touch (or add it to watch paths) to
  auto-deploy. Fix the watch paths as part of this.
- **Coordinate with Patrick/Ravi** before schema + job changes (Ravi owns this
  pipeline; it's the B-side-confirmation backbone).

## 7. Rollout

Everything stays **dark**: card gated by `OI_MORNING_ENABLED` (unset). Ship schema +
volume capture first (silent — just populates data), let it run several sessions,
verify carry lands ≤~100% on a sample, THEN wire the card to the clean series, preview
via `?post=0`, and only then discuss arming.

## 8. Testing

- Unit: carry math on a seeded `(oi, volume)` series (adjacent days → ≤100%;
  missing prior/volume → N/A; new contract → NEW/N-A).
- Data validation: after N sessions, assert on a sample that `ΔOI(D) ≤ volume(D)` holds
  for BUILDING contracts (the invariant that was violated).
- No-regression: existing `oi_snapshots` consumers unchanged (OI-only reads).

## 9. Tasks (phased)

1. **Measure** current OI-snapshot sparsity (cadence, % of flow contracts with a real
   D−1 baseline) — grounds the fix, confirms the diagnosis at scale.
2. Schema: add `volume` + `session_date` (additive migration).
3. `daily_snapshot_job`: capture completed-session volume (Massive aggs, urllib,
   fail-soft) + label `session_date`.
4. Backfill volume for the last ~10 sessions.
5. Rewire `oi_morning` carry to the clean table series; carry N/A when incomplete.
6. Fix flow-worker watch paths for `oi_morning.py`.
7. Validate the `ΔOI ≤ volume` invariant on live data over several sessions.
8. Only then: preview → discuss arming.

## 10. Open questions

- Volume-fetch cost in the daily job at full active-contract scale — acceptable, or
  cap/tier it?
- Is `session_date` labeling correct given OCC T+1 — capture at 5:30 = *which* trading
  day's OI? (Confirm against a known contract before backfilling.)
- Do we ever want the ETF/index board too (currently single-name only)?
