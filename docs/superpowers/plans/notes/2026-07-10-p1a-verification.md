# P1a verification notes — 2026-07-10

Two timeboxed VERIFICATION investigations gating later phases (P5 regime analytics,
P1b broker-coverage marketing claim). Decision record — evidence, not prose.

---

## 1. Regime History

**CONCLUSION: EXISTS + backfill feasible.** A dated exposure-score series exists back to
**2026-02-20**; per-trade regime-at-entry can be reconstructed by re-running the classifier
on the historical score. The *classified regime LABEL* is not itself persisted anywhere (the
live path is a current-snapshot read), but its INPUT (the 0–150 UCT Exposure Rating) IS stored
dated, which is all the backfill needs. For P5 copy: **regime history begins 2026-02-20.**

### How the live classifier works (no history of its own)
- `api/services/journal_two/regime.py::get_current_regime()` reads
  `engine.get_breadth()["exposure"]["score"]` and buckets it: `>=90 green · >=50 amber ·
  >=15 orange · else red` (`classify_regime`, regime.py:21-31).
- `engine.get_breadth()` (engine.py:231-268) sources, in priority order: local state file →
  `/data/wire_data.json` (a **single current snapshot**, overwritten each `/api/push`, 23h TTL)
  → live fetch. **None is a time series.** So the classified regime is forward-only *as stored* —
  nothing persists yesterday's label.

### Backfill source A (primary) — `market_regimes` (uct-intelligence DB)
- File `C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db` — **reachable from this
  environment**, read-only verified.
- Table `market_regimes`: `regime_date` TEXT `YYYY-MM-DD` + `exposure_pct` INTEGER (this IS the
  score the classifier consumes — CLAUDE.md: "DB write: market_regimes.exposure_pct ←
  exposure.get('score')").
- Coverage: **105 distinct dated rows, regime_date 2026-02-20 → 2026-07-09, 104/105 non-null
  exposure_pct.** Sample: 2026-07-09→60, 07-08→50, 07-02→35, 07-01→57.
- **Reachability caveat:** this DB is LOCAL-ONLY on Railway (engine.py hardcoded local paths fail
  silently there). It reaches Railway only via the **Compass Brain Pack** (`/data/brain/data/
  uct_intelligence.db`, `UCT_INTEL_PATH=/data/brain`) — currently DARK/flag-gated. So a Railway
  backfill either uses source B, or runs as a local one-shot that pushes the computed values.

### Backfill source B (Railway-reachable) — `breadth_monitor.db`
- `/data/breadth_monitor.db` on the dashboard's own web volume. Schema
  `breadth_snapshots(date TEXT PK, metrics TEXT json, created_at)` (breadth_monitor.py:45-54).
- `metrics` JSON carries a dated **`uct_exposure`** field, written daily 4:30 PM ET by
  `uct-intelligence/scripts/breadth_collector.py` (`metrics["uct_exposure"] =
  _fetch_uct_exposure(today)`, breadth_collector.py:1715), which itself reads
  `SELECT exposure_pct FROM market_regimes WHERE regime_date = ?` (line 1285). A backfill/patch
  path already exists (breadth_collector.py:2400-2450, PATCH `/api/breadth-monitor/{date}/field`).
- Queryable via `GET /api/breadth-monitor?days=N` / `breadth_monitor.get_history(days)`.
  (Local dev copy of this DB is empty — production Railway volume is the populated one.)

### Backfill recipe
For each trade's entry date → look up the dated exposure score (source A directly, or source B via
the API) → `regime.classify_regime(score)` → green/amber/orange/red. Trades before ~2026-02-20 get
no label ("since regime history began").

---

## 2. Broker Coverage

**CONCLUSION: MULTI-BROKER LIKELY WORKS — the SnapTrade connect portal is broker-agnostic.**
No Robinhood-only (or any broker) restriction exists anywhere in the connect/refresh path. This is
a **marketing claim pending ONE live non-Robinhood test**, not an engineering project.

### Evidence — connect path is agnostic
- `broker/service.py::connect()` (lines 30-92): registers a SnapTrade user, then returns the
  Connection-Portal `redirectUri` from `snap.login_redirect_uri()`. No broker/institution argument.
- `broker/snaptrade_client.py::login_redirect_uri()` (lines 274-295): calls
  `sdk.authentication.login_snap_trade_user` with only `user_id`, `user_secret`, and optionally
  `custom_redirect` (post-portal return URL) + `reconnect` (repair a broken connection). **No
  `broker`/`brokerAuthorizationId`/`connectionType`/institution filter is passed** — SnapTrade's
  portal shows ALL its supported brokers.
- `service.py::refresh_accounts()` (lines 95-117) → `snap.list_accounts()` →
  `sdk.account_information.list_user_accounts` maps **every** account the user connected; no
  institution allow-list.

### Evidence — no restriction elsewhere
- Grep for `robinhood|institution ==|allowed_broker|broker_slug|whitelist|connectionType` across
  `api/` returns ZERO matches in the broker package or router. The only "Robinhood" hits are
  unrelated team-bio seed text (`desk_team_seed.py`).
- `feedback_broker_mirror_fidelity` / CLAUDE.md broker-sync notes reinforce this: "Provider =
  SnapTrade (30+ US brokers)"; the LOCKED invariant is to mirror the broker exactly, never filter.

### Remaining step
One live end-to-end connect + sync with a non-Robinhood brokerage (e.g. Fidelity/Schwab/E*TRADE)
to confirm the reconstruct/reconcile pipeline handles that broker's activity shapes → then it's a
marketing claim.
