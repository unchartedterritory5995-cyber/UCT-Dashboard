"""
flow_tape_spool.py — raw OPRA tape spool + autonomous intraday gap replay.

THE PROBLEM (7/16, owner directive: gaps are priority #1 until systematic):
when the consumer's write pipeline freezes, the WebSocket usually KEEPS
RECEIVING — the prints of a 6-minute freeze were delivered to this process
and then lost with it. Massive OPRA has no intraday replay, so every such
window was a permanent hole until the T+1 flat file (~13,872 prints across 8
gaps on 7/16 alone). Deploy-swap gaps (socket down) are the one class this
cannot capture — those need Massive's 2nd concurrent connection.

THE FIX, two dumb halves:
  1. SPOOL — the consumer's receive loop hands every raw WS frame to
     spool_frame(): a bounded deque drained by a daemon thread into hourly
     files under <flow.db dir>/tape_spool/. The hot loop only ever does an
     append to a deque; the writer can die, lag, or drop (counted) without
     ever back-pressuring the tape. Current hour = plain JSONL (readable
     mid-write); rotated hours gzip; pruned after ~26h (T+1 flat file owns
     history beyond that).
  2. REPLAY — on consumer start (watchdog restart, deploy, crash), a daemon
     thread waits for boot to settle, asks flow_gap_autofill.detect_windows
     for TODAY's gap windows, rebuilds each window's events from the spool
     through the SAME pipeline as the T+1 heal (massive_processor.batch_process
     → snapshot OI + cached ticker meta → event_to_bbs_row → FlowDB.insert_csv,
     dedup_key makes overlap harmless) + Side via the flow_heal_enrich tick
     test + a color rebuild. A freeze becomes minutes of lag, zero loss, no
     human in the loop.

Gates: FLOW_TAPE_SPOOL_ENABLED (default 1), FLOW_TAPE_REPLAY_ENABLED
(default 1). Manual trigger: POST /api/flow-gap-fill/replay-spool.
"""
import gzip
import json
import logging
import os
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
SPOOL_DIR = os.environ.get(
    "FLOW_TAPE_SPOOL_DIR",
    os.path.join(os.path.dirname(DB_PATH) or "/data", "tape_spool"))
ENABLED = os.environ.get("FLOW_TAPE_SPOOL_ENABLED", "1").lower() in ("1", "true", "yes")
REPLAY_ENABLED = os.environ.get("FLOW_TAPE_REPLAY_ENABLED", "1").lower() in ("1", "true", "yes")
RETENTION_HOURS = int(os.environ.get("FLOW_TAPE_SPOOL_RETENTION_HOURS", "26"))
REPLAY_BOOT_DELAY_SEC = float(os.environ.get("FLOW_TAPE_REPLAY_BOOT_DELAY_SEC", "90"))
EDGE_SEC = 60                     # replay margin around each gap window
_QUEUE_MAX = 50_000               # ~1-2 min of extreme-volume frames

_q: deque = deque(maxlen=_QUEUE_MAX)
_stats = {"frames_spooled": 0, "frames_dropped": 0, "writer_errors": 0,
          "last_replay": None}
_writer_started = False
_start_lock = threading.Lock()
_REPLAY_LOCK = threading.Lock()


# ── Spool writer ──────────────────────────────────────────────────────────

def spool_frame(msg) -> None:
    """Called from the consumer's receive loop with the raw WS frame.
    MUST stay O(1) and exception-free — the tape is behind this call."""
    if not ENABLED:
        return
    try:
        if len(_q) == _q.maxlen:
            _stats["frames_dropped"] += 1
        _q.append(msg if isinstance(msg, str) else msg.decode("utf-8", "replace"))
    except Exception:
        _stats["frames_dropped"] += 1


def _hour_path(dt_utc: datetime) -> str:
    return os.path.join(SPOOL_DIR, f"tape-{dt_utc.strftime('%Y%m%d-%H')}.jsonl")


def _writer_loop() -> None:
    os.makedirs(SPOOL_DIR, exist_ok=True)
    cur_path, cur_f = None, None
    while True:
        try:
            time.sleep(2.0)
            if not _q:
                continue
            path = _hour_path(datetime.utcnow())
            if path != cur_path:
                if cur_f:
                    cur_f.close()
                    _rotate_and_prune(cur_path)
                cur_f = open(path, "a", encoding="utf-8")
                cur_path = path
            n = len(_q)
            for _ in range(n):
                try:
                    cur_f.write(_q.popleft().rstrip("\n") + "\n")
                except IndexError:
                    break
            cur_f.flush()
            _stats["frames_spooled"] += n
        except Exception as e:
            _stats["writer_errors"] += 1
            logger.warning("[tape-spool] writer error (non-fatal): %s", e)
            try:
                if cur_f:
                    cur_f.close()
            except Exception:
                pass
            cur_path, cur_f = None, None
            time.sleep(5)


def _rotate_and_prune(closed_path: str) -> None:
    """gzip the just-closed hour; drop spool files older than RETENTION_HOURS."""
    try:
        if closed_path and os.path.exists(closed_path):
            with open(closed_path, "rb") as src, gzip.open(closed_path + ".gz", "wb") as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)
            os.remove(closed_path)
    except Exception as e:
        logger.warning("[tape-spool] rotate failed (kept plain): %s", e)
    try:
        cutoff = time.time() - RETENTION_HOURS * 3600
        for f in os.listdir(SPOOL_DIR):
            p = os.path.join(SPOOL_DIR, f)
            if f.startswith("tape-") and os.path.getmtime(p) < cutoff:
                os.remove(p)
    except Exception:
        pass


def start_writer() -> bool:
    global _writer_started
    if not ENABLED:
        return False
    with _start_lock:
        if _writer_started:
            return False
        threading.Thread(target=_writer_loop, daemon=True,
                         name="flow-tape-spool-writer").start()
        _writer_started = True
    logger.info("[tape-spool] writer started (dir=%s retention=%dh)",
                SPOOL_DIR, RETENTION_HOURS)
    return True


def get_stats() -> dict:
    return dict(_stats, queue_len=len(_q), enabled=ENABLED,
                replay_enabled=REPLAY_ENABLED, spool_dir=SPOOL_DIR)


# ── Replay ────────────────────────────────────────────────────────────────

def _iter_spool_lines(t0_ns: int, t1_ns: int):
    """Yield raw frame strings whose file hour could overlap [t0, t1]."""
    if not os.path.isdir(SPOOL_DIR):
        return
    h0 = datetime.utcfromtimestamp(t0_ns / 1e9).strftime("%Y%m%d-%H")
    h1 = datetime.utcfromtimestamp(t1_ns / 1e9).strftime("%Y%m%d-%H")
    for f in sorted(os.listdir(SPOOL_DIR)):
        if not f.startswith("tape-"):
            continue
        hour = f[5:16]                      # YYYYMMDD-HH
        if not (h0 <= hour <= h1):
            continue
        p = os.path.join(SPOOL_DIR, f)
        try:
            if f.endswith(".gz"):
                fh = gzip.open(p, "rt", encoding="utf-8", errors="replace")
            else:
                fh = open(p, "r", encoding="utf-8", errors="replace")
            with fh:
                try:
                    for line in fh:
                        yield line
                except EOFError:
                    pass                    # truncated tail of a live/crashed file
        except Exception as e:
            logger.warning("[tape-spool] read %s failed: %s", f, e)


def _frames_to_trades(t0_ns: int, t1_ns: int) -> list:
    """[(ticker, price, size, exchange, condition, sip_ns), ...] in window.
    Mirrors the live consumer's T-frame field mapping (incl. conds[0])."""
    out = []
    for line in _iter_spool_lines(t0_ns, t1_ns):
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, list):
            payload = [payload]
        for evt in payload:
            if evt.get("ev") != "T":
                continue
            try:
                ts_ns = int(evt["t"]) * 1_000_000
                if not (t0_ns <= ts_ns <= t1_ns):
                    continue
                conds = evt.get("c") or []
                out.append((evt["sym"], float(evt["p"]), int(evt["s"]),
                            int(evt.get("x", 0)),
                            int(conds[0]) if conds else -1, ts_ns))
            except (KeyError, ValueError, TypeError):
                continue
    return out


def _replay_window(target: date, gap_start_min: int, gap_end_min: int) -> dict:
    """Rebuild one gap window from the spool through the T+1-heal pipeline."""
    import pandas as pd
    from api.massive_processor import batch_process, event_to_bbs_row, is_index_source
    from api.massive_flatfiles_worker import _load_oi_for_events, MIN_PREMIUM, MIN_VOLUME
    from api.massive_ws_worker import _load_ticker_metadata
    from api.flow_db import FlowDB, COLUMNS

    day_et = datetime(target.year, target.month, target.day, tzinfo=ET)
    t0_ns = int((day_et + timedelta(minutes=gap_start_min, seconds=-EDGE_SEC)).timestamp() * 1e9)
    t1_ns = int((day_et + timedelta(minutes=gap_end_min, seconds=EDGE_SEC)).timestamp() * 1e9)

    trades = _frames_to_trades(t0_ns, t1_ns)
    if not trades:
        return {"window": (gap_start_min, gap_end_min), "spool_trades": 0,
                "inserted": 0, "skipped": 0}

    df = pd.DataFrame(trades, columns=["ticker", "price", "size", "exchange",
                                       "conditions", "sip_timestamp"])
    df = df.sort_values("sip_timestamp", kind="stable").reset_index(drop=True)
    events, _ = batch_process(df, min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)

    stocks = [e for e in events if not is_index_source(e.root)]
    indexes = [e for e in events if is_index_source(e.root)]
    db = FlowDB()
    meta = _load_ticker_metadata(list({e.root for e in events}))
    snap_iso = target.isoformat()
    oi_s = _load_oi_for_events(db.db_path, stocks, snap_iso)
    oi_i = _load_oi_for_events(db.db_path, indexes, snap_iso)

    header = ",".join(COLUMNS) + "\n"
    inserted = skipped = 0
    for evts, source, oi_map in ((stocks, "stocks", oi_s), (indexes, "indexes", oi_i)):
        if not evts:
            continue
        buf = [header]
        for i, ev in enumerate(evts):
            m = meta.get(ev.root, {})
            row = event_to_bbs_row(ev, source=source, mktcap=m.get("mktcap", 0),
                                   sector=m.get("sector", ""), oi=oi_map.get(i, 0))
            buf.append(",".join(str(row.get(c, "")) for c in COLUMNS) + "\n")
        res = db.insert_csv("".join(buf), source=source)
        inserted += res.get("inserted", 0)
        skipped += res.get("skipped", 0)

    # Side for the replayed span: tick-test over the window's raw prints.
    side_updated = 0
    try:
        from api import flow_heal_enrich as fhe
        import numpy as np
        patches, pstats = {}, {"events": 0, "sided": 0}
        dfc = df[~df["conditions"].isin(list(fhe.CANCEL))]
        for tk, g in dfc.groupby("ticker", sort=False):
            g = g.sort_values("sip_timestamp", kind="stable")
            fhe._tick_test_contract(
                tk,
                g["sip_timestamp"].to_numpy(dtype=np.int64),
                g["price"].to_numpy(dtype=np.float64),
                g["size"].to_numpy(dtype=np.int64),
                g["conditions"].to_numpy(dtype=np.int32),
                patches, pstats)
        if patches:
            import tempfile
            from api.backfill_from_patches import run_patches_backfill
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                             dir=os.path.dirname(DB_PATH) or None) as f:
                json.dump(patches, f)
                ppath = f.name
            try:
                mdy = f"{target.month}/{target.day}/{target.year}"
                side_updated = run_patches_backfill(ppath, mdy).get("side_updated", 0)
            finally:
                try:
                    os.remove(ppath)
                except OSError:
                    pass
    except Exception as e:
        logger.warning("[tape-spool] side patches failed (rows stand): %s", e)

    return {"window": (gap_start_min, gap_end_min), "spool_trades": len(trades),
            "events": len(events), "inserted": inserted, "skipped": skipped,
            "side_updated": side_updated}


def replay_gaps(target: date = None) -> dict:
    """Detect today's gap windows and heal each from the spool. Idempotent
    (dedup_key). Never raises. Skips outside trading days/sessions."""
    if not _REPLAY_LOCK.acquire(blocking=False):
        return {"status": "already_running"}
    try:
        from api.flow_gap_autofill import detect_windows, _is_trading_day, _bump_version, _post_discord
        from api.color_rebuild import run_color_rebuild

        now_et = datetime.now(ET)
        target = target or now_et.date()
        if not _is_trading_day(target):
            return {"status": "not_trading_day"}

        windows, mode = detect_windows(target)
        # Only replay windows that have fully PASSED (the current live minute
        # isn't a gap, it's the present).
        now_min = now_et.hour * 60 + now_et.minute
        if target == now_et.date():
            windows = [w for w in windows if w[1] < now_min - 1]
        if not windows:
            return {"status": "no_gaps"}

        results = [
            _replay_window(target, s, e) for s, e in windows
        ]
        total_ins = sum(r["inserted"] for r in results)
        if total_ins:
            try:
                run_color_rebuild(f"{target.month}/{target.day}/{target.year}")
            except Exception as e:
                logger.warning("[tape-spool] color rebuild failed: %s", e)
            _bump_version()
        out = {"status": "completed", "target": target.isoformat(),
               "windows": results, "inserted_total": total_ins}
        _stats["last_replay"] = out
        wtxt = " · ".join(f"{s//60:02d}:{s%60:02d}→{e//60:02d}:{e%60:02d}"
                          for s, e in windows)
        _post_discord(
            f"\U0001F9F5 TAPE-SPOOL REPLAY {target.month}/{target.day}/{target.year}: "
            f"{len(windows)} gap window(s) [{wtxt}] — {total_ins} rows restored "
            f"INTRADAY from the local spool (side/color applied; dupes skipped: "
            f"{sum(r['skipped'] for r in results)})")
        logger.info("[tape-spool] replay complete: %s", out)
        return out
    except Exception as e:
        logger.exception("[tape-spool] replay failed: %s", e)
        return {"status": "failed", "error": str(e)[:300]}
    finally:
        _REPLAY_LOCK.release()


def start_boot_replay() -> bool:
    """Daemon thread: after boot settles, heal any of today's gaps from the
    spool — this is what turns a watchdog restart into zero data loss."""
    if not (ENABLED and REPLAY_ENABLED):
        return False

    def _run():
        time.sleep(REPLAY_BOOT_DELAY_SEC)
        try:
            now_et = datetime.now(ET)
            mins = now_et.hour * 60 + now_et.minute
            if now_et.weekday() < 5 and (9 * 60 + 35) <= mins <= (16 * 60 + 30):
                replay_gaps()
        except Exception as e:
            logger.warning("[tape-spool] boot replay failed (non-fatal): %s", e)

    threading.Thread(target=_run, daemon=True, name="flow-tape-boot-replay").start()
    return True
