"""Self-healing breadth — keep every recent day accurate even when the collector
fails.

The 4:15/4:30 collector runs off-box and can push a DEGRADED snapshot (a failed
universe price pull → Stage-2≈0, no 4%-movers, no new highs/lows, coarse
percentages) that then stands as the day's row. This module recomputes such a day
from OUR OWN bar data via the reconstruction engine (`breadth_history_recon.
recompute_close`, the same method `validate_recent` already runs in prod) and
overwrites the bad row with the accurate one — preserving the index closes +
weekly sentiment the collector DID get (they ride a separate feed).

Paired with the push guard (`api/routers/breadth_monitor.py` rejects a degraded
push so it can never clobber a good/healed row), this makes the Monitor's current
and prior days always accurate: a bad collection is refused, and a missing or
degraded recent day is regenerated from bars.

Gated by BREADTH_SELF_HEAL (default on). Runs on the WEB pod (breadth_snapshots
lives on the web volume); recompute reads the web bars.db, which is continuously
warmed for the active universe.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Optional

_ENABLED = os.environ.get("BREADTH_SELF_HEAL", "1") != "0"
_LOCK = threading.Lock()

# NOT_LIVE fields (index closes + sentiment + exposure) are not price-reconstructable
# and ride a separate feed the collector usually gets right even on a bad price pull,
# so a heal PRESERVES them from the existing row (falling back to the newest good row).
def _not_live_keys():
    try:
        from api.services.breadth_live import NOT_LIVE
        return NOT_LIVE
    except Exception:
        return ("cboe_putcall", "cnn_fear_greed", "aaii_bulls", "aaii_bears",
                "aaii_neutral", "aaii_spread", "naaim", "uct_exposure", "vix",
                "sp500_close")


def _recent_dates(days: int) -> list:
    """The last `days` collected session dates, newest-first."""
    from api.services import breadth_monitor as bm
    try:
        with bm._conn() as c:
            return [r[0] for r in c.execute(
                "SELECT date FROM breadth_snapshots ORDER BY date DESC LIMIT ?", (days,)
            ).fetchall()]
    except Exception:
        return []


def _carry_not_live(date_str: str, keys) -> dict:
    """Newest stored value for each NOT_LIVE key from a NON-degraded row strictly
    before `date_str` — the correct carry for weekly surveys / a missed index close."""
    from api.services import breadth_monitor as bm
    out: dict = {}
    try:
        with bm._conn() as c:
            rows = c.execute(
                "SELECT date, metrics FROM breadth_snapshots WHERE date < ? "
                "ORDER BY date DESC LIMIT 15", (date_str,)
            ).fetchall()
    except Exception:
        return out
    import json as _json
    for r in rows:
        try:
            m = _json.loads(r["metrics"])
        except Exception:
            continue
        if bm.snapshot_looks_degraded(m):
            continue
        for k in keys:
            if k not in out and m.get(k) is not None:
                out[k] = m[k]
        if len(out) >= len(keys):
            break
    return out


def heal_date(date_str: str, force: bool = False) -> dict:
    """Recompute one session's breadth from bars and store it IF the current row is
    missing or degraded (or `force`). Preserves the good index/sentiment fields.
    Best-effort — returns a status dict, never raises."""
    from api.services import breadth_monitor as bm
    from api.services import breadth_history_recon as recon
    from api.services import breadth_live as bl

    stored = bm.raw_row(date_str)
    if stored is not None and not force and not bm.snapshot_looks_degraded(stored):
        return {"ok": True, "date": date_str, "skipped": "already accurate"}

    # The recompute keys off the CANONICAL daily-bar timestamp — derive it from the
    # SPY bar for this ET date exactly as validate_recent does (a synthesized ts
    # would not match the stored bar and the day's prices wouldn't load).
    ts = None
    try:
        conn = bl._bars_conn()
        rows = conn.execute(
            "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT 1500"
        ).fetchall()
        ts = {bl._iso(int(r[0])): int(r[0]) for r in rows}.get(date_str)
    except Exception as e:
        return {"ok": False, "date": date_str, "reason": f"bar lookup failed: {e}"}
    if not ts:
        return {"ok": False, "date": date_str,
                "reason": "no SPY daily bar for this date (holiday / bars not warmed)"}

    try:
        metrics = recon.recompute_close(ts)
    except Exception as e:
        return {"ok": False, "date": date_str, "reason": f"recompute raised: {e}"}
    if not metrics:
        return {"ok": False, "date": date_str,
                "reason": "recompute unavailable (bars/history insufficient)"}

    metrics = dict(metrics)
    metrics["date"] = date_str
    # If the reconstruction ITSELF came back degraded (our bars couldn't price the
    # universe either), do NOT overwrite — a second bad row helps no one.
    if bm.snapshot_looks_degraded(metrics):
        return {"ok": False, "date": date_str, "reason": "recompute also degraded"}

    keys = _not_live_keys()
    carried = _carry_not_live(date_str, keys)
    for k in keys:
        # keep the collector's own index/sentiment where it got them; else carry.
        if stored and stored.get(k) is not None:
            metrics[k] = stored[k]
        elif k not in metrics and carried.get(k) is not None:
            metrics[k] = carried[k]
    # CNN Fear&Greed of exactly 0 is the "missing" sentinel, not real extreme fear —
    # carry a real recent value instead.
    if metrics.get("cnn_fear_greed") in (0, 0.0, None) and carried.get("cnn_fear_greed"):
        metrics["cnn_fear_greed"] = carried["cnn_fear_greed"]

    metrics["_healed"] = True
    ok = bm.store_snapshot(date_str, metrics)
    return {"ok": bool(ok), "date": date_str, "healed": True,
            "was_degraded": stored is not None,
            "universe_count": metrics.get("universe_count"),
            "stage2_count": metrics.get("stage2_count"),
            "up_4pct_today": metrics.get("up_4pct_today")}


def heal_recent(days: int = 10) -> dict:
    """Scan the last `days` collected sessions and heal any that are degraded.
    (A MISSING recent day is left to the collector / deep-history reconstruction;
    this targets rows that exist but are bad.)"""
    if not _ENABLED:
        return {"ok": False, "reason": "disabled"}
    if not _LOCK.acquire(blocking=False):
        return {"ok": True, "busy": True}
    try:
        results = []
        for d in _recent_dates(days):
            from api.services import breadth_monitor as bm
            m = bm.raw_row(d)
            if m is not None and bm.snapshot_looks_degraded(m):
                results.append(heal_date(d))
        return {"ok": True, "checked": days, "healed": [r for r in results if r.get("healed")],
                "attempts": results}
    finally:
        _LOCK.release()


def start_background_heal(delay_seconds: int = 40) -> None:
    """Boot pass (once, shortly after startup) to fix any degraded recent day left
    over from a bad collection. The scheduled post-close pass lives in main.py."""
    if not _ENABLED:
        return

    def _run():
        time.sleep(max(0, delay_seconds))
        try:
            res = heal_recent(10)
            print(f"[breadth-heal] boot pass: "
                  f"{len(res.get('healed', []))} healed of last 10")
        except Exception as e:
            print(f"[breadth-heal] boot pass error (non-fatal): {e}")

    threading.Thread(target=_run, name="breadth_self_heal_boot", daemon=True).start()
