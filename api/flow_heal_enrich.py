"""
flow_heal_enrich.py — classification enrichment for T+1 healed flow.db days.

The T+1 auto-heal (flow_gap_autofill + massive_flatfiles_worker) restores ROWS
but the flat-file aggregator can't classify them: batch_process emits side=''
(no NBBO in the trades file) and OI resolves only for contracts present in
contract_oi_snapshots — so healed windows land ~0% sided / mostly OI=0 and are
invisible to every tier that gates on side or vol-exceeds-OI (alpha, size,
LEAPS, bullish/bearish). Health checks count rows, so the day reads green
while being inert.

This module completes the pipeline, in the order that matters (color is a
function of OI, so OI MUST land before the color rebuild):

  1. OI backfill    — dated OI from contract_oi_snapshots. Exact snap_date
                      (start-of-day OI for the trade day) preferred; falls back
                      to the nearest EARLIER snapshot within OI_MAX_STALE_DAYS.
                      Never a later snapshot (contaminated by the day's own
                      volume) and never a live Schwab call (point-in-time trap:
                      today's OI written onto a past day silently corrupts
                      V/OI, colors, and tiers).
  2. Color rebuild  — color_rebuild.run_color_rebuild (WHITE-only upgrades),
                      now with real OI to exceed.
  3. Side patches   — Phase-2i tick test against the raw tape (in-process port
                      of build_patches.py) applied via
                      backfill_from_patches.run_patches_backfill. Side-only in
                      effect: patches carry color=WHITE / oi=0 by design.
  4. Parity check   — sided-% and OI>0-% of the backfilled cohort vs the day's
                      live-captured baseline. A heal that diverges sharply is
                      reported INCOMPLETE instead of silently green.

Known drift (harmless today): the tick test aggregates at AGG_WINDOW_NS=100ms
while the fill pipeline (massive_processor.batch_process) uses 500ms, so patch
keys and inserted rows derive first_ts from different event boundaries. The
60s matching window in run_patches_backfill absorbs it — know this before
tightening that window.

Gate: FLOW_HEAL_ENRICH_ENABLED (default 1 — the whole point is that tomorrow's
heal classifies without an env edit). Manual trigger:
POST /api/flow-gap-fill/enrich?target_date=YYYY-MM-DD (PUSH_SECRET).
"""
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
ENABLED = os.environ.get("FLOW_HEAL_ENRICH_ENABLED", "1").lower() in ("1", "true", "yes")

# How many calendar days back an OI snapshot may be and still be used for a
# trade day with no exact-date snapshot. OI moves slowly day-over-day; a
# ≤7d-old (pre-trade-day) value is meaningfully accurate for exceedance
# classification, and 7 covers a long weekend + a failed snapshot morning.
OI_MAX_STALE_DAYS = int(os.environ.get("FLOW_HEAL_OI_MAX_STALE_DAYS", "7"))

# ── Tick-test constants — KEEP IN SYNC with build_patches.py (the offline
# original) and massive_processor's condition-code sets. ──────────────────
CANCEL = {201, 203, 205, 207}
MULTI_LEG = set(range(232, 248))
SWEEP_CODES = {219}
BLOCK_CODES = {227, 228, 229, 230, 231}
AGG_WINDOW_NS = 100_000_000     # 100ms — build_patches boundary (NOT the fill's 500ms)
MIN_PREMIUM = 10_000

# Last enrich result, for /api/flow-gap-fill/status visibility.
_LAST = {"result": None}
_LOCK = threading.Lock()

# One enrich at a time. Concurrent runs collide on flow.db's single writer —
# the first holds the write lock through its giant UPDATE transaction and every
# later run "completes" in ~2min with database-is-locked on all three steps
# (observed live on the 7/14 re-heal: two duplicate triggers produced two
# bogus 'incomplete' results while the real run kept grinding).
_RUN_LOCK = threading.Lock()


def last_result():
    with _LOCK:
        return _LAST["result"]


def _mdy(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def _mdy_to_date(mdy: str):
    try:
        m, dd, y = mdy.strip().split("/")
        return date(int(y), int(m), int(dd))
    except (ValueError, AttributeError):
        return None


# ── Patches: in-process port of build_patches.py ─────────────────────────

def _parse_opra_ticker(ticker):
    """O:AAPL260717C00200000 -> (root, expiry_date, 'CALL'/'PUT', strike)."""
    s = ticker[2:] if ticker.startswith("O:") else ticker
    if len(s) < 15:
        return None
    suffix = s[-15:]
    root = s[:-15]
    try:
        yy = int(suffix[0:2])
        mm = int(suffix[2:4])
        dd = int(suffix[4:6])
        cp = "CALL" if suffix[6] == "C" else "PUT"
        strike_int = int(suffix[7:])
        return root, date(2000 + yy, mm, dd), cp, strike_int / 1000.0
    except (ValueError, IndexError):
        return None


def _fmt_time_ns(ts_ns: int) -> str:
    """ns epoch -> 'H:MM:SS AM/PM' ET, matching massive_processor._fmt_time
    (real America/New_York, not a hardcoded UTC-4)."""
    dt = datetime.fromtimestamp(ts_ns / 1e9, tz=ET)
    h = dt.hour % 12 or 12
    ampm = "PM" if dt.hour >= 12 else "AM"
    return f"{h}:{dt.minute:02d}:{dt.second:02d} {ampm}"


def _fmt_strike(s: float) -> str:
    if s == int(s):
        return str(int(s))
    return "%g" % s


def _tick_test_contract(ticker, ts_arr, px_arr, sz_arr, cd_arr, patches, stats):
    """One contract's prints (time-sorted, cancels already dropped): aggregate
    at AGG_WINDOW_NS and classify each event's side via the Phase-2i tick test
    (compare event avg price to the last raw print BEFORE the event; on a flat
    tick, walk back up to 20 prints for the last direction). Emits sided,
    non-multi-leg events into `patches` keyed contract|time."""
    parsed = _parse_opra_ticker(ticker)
    if parsed is None:
        return
    root, exp, cp, strike = parsed

    nseg = len(ts_arr)
    k = 0
    while k < nseg:
        m = k
        first_ts = ts_arr[k]
        while m + 1 < nseg and ts_arr[m + 1] - first_ts <= AGG_WINDOW_NS:
            m += 1
        sizes = sz_arr[k:m + 1]
        prices = px_arr[k:m + 1]
        codes = cd_arr[k:m + 1]
        total_size = int(sizes.sum())
        if total_size <= 0:
            k = m + 1
            continue
        avg_price = float((prices * sizes).sum() / total_size)
        premium = avg_price * total_size * 100
        if premium < MIN_PREMIUM:
            k = m + 1
            continue
        code_set = set(int(c) for c in codes)
        if code_set & MULTI_LEG:
            typ = "ML/"
        elif code_set & SWEEP_CODES:
            typ = "SWEEP"
        elif code_set & BLOCK_CODES:
            typ = "BLOCK"
        else:
            typ = ""
        side = ""
        if k > 0:
            last_px = float(px_arr[k - 1])
            if last_px > 0:
                diff_pct = (avg_price - last_px) / last_px * 100
                if diff_pct > 5:
                    side = "AA"
                elif diff_pct > 0.5:
                    side = "A"
                elif diff_pct < -5:
                    side = "BB"
                elif diff_pct < -0.5:
                    side = "B"
                else:
                    for bi in range(k - 2, max(k - 22, -1), -1):
                        prev = float(px_arr[bi])
                        if abs(prev - last_px) > 0.001:
                            side = "A" if last_px > prev else "B"
                            break
        stats["events"] += 1
        if side and typ != "ML/":
            stats["sided"] += 1
            key = (f"{root}|{cp}|{_fmt_strike(strike)}|"
                   f"{exp.month}/{exp.day}/{exp.year}|{_fmt_time_ns(int(first_ts))}")
            # Side-only patch by design: color=WHITE / oi=0 make the applier's
            # color-upgrade and OI branches no-ops (this step must not fight
            # the snapshot-sourced OI written in step 1).
            patches[key] = {"side": side, "color": "WHITE", "oi": 0}
        k = m + 1


def build_patches_for_tape(gz_path: str) -> tuple:
    """Stream the raw OPRA trades .csv.gz and build the Side patches dict.
    Returns (patches, stats). Memory-bounded: one contract buffered at a time
    (the flat file is contract-grouped and time-sorted within contract)."""
    import numpy as np
    import pandas as pd

    patches = {}
    stats = {"rows": 0, "events": 0, "sided": 0}
    cur_ticker = None
    buf_ts, buf_px, buf_sz, buf_cd = [], [], [], []

    def _flush():
        if cur_ticker is not None and buf_ts:
            _tick_test_contract(
                cur_ticker,
                np.array(buf_ts, dtype=np.int64),
                np.array(buf_px, dtype=np.float64),
                np.array(buf_sz, dtype=np.int64),
                np.array(buf_cd, dtype=np.int32),
                patches, stats)

    for chunk in pd.read_csv(
            gz_path, compression="gzip", chunksize=500_000,
            dtype={"ticker": str, "price": "float64",
                   "sip_timestamp": "int64", "size": "int64"}):
        stats["rows"] += len(chunk)
        chunk = chunk.dropna(subset=["conditions"])
        if len(chunk) == 0:
            continue
        chunk["conditions"] = chunk["conditions"].astype("int32")
        chunk = chunk[~chunk["conditions"].isin(CANCEL)]
        if len(chunk) == 0:
            continue

        tk = chunk["ticker"].to_numpy()
        ts = chunk["sip_timestamp"].to_numpy()
        px = chunk["price"].to_numpy()
        sz = chunk["size"].to_numpy()
        cd = chunk["conditions"].to_numpy()

        n = len(tk)
        i = 0
        while i < n:
            t = tk[i]
            j = i
            while j + 1 < n and tk[j + 1] == t:
                j += 1
            if cur_ticker is None:
                cur_ticker = t
            if t != cur_ticker:
                _flush()
                buf_ts, buf_px, buf_sz, buf_cd = [], [], [], []
                cur_ticker = t
            buf_ts.extend(ts[i:j + 1].tolist())
            buf_px.extend(px[i:j + 1].tolist())
            buf_sz.extend(sz[i:j + 1].tolist())
            buf_cd.extend(cd[i:j + 1].tolist())
            i = j + 1

    _flush()
    stats["patches"] = len(patches)
    return patches, stats


# ── Step 1: dated OI backfill from contract_oi_snapshots ─────────────────

def run_oi_backfill(target_mdy: str, max_stale_days: int = None) -> dict:
    """Fill empty-OI flow rows for target_mdy from contract_oi_snapshots.

    Snapshot selection per contract: the LATEST snap_date <= target date
    (5:30 AM snapshot on day T = start-of-day-T OI — the correct dated value
    for day-T trades), bounded to >= target - max_stale_days. Later snapshots
    are never used (they include the day's own volume). Reuses the tested
    strike/exp candidate matcher (_backfill_flow_oi)."""
    if max_stale_days is None:
        max_stale_days = OI_MAX_STALE_DAYS
    target_d = _mdy_to_date(target_mdy)
    if target_d is None:
        return {"error": f"bad target_date {target_mdy!r}"}
    target_iso = target_d.isoformat()
    floor_iso = (target_d - timedelta(days=max_stale_days)).isoformat()

    stats = {"target_date": target_mdy, "max_stale_days": max_stale_days,
             "symbols_with_empty_oi": 0, "snapshot_contracts_matched": 0,
             "exact_date_contracts": 0, "stale_contracts": 0,
             "rows_updated": 0, "snapshot_rows_on_date": 0}

    # _backfill_flow_oi issues one UPDATE per (contract × strike/exp candidate)
    # keyed on Symbol+CreatedDate — without this index each UPDATE full-scans a
    # multi-GB flow table and a big heal day grinds for HOURS (observed live on
    # the 7/14 re-heal: thread parked in oi_snapshot_router.py:459). One-time
    # build costs a couple of minutes; IF NOT EXISTS makes it a no-op after.
    with sqlite3.connect(DB_PATH, timeout=60) as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_symbol_created "
                     "ON flow(Symbol, CreatedDate)")
        conn.commit()

    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        sym_rows = conn.execute(
            "SELECT DISTINCT Symbol FROM flow "
            "WHERE CreatedDate = ? AND (OI = '0' OR OI = '' OR OI IS NULL)",
            (target_mdy,)).fetchall()
        symbols = {r[0] for r in sym_rows if r[0]}
        stats["symbols_with_empty_oi"] = len(symbols)
        if not symbols:
            return stats

        stats["snapshot_rows_on_date"] = conn.execute(
            "SELECT COUNT(*) FROM contract_oi_snapshots WHERE snap_date = ?",
            (target_iso,)).fetchone()[0]

        snap_by_key = {}
        cur = conn.execute(
            "SELECT contract_key, snap_date, oi FROM contract_oi_snapshots "
            "WHERE snap_date <= ? AND snap_date >= ?",
            (target_iso, floor_iso))
        for ck, sd, oi_val in cur:
            try:
                oi_val = int(oi_val or 0)
            except (ValueError, TypeError):
                continue
            if oi_val <= 0:
                continue
            if ck.split("|", 1)[0] not in symbols:
                continue
            prev = snap_by_key.get(ck)
            if prev is None or sd > prev[0]:
                snap_by_key[ck] = (sd, oi_val)

    if not snap_by_key:
        return stats

    stats["snapshot_contracts_matched"] = len(snap_by_key)
    stats["exact_date_contracts"] = sum(
        1 for sd, _ in snap_by_key.values() if sd == target_iso)
    stats["stale_contracts"] = (
        stats["snapshot_contracts_matched"] - stats["exact_date_contracts"])

    stats["rows_updated"] = _apply_oi_setbased(snap_by_key, target_mdy)
    return stats


def _apply_oi_setbased(snap_by_key: dict, target_mdy: str) -> int:
    """Write resolved OI onto empty-OI flow rows in ONE statement.

    The router's _backfill_flow_oi issues one UPDATE per contract × strike/exp
    string variant — ~3M statements for a 142k-contract heal day, which ground
    for hours even indexed (observed live, 7/14 re-heal). Instead: explode the
    same candidate variants into an indexed TEMP table and let a single
    UPDATE ... WHERE EXISTS sweep the day once."""
    rows = []
    for ck, (_sd, oi) in snap_by_key.items():
        try:
            sym, cp_letter, strike_s, exp = ck.split("|", 3)
            strike = float(strike_s)
        except (ValueError, AttributeError):
            continue
        cp = "CALL" if cp_letter == "C" else "PUT"
        strikes = {str(strike), "%g" % strike, f"{strike:.1f}", f"{strike:.2f}"}
        if strike == int(strike):
            strikes.add(str(int(strike)))
            strikes.add(f"{int(strike)}.0")
        exps = {exp}
        try:
            m, d, y = exp.split("/")
            exps.add(f"{int(m):02d}/{int(d):02d}/{y}")
            exps.add(f"{int(m)}/{int(d)}/{y}")
            exps.add(f"{y}-{int(m):02d}-{int(d):02d}")
        except ValueError:
            pass
        for s in strikes:
            for e in exps:
                rows.append((sym, cp, s, e, int(oi)))

    with sqlite3.connect(DB_PATH, timeout=60) as conn:
        conn.execute("DROP TABLE IF EXISTS temp._heal_oi")
        conn.execute(
            "CREATE TEMP TABLE _heal_oi ("
            "sym TEXT, cp TEXT, strike TEXT, exp TEXT, oi INTEGER, "
            "PRIMARY KEY (sym, cp, strike, exp)) WITHOUT ROWID")
        conn.executemany(
            "INSERT OR IGNORE INTO _heal_oi VALUES (?,?,?,?,?)", rows)
        cur = conn.execute(
            "UPDATE flow SET OI = CAST((SELECT t.oi FROM _heal_oi t "
            "  WHERE t.sym = flow.Symbol AND t.cp = flow.CallPut "
            "    AND t.strike = flow.Strike AND t.exp = flow.ExpirationDate) AS TEXT) "
            "WHERE CreatedDate = ? AND (OI = '0' OR OI = '' OR OI IS NULL) "
            "  AND EXISTS (SELECT 1 FROM _heal_oi t "
            "  WHERE t.sym = flow.Symbol AND t.cp = flow.CallPut "
            "    AND t.strike = flow.Strike AND t.exp = flow.ExpirationDate)",
            (target_mdy,))
        updated = cur.rowcount
        conn.commit()
    return updated


# ── Step 4: classification parity (the honesty check) ────────────────────

# When a full-session heal leaves no live-captured baseline, judge against
# these floors (live norms run ~46% sided / ~84% OI>0 — spec §1).
_DEFAULT_BASELINE = {"sided_pct": 40.0, "oi_pos_pct": 70.0}
_MIN_LIVE_BASELINE_ROWS = 500
_PARITY_RATIO = 0.5   # backfilled must reach half the baseline to count as complete


def classification_parity(target_mdy: str) -> dict:
    """Compare the backfilled cohort (created_at date > trade date) against the
    live-captured cohort on sided-% and OI>0-%. Row presence is NOT heal
    success — this is what /worker-history was blind to."""
    target_d = _mdy_to_date(target_mdy)
    if target_d is None:
        return {"error": f"bad target_date {target_mdy!r}"}
    target_iso = target_d.isoformat()

    live = {"rows": 0, "sided": 0, "oi_pos": 0, "magenta": 0, "yellow": 0}
    backfilled = {"rows": 0, "sided": 0, "oi_pos": 0, "magenta": 0, "yellow": 0}
    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        cur = conn.execute(
            "SELECT Side, OI, Color, substr(created_at, 1, 10) FROM flow "
            "WHERE CreatedDate = ? AND source = 'stocks'", (target_mdy,))
        for side, oi, color, created in cur:
            cohort = backfilled if (created or "") > target_iso else live
            cohort["rows"] += 1
            if (side or "") in ("A", "AA", "B", "BB"):
                cohort["sided"] += 1
            try:
                if int(float(oi or 0)) > 0:
                    cohort["oi_pos"] += 1
            except (ValueError, TypeError):
                pass
            if color == "MAGENTA":
                cohort["magenta"] += 1
            elif color == "YELLOW":
                cohort["yellow"] += 1

    def _pcts(c):
        n = c["rows"]
        return {
            "rows": n,
            "sided_pct": round(100.0 * c["sided"] / n, 1) if n else None,
            "oi_pos_pct": round(100.0 * c["oi_pos"] / n, 1) if n else None,
            "magenta_pct": round(100.0 * c["magenta"] / n, 1) if n else None,
            "yellow_pct": round(100.0 * c["yellow"] / n, 1) if n else None,
        }

    out = {"target_date": target_mdy,
           "live": _pcts(live), "backfilled": _pcts(backfilled)}

    if backfilled["rows"] == 0:
        out["heal_complete"] = True
        out["note"] = "no backfilled rows on this date"
        return out

    if live["rows"] >= _MIN_LIVE_BASELINE_ROWS:
        baseline = {"sided_pct": out["live"]["sided_pct"],
                    "oi_pos_pct": out["live"]["oi_pos_pct"],
                    "source": "live-captured"}
    else:
        baseline = dict(_DEFAULT_BASELINE, source="default (full-session heal)")
    out["baseline"] = baseline

    bf = out["backfilled"]
    out["heal_complete"] = (
        (bf["sided_pct"] or 0) >= _PARITY_RATIO * (baseline["sided_pct"] or 0)
        and (bf["oi_pos_pct"] or 0) >= _PARITY_RATIO * (baseline["oi_pos_pct"] or 0))
    if not out["heal_complete"]:
        out["note"] = ("backfilled classification diverges sharply from "
                       "baseline — healed rows are partially inert for "
                       "side/V-OI gated tiers")
    return out


# ── Orchestrator ──────────────────────────────────────────────────────────

def enrich_day(target: date, gz_path: str = None, *, force: bool = False) -> dict:
    """Run the full classification pipeline for one healed day. Never raises;
    each step is isolated so one failure doesn't void the others. Order is
    load-bearing: OI BEFORE color (color is a function of OI), Side last."""
    started = time.time()
    mdy = _mdy(target)
    out = {"status": "running", "target_date": mdy, "steps": {}}
    if not ENABLED and not force:
        out["status"] = "disabled"
        return out
    if not _RUN_LOCK.acquire(blocking=False):
        out["status"] = "already_running"
        return out
    try:
        return _enrich_day_locked(target, gz_path, mdy, out, started)
    finally:
        _RUN_LOCK.release()


def _enrich_day_locked(target: date, gz_path: str, mdy: str, out: dict,
                       started: float) -> dict:

    # 1. OI first — rebuild-color with OI=0 bakes in wrong colors (spec §2).
    try:
        out["steps"]["oi_backfill"] = run_oi_backfill(mdy)
    except Exception as e:
        logger.exception("[heal-enrich] OI backfill failed for %s", mdy)
        out["steps"]["oi_backfill"] = {"error": str(e)[:300]}

    # 2. Color, now that OI can be exceeded. WHITE-only upgrades, idempotent.
    try:
        from api.color_rebuild import run_color_rebuild
        cstats = run_color_rebuild(mdy)
        out["steps"]["rebuild_color"] = {
            k: cstats.get(k) for k in (
                "rows_scanned", "contracts_evaluated",
                "rows_upgraded_to_magenta", "rows_upgraded_to_yellow",
                "contracts_no_oi")}
    except Exception as e:
        logger.exception("[heal-enrich] color rebuild failed for %s", mdy)
        out["steps"]["rebuild_color"] = {"error": str(e)[:300]}

    # 3. Side via tick-test patches. Needs the raw tape; reuse the fill's
    #    download when provided, else fetch our own copy.
    own_tape = None
    try:
        if not gz_path or not os.path.exists(gz_path):
            from api.massive_flatfiles_worker import _download
            gz = _download(target)
            if gz is not None:
                own_tape = os.path.join(
                    os.path.dirname(DB_PATH) or "/tmp",
                    f"heal-tape-{target.isoformat()}.csv.gz")
                with open(own_tape, "wb") as f:
                    f.write(gz)
                del gz
                gz_path = own_tape
            else:
                gz_path = None

        if gz_path:
            patches, pstats = build_patches_for_tape(gz_path)
            patches_path = os.path.join(
                os.path.dirname(DB_PATH) or "/tmp",
                f"heal-patches-{target.isoformat()}.json")
            with open(patches_path, "w") as f:
                json.dump(patches, f)
            try:
                from api.backfill_from_patches import run_patches_backfill
                apply_stats = run_patches_backfill(patches_path, mdy)
            finally:
                try:
                    os.remove(patches_path)
                except OSError:
                    pass
            out["steps"]["side_patches"] = {
                "tape_rows": pstats.get("rows"),
                "events": pstats.get("events"),
                "patches_built": pstats.get("patches"),
                "side_updated": apply_stats.get("side_updated"),
                "oi_updated": apply_stats.get("oi_updated"),
                "unmatched_patches": apply_stats.get("unmatched_patches"),
            }
        else:
            out["steps"]["side_patches"] = {
                "skipped": "raw tape unavailable (not published yet?)"}
    except Exception as e:
        logger.exception("[heal-enrich] side patches failed for %s", mdy)
        out["steps"]["side_patches"] = {"error": str(e)[:300]}
    finally:
        if own_tape:
            try:
                os.remove(own_tape)
            except OSError:
                pass

    # 4. Honesty check.
    try:
        out["parity"] = classification_parity(mdy)
        out["status"] = ("completed" if out["parity"].get("heal_complete")
                         else "incomplete")
    except Exception as e:
        logger.exception("[heal-enrich] parity check failed for %s", mdy)
        out["parity"] = {"error": str(e)[:300]}
        out["status"] = "completed_unverified"

    out["duration_sec"] = round(time.time() - started, 1)
    with _LOCK:
        _LAST["result"] = out
    logger.info("[heal-enrich] %s: %s", mdy, out["status"])
    return out


def summary_line(res: dict) -> str:
    """One Discord-ready line summarizing an enrich_day result."""
    if not res:
        return "enrich: no result"
    mdy = res.get("target_date", "?")
    steps = res.get("steps", {})
    oi = steps.get("oi_backfill", {})
    col = steps.get("rebuild_color", {})
    sd = steps.get("side_patches", {})
    parity = res.get("parity", {})
    bf = parity.get("backfilled", {}) if isinstance(parity, dict) else {}
    base = parity.get("baseline", {}) if isinstance(parity, dict) else {}
    bits = [f"\U0001F9EC ENRICH {mdy} [{res.get('status')}]"]
    if "error" in oi:
        bits.append(f"OI: ERR {oi['error'][:80]}")
    else:
        bits.append(f"OI +{oi.get('rows_updated', 0)} rows "
                    f"({oi.get('exact_date_contracts', 0)} exact / "
                    f"{oi.get('stale_contracts', 0)} stale≤{oi.get('max_stale_days')}d snaps)")
    if "error" in col:
        bits.append(f"color: ERR {col['error'][:80]}")
    else:
        bits.append(f"color +{col.get('rows_upgraded_to_magenta', 0)}M/"
                    f"+{col.get('rows_upgraded_to_yellow', 0)}Y")
    if "error" in sd:
        bits.append(f"side: ERR {sd['error'][:80]}")
    elif "skipped" in sd:
        bits.append(f"side: skipped ({sd['skipped']})")
    else:
        bits.append(f"side +{sd.get('side_updated', 0)}")
    if isinstance(parity, dict) and bf.get("rows"):
        mark = "✅" if parity.get("heal_complete") else "\U0001F6A8 INCOMPLETE"
        bits.append(
            f"backfilled {bf['rows']} rows: sided {bf.get('sided_pct')}% / "
            f"OI>0 {bf.get('oi_pos_pct')}% vs baseline "
            f"{base.get('sided_pct')}%/{base.get('oi_pos_pct')}% {mark}")
    return " · ".join(bits)
