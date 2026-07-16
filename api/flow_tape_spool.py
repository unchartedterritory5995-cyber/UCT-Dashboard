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
# Replay default ON as of Block B (capped intraday detection, edge-honest
# inserts, chunked/yielding CPU, live-writer conflict abort, scheduled sweeps).
# Runtime kill: POST /api/flow-gap-fill/spool-control {"replay": false}.
REPLAY_ENABLED = os.environ.get("FLOW_TAPE_REPLAY_ENABLED", "1").lower() in ("1", "true", "yes")
# Total gap minutes replayed per run; anything beyond defers to the T+1 heal
# (review B3 — bounds worst-case CPU/memory inside the live tape process).
REPLAY_MAX_MIN = int(os.environ.get("FLOW_TAPE_REPLAY_MAX_MIN", "120"))
SUB_WINDOW_MIN = 30               # insert txn granularity (review B4)
RETENTION_HOURS = int(os.environ.get("FLOW_TAPE_SPOOL_RETENTION_HOURS", "26"))
REPLAY_BOOT_DELAY_SEC = float(os.environ.get("FLOW_TAPE_REPLAY_BOOT_DELAY_SEC", "390"))
MAX_SPOOL_BYTES = int(float(os.environ.get("FLOW_TAPE_SPOOL_MAX_GB", "4")) * (1 << 30))
MIN_FREE_BYTES = int(float(os.environ.get("FLOW_TAPE_SPOOL_MIN_FREE_GB", "2")) * (1 << 30))
EDGE_SEC = 60                     # replay margin around each gap window
_QUEUE_MAX = 50_000               # ~1-2 min of extreme-volume frames

_q: deque = deque(maxlen=_QUEUE_MAX)
_stats = {"frames_spooled": 0, "frames_dropped": 0, "writer_errors": 0,
          "paused_no_space": False, "last_replay": None}
_writer_started = False
_start_lock = threading.Lock()
_REPLAY_LOCK = threading.Lock()
_writer_thread = None
_POSTED_WINDOWS: set = set()      # (date_iso, start_min, end_min) Discord dedup


# ── Spool writer ──────────────────────────────────────────────────────────

def spool_frame(msg) -> None:
    """Called from the consumer's receive loop with the raw WS frame.
    MUST stay O(1) and exception-free — the tape is behind this call.

    Pure-quote frames are skipped (review A3a): the Q subscription pool's
    NBBO stream dominates frame volume by an order of magnitude and replay
    only ever reads "T" trades — spooling quotes would burn GBs/day on the
    volume that also holds flow.db. Cheap substring test, no JSON parse."""
    if not ENABLED or _stats["paused_no_space"]:
        return
    try:
        s = msg if isinstance(msg, str) else msg.decode("utf-8", "replace")
        if '"ev":"T"' not in s and '"ev": "T"' not in s:
            return
        if len(_q) == _q.maxlen:
            _stats["frames_dropped"] += 1
        _q.append(s)
    except Exception:
        _stats["frames_dropped"] += 1


def _hour_path(dt_utc: datetime) -> str:
    return os.path.join(SPOOL_DIR, f"tape-{dt_utc.strftime('%Y%m%d-%H')}.jsonl")


def _writer_loop() -> None:
    cur_path, cur_f = None, None
    ticks = 0
    while True:
        try:
            time.sleep(2.0)
            ticks += 1
            if ticks % 30 == 1:            # ~every 60s: disk-safety check
                _check_disk_budget()
            if not _q:
                continue
            os.makedirs(SPOOL_DIR, exist_ok=True)   # inside the loop (review A6):
            # a transient volume error must not kill the writer permanently.
            path = _hour_path(datetime.utcnow())
            if path != cur_path:
                if cur_f:
                    cur_f.close()
                    # Rotation must NOT block the drain (review A4): at the
                    # open, gzipping a 100MB+ hour inline would overflow the
                    # 50k deque. One-shot daemon thread does gzip + prune.
                    threading.Thread(target=_rotate_and_prune, args=(cur_path,),
                                     daemon=True, name="flow-tape-rotate").start()
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


def _check_disk_budget() -> None:
    """Pause spooling when the spool exceeds its byte cap or the volume's
    free space drops below the floor (protects flow.db WAL + backup bursts).
    Resumes automatically once pruning/space recovers (review A3b)."""
    try:
        import shutil
        spool_bytes = 0
        if os.path.isdir(SPOOL_DIR):
            for f in os.listdir(SPOOL_DIR):
                if f.startswith("tape-"):
                    try:
                        spool_bytes += os.path.getsize(os.path.join(SPOOL_DIR, f))
                    except OSError:
                        pass
        free = shutil.disk_usage(os.path.dirname(DB_PATH) or "/").free
        paused = spool_bytes > MAX_SPOOL_BYTES or free < MIN_FREE_BYTES
        if paused and not _stats["paused_no_space"]:
            logger.warning("[tape-spool] PAUSED: spool=%.1fGB free=%.1fGB",
                           spool_bytes / (1 << 30), free / (1 << 30))
            try:
                from api.flow_gap_autofill import _post_discord
                _post_discord(
                    f"⚠️ TAPE-SPOOL PAUSED (disk budget): spool "
                    f"{spool_bytes / (1 << 30):.1f}GB / free {free / (1 << 30):.1f}GB — "
                    f"gap capture suspended until space recovers")
            except Exception:
                pass
        _stats["paused_no_space"] = paused
    except Exception as e:
        logger.warning("[tape-spool] disk check failed: %s", e)


def _rotate_and_prune(closed_path: str) -> None:
    """gzip the just-closed hour (temp name + atomic replace so readers never
    see a partial .gz — review A3c/A4); drop files older than RETENTION_HOURS."""
    tmp = None
    try:
        if closed_path and os.path.exists(closed_path):
            # temp name must NOT start with "tape-" or _iter_spool_lines /
            # the pruner would treat the half-written gz as a spool file
            tmp = os.path.join(SPOOL_DIR,
                               "_tmp-" + os.path.basename(closed_path) + ".gz")
            with open(closed_path, "rb") as src, \
                    gzip.open(tmp, "wb", compresslevel=1) as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)
            os.replace(tmp, closed_path + ".gz")
            os.remove(closed_path)
    except Exception as e:
        logger.warning("[tape-spool] rotate failed (kept plain): %s", e)
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass
    try:
        cutoff = time.time() - RETENTION_HOURS * 3600
        for f in os.listdir(SPOOL_DIR):
            p = os.path.join(SPOOL_DIR, f)
            if (f.startswith("tape-") or f.startswith("_tmp-")) \
                    and os.path.getmtime(p) < cutoff:
                os.remove(p)
    except Exception:
        pass


def start_writer() -> bool:
    global _writer_started, _writer_thread
    if not ENABLED:
        return False
    with _start_lock:
        if _writer_started:
            return False
        _writer_thread = threading.Thread(target=_writer_loop, daemon=True,
                                          name="flow-tape-spool-writer")
        _writer_thread.start()
        _writer_started = True
    logger.info("[tape-spool] writer started (dir=%s retention=%dh)",
                SPOOL_DIR, RETENTION_HOURS)
    return True


def get_stats() -> dict:
    return dict(_stats, queue_len=len(_q), enabled=ENABLED,
                replay_enabled=REPLAY_ENABLED, spool_dir=SPOOL_DIR,
                writer_alive=bool(_writer_thread and _writer_thread.is_alive()))


def set_flags(spool=None, replay=None) -> dict:
    """Runtime kill switch (review A5) — flips the module gates WITHOUT a
    restart (a restart gaps the tape, which is what these exist to protect)."""
    global ENABLED, REPLAY_ENABLED
    if spool is not None:
        ENABLED = bool(spool)
    if replay is not None:
        REPLAY_ENABLED = bool(replay)
    logger.info("[tape-spool] flags set: spool=%s replay=%s", ENABLED, REPLAY_ENABLED)
    return {"spool_enabled": ENABLED, "replay_enabled": REPLAY_ENABLED}


# ── Replay ────────────────────────────────────────────────────────────────

def _iter_spool_lines(t0_ns: int, t1_ns: int):
    """Yield raw frame strings whose file hour could overlap [t0, t1].

    Review B7: the drain lags print-time, so a gap's tail frames can land in
    the NEXT hour file — widen the upper bound by an hour. When both plain
    and .gz exist for the same hour (crash between gzip and unlink), prefer
    the .gz and skip the plain twin — double-reading would hand batch_process
    duplicated prints and mint inflated-Volume phantom rows dedup can't stop."""
    if not os.path.isdir(SPOOL_DIR):
        return
    h0 = datetime.utcfromtimestamp(t0_ns / 1e9).strftime("%Y%m%d-%H")
    h1 = datetime.utcfromtimestamp(t1_ns / 1e9 + 3600).strftime("%Y%m%d-%H")
    by_hour = {}
    for f in os.listdir(SPOOL_DIR):
        if not f.startswith("tape-"):
            continue
        hour = f[5:16]                      # YYYYMMDD-HH
        if not (h0 <= hour <= h1):
            continue
        cur = by_hour.get(hour)
        if cur is None or (f.endswith(".gz") and not cur.endswith(".gz")):
            by_hour[hour] = f
    for hour in sorted(by_hour):
        f = by_hour[hour]
        p = os.path.join(SPOOL_DIR, f)
        try:
            if f.endswith(".gz"):
                fh = gzip.open(p, "rt", encoding="utf-8", errors="replace")
            else:
                fh = open(p, "r", encoding="utf-8", errors="replace")
            with fh:
                try:
                    n = 0
                    for line in fh:
                        n += 1
                        if n % 20000 == 0:
                            time.sleep(0.05)   # GIL yield (review B3)
                        yield line
                except EOFError:
                    pass                    # truncated tail of a live/crashed file
        except Exception as e:
            logger.warning("[tape-spool] read %s failed: %s", f, e)


def _collect_window_trades(target: date, windows: list) -> dict:
    """ONE pass over the spool for ALL windows (review B3 — the per-window
    variant re-parsed the same hour files up to 8x on a 7/16-shaped day).
    Returns {window_index: [(ticker, price, size, exchange, cond, sip_ns)]}.
    Mirrors the live consumer's T-frame field mapping (incl. conds[0])."""
    day_et = datetime(target.year, target.month, target.day, tzinfo=ET)
    spans = []
    for i, (s, e) in enumerate(windows):
        t0 = int((day_et + timedelta(minutes=s, seconds=-EDGE_SEC)).timestamp() * 1e9)
        t1 = int((day_et + timedelta(minutes=e, seconds=EDGE_SEC)).timestamp() * 1e9)
        spans.append((t0, t1, i))
    lo = min(t0 for t0, _, _ in spans)
    hi = max(t1 for _, t1, _ in spans)

    out = {i: [] for i in range(len(windows))}
    for line in _iter_spool_lines(lo, hi):
        line = line.strip()
        if not line or '"ev":"T"' not in line and '"ev": "T"' not in line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, list):
            payload = [payload]
        for evt in payload:
            try:
                if not isinstance(evt, dict) or evt.get("ev") != "T":
                    continue
                ts_ns = int(evt["t"]) * 1_000_000
                w = None
                for t0, t1, i in spans:      # <=8 windows; linear scan is fine
                    if t0 <= ts_ns <= t1:
                        w = i
                        break
                if w is None:
                    continue
                conds = evt.get("c") or []
                out[w].append((evt["sym"], float(evt["p"]), int(evt["s"]),
                               int(evt.get("x", 0)),
                               int(conds[0]) if conds else -1, ts_ns))
            except (KeyError, ValueError, TypeError, AttributeError):
                continue
    return out


def _live_writer_conflicts() -> int:
    """Live-tape distress signal (review B4): count of live batches dropped
    to lock contention. If this moves while we hold the replay lock, we are
    the contention — abort (replay is idempotent; the sweep retries later)."""
    try:
        from api.massive_ws_worker import _state
        return int(_state.get("batches_dropped_locked", 0) or 0)
    except Exception:
        return 0


def _replay_window(target: date, gap_start_min: int, gap_end_min: int,
                   trades: list) -> dict:
    """Rebuild one gap window from pre-collected spool trades.

    EDGE HONESTY (review B2): the ±EDGE_SEC read margin exists ONLY for
    aggregation context. An event chain that starts before the gap opened
    (or is still running when it closed) was partially captured LIVE — its
    live row and a replayed full-chain row would carry different Volume/
    Premium and dedup_key canNOT collapse them. Only events whose full span
    [first_ts, last_ts] lies inside the gap proper are inserted.

    CPU/LOCK BOUNDS (B3/B4): processed in <=SUB_WINDOW_MIN-minute chunks —
    one insert transaction per chunk with a breather between, GIL yields
    between tick-test groups — because this runs inside the live tape's
    process and the whole initiative started with reads starving that writer."""
    import numpy as np
    import pandas as pd
    from api.massive_processor import batch_process, event_to_bbs_row, is_index_source
    from api.massive_flatfiles_worker import _load_oi_for_events, MIN_PREMIUM, MIN_VOLUME
    from api.massive_ws_worker import _load_ticker_metadata, _load_er_flags
    from api.flow_db import FlowDB, COLUMNS
    from api import flow_heal_enrich as fhe

    out = {"window": (gap_start_min, gap_end_min), "spool_trades": len(trades),
           "events": 0, "inserted": 0, "skipped": 0, "side_updated": 0,
           "symbols": set()}
    if not trades:
        return out

    day_et = datetime(target.year, target.month, target.day, tzinfo=ET)
    gs_ns = int((day_et + timedelta(minutes=gap_start_min)).timestamp() * 1e9)
    ge_ns = int((day_et + timedelta(minutes=gap_end_min)).timestamp() * 1e9)
    db = FlowDB()
    header = ",".join(COLUMNS) + "\n"
    mdy = f"{target.month}/{target.day}/{target.year}"
    snap_iso = target.isoformat()

    trades.sort(key=lambda t: t[5])
    n_chunks = max(1, -(-(gap_end_min - gap_start_min) // SUB_WINDOW_MIN))
    for ci in range(n_chunks):
        c0 = gs_ns + ci * SUB_WINDOW_MIN * 60 * 1_000_000_000
        c1 = min(ge_ns, c0 + SUB_WINDOW_MIN * 60 * 1_000_000_000)
        # chunk trades WITH context margin; edge filter happens on events
        pad = EDGE_SEC * 1_000_000_000
        chunk = [t for t in trades if c0 - pad <= t[5] <= c1 + pad]
        if not chunk:
            continue
        df = pd.DataFrame(chunk, columns=["ticker", "price", "size", "exchange",
                                          "conditions", "sip_timestamp"])
        del chunk
        df = df.sort_values("sip_timestamp", kind="stable").reset_index(drop=True)
        events, _ = batch_process(df, min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)
        # B2: full-chain-inside-the-gap only; chunk interior bounds are the
        # chunk edges except at the true gap boundaries.
        lo = max(gs_ns, c0)
        hi = min(ge_ns, c1)
        events = [e for e in events
                  if e.first_ts_ns >= lo and e.last_ts_ns < hi]
        out["events"] += len(events)
        if not events:
            del df
            continue

        stocks = [e for e in events if not is_index_source(e.root)]
        indexes = [e for e in events if is_index_source(e.root)]
        roots = list({e.root for e in events})
        out["symbols"].update(roots)
        meta = _load_ticker_metadata(roots)
        er_map = _load_er_flags(roots)
        oi_s = _load_oi_for_events(db.db_path, stocks, snap_iso)
        oi_i = _load_oi_for_events(db.db_path, indexes, snap_iso)

        for evts, source, oi_map in ((stocks, "stocks", oi_s),
                                     (indexes, "indexes", oi_i)):
            if not evts:
                continue
            buf = [header]
            for i, ev in enumerate(evts):
                m = meta.get(ev.root, {})
                row = event_to_bbs_row(ev, source=source,
                                       mktcap=m.get("mktcap", 0),
                                       sector=m.get("sector", ""),
                                       oi=oi_map.get(i, 0),
                                       er_flag=er_map.get(ev.root, 'F'))
                buf.append(",".join(str(row.get(c, "")) for c in COLUMNS) + "\n")
            res = db.insert_csv("".join(buf), source=source)
            out["inserted"] += res.get("inserted", 0)
            out["skipped"] += res.get("skipped", 0)
            time.sleep(0.15)                 # breather between txns (B4)

        # Side tick test on this chunk's raw prints (per OPRA contract string)
        try:
            patches, pstats = {}, {"events": 0, "sided": 0}
            dfc = df[~df["conditions"].isin(list(fhe.CANCEL))]
            gi = 0
            for tk, g in dfc.groupby("ticker", sort=False):
                gi += 1
                if gi % 50 == 0:
                    time.sleep(0.05)         # GIL yield (B3)
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
                with tempfile.NamedTemporaryFile(
                        "w", suffix=".json", delete=False,
                        dir=os.path.dirname(DB_PATH) or None) as f:
                    json.dump(patches, f)
                    ppath = f.name
                try:
                    out["side_updated"] += run_patches_backfill(
                        ppath, mdy).get("side_updated", 0)
                finally:
                    try:
                        os.remove(ppath)
                    except OSError:
                        pass
        except Exception as e:
            logger.warning("[tape-spool] side patches failed (rows stand): %s", e)
        del df
        time.sleep(0.1)

    out["symbols"] = sorted(out["symbols"])
    return out


def replay_gaps(target: date = None) -> dict:
    """Detect today's gap windows and heal each from the spool. Idempotent
    (dedup_key). Never raises. Skips outside trading days/sessions."""
    if not REPLAY_ENABLED:
        return {"status": "disabled"}
    if not _REPLAY_LOCK.acquire(blocking=False):
        return {"status": "already_running"}
    try:
        from api.flow_gap_autofill import detect_windows, _is_trading_day, _bump_version, _post_discord
        from api.color_rebuild import run_color_rebuild

        now_et = datetime.now(ET)
        target = target or now_et.date()
        mdy = f"{target.month}/{target.day}/{target.year}"
        if not _is_trading_day(target):
            return {"status": "not_trading_day"}

        # B1: intraday detection is CAPPED at the current minute so future
        # session minutes aren't counted as empty (uncapped, any pre-~12:45
        # check collapsed into a bogus full_session window). With the cap,
        # every detected window is fully in the past by construction — and a
        # capped full_session IS trustworthy: it means the elapsed session is
        # mostly empty (an open-freeze), which is exactly what we replay.
        now_min = now_et.hour * 60 + now_et.minute
        cap = (now_min - 1) if target == now_et.date() else None
        windows, mode = detect_windows(target, cap_end_min=cap)
        if not windows:
            return {"status": "no_gaps"}

        # B3: bound total replayed minutes; the remainder defers to T+1.
        kept, total_min, deferred = [], 0, []
        for s, e in windows:
            if total_min + (e - s) <= REPLAY_MAX_MIN:
                kept.append((s, e))
                total_min += e - s
            else:
                deferred.append((s, e))
        windows = kept
        if not windows:
            _post_discord(f"\U0001F9F5 TAPE-SPOOL REPLAY {mdy}: gap load exceeds "
                          f"{REPLAY_MAX_MIN}min budget — deferring entirely to the T+1 heal")
            return {"status": "deferred_budget", "deferred": deferred}

        by_window = _collect_window_trades(target, windows)
        conflicts_before = _live_writer_conflicts()
        results, aborted = [], False
        for i, (s, e) in enumerate(windows):
            if not REPLAY_ENABLED:          # kill switch honored mid-run (A5)
                break
            if _live_writer_conflicts() > conflicts_before:
                aborted = True              # B4: we ARE the contention — stop
                break
            results.append(_replay_window(target, s, e, by_window.get(i, [])))

        total_ins = sum(r["inserted"] for r in results)
        symbols = sorted({sym for r in results for sym in r.get("symbols", [])})
        if total_ins:
            # Post-pass enrichment: set-based OI backfill (exact + stale<=7d
            # walkback, idempotent) then color scoped to the replayed symbols
            # only (B4/B7) — the full-day rebuild belongs to the T+1 slot.
            try:
                from api import flow_heal_enrich as fhe
                fhe.run_oi_backfill(mdy)
            except Exception as e:
                logger.warning("[tape-spool] OI backfill failed: %s", e)
            try:
                run_color_rebuild(mdy, symbols=symbols or None)
            except TypeError:
                run_color_rebuild(mdy)      # older signature fallback
            except Exception as e:
                logger.warning("[tape-spool] color rebuild failed: %s", e)
            _bump_version()

        out = {"status": "aborted_live_conflict" if aborted else "completed",
               "target": target.isoformat(), "windows": results,
               "deferred": deferred, "inserted_total": total_ins}
        _stats["last_replay"] = out

        # B7: Discord only when there's something to say, once per window/day.
        key_new = [(s, e) for s, e in windows
                   if (target.isoformat(), s, e) not in _POSTED_WINDOWS]
        for s, e in key_new:
            _POSTED_WINDOWS.add((target.isoformat(), s, e))
        if aborted:
            _post_discord(f"\U0001F534 TAPE-SPOOL REPLAY {mdy} ABORTED: live writer "
                          f"hit lock contention mid-replay — backing off; the "
                          f"scheduled sweep retries, T+1 is the backstop")
        elif key_new:
            wtxt = " · ".join(f"{s//60:02d}:{s%60:02d}→{e//60:02d}:{e%60:02d}"
                              for s, e in key_new)
            covered = sum(r["spool_trades"] for r in results)
            body = (f"{total_ins} rows restored INTRADAY from the local spool "
                    f"(side+OI+color applied; dupes skipped "
                    f"{sum(r['skipped'] for r in results)})" if total_ins else
                    f"0 restored — window(s) not spool-covered (socket was down "
                    f"or spool predates them); T+1 heals them tonight")
            _post_discord(f"\U0001F9F5 TAPE-SPOOL REPLAY {mdy}: {len(windows)} "
                          f"window(s) [{wtxt}], {covered} spooled prints — {body}"
                          + (f" · {len(deferred)} window(s) deferred to T+1 (budget)"
                             if deferred else ""))
        logger.info("[tape-spool] replay complete: %s", out)
        return out
    except Exception as e:
        logger.exception("[tape-spool] replay failed: %s", e)
        out = {"status": "failed", "error": str(e)[:300]}
        _stats["last_replay"] = out          # A9: a failed replay must be
        try:                                 # distinguishable from no_gaps
            from api.flow_gap_autofill import _post_discord as _pd
            _pd(f"\U0001F534 TAPE-SPOOL REPLAY FAILED: {str(e)[:250]} — "
                f"gaps remain; T+1 heal is the backstop")
        except Exception:
            pass
        return out
    finally:
        _REPLAY_LOCK.release()


def start_boot_replay() -> bool:
    """Daemon thread: after boot settles, heal any of today's gaps from the
    spool — this is what turns a watchdog restart into zero data loss."""
    if not (ENABLED and REPLAY_ENABLED):
        return False

    def _run():
        time.sleep(REPLAY_BOOT_DELAY_SEC)
        if not REPLAY_ENABLED:               # re-check after the sleep (A5)
            return
        try:
            now_et = datetime.now(ET)
            mins = now_et.hour * 60 + now_et.minute
            if now_et.weekday() < 5 and (9 * 60 + 35) <= mins <= (16 * 60 + 30):
                replay_gaps()
        except Exception as e:
            logger.warning("[tape-spool] boot replay failed (non-fatal): %s", e)
            _stats["last_replay"] = {"status": "boot_replay_failed",
                                     "error": str(e)[:300]}

    threading.Thread(target=_run, daemon=True, name="flow-tape-boot-replay").start()
    return True


def register_jobs(scheduler) -> bool:
    """Scheduled gap sweeps (review B6): the boot replay only covers restarts;
    a sub-300s stall that self-recovers (no watchdog exit) or a post-15:55 gap
    would otherwise wait for T+1. Sweeps are cheap no-ops when gap-free.
    EXPLICIT timezone (the APScheduler UTC trap)."""
    if not (ENABLED and REPLAY_ENABLED):
        return False
    # Only where the consumer (and thus the spool) actually lives — web and
    # the bars worker share this module via main.py but hold frozen flow.db
    # copies; a sweep there would "heal" a database nobody reads.
    if os.environ.get("MASSIVE_WS_ENABLED") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(replay_gaps,
                      CronTrigger(day_of_week="mon-fri", hour="10-15",
                                  minute="5,25,45", timezone=ET),
                      id="tape_spool_sweep", max_instances=1,
                      replace_existing=True, coalesce=True)
    scheduler.add_job(replay_gaps,
                      CronTrigger(day_of_week="mon-fri", hour=16, minute=12,
                                  timezone=ET),
                      id="tape_spool_sweep_close", max_instances=1,
                      replace_existing=True, coalesce=True)
    logger.info("[tape-spool] sweep jobs registered (:05/:25/:45 10:00-15:45 "
                "+ 16:12 ET Mon-Fri)")
    return True
