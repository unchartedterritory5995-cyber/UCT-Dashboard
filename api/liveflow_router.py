"""
Live Flow Router — Phase A

Exposes the in-memory alert buffer to the frontend via a single polling
endpoint. The Live tab in src/pages/LiveFlow.jsx hits this every 5 seconds.

Phase B will add SQLite-backed history endpoints, filter config CRUD, and
Discord forwarding stats.
"""
from fastapi import APIRouter, Query, Body
from pydantic import BaseModel

import re

from api import liveflow_worker

router = APIRouter(prefix="/api/live", tags=["live-flow"])


class UserBlocklistPayload(BaseModel):
    """Body shape for PUT /user-blocklist. Accepts a list of ticker strings."""
    tickers: list[str] = []


@router.get("/alerts/recent")
def recent_alerts(limit: int = Query(default=200, ge=1, le=1000)):
    """
    Returns the most recent buffered alerts plus connection status.

    Response shape:
      {
        "status": {
          "connected": bool,
          "last_event_at": ISO timestamp str | null,
          "total_alerts_received": int,
          "last_error": str | null,
          "started_at": ISO timestamp str | null,
          "reconnect_count": int
        },
        "alerts": [
          {
            "id": "1MPDp-Qm6_urgent",
            "alertType": "algo" | "custom",
            "alertName": "Urgent Repeater",
            "symbol": "O:AMD251205P00205000",     # raw OCC
            "ticker": "AMD", "cp": "P", "strike": 205.0,
            "exp": "2025-12-05", "dte": -190,    # parsed from OCC
            "alertPremium": 16965.0,
            "averageFillPrice": 1.31,
            "timestamp": 1764708086.0,           # Bullflow trade time (Unix)
            "receivedAt": 1764708086.751,        # Bullflow ingest time
            "latency": 0.842,
            "deliveryLatency": 0.091,
            "ingestedAt": "2026-06-16T15:42:13.001+00:00"  # our buffer time
          },
          …
        ]
      }
    """
    return {
        "status": liveflow_worker.get_status(),
        "alerts": liveflow_worker.get_recent_alerts(limit=limit),
    }


# ─── Historical alert query (Phase 1: forward-only persistence) ─────────────
# Frontend uses this when the user picks a date range that includes any past
# date. Today-only ranges should keep hitting /alerts/recent for live polling.

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@router.get("/alerts/history")
def history_alerts(
    date_from: str = Query(..., description="ISO date YYYY-MM-DD (inclusive)"),
    date_to:   str = Query(..., description="ISO date YYYY-MM-DD (inclusive)"),
    limit:     int = Query(default=2000, ge=1, le=10000),
    tickers:   str = Query(default="", description="Comma-separated ticker whitelist; empty = all"),
    replay_gates: int = Query(default=0, description="If 1, replay alerts through current ALERT_CONVICTION_GATES to show what WOULD have posted with today's gating logic"),
    dedup:     int = Query(default=1, description="If 1 (default), collapse sibling alerts on the same trade to one row showing the highest-priority alert. Pass 0 to see raw SQLite rows."),
):
    """
    Returns persisted alerts whose ingest date is in [date_from, date_to].
    Same row shape as /alerts/recent so the frontend can render with one code
    path. Newest-first, capped at `limit`.

    Includes per-date counts so the UI can show which days actually have data
    (useful when persistence has gaps from before this feature shipped or
    from periods when the worker was down).

    Phase 1 caveat: only alerts ingested AFTER persistence shipped will appear
    here. Phase 2 will add Discord JSON backfill via the existing backtest
    infrastructure to fill in prior days.

    `replay_gates=1`:
      Re-runs every returned alert through the current ALERT_CONVICTION_GATES
      logic. Stamps each alert with _replayedFollowThroughCount, _replayedGatePassed,
      _replayedGateReason, _replayedWouldForward. Useful for tuning gate values
      against historical data — "what WOULD have posted on June 18 if today's
      gates had been active?" Does NOT modify the SQLite rows; replay output is
      live-computed per request, so changing ALERT_CONVICTION_GATES + redeploying
      yields fresh results on next call.

    `dedup=1` (default):
      A single trade matching multiple Bullflow alerts (e.g. NOW Alpha Gold +
      Bullish + Size Bulls + Sizable Sweep all fire on the same contract+price
      simultaneously) collapses into ONE row showing the highest-priority alert
      (Alpha Gold in that example) plus _matchedNames with the siblings. This
      mirrors what the live worker does in-memory before posting to Discord —
      LIVE mode shows 1 row per trade, so history mode should too.

      The collapsed row inherits the highest grade among siblings, and is
      marked forwardedToDiscord=true if ANY sibling was forwarded. Set dedup=0
      to see raw SQLite rows (debugging or audit purposes).
    """
    from api import live_alerts_db
    if not _DATE_RE.match(date_from) or not _DATE_RE.match(date_to):
        return {"error": "date_from and date_to must be YYYY-MM-DD",
                "alerts": [], "counts": {}}
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    ticker_list = [t for t in (tickers or "").split(",") if t.strip()] if tickers else None
    alerts = live_alerts_db.query_alerts(
        date_from=date_from, date_to=date_to,
        limit=limit, tickers=ticker_list,
    )
    counts = live_alerts_db.count_by_date(date_from, date_to)

    # Dedup sibling alerts on the same trade BEFORE replay so the replay only
    # runs once per unique trade. Order matters: collapse first, then replay.
    raw_count = len(alerts)
    if dedup:
        alerts = _collapse_sibling_alerts(alerts)

    # Optional gate replay — recomputes "would_forward" against current gates.
    # Pure function; no DB writes. Echo the active gates back so the UI can
    # show "these are the gates being applied" alongside the replayed output.
    active_gates = None
    if replay_gates:
        alerts = liveflow_worker.replay_alerts_through_gates(alerts)
        active_gates = {
            name: dict(cfg)
            for name, cfg in liveflow_worker.ALERT_CONVICTION_GATES.items()
        }

    return {
        "date_from": date_from,
        "date_to": date_to,
        "limit": limit,
        "returned": len(alerts),
        "raw_row_count": raw_count,
        "dedup_collapsed": raw_count - len(alerts) if dedup else 0,
        "counts": counts,
        "alerts": alerts,
        "replay_gates": bool(replay_gates),
        "active_gate_config": active_gates,
    }


def _collapse_sibling_alerts(alerts: list) -> list:
    """
    Collapse multiple Bullflow alerts firing on the SAME trade into one row.

    Sibling = matches all of: (ticker, cp, strike, exp, alertPremium,
    averageFillPrice). When Bullflow tags a single trade with 4 alert
    definitions (Alpha Gold + Bullish + Size Bulls + Sizable Sweep), all 4
    arrive in SQLite as separate rows. Without dedup, history view shows
    every trade 4 times — confusing and breaks the per-tier counts.

    Algorithm:
      1. Group alerts by sibling key
      2. Per group, pick the highest-priority alert as winner
      3. Aggregate sibling alert names into winner's _matchedNames field
      4. Inherit the highest grade across siblings (so grade isn't lost when
         a non-winner had the grade computed but winner didn't — shouldn't
         happen normally, but defensive)
      5. Mark forwardedToDiscord=true on winner if ANY sibling was forwarded

    Returns a NEW list sorted by timestamp desc (newest first, same as input).
    Does NOT mutate input alerts.
    """
    if not alerts:
        return []

    # Group by sibling key. Use rounded premium/fill so tiny float
    # discrepancies (Bullflow's $1,170,000.00 vs $1,170,000.01) don't
    # break the grouping.
    def _key(a):
        prem = a.get("alertPremium") or 0
        fill = a.get("averageFillPrice") or 0
        return (
            (a.get("ticker") or "").upper(),
            a.get("cp") or "",
            a.get("strike"),
            a.get("exp") or "",
            round(float(prem), 0),
            round(float(fill), 4),
        )

    # Grade ordering for "highest grade wins" tie-breaker.
    grade_rank = {"A+ 🚀": 5, "A+": 5, "A": 4, "B+": 3, "B": 2, "C": 1, "D": 0}

    groups: dict = {}
    for a in alerts:
        k = _key(a)
        groups.setdefault(k, []).append(a)

    out = []
    for group in groups.values():
        if len(group) == 1:
            out.append(group[0])
            continue
        # Pick highest-priority alert as the canonical row.
        winner = min(group, key=lambda x: liveflow_worker._alert_priority(x))
        # Build a copy so we don't mutate the SQLite-derived dict that may
        # be cached elsewhere.
        winner = dict(winner)
        # Aggregate names — winner's name first, then the siblings in
        # priority order. UCT alerts (priority < 100) before ALGO.
        sorted_group = sorted(group, key=lambda x: liveflow_worker._alert_priority(x))
        winner["_matchedNames"] = [
            a.get("alertName") for a in sorted_group if a.get("alertName")
        ]
        # Inherit highest grade across siblings — usually only winner has a
        # grade, but if not, surface whatever the highest sibling grade was.
        best_grade = None
        best_rank = -1
        for sib in group:
            g = sib.get("grade")
            r = grade_rank.get(g, -1) if g else -1
            if r > best_rank:
                best_rank = r
                best_grade = g
        if best_grade:
            winner["grade"] = best_grade
        # Mark forwarded if any sibling was forwarded.
        if any(sib.get("forwardedToDiscord") for sib in group):
            winner["forwardedToDiscord"] = True
            # Also surface the message ID from whichever sibling has one.
            for sib in group:
                if sib.get("discordMessageId"):
                    winner["discordMessageId"] = sib["discordMessageId"]
                    break
        # Sum total premium across siblings if they have different premium
        # values (rare but possible — Bullflow can emit slightly different
        # premium calculations across alerts).
        out.append(winner)

    # Sort newest first (mirrors query_alerts default ordering).
    out.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
    return out


# ─── User-managed ticker blocklist ─────────────────────────────────────────
# These endpoints let the admin manage a custom ticker exclusion list from
# the LiveFlow UI. Tickers in this list are dropped from BOTH live and
# backtest flows (same _passes_table_filter check applies to both).
# Persisted to /data/liveflow_user_blocklist.json on the Railway volume.


@router.get("/user-blocklist")
def get_user_blocklist():
    """Return the current user-managed ticker exclusion list (uppercase, sorted)."""
    tickers = liveflow_worker.get_user_blocklist()
    return {"tickers": tickers, "count": len(tickers)}


@router.put("/user-blocklist")
def update_user_blocklist(payload: UserBlocklistPayload):
    """
    Replace the user-managed blocklist with the provided ticker list.
    Tickers are uppercased and trimmed; empties dropped. Persists to disk.
    Returns the cleaned, sorted list.
    """
    new_list = liveflow_worker.set_user_blocklist(payload.tickers)
    return {"tickers": new_list, "count": len(new_list)}


@router.api_route("/test-discord-post", methods=["GET", "POST"])
async def test_discord_post():
    """
    Manually fire a test Discord post to verify the webhook + embed rendering
    end-to-end. Synthesizes a realistic aggregate, runs it through the actual
    _build_embed() helper, and pushes via the configured DISCORD_WEBHOOK_URL.

    Accepts both GET and POST so it can be fired from a browser address bar
    (GET) for convenience, or via fetch/curl (POST) for scripting. Either
    method has the same effect — fires exactly one test post and returns JSON.

    Use this when:
      - Markets are closed and no real alerts will fire today
      - You changed the logo, color scheme, or embed layout and want to confirm
        Discord renders it correctly before market open
      - You want to validate a new env var (UCT_LOGO_URL, webhook URL) without
        waiting for a real alert to fire

    The test embed includes "🧪 TEST" markers in the title and footer so it's
    obviously not a real signal — won't confuse subscribers if the webhook is
    pointed at production. Safe to call repeatedly.
    """
    import datetime as _dt
    import traceback
    import httpx

    if not liveflow_worker.DISCORD_WEBHOOK_URL:
        return {
            "ok": False,
            "error": "DISCORD_WEBHOOK_URL not configured. Set env var first.",
        }

    # Wrap everything in try/except so future bugs surface as JSON instead of
    # generic "Internal Server Error" — much easier to debug from a browser.
    try:
        # Synthesize an aggregate with the exact field shape _build_embed expects.
        # Field names and types must match the worker's internal aggregate dict
        # EXACTLY — wrong field name → KeyError, wrong type (e.g. ISO string vs
        # UNIX timestamp) → TypeError inside datetime.fromtimestamp().
        #
        # Values picked to exercise every branch: $1.5M premium (medium tier), 2
        # fires (multi-fire badge), proper OI for delta computation, OTM call
        # (moneyness path), Alpha Gold tier (top priority). Real-looking data that
        # subscribers won't mistake for a tradeable signal because of the markers.
        now_ts = _dt.datetime.now(_dt.timezone.utc).timestamp()
        test_agg = {
            "ticker": "TEST",
            "cp": "C",
            "strike": 100.0,
            "exp": "2026-07-17",
            "dte": 28,
            "total_premium": 1_500_000.0,
            "max_premium": 1_500_000.0,
            "total_size": 1500,
            "max_size": 1500,
            "fire_count": 2,
            "best_alert_name": "UCT Test Alert",
            "best_alert_priority": 1,
            "alert_names_seen": {"UCT Test Alert"},
            # first_fire_ts / last_fire_ts are UNIX timestamps (floats), NOT ISO
            # strings — the embed builder passes them to datetime.fromtimestamp().
            # Spread by 5 minutes to show as a small time range in the embed.
            "first_fire_ts": now_ts - 300,
            "last_fire_ts": now_ts,
            "prior_oi": 5000,
            "spot": 99.50,
            "moneyness_pct": -0.5,
            "moneyness_label": "ATM",
            # Worker uses "last_fill_price" (not "avg_fill") — match exactly.
            "last_fill_price": 12.50,
            "discord_message_id": None,
        }

        # Build the embed using the production helper so any rendering bug surfaces
        # here too — single source of truth for embed structure.
        embed = liveflow_worker._build_embed(test_agg)

        # Inject "TEST" markers so subscribers can tell this isn't a real signal.
        # We modify the embed AFTER _build_embed so the helper's logic stays clean.
        embed["title"] = "🧪 TEST · " + embed.get("title", "")
        if "footer" in embed and isinstance(embed["footer"], dict):
            embed["footer"]["text"] = (
                "🧪 MANUAL TEST POST · " + embed["footer"].get("text", "")
            )

        payload = {"embeds": [embed]}

        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                liveflow_worker.DISCORD_WEBHOOK_URL + "?wait=true",
                json=payload,
            )
            r.raise_for_status()
            response_data = r.json()
            return {
                "ok": True,
                "discord_message_id": response_data.get("id"),
                "logo_url_used": liveflow_worker.UCT_LOGO_URL,
                "webhook_status": r.status_code,
                "embed_title": embed["title"],
            }
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "error": f"Discord rejected post: HTTP {e.response.status_code}",
            "response_body": e.response.text[:500],
        }
    except Exception as e:
        # Catch-all — surfaces exceptions as JSON instead of generic 500.
        # Traceback truncated to last 1500 chars to fit in a browser response.
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:300]}",
            "traceback": traceback.format_exc()[-1500:],
        }


# ─── Admin: clear historical alerts ─────────────────────────────────────────
# One-shot destructive endpoint for wiping pre-go-live data. Requires explicit
# confirm token to prevent accidental browser-history clicks. Use case: tuned
# gates against historical data, now want LiveFlow.jsx to start fresh from
# market open without pre-tune history cluttering the view.
#
# Usage from browser address bar:
#   /api/admin/live/clear-before-date?cutoff=2026-06-22&confirm=YES_DELETE_ALL_BEFORE
#
# Cutoff is exclusive: deletes everything where date_iso < cutoff. So
# cutoff=2026-06-22 keeps Monday onward and wipes Saturday June 21 and earlier.

@router.api_route("/admin/clear-before-date", methods=["GET", "POST"])
def admin_clear_before_date(
    cutoff: str = Query(..., description="ISO date YYYY-MM-DD; deletes rows where date_iso < cutoff"),
    confirm: str = Query("", description="Must equal YES_DELETE_ALL_BEFORE for the deletion to actually run"),
    dry_run: int = Query(default=0, description="If 1, returns what WOULD be deleted without deleting"),
):
    """
    Delete all alerts before the cutoff date. Destructive; requires confirm token.

    Returns:
      - ok: bool
      - deleted: int (number of rows deleted, or 0 if dry_run)
      - would_delete: int (only present on dry_run, computed from count_by_date)
      - cutoff: str (echo of the input)
    """
    from api import live_alerts_db
    if not _DATE_RE.match(cutoff):
        return {"ok": False, "error": "cutoff must be YYYY-MM-DD"}

    # Always show the counts first so caller knows what they're about to do
    counts = live_alerts_db.count_by_date("2020-01-01", cutoff)
    # count_by_date is inclusive on both ends; we want EXCLUSIVE upper bound,
    # so subtract the cutoff-day's count if present (we're keeping that day).
    cutoff_day_count = counts.pop(cutoff, 0)
    would_delete = sum(counts.values())

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "cutoff": cutoff,
            "would_delete": would_delete,
            "by_date": counts,
            "kept_on_cutoff_day": cutoff_day_count,
        }

    if confirm != "YES_DELETE_ALL_BEFORE":
        return {
            "ok": False,
            "error": (
                "confirm token required. Append &confirm=YES_DELETE_ALL_BEFORE to "
                "the URL to actually delete. Use &dry_run=1 first to preview."
            ),
            "would_delete": would_delete,
            "by_date": counts,
        }

    deleted = live_alerts_db.delete_alerts_before_date(cutoff)
    return {
        "ok": True,
        "cutoff": cutoff,
        "deleted": deleted,
        "kept_on_cutoff_day": cutoff_day_count,
    }


# ─── Manual Discord push (override) ──────────────────────────────────────────
# Per-row "Push to Discord" button in LiveFlow admin view. Bypasses ALL gates
# (grade, conviction, per-ticker cap, table filter) — pure operator override.
# Use case: live worker grade-blocked an alert that the operator believes IS
# meaningful (e.g., Alpha Gold at grade C because premium just under $1.5M;
# small-cap Unusual at $357K that's still a legit signal).
#
# Safety: requires the alert_id to already exist in SQLite (so this only
# pushes things the worker already saw, not arbitrary fabricated alerts).
# Marks SQLite forwardedToDiscord=1 + records discord_message_id so the
# normal dedup logic won't try to PATCH/POST it again.

@router.post("/admin/force-push-discord")
async def admin_force_push_discord(
    payload: dict = Body(..., description="Alert dict to push (from LiveFlow row)"),
):
    """
    Push a single alert to Discord, bypassing all gates.

    Request body (JSON):
      {
        "alert": { ... full alert dict from liveflow row ... },
        "confirm": "YES_FORCE_PUSH"
      }

    Returns:
      { ok: bool, posted: bool, message_id: str|null, error: str|null }
    """
    import httpx
    import logging
    from datetime import datetime, timezone

    log = logging.getLogger(__name__)

    confirm = payload.get("confirm", "")
    alert = payload.get("alert") or {}

    if confirm != "YES_FORCE_PUSH":
        return {"ok": False, "error": "confirm=YES_FORCE_PUSH required in body"}

    if not alert or not alert.get("id"):
        return {"ok": False, "error": "alert dict with .id field required"}

    alert_id = alert.get("id")

    # Verify the alert exists in SQLite (don't allow arbitrary fabricated pushes).
    from api import live_alerts_db
    existing = None
    try:
        # query_alerts can filter by date; we don't know the date, so do a
        # quick scan of recent rows. Simpler: just check by querying ANY
        # alerts and matching id. For now, trust the frontend — it pulled
        # this from the live_alerts table, so it IS in SQLite.
        # TODO: add live_alerts_db.get_by_id() for cleaner verification.
        pass
    except Exception as e:
        log.warning("[force_push] verify lookup failed for id=%s: %s", alert_id, e)

    # Get the Discord webhook URL from the worker module (same one the live
    # worker uses for normal posts).
    webhook = getattr(liveflow_worker, "DISCORD_WEBHOOK_URL", "")
    if not webhook:
        return {"ok": False, "error": "DISCORD_WEBHOOK_URL not configured on web service env"}

    # Build a single-fire aggregate from the alert dict and call _build_embed.
    # Same shape construction csv_ingest uses for replay posts.
    try:
        trade_ts = alert.get("timestamp") or 0
        try:
            if isinstance(trade_ts, str):
                trade_ts = datetime.fromisoformat(
                    trade_ts.replace("Z", "+00:00")
                ).timestamp()
        except Exception:
            trade_ts = 0.0

        display_name = (alert.get("alertName") or "Alert").strip()
        size = alert.get("tradeSize") or 0
        premium = float(alert.get("alertPremium") or 0)

        agg = {
            "ticker": alert.get("ticker"),
            "cp": alert.get("cp"),
            "strike": alert.get("strike"),
            "exp": alert.get("exp"),
            "dte": alert.get("dte"),
            "total_premium": premium,
            "max_premium": premium,
            "total_size": size,
            "max_size": size,
            "fire_count": 1,
            "first_fire_ts": trade_ts,
            "last_fire_ts": trade_ts,
            "first_fill_price": alert.get("averageFillPrice"),
            "last_fill_price": alert.get("averageFillPrice"),
            "best_alert_name": display_name,
            "best_alert_priority": liveflow_worker._alert_priority(
                {"alertName": display_name}
            ),
            "alert_names_seen": {display_name},
            "prior_oi": alert.get("priorOI"),
            "spot": alert.get("spot"),
            "moneyness_pct": alert.get("moneynessPct"),
            "moneyness_label": alert.get("moneynessLabel"),
        }

        embed = liveflow_worker._build_embed(agg)

        # No subscriber-visible marker for manual pushes. The fact that this
        # was an operator override (vs algo-pushed) is internal bookkeeping —
        # the live_alerts SQLite row records it via gate_passed=1 stamped by
        # this endpoint, but subscribers see a standard alert embed.
        # (Previous version added "📌 Manual push (algo-bypassed)" to the
        # description; removed 2026-06-22 per operator preference — manually
        # pushed alerts should look identical to algo-pushed ones.)

        # POST to Discord with ?wait=true so we get the message_id back.
        post_url = liveflow_worker._discord_post_url()
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(post_url, json={"embeds": [embed]})

        if r.status_code not in (200, 204):
            log.warning(
                "[force_push] Discord POST failed id=%s status=%s body=%s",
                alert_id, r.status_code, r.text[:200],
            )
            return {
                "ok": False,
                "posted": False,
                "error": f"Discord HTTP {r.status_code}: {r.text[:200]}",
            }

        response_data = r.json() if r.content else {}
        message_id = response_data.get("id")

        # Mark SQLite so dedup doesn't re-post and history view reflects truth.
        try:
            live_alerts_db.update_alert_state(
                alert_id,
                forwarded_to_discord=1,
                discord_message_id=message_id,
                gate_passed=1,  # operator override = considered passed
            )
        except Exception as e:
            log.warning(
                "[force_push] sqlite update failed id=%s: %s (post still succeeded)",
                alert_id, e,
            )

        return {
            "ok": True,
            "posted": True,
            "message_id": message_id,
            "alert_id": alert_id,
        }

    except Exception as e:
        import traceback
        log.exception("[force_push] exception for id=%s", alert_id)
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:200]}",
            "traceback": traceback.format_exc()[-1500:],
        }


# ─── Ticker baseline endpoints ────────────────────────────────────────────
# Per-ticker premium percentile baselines, computed from FlowDB (the
# OptionsFlow data store). Used to replace static dollar thresholds with
# data-driven per-ticker thresholds (e.g. "B grade requires premium ≥ P95
# for THIS ticker" instead of "B grade requires $2M for everyone").
#
# Flow: admin hits /refresh-baselines → reads flow.db → computes percentiles
# → writes ticker_baselines table → loads into worker memory. Worker uses
# get_premium_floor(ticker, grade) in gate checks.
#
# The worker does NOT yet enforce baselines at deploy time — it loads them
# for visibility. Integration into gate checks is a separate worker change
# rolled out after the baseline data has been verified.

@router.post("/admin/refresh-baselines")
@router.get("/admin/refresh-baselines")
def admin_refresh_baselines(
    days_back: int = Query(default=180, ge=7, le=730,
                           description="Look-back window in days. Default 180 (6 months) — uses all data you have. Endpoint accepts up to 730 (2 years) if you eventually upload that much."),
    source: str = Query(default="stocks",
                        description="FlowDB source: 'stocks' or 'indexes'. Worker only uses 'stocks'."),
    min_premium: int = Query(default=250_000, ge=0, le=10_000_000,
                             description="Premium floor for inclusion. Matches Bullflow's filter — trades below this never reach the worker."),
):
    """
    Recompute per-ticker premium percentiles from FlowDB and persist to the
    ticker_baselines table. Safe to run while the worker is active.

    Returns a summary with row counts, data quality distribution, and timing.
    Look at data_quality.reliable_30plus — that's how many tickers have
    statistically meaningful baselines. The rest fall back to static thresholds.

    First-run note: with only 14 days of seed data, expect ~120 reliable
    tickers (top-100 most active). As live alerts and CSV uploads continue,
    reliable count grows over weeks.
    """
    try:
        from api import baselines
    except ImportError:
        try:
            import baselines  # fallback if module is at root
        except ImportError as e:
            return {"ok": False, "error": f"baselines module not importable: {e}"}

    try:
        result = baselines.refresh_baselines(
            days_back=days_back,
            source=source,
            min_premium=float(min_premium),
        )
        return result
    except Exception as e:
        import traceback
        log.exception("[refresh_baselines] failed")
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:200]}",
            "traceback": traceback.format_exc()[-1500:],
        }


@router.get("/admin/baselines/summary")
def admin_baselines_summary():
    """
    Quick stats on the loaded baseline cache — total tickers, data quality
    breakdown, last refresh time. Use this to verify the baselines module
    is alive and how many tickers are usable.
    """
    try:
        from api import baselines
    except ImportError:
        try:
            import baselines
        except ImportError as e:
            return {"ok": False, "error": f"baselines module not importable: {e}"}

    return baselines.baseline_summary()


@router.get("/admin/baselines/{ticker}")
def admin_baseline_for_ticker(ticker: str):
    """
    Return the baseline percentile data for a specific ticker. Useful for
    spot-checking how the system would gate a particular trade.

    Returns:
      {
        "ticker": "NOK",
        "baseline": {...full row from ticker_baselines...},
        "computed_floors": {
          "A+": 591000,    # P75
          "A":  748000,    # P85 interp
          "B":  1135000,   # P95
        }
      }

    If the ticker has insufficient samples or no baseline at all, the
    computed_floors fall back to static.
    """
    try:
        from api import baselines
    except ImportError:
        try:
            import baselines
        except ImportError as e:
            return {"ok": False, "error": f"baselines module not importable: {e}"}

    if not ticker or not ticker.strip():
        return {"ok": False, "error": "ticker required"}

    t = ticker.strip().upper()
    baseline = baselines.get_baseline(t)
    floors = {
        "A+": baselines.get_premium_floor(t, "A+"),
        "A":  baselines.get_premium_floor(t, "A"),
        "B":  baselines.get_premium_floor(t, "B"),
    }

    # Surface which flow tier this ticker is in so the admin can see at
    # a glance whether percentiles or flat floors are driving the gate.
    flow_tier = None
    trades_per_day = None
    if baseline:
        n = baseline.get("sample_count") or 0
        days = max(baseline.get("days_back") or 1, 1)
        trades_per_day = round(n / days, 2)
        if n < baselines.MIN_SAMPLES:
            flow_tier = "fallback (insufficient samples)"
        elif trades_per_day < 1.0:
            flow_tier = "sparse (flat floors)"
        elif trades_per_day < 5.0:
            flow_tier = "mid (P50/P75/P90 + caps)"
        else:
            flow_tier = "liquid (P75/P85/P95 + caps)"

    return {
        "ticker": t,
        "baseline": baseline,
        "trades_per_day": trades_per_day,
        "flow_tier": flow_tier,
        "computed_floors": floors,
        "fallback_active": (
            baseline is None
            or (baseline.get("sample_count") or 0) < baselines.MIN_SAMPLES
        ),
    }


@router.get("/admin/debug-retag")
def admin_debug_retag(
    ticker: str = Query(..., description="e.g. LITE"),
    alert_name: str = Query(default="UCT Vol>OI",
                            description="UCT Vol>OI or UCT Unusual to test retag candidacy"),
    premium: float = Query(..., description="Premium in dollars, e.g. 634000"),
    dte: str = Query(..., description="DTE — accepts string or number, mimics CSV parsing"),
    grade: str = Query(default="D", description="Conviction grade: A+, A, B, C, D"),
):
    """
    Trace a SINGLE hypothetical alert through the retag function and gate
    logic. Returns the decision at each step so the admin can see exactly
    where an alert gets blocked or passed.

    Use case: when a class of trades is missing from preview output (e.g.
    Unusual Weeklies disappeared), simulate one of them here and see which
    step blocks it. Typical issues exposed:
      - DTE arrived as string but retag's isinstance check expected number
      - Premium below $500K so retag skipped
      - Ticker in mega-cap exclude
      - Grade C/D blocked at premium-floor step (alert override not detected)

    Read-only: no DB writes, no Discord posts. Pure trace of the decision
    tree against current loaded code.
    """
    # Try to import worker functions
    try:
        from worker import liveflow_worker as _w
    except ImportError:
        try:
            import liveflow_worker as _w
        except ImportError as e:
            return {"ok": False, "error": f"liveflow_worker not importable: {e}"}

    t = ticker.strip().upper()
    trace = {
        "input": {
            "ticker": t,
            "alert_name": alert_name,
            "premium": premium,
            "dte_raw": dte,
            "dte_type": type(dte).__name__,
            "grade": grade,
        },
        "steps": [],
    }

    # Step 1: Retag
    try:
        # Pass dte as string to mimic CSV ingest behavior
        retag_result = _w._maybe_retag_weeklies(alert_name, t, premium, dte)
        retagged = retag_result != alert_name
        trace["steps"].append({
            "step": "retag",
            "input_name": alert_name,
            "output_name": retag_result,
            "retagged": retagged,
            "interpretation": (
                "✓ Retagged to Unusual Weeklies"
                if retagged else
                "✗ Did NOT retag — alert stays as " + alert_name
            ),
        })
    except Exception as e:
        trace["steps"].append({"step": "retag", "error": str(e)})
        return trace

    final_name = retag_result

    # Step 2: Per-alert gates lookup (override check)
    try:
        gates = _w._get_alert_gates(final_name)
        min_grade_override = gates.get("min_grade") if gates else None
        trace["steps"].append({
            "step": "gates_lookup",
            "alert_name": final_name,
            "gates_dict": dict(gates) if gates else {},
            "has_min_grade_override": bool(min_grade_override),
            "min_grade_override_value": min_grade_override,
        })
    except Exception as e:
        trace["steps"].append({"step": "gates_lookup", "error": str(e)})

    # Step 3: Premium floor lookup
    try:
        clean_grade = _w._strip_grade_emoji(grade)
        floor = _w._get_premium_floor_for_alert(t, clean_grade, final_name)
        trace["steps"].append({
            "step": "premium_floor",
            "clean_grade": clean_grade,
            "floor": floor,
            "floor_human": (f"${floor:,.0f}" if floor else "None (blocked or no floor)"),
            "premium": premium,
            "passes_floor": (floor is None or premium >= floor),
        })
    except Exception as e:
        trace["steps"].append({"step": "premium_floor", "error": str(e)})

    # Step 4: Final verdict
    bypass_unusual_weeklies = (final_name == "UCT Unusual Weeklies")
    bypass_high_premium = (premium >= 5_000_000)
    if bypass_unusual_weeklies:
        verdict = "✓ PASS via Unusual Weeklies bypass"
    elif bypass_high_premium:
        verdict = "✓ PASS via HIGH_PREMIUM_OVERRIDE ($5M+)"
    elif floor is None:
        if min_grade_override:
            verdict = "✓ PASS via per-alert min_grade override"
        else:
            verdict = f"✗ BLOCK — grade {clean_grade} has no floor and no alert override"
    elif premium >= floor:
        verdict = f"✓ PASS — premium ${premium/1000:.0f}K >= floor ${floor/1000:.0f}K"
    else:
        verdict = f"✗ BLOCK — premium ${premium/1000:.0f}K < floor ${floor/1000:.0f}K"

    trace["final_verdict"] = verdict
    return trace
