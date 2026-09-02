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

# A recompute must price at least this fraction of the universe to be stored — a
# day's own daily bars land over the evening, so an early recompute prices only a
# sliver and its counts are a gross undercount.
_MIN_COVERAGE = float(os.environ.get("BREADTH_HEAL_MIN_COVERAGE", "0.6"))

# ── Bars-recompute DIVERGENCE guard ─────────────────────────────────────────────
# The signature guard (`snapshot_looks_degraded`) only catches a collection where
# stage-2 AND movers AND highs/lows all collapse together. A collection can be
# corrupt in a NARROWER way — 2026-09-01: the MA-breadth family was deflated
# (%>200MA 61->47.5, stage-2 497->32) while the movers came through, so the guard
# missed it and the bad row stood on the Monitor + every UCTA chart. The reliable
# check is not more hand-coded signatures but a comparison to OUR OWN bars: recompute
# the day and, if the stored MA-breadth disagrees materially, the stored row is wrong
# (the recompute is truth). Only the newest collector days are checked (they're the
# freshly-written, most-visible ones); a day confirmed to agree is memoized so it
# isn't re-recomputed every loop.
_DIVERGENCE_POINTS = float(os.environ.get("BREADTH_DIVERGENCE_POINTS", "8"))
_DIVERGENCE_CHECK_DAYS = int(os.environ.get("BREADTH_DIVERGENCE_CHECK_DAYS", "2"))
_DIVERGENCE_KEYS = ("pct_above_200sma", "pct_above_100sma",
                    "pct_above_50sma", "pct_above_40sma")
_DIV_OK: set = set()   # dates confirmed to agree with the bars recompute (this process)


def _divergence_from_recompute(stored: dict, rec: dict) -> Optional[dict]:
    """A MATERIAL disagreement between the stored MA-breadth and a fresh bars
    recompute, or None when they agree. The MA-breadth family is slow-moving and
    coverage-invariant, so several of them off by multiple points means the stored
    row's MA math is corrupt. Requires the gap on ≥2 metrics — one alone could be a
    universe/edge-case difference; the whole family drifting is the tell."""
    if not isinstance(stored, dict) or not isinstance(rec, dict):
        return None
    diffs = {}
    for k in _DIVERGENCE_KEYS:
        sv, rv = stored.get(k), rec.get(k)
        if sv is None or rv is None:
            continue
        try:
            diffs[k] = round(abs(float(sv) - float(rv)), 1)
        except (TypeError, ValueError):
            continue
    flagged = {k: v for k, v in diffs.items() if v >= _DIVERGENCE_POINTS}
    if len(flagged) >= 2:
        return {"threshold": _DIVERGENCE_POINTS, "diffs": diffs, "flagged": flagged}
    return None


def _expected_universe() -> int:
    """The size of the universe we SHOULD be measuring (the current list)."""
    try:
        from api.services.breadth_live import universe
        tk, _ = universe()
        return len(tk or [])
    except Exception:
        return 0


def _is_low_coverage_heal(m: dict, expected: int) -> bool:
    """A row WE healed earlier off too few bars — must be re-healed once the day's
    full daily bars are in (the degradation detector won't catch it: its universe
    is small, not large-with-collapsed-counts)."""
    if not isinstance(m, dict) or not m.get("_healed"):
        return False
    priced = m.get("universe_count") or 0
    return bool(expected) and priced < expected * _MIN_COVERAGE


def _needs_heal(m: Optional[dict], expected: int) -> bool:
    """A day needs (re)healing if the collector's row is degraded, or our own
    earlier heal was low-coverage."""
    from api.services import breadth_monitor as bm
    if m is None:
        return False   # a genuinely missing day is left to the collector / deep recon
    return bm.snapshot_looks_degraded(m) or _is_low_coverage_heal(m, expected)

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


def _recent_universe_list(date_str: str):
    """The newest real `universe_list` on-or-before `date_str` (the universe barely
    changes day to day). Used to restore one a heal stripped."""
    import json as _json
    from api.services import breadth_monitor as bm
    try:
        with bm._conn() as c:
            rows = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date <= ? ORDER BY date DESC LIMIT 15",
                (date_str,)).fetchall()
    except Exception:
        return None
    for r in rows:
        try:
            ul = _json.loads(r["metrics"]).get("universe_list")
        except Exception:
            continue
        if ul and len(ul) > 100:
            return ul
    return None


def ensure_universe_list(date_str: str) -> bool:
    """🔴 `breadth_live.universe()` reads the NEWEST snapshot's `universe_list`; a
    row without it collapses the ENTIRE live path (reference_levels → live row →
    intraday chart data). If this date's row is missing a real one, patch it from a
    recent good day. Cheap, and safe to run even when the metric heal can't (bars
    not ready), so the live path is restored immediately. Returns True if it patched."""
    from api.services import breadth_monitor as bm
    stored = bm.raw_row(date_str)
    if stored is None:
        return False
    ul = stored.get("universe_list")
    if ul and len(ul) > 100:
        return False
    good = _recent_universe_list(date_str)
    if good:
        return bool(bm.patch_field(date_str, "universe_list", good))
    return False


def heal_date(date_str: str, force: bool = False,
              check_divergence: bool = False) -> dict:
    """Recompute one session's breadth from bars and store it IF the current row is
    missing/degraded, or (with `check_divergence`) its MA-breadth diverges materially
    from the recompute, or `force`. Preserves the good index/sentiment fields AND the
    drill lists (esp. `universe_list`, which the live path reads). Best-effort —
    returns a status dict, never raises."""
    from api.services import breadth_monitor as bm
    from api.services import breadth_history_recon as recon
    from api.services import breadth_live as bl

    stored = bm.raw_row(date_str)
    expected = _expected_universe()
    # ALWAYS repair a stripped universe_list first — this unbreaks the live path
    # even when the coverage floor below stops the metric heal from running.
    ul_repaired = ensure_universe_list(date_str)
    if ul_repaired:
        stored = bm.raw_row(date_str)   # re-read: it now carries the list

    # The cheap signature gate decides on its own; the divergence check needs the
    # recompute below, so it can't short-circuit here.
    signature_needs = force or stored is None or _needs_heal(stored, expected)
    if not signature_needs and not check_divergence:
        return {"ok": True, "date": date_str, "skipped": "already accurate",
                "ul_repaired": ul_repaired}

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

    # COVERAGE FLOOR: only store a recompute that actually PRICED most of the
    # universe. A day's own daily bars land over the evening, so a recompute run
    # too early prices only a fraction (e.g. 156 of ~2,600) and its counts are a
    # gross undercount that reads plausible. Below the floor we leave the day for
    # the watch loop to retry once the bars are complete (a genuinely accurate
    # same-day answer needs either the full daily bars or the collector's feed).
    priced = metrics.get("universe_count") or 0
    if expected and priced < expected * _MIN_COVERAGE:
        return {"ok": False, "date": date_str,
                "reason": (f"recompute coverage too low ({priced}/{expected}) — "
                           "daily bars not fully ingested yet; will retry"),
                "priced": priced, "expected": expected, "ul_repaired": ul_repaired}

    # DIVERGENCE GATE: when we're here only to divergence-check (the day passed the
    # cheap signature gate as "fine"), store the recompute ONLY if the stored row's
    # MA-breadth disagrees materially with our own bars. If they agree, the collector's
    # row is trusted and left as-is — nothing is overwritten.
    divergence = None
    if not signature_needs:
        divergence = _divergence_from_recompute(stored, metrics)
        if not divergence:
            return {"ok": True, "date": date_str, "skipped": "recompute agrees",
                    "ul_repaired": ul_repaired}

    # Preserve the collector's drill lists — the recompute produces scalars only, and
    # `universe_list` in particular is load-bearing for `breadth_live.universe()`.
    if stored:
        for k, v in stored.items():
            if k.endswith("_list") and v is not None:
                metrics.setdefault(k, v)
    if not (metrics.get("universe_list") and len(metrics["universe_list"]) > 100):
        good_ul = _recent_universe_list(date_str)
        if good_ul:
            metrics["universe_list"] = good_ul

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
            "reason": ("bars-recompute divergence" if divergence
                       else "degraded/forced"),
            "divergence": divergence,
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
        from api.services import breadth_monitor as bm
        expected = _expected_universe()
        results = []
        repaired = []
        for i, d in enumerate(_recent_dates(days)):
            # ALWAYS repair a stripped universe_list first — it's load-bearing for
            # the live path and its absence otherwise HIDES the row from _needs_heal
            # (an empty newest list drives _expected_universe to 0).
            if ensure_universe_list(d):
                repaired.append(d)
            m = bm.raw_row(d)
            # The newest COLLECTOR days also get a bars-recompute divergence check —
            # this catches a corrupt collection the cheap signature gate misses
            # (2026-09-01). A day already healed by us, or already confirmed to agree
            # this process, is skipped so we don't recompute it every loop.
            div = (i < _DIVERGENCE_CHECK_DAYS and isinstance(m, dict)
                   and not m.get("_healed") and d not in _DIV_OK)
            if _needs_heal(m, expected) or div:
                res = heal_date(d, check_divergence=div)
                results.append(res)
                if div and res.get("skipped") == "recompute agrees":
                    _DIV_OK.add(d)
        return {"ok": True, "checked": days, "ul_repaired": repaired,
                "healed": [r for r in results if r.get("healed")], "attempts": results}
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
