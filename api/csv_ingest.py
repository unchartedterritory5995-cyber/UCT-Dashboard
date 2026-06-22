"""
CSV-to-SQLite ingest for Bullflow daily exports.

Backfills the `live_alerts_v1` SQLite table from Bullflow's daily CSV exports
when the live SSE worker wasn't capturing them. Primary use case: historical
days (like June 18) where the MCP backfill sampler hit its 100/day cap and
left ~200 alerts uncaptured.

Once live SSE is the canonical source (Monday onwards), this endpoint is
rarely needed. But it stays in the codebase as the recovery path for any
day where capture was incomplete (worker crash, deploy gap, MCP cap).

Workflow:
  1. AlertTester page has the daily CSV uploaded + live alert configs loaded.
  2. User clicks "Backfill to SQLite" button (in AlertTester).
  3. Frontend POSTs the CSV + all 10 alert configs to this endpoint.
  4. For each alert config, this endpoint runs the same Bullflow filter the
     simulator uses, then writes one alert row per (matched_trade × alert)
     into live_alerts_v1.
  5. Live Flow history view at ?from=DATE&to=DATE now shows the complete
     day's data. With ?replay_gates=1, the gate replay shows accurate
     "would-have-posted" output.

Determinism: alert IDs are computed as `csv_{date}_{row_idx}_{alert_short}`,
so re-running the same CSV through the same configs produces the same IDs.
Existing rows get silently skipped (composite PK collision on insert) rather
than duplicated. To force a re-ingest with different configs, delete the
date's rows first via the (admin-only) clear endpoint below.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

from api import live_alerts_db, alert_tester

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/live", tags=["live-admin"])


def _build_occ_symbol(ticker: str, exp: str, cp: str, strike: float) -> str:
    """
    Build OCC-format option symbol matching what Bullflow's SSE provides.
    Format: O:{TICKER}{YYMMDD}{C/P}{STRIKE*1000:08d}
    Example: MU $550 Put exp 2026-12-18 → O:MU261218P00550000

    Falls back gracefully if any input is malformed — returns empty string
    rather than raising, so a single bad row doesn't break the batch.
    """
    if not ticker or not exp or not cp or strike is None:
        return ""
    try:
        # exp is YYYY-MM-DD → strip century to YYMMDD
        exp_compact = exp.replace("-", "")
        if len(exp_compact) == 8:
            exp_compact = exp_compact[2:]
        elif len(exp_compact) != 6:
            return ""
        strike_8 = f"{int(round(float(strike) * 1000)):08d}"
        return f"O:{ticker}{exp_compact}{cp}{strike_8}"
    except (ValueError, TypeError):
        return ""


def _build_alert_from_csv_row(
    row: dict, alert_name: str, date: str, idx: int
) -> dict:
    """
    Convert a parsed CSV row + matching alert name into the dict shape
    live_alerts_db.insert_alert expects. Mirrors what liveflow_worker's
    _ingest_alert produces, minus the enrichment fields (priorOI, moneyness,
    etc) which aren't available from CSV alone.

    The frontend's bell column / replay logic only depends on alertName,
    ticker, cp, strike, exp, alertPremium, ingestedAt — all present here.
    """
    ticker = (row.get("ticker") or "").upper()
    cp = row.get("cp") or ""
    strike = row.get("strike")
    exp = row.get("exp") or ""
    unix_ts = float(row.get("unix") or 0)

    # Deterministic ID — collisions impossible across (alert_name × row_idx)
    # and stable across re-runs so re-ingest is idempotent.
    short_alert = (
        alert_name.replace("UCT ", "")
                  .replace(" ", "_")
                  .replace(">", "gt")
                  .lower()
    )
    alert_id = f"csv_{date}_{idx:05d}_{short_alert}"

    iso_ts = None
    if unix_ts > 0:
        try:
            iso_ts = datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            iso_ts = None

    return {
        "id":                alert_id,
        "alertType":         "custom",  # all UCT alerts are custom; algo skipped
        "alertName":         alert_name,
        "symbol":            _build_occ_symbol(ticker, exp, cp, strike),
        "ticker":            ticker,
        "cp":                cp,
        "strike":            float(strike) if strike is not None else None,
        "exp":               exp,
        "dte":               row.get("dte"),
        "alertPremium":      float(row.get("premium") or 0),
        "averageFillPrice":  row.get("trade_price"),
        "timestamp":         unix_ts if unix_ts > 0 else None,
        "receivedAt":        None,
        "latency":           None,
        "deliveryLatency":   None,
        "ingestedAt":        iso_ts,
        "tradeSize":         row.get("trade_size"),
        "priorOI":           row.get("oi"),
        "volumeOIRatio":     None,
        "oiExceeded":        False,
        "oiSnapshotDate":    None,
        "spot":              row.get("spot"),
        "moneynessPct":      None,
        "moneynessLabel":    None,
        "contractRepeatCount": None,
        "_superseded":       False,
        "grade":             None,
        "gatePassed":        None,
        "forwardedToDiscord": False,
        "discordMessageId":  None,
        "source":            "csv_ingest",
    }


@router.post("/ingest-bullflow-csv")
async def ingest_bullflow_csv(
    csv_file: UploadFile = File(..., description="Bullflow daily CSV export"),
    alert_configs: str = Form(
        ...,
        description="JSON array of alert config objects; each must have alertName + filter fields",
    ),
    date: str = Form(..., description="Trade date YYYY-MM-DD (must match CSV contents)"),
):
    """
    Ingest a Bullflow daily CSV into live_alerts_v1.

    Body (multipart/form-data):
      csv_file       — the Bullflow CSV (29k+ rows typical)
      alert_configs  — JSON array: [{alertName, minPremium, minDTE, ...}, ...]
                       Same shape as /api/admin/alert-tester/configs returns
      date           — YYYY-MM-DD trade date label

    Returns:
      {
        ok: bool,
        csv_rows: int,         # total rows in CSV
        alerts_processed: int, # configs we ran
        alerts_inserted: int,
        alerts_skipped: int,   # duplicate ID (re-run on existing day)
        by_alert: {name: count},
        elapsed_sec: float
      }
    """
    import time
    t0 = time.time()

    # 1. Parse alert configs
    try:
        configs = json.loads(alert_configs)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid alert_configs JSON: {e}")
    if not isinstance(configs, list) or not configs:
        raise HTTPException(400, "alert_configs must be a non-empty JSON array")

    # 2. Parse CSV via the same parser AlertTester uses
    raw = await csv_file.read()
    rows, parse_errors = alert_tester._parse_csv(raw)
    if not rows:
        return JSONResponse({
            "ok": False,
            "error": "CSV had no parseable rows",
            "parse_errors": parse_errors[:5] if parse_errors else [],
        })

    # 3. For each alert config, run the Bullflow filter and insert matches.
    # We track inserted vs skipped (duplicate IDs from prior runs) separately
    # so the user can tell if a re-ingest actually added anything new.
    inserted = 0
    skipped = 0
    insert_errors = 0
    by_alert: dict = {}

    for cfg in configs:
        if not isinstance(cfg, dict):
            continue
        alert_name = (cfg.get("alertName") or "").strip()
        if not alert_name:
            continue
        # Skip non-UCT alerts (Bullflow's native algos like "Sizable Sweep"
        # — we don't have their filter logic, so we can't reproduce them).
        if not alert_name.startswith("UCT "):
            log.info("[csv_ingest] skipping non-UCT alert: %s", alert_name)
            continue

        try:
            matched, _ = alert_tester._apply_bullflow_filter(rows, cfg)
        except Exception as e:
            log.warning("[csv_ingest] filter error for %s: %s", alert_name, e)
            continue

        per_alert_count = 0
        for idx, r in enumerate(matched):
            alert_dict = _build_alert_from_csv_row(r, alert_name, date, idx)
            try:
                # insert_alert returns truthy on success or raises on
                # composite-PK collision. We treat the collision as "already
                # have this row" rather than an error.
                result = live_alerts_db.insert_alert(alert_dict)
                inserted += 1
                per_alert_count += 1
            except Exception as e:
                msg = str(e).lower()
                if "unique" in msg or "duplicate" in msg or "constraint" in msg:
                    skipped += 1
                else:
                    insert_errors += 1
                    if insert_errors < 5:
                        log.warning(
                            "[csv_ingest] insert failed id=%s err=%s",
                            alert_dict.get("id"), e,
                        )
        by_alert[alert_name] = per_alert_count

    elapsed = time.time() - t0
    return JSONResponse({
        "ok": True,
        "date": date,
        "csv_rows": len(rows),
        "alerts_processed": len(configs),
        "alerts_inserted": inserted,
        "alerts_skipped_duplicates": skipped,
        "insert_errors": insert_errors,
        "by_alert": by_alert,
        "elapsed_sec": round(elapsed, 2),
        "next_step": (
            "Visit /live-flow?from=" + date + "&to=" + date + " to see the "
            "ingested alerts. Toggle 'GATES ON' to replay through current "
            "ALERT_CONVICTION_GATES."
        ),
    })


@router.post("/replay-csv-preview")
async def replay_csv_preview(
    csv_file: UploadFile = File(..., description="Bullflow daily CSV export"),
    alert_configs: str = Form(
        ...,
        description="JSON array of alert config objects; each must have alertName + filter fields",
    ),
    date: str = Form(..., description="Trade date YYYY-MM-DD"),
):
    """
    Wrapper that calls _replay_csv_preview_impl with full exception trapping.
    Diagnostic endpoint — surfaces tracebacks in the JSON response (HTTP 200
    with ok=false) instead of generic HTTP 500, so frontend can display the
    real error. Remove this wrapper once the endpoint is stable.
    """
    import traceback as _tb
    try:
        return await _replay_csv_preview_impl(csv_file, alert_configs, date)
    except Exception as e:
        return JSONResponse({
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:500]}",
            "traceback": _tb.format_exc()[-2500:],
            "hint": (
                "If error mentions 'has no attribute replay_alerts_through_full_pipeline', "
                "the worker module on the WEB service is stale — push liveflow_worker.py "
                "and redeploy. If error mentions '_grade_level' or '_alert_priority', "
                "the function signature changed; check the imports."
            ),
        })


async def _replay_csv_preview_impl(
    csv_file: UploadFile,
    alert_configs: str,
    date: str,
):
    """
    PREVIEW what alerts from this CSV WOULD push to Discord under current
    worker gates. Does NOT insert to SQLite. Does NOT post to Discord.

    Workflow:
      1. Parse CSV via the same parser AlertTester uses
      2. For each alert config, run the Bullflow filter to get candidate matches
      3. Build alert dicts (live_alerts_db schema)
      4. Run the full pipeline replay via liveflow_worker.replay_alerts_through_
         full_pipeline — applies TABLE_FILTER → re-tag → grade → min_grade →
         conviction gates
      5. Cross-reference with SQLite to identify duplicates of alerts that
         already posted to Discord today
      6. Return summary + per-alert detail

    Returns:
      {
        ok: bool,
        date: str,
        csv_rows: int,
        candidates_from_bullflow: int,    # passed Bullflow filter for any alert
        would_forward: int,               # passed all worker gates
        already_posted_dupes: int,        # of would_forward, how many already in
                                          # SQLite as forwardedToDiscord=1 today
        net_new: int,                     # would_forward - already_posted_dupes
        by_alert: {name: {candidates: N, would_forward: N, net_new: N}},
        forward_list: [
          {
            ticker, cp, strike, exp, premium, time, grade,
            original_alert, final_alert,   # final differs if re-tagged
            is_duplicate: bool,
            duplicate_id: str|null,        # SQLite id of the dupe if found
          },
          ...
        ],
        elapsed_sec: float
      }
    """
    import time
    t0 = time.time()

    # 1. Parse alert configs
    try:
        configs = json.loads(alert_configs)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid alert_configs JSON: {e}")
    if not isinstance(configs, list) or not configs:
        raise HTTPException(400, "alert_configs must be a non-empty JSON array")

    # 2. Parse CSV
    raw = await csv_file.read()
    rows, parse_errors = alert_tester._parse_csv(raw)
    if not rows:
        return JSONResponse({
            "ok": False,
            "error": "CSV had no parseable rows",
            "parse_errors": parse_errors[:5] if parse_errors else [],
        })

    # 3. Run Bullflow filter per alert, collect all candidate alerts.
    candidate_alerts: list = []
    by_alert_candidates: dict = {}
    for cfg in configs:
        if not isinstance(cfg, dict):
            continue
        alert_name = (cfg.get("alertName") or "").strip()
        if not alert_name or not alert_name.startswith("UCT "):
            continue
        try:
            matched, _ = alert_tester._apply_bullflow_filter(rows, cfg)
        except Exception as e:
            log.warning("[csv_preview] filter error for %s: %s", alert_name, e)
            continue
        by_alert_candidates[alert_name] = len(matched)
        for idx, r in enumerate(matched):
            alert_dict = _build_alert_from_csv_row(r, alert_name, date, idx)
            candidate_alerts.append(alert_dict)

    if not candidate_alerts:
        return JSONResponse({
            "ok": True,
            "date": date,
            "csv_rows": len(rows),
            "candidates_from_bullflow": 0,
            "would_forward": 0,
            "already_posted_dupes": 0,
            "net_new": 0,
            "by_alert": {},
            "forward_list": [],
            "elapsed_sec": round(time.time() - t0, 2),
            "note": "No Bullflow matches in CSV for any configured alert.",
        })

    # 4. Run full-pipeline replay. The function stamps _replayed* fields on
    # each alert dict. We import here to avoid a module-level circular import
    # (csv_ingest already imports alert_tester which may import worker).
    from api import liveflow_worker
    replayed = liveflow_worker.replay_alerts_through_full_pipeline(candidate_alerts)
    would_forward_alerts = [a for a in replayed if a.get("_replayedWouldForward") == 1]

    # 5. Dedupe against SQLite: find alerts already posted to Discord today.
    # Match by symbol (OCC string) + alertName since the same trade can fire
    # multiple alerts. We pull all today's forwarded rows once and lookup.
    posted_today_lookup: dict = {}
    try:
        all_today = live_alerts_db.query_alerts(
            date_from=date, date_to=date, limit=10000,
        )
        for row in all_today:
            if row.get("forwardedToDiscord"):
                # Key on (symbol, final_alert_name) to handle re-tagged matches
                key = (row.get("symbol"), (row.get("alertName") or "").strip())
                posted_today_lookup[key] = row.get("id")
    except Exception as e:
        log.warning("[csv_preview] could not query existing posted alerts: %s", e)

    # 6. Build forward_list with dedup flagging
    forward_list = []
    dupes_count = 0
    by_alert_summary: dict = {}
    for a in would_forward_alerts:
        final_name = a.get("_replayedFinalAlertName") or a.get("alertName")
        symbol = a.get("symbol")
        dupe_key = (symbol, final_name)
        dupe_id = posted_today_lookup.get(dupe_key)
        is_dupe = dupe_id is not None
        if is_dupe:
            dupes_count += 1
        forward_list.append({
            "ticker": a.get("ticker"),
            "cp": a.get("cp"),
            "strike": a.get("strike"),
            "exp": a.get("exp"),
            "dte": a.get("dte"),
            "premium": a.get("alertPremium"),
            "ingestedAt": a.get("ingestedAt"),
            "grade": a.get("_replayedGrade"),
            "score": a.get("_replayedConvictionScore"),
            "original_alert": a.get("alertName"),
            "final_alert": final_name,
            "is_duplicate": is_dupe,
            "duplicate_id": dupe_id,
        })
        # Per-alert summary keyed on FINAL name (what would post to Discord)
        summary = by_alert_summary.setdefault(final_name, {
            "would_forward": 0, "net_new": 0,
        })
        summary["would_forward"] += 1
        if not is_dupe:
            summary["net_new"] += 1

    # Sort forward_list by time for readability
    forward_list.sort(key=lambda x: x.get("ingestedAt") or "")

    return JSONResponse({
        "ok": True,
        "date": date,
        "csv_rows": len(rows),
        "candidates_from_bullflow": len(candidate_alerts),
        "would_forward": len(would_forward_alerts),
        "already_posted_dupes": dupes_count,
        "net_new": len(would_forward_alerts) - dupes_count,
        "by_alert_candidates": by_alert_candidates,
        "by_alert_summary": by_alert_summary,
        "forward_list": forward_list,
        "elapsed_sec": round(time.time() - t0, 2),
        "note": (
            "This is a PREVIEW only — no Discord posts made, no SQLite writes. "
            "Use this to decide if the replay-to-Discord step is worth running."
        ),
    })


@router.post("/replay-csv-to-discord")
async def replay_csv_to_discord(
    csv_file: UploadFile = File(..., description="Bullflow daily CSV export"),
    alert_configs: str = Form(..., description="JSON array of alert configs"),
    date: str = Form(..., description="Trade date YYYY-MM-DD"),
    confirm: str = Form(default="", description="Must equal YES_REPLAY_TO_DISCORD"),
    max_posts: int = Form(default=25, description="Hard cap on Discord posts; default 25"),
):
    """Diagnostic wrapper — surfaces exceptions as JSON instead of 500."""
    import traceback as _tb
    try:
        return await _replay_csv_to_discord_impl(
            csv_file, alert_configs, date, confirm, max_posts,
        )
    except Exception as e:
        return JSONResponse({
            "ok": False,
            "error": f"{type(e).__name__}: {str(e)[:500]}",
            "traceback": _tb.format_exc()[-2500:],
        })


async def _replay_csv_to_discord_impl(
    csv_file: UploadFile,
    alert_configs: str,
    date: str,
    confirm: str,
    max_posts: int,
):
    """
    EXECUTE the Discord replay. Posts qualifying alerts from the CSV to the
    configured Discord webhook. ALSO inserts each posted alert into SQLite
    with source='csv_replay_discord' and forwardedToDiscord=1 so re-running
    the endpoint skips them automatically.

    Workflow:
      1. Same preview pipeline as /replay-csv-preview
      2. Filter to (would_forward AND not is_duplicate)
      3. Hard-cap to max_posts (default 25)
      4. For each: insert SQLite row, post to Discord with REPLAY footer,
         update SQLite with discord_message_id + forwardedToDiscord=1
      5. Return summary

    Requires confirm=YES_REPLAY_TO_DISCORD to actually run. Without it,
    returns a preview-style payload (no posts, no inserts).

    Use case: catch-up push after a gate config change. The CSV represents
    the day's flow that the live worker either missed or filtered too
    strictly under prior gates. The new gates would push these — this
    endpoint executes that push.
    """
    import time
    t0 = time.time()

    # 1. Parse alert configs
    try:
        configs = json.loads(alert_configs)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid alert_configs JSON: {e}")
    if not isinstance(configs, list) or not configs:
        raise HTTPException(400, "alert_configs must be a non-empty JSON array")

    # 2. Parse CSV
    raw = await csv_file.read()
    rows, parse_errors = alert_tester._parse_csv(raw)
    if not rows:
        return JSONResponse({"ok": False, "error": "CSV had no parseable rows"})

    # 3. Build candidate alerts from Bullflow filter (same as preview)
    candidate_alerts: list = []
    for cfg in configs:
        if not isinstance(cfg, dict):
            continue
        alert_name = (cfg.get("alertName") or "").strip()
        if not alert_name or not alert_name.startswith("UCT "):
            continue
        try:
            matched, _ = alert_tester._apply_bullflow_filter(rows, cfg)
        except Exception as e:
            log.warning("[csv_replay] filter error for %s: %s", alert_name, e)
            continue
        for idx, r in enumerate(matched):
            alert_dict = _build_alert_from_csv_row(r, alert_name, date, idx)
            candidate_alerts.append(alert_dict)

    if not candidate_alerts:
        return JSONResponse({
            "ok": True, "date": date, "csv_rows": len(rows),
            "candidates_from_bullflow": 0, "would_forward": 0,
            "posted": 0, "elapsed_sec": round(time.time() - t0, 2),
            "note": "No Bullflow matches in CSV.",
        })

    # 4. Run full-pipeline replay
    from api import liveflow_worker
    replayed = liveflow_worker.replay_alerts_through_full_pipeline(candidate_alerts)
    would_forward_alerts = [a for a in replayed if a.get("_replayedWouldForward") == 1]

    # 5. Dedupe against SQLite forwarded rows
    posted_today_lookup: dict = {}
    try:
        all_today = live_alerts_db.query_alerts(date_from=date, date_to=date, limit=10000)
        for row in all_today:
            if row.get("forwardedToDiscord"):
                key = (row.get("symbol"), (row.get("alertName") or "").strip())
                posted_today_lookup[key] = row.get("id")
    except Exception as e:
        log.warning("[csv_replay] dedup query failed: %s", e)

    # Filter to NET NEW (not already posted) and sort by trade time so
    # subscribers see them in chronological order.
    net_new = []
    for a in would_forward_alerts:
        final_name = a.get("_replayedFinalAlertName") or a.get("alertName")
        dupe_key = (a.get("symbol"), final_name)
        if dupe_key not in posted_today_lookup:
            net_new.append(a)
    net_new.sort(key=lambda x: x.get("ingestedAt") or "")

    # 6. Confirm token check. Without it, return what WOULD happen and stop.
    if confirm != "YES_REPLAY_TO_DISCORD":
        return JSONResponse({
            "ok": False,
            "error": (
                "confirm=YES_REPLAY_TO_DISCORD required. This endpoint POSTS to "
                "Discord — destructive. Run without confirm to see this preview."
            ),
            "would_post_count": min(len(net_new), max_posts),
            "would_post_capped_at": max_posts,
            "net_new_total": len(net_new),
            "by_alert": _summarize_by_alert(net_new),
        })

    # 7. Hard cap at max_posts. Take earliest-first so subscribers see the
    # day chronologically rather than starting with the latest.
    to_post = net_new[:max_posts]

    # 8. Insert each to SQLite FIRST (so we have a record even if Discord
    # post fails). Then post to Discord. Then update with message_id.
    # Update source to distinguish from regular csv_ingest rows.
    for a in to_post:
        # Apply the replayed alert name to the SQLite row so history shows
        # the re-tagged "UCT Unusual Weeklies" instead of original Vol>OI etc.
        final_name = a.get("_replayedFinalAlertName") or a.get("alertName")
        a["alertName"] = final_name
        a["source"] = "csv_replay_discord"
        a["grade"] = a.get("_replayedGrade")  # set grade so history view shows it
        a["gatePassed"] = True
        try:
            live_alerts_db.insert_alert(a)
        except Exception as e:
            msg = str(e).lower()
            if not ("unique" in msg or "duplicate" in msg or "constraint" in msg):
                log.warning("[csv_replay] insert failed id=%s: %s", a.get("id"), e)

    # 9. Post to Discord
    post_result = await liveflow_worker.replay_post_alerts_to_discord(
        to_post, max_posts=max_posts, inter_post_delay_sec=1.0,
    )

    # 10. Update SQLite with forwarded flag + message IDs for the ones
    # that successfully posted.
    for result in post_result.get("results", []):
        if result.get("ok") and result.get("alert_id"):
            try:
                live_alerts_db.update_alert_state(
                    result["alert_id"],
                    forwarded_to_discord=1,
                    discord_message_id=result.get("message_id"),
                )
            except Exception as e:
                log.debug("[csv_replay] update_alert_state failed id=%s: %s",
                          result.get("alert_id"), e)

    return JSONResponse({
        "ok": True,
        "date": date,
        "csv_rows": len(rows),
        "candidates_from_bullflow": len(candidate_alerts),
        "would_forward": len(would_forward_alerts),
        "net_new": len(net_new),
        "posted": post_result["succeeded"],
        "failed": post_result["failed"],
        "rate_limited": post_result["rate_limited"],
        "capped_at": max_posts,
        "skipped_due_to_cap": max(0, len(net_new) - max_posts),
        "by_alert": _summarize_by_alert(to_post),
        "post_results": post_result.get("results", []),
        "elapsed_sec": round(time.time() - t0, 2),
    })


def _summarize_by_alert(alerts: list) -> dict:
    """Group alerts by final (post-retag) name and return {name: count}.
    Used for the replay/preview response 'by_alert' field."""
    out: dict = {}
    for a in alerts:
        name = a.get("_replayedFinalAlertName") or a.get("alertName") or "Unknown"
        out[name] = out.get(name, 0) + 1
    return out


@router.post("/clear-csv-ingest")
async def clear_csv_ingest(date: str = Form(...)):
    """
    Delete all csv_ingest rows for a given date so the CSV can be re-ingested
    cleanly (e.g. after changing alert configs in Bullflow MCP and wanting
    the SQLite to reflect the new filtering).

    Only deletes rows with source='csv_ingest' for the specified date.
    Bullflow MCP backfill rows (source='bullflow_replay') and live worker
    rows (source='live_sse') are NOT touched — those are real data.
    """
    if not date or len(date) != 10:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    try:
        deleted = live_alerts_db.delete_alerts_by_source_and_date(
            source="csv_ingest", date=date,
        )
        return {"ok": True, "deleted": deleted, "date": date}
    except AttributeError:
        # delete_alerts_by_source_and_date may not exist in live_alerts_db yet
        # — fall back to a raw SQL approach if needed. For now, just report.
        return {
            "ok": False,
            "error": (
                "live_alerts_db.delete_alerts_by_source_and_date not implemented. "
                "Re-ingest still works but duplicates will be silently skipped. "
                "To force-replace, manually delete rows where source='csv_ingest' "
                "AND date_iso='" + date + "'."
            ),
        }
