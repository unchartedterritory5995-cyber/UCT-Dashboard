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
