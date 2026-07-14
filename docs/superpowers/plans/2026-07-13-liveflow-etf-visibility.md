# LiveFlow ETF/Index Visibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after Ravi approves the change list. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make institutional ETF/index flow (QQQ/SPY/SPX/NDX/…) actually visible on `/live-massive` by lowering the ETF-specific premium floors, and get sign-off on a Phase 2 Index/Hedging aggregate view.

**Architecture:** Phase 1 is config-only — the curated thresholds live in `/data/curated_thresholds.json` on the **flow-worker** service and are edited live via `POST /api/live/massive/thresholds` (deep-merges with defaults, atomic file swap, invalidates the in-memory cache). No deploy, no code change, instantly reversible. Phase 2 is a separate feature (Ravi-area) that gets its own spec after concept approval.

**Tech Stack:** FastAPI (`api/live_massive_router.py`), SQLite `flow.db` on flow-worker, React (`app/src/pages/LiveFlowMassive.jsx`).

## Global Constraints

- `live_massive_router.py` is Ravi's area — **nothing here ships without his approve/deny on the numbered list below.**
- Threshold edits are NOT deploys — safe at any hour. Code deploys to web only ≥4:20 PM or <9:15 AM ET (pre-push hook enforces).
- Flow reads/writes are proxied to flow-worker (`FLOW_READS_PROXY_ENABLED=1`); the thresholds POST must take effect on **flow-worker's** file, so always verify via the public API, never by editing web's frozen copy.
- Editing `/data/curated_thresholds.json` directly over SSH does NOT take effect until process restart (in-memory cache) — always use the API/admin panel.

---

## Background (measured 2026-07-13, flow-worker `/data/flow.db`, table `flow`)

- ~49,907 `source='indexes'` prints ingested today (SPXW 10.9K, SPY 8.7K, SPX 7.0K, QQQ 6.1K, …) — ingestion is complete; visibility is the problem.
- Current ETF floors (set 7/7 with the `etf_enabled` pipeline, conservative first guess): Alpha $5M · Size $2.5M · LEAPS $2.5M · Bullish/Bearish $1.25M · Unusual $500K + 10× V/OI.
- Only **25** classified (MAGENTA/YELLOW) SWEEP/BLOCK index prints cleared $2.5M all day → ETF side of the feed reads as empty/broken.
- 86% of large classified index prints are `Type='ML/'` multi-leg spreads (SPX/NDX complex orders) — structurally wrong for the directional tape; right home is an aggregate view.
- Expected daily alert volume at proposed floors (same-day sweep/block data): **≥$1M → 67 prints**, **≥$600K → 122 prints**, spread QQQ 15 · SPY 13 · NDX 13 · SPX 9 · SOXX 9 · IBIT 9 · SLV 8 · GLD 8 · IWM 7 · SMH 4.

## Decision List (sent to Ravi 2026-07-13 — approve/deny each by number)

1. **Alpha Gold ETF floor: $5,000,000 → $2,500,000**
2. **Size ETF floor: $2,500,000 → $1,000,000**
3. **LEAPS ETF floor: $2,500,000 → $1,000,000**
4. **Bullish/Bearish ETF floors: $1,250,000 → $600,000**
5. **Unusual ETF tier: NO change** (stays $500K + 10× V/OI — the retail-noise guard)
6. **Multi-leg (`ML/`) index prints stay OUT of the main tape** (no change — reaffirming current behavior)
7. **Phase 2 concept: dedicated Index/Hedging aggregate panel** (net premium + put/call skew for SPY/QQQ/SPX/NDX, 0DTE share, hedging-pressure read vs. the single-stock tape — in Market Read or its own panel). Approval here = approval to write the spec, not to ship.

---

### Task 1: Record Ravi's verdicts

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-liveflow-etf-visibility.md` (this file)

- [ ] **Step 1:** Read Ravi's Discord reply in the UCT Intelligence dev server (#system-alerts thread or #dev-chat). Record each number as APPROVED / DENIED / MODIFIED (with his value) in the Decision List above.
- [ ] **Step 2:** If any of 1–4 are MODIFIED, substitute his values into the JSON in Task 2. If ALL of 1–4 are denied, stop — Phase 1 is dead; only proceed with item 7 if approved.
- [ ] **Step 3:** Commit: `git commit -m "docs: record Ravi verdicts on ETF visibility plan" -- docs/superpowers/plans/2026-07-13-liveflow-etf-visibility.md`

### Task 2: Apply approved floor changes (live, no deploy)

**Interfaces:**
- Consumes: `GET/POST https://uctintelligence.com/api/live/massive/thresholds` (POST body deep-merges; only send the keys being changed; unknown top-level keys are rejected 400).
- Produces: updated `etf_premium_floors` live in production, effective on the next `/recent` poll (~15s) and Market Read refresh (~30s).

- [ ] **Step 1: Snapshot current thresholds (this is also the rollback artifact)**

```bash
curl -s https://uctintelligence.com/api/live/massive/thresholds \
  -H "User-Agent: Mozilla/5.0" \
  > "$HOME/Documents/etf-thresholds-backup-$(date +%Y%m%d).json"
```

Expected: JSON containing `"etf_premium_floors": {"alpha": 5000000, "size": 2500000, "leaps": 2500000, "bullish": 1250000, "bearish": 1250000}` (pre-change values).

- [ ] **Step 2: POST the approved floors** (values below assume 1–4 approved as proposed; substitute Ravi's numbers if modified)

```python
import json, urllib.request
new = {"etf_premium_floors": {
    "alpha": 2_500_000,   # item 1
    "size": 1_000_000,    # item 2
    "leaps": 1_000_000,   # item 3
    "bullish": 600_000,   # item 4
    "bearish": 600_000,   # item 4
}}
req = urllib.request.Request(
    "https://uctintelligence.com/api/live/massive/thresholds",
    data=json.dumps(new).encode(),
    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    method="POST")
print(json.load(urllib.request.urlopen(req))["thresholds"]["etf_premium_floors"])
```

Expected output: `{'alpha': 2500000, 'size': 1000000, 'leaps': 1000000, 'bullish': 600000, 'bearish': 600000}`

- [ ] **Step 3: Verify persistence on flow-worker (proxy sanity check)**

```bash
curl -s https://uctintelligence.com/api/live/massive/thresholds -H "User-Agent: Mozilla/5.0" | python -c "import json,sys; print(json.load(sys.stdin)['etf_premium_floors'])"
```

Expected: the new values (proves the POST landed on the service that owns `/data/curated_thresholds.json`, not a stale copy).

### Task 3: Verify on the live page (next trading session)

- [ ] **Step 1:** During market hours next trading day, open `uctintelligence.com/live-massive`, set the toggle to **ETFs**. Expected: a real tape of SPY/QQQ/NDX/SPX/GLD/IWM sweeps and blocks (order of magnitude: tens of prints by midday, not zero).
- [ ] **Step 2:** Set toggle to **Stocks**. Expected: identical to pre-change behavior (stock floors untouched).
- [ ] **Step 3:** Set toggle to **All** with the **Size** chip. Expected: stock Size alerts plus the day's ≥$1M ETF prints interleaved; ETF rows should NOT dominate (if they exceed ~⅓ of the tape, floors are too low — raise via Task 2 mechanism and note it here).
- [ ] **Step 4:** Sanity-check the Market Read card in ETFs mode (it takes the same `stock_etf` partition): bull/bear totals should be nonzero and plausible.
- [ ] **Step 5:** Report the observed counts back to Ravi in the same Discord thread and record them here. Commit.

### Task 4: Rollback (only if the tape gets noisy or Ravi reverses)

- [ ] **Step 1:** POST the pre-change floors from the Step-1 backup file using the same Python snippet from Task 2 Step 2 with `{"etf_premium_floors": {"alpha": 5000000, "size": 2500000, "leaps": 2500000, "bullish": 1250000, "bearish": 1250000}}`.
- [ ] **Step 2:** Verify with the Task 2 Step 3 curl. Note: do NOT use `POST /thresholds/reset` — it wipes ALL saved thresholds (stack, premium_by_cap, overrides) back to compiled defaults, not just the ETF floors.

### Phase 2 (item 7 — only if approved): Index/Hedging aggregate panel

Not planned in detail here by design — it's Ravi's area and concept approval comes first. Scope sketch to carry into the spec:

- **What:** an aggregate panel (Market Read strip extension or its own card) showing, for SPY/QQQ/SPX+SPXW/NDX+NDXP/IWM: net premium (bull−bear), put/call premium skew, 0DTE share of premium, and a simple hedging-pressure read (index put premium vs. single-stock call premium).
- **Why aggregates, not rows:** 86% of large index prints are multi-leg spreads; a $20M SPX print that is one leg of a collar is not "bearish flow" and would mislead members as a tape row. As aggregates the ML flow becomes signal instead of noise.
- **Data:** already ingested (`source='indexes'` rows in flow-worker `flow.db`, ~50K/day) — zero new ingestion work; this is a query + UI feature. Query gotchas: `CreatedDate` is a `M/D/YYYY` string; use the Color index patterns already in `_build_day_stats`.
- **Next step if approved:** brainstorm + spec via the standard superpowers flow, coordinate with Ravi on endpoint placement in `live_massive_router.py` vs. a new router.

## Status Log

- 2026-07-13 ~10:00 PM ET: Plan written; decision list posted to Ravi (@manrav) via #system-alerts webhook. Awaiting verdicts.
