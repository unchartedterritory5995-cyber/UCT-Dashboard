"""Evidence-based auto-tuning for the catalyst quality-gate thresholds.

The gate in filters.py enforces four tradeability knobs (MIN_PRICE,
MIN_DOLLAR_VOL, MIN_FLOAT, MIN_MARKET_CAP). Historically those were guesswork
set via Railway env vars. This module turns them into a closed feedback loop:

  * TIGHTEN — when the trader 👎's a cluster of rows that all cleared a knob
    (e.g. ten 'bad' rows priced ~$3.40), nudge that knob UP toward the 75th
    percentile of the bad set, but never above the cheapest 👍 row (so a knob
    can't be tightened past a name the trader liked).

  * LOOSEN — when the nightly coverage audit keeps EXCLUDING big movers for a
    given reason ('price ... below ...'), nudge that knob DOWN one step. A
    loosen signal beats any tighten signal for the same knob.

Every change is bounded (≤ MAX_STEP_FRAC per run), clamped to the knob's
[lo, hi] bounds, written to an mtime-cached overrides JSON, and logged to a
SQLite audit table so it can be reviewed + reverted. ENV always wins over an
auto-override, so the operator keeps the manual escape hatch.

Fail-safe: run_autotune / revert / get_threshold never raise — this is a
best-effort background optimizer, not a request-path dependency.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
import contextlib
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# Reuse the catalysts DB for the change log (one store, audited together).
from api.services.catalyst.store import _DB_PATH  # noqa: E402

# ── Knob registry: name -> (default, lo, hi). Bounds are hard — an override or
# a tuned target is always clamped into this range. ──
KNOBS = {
    "CATALYST_MIN_PRICE":      (3.0, 2.0, 8.0),
    "CATALYST_MIN_DOLLAR_VOL": (5_000_000, 3_000_000, 40_000_000),
    "CATALYST_MIN_FLOAT":      (5_000_000, 2_000_000, 25_000_000),
    "CATALYST_MIN_MARKET_CAP": (300_000_000, 100_000_000, 1_000_000_000),
}

# Knob -> the feedback-row metric whose distribution drives a tighten.
_METRIC = {
    "CATALYST_MIN_PRICE": "price",
    "CATALYST_MIN_DOLLAR_VOL": "dollar_vol",
    "CATALYST_MIN_FLOAT": "float_shares",
    "CATALYST_MIN_MARKET_CAP": "market_cap",
}

# Coverage-audit rejection-reason leading word -> knob to loosen.
_REASON_KNOB = {
    "price": "CATALYST_MIN_PRICE",
    "liquidity": "CATALYST_MIN_DOLLAR_VOL",
    "float": "CATALYST_MIN_FLOAT",
    "market": "CATALYST_MIN_MARKET_CAP",
}

_OVERRIDES_PATH = os.environ.get(
    "CATALYST_TUNING_OVERRIDES_PATH",
    os.path.join(os.path.dirname(_DB_PATH) or ".",
                 "catalyst_tuning_overrides.json"),
)

_WRITE_LOCK = threading.Lock()
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

# mtime-cached overrides read.
_OVR_CACHE: dict = {}
_OVR_MTIME: float = -1.0
_OVR_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalyst_tuning_log (
  ts          INTEGER NOT NULL,
  knob        TEXT NOT NULL,
  old_value   REAL,
  new_value   REAL,
  evidence    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tuning_log_ts ON catalyst_tuning_log(ts DESC);
"""


# ── env-tunable params (read inside functions so tests can monkeypatch) ──
def _max_step_frac() -> float:
    return _envf("CATALYST_AUTOTUNE_MAX_STEP", 0.15)


def _min_samples() -> int:
    return int(_envf("CATALYST_AUTOTUNE_MIN_SAMPLES", 10))


def _lookback_days() -> int:
    return int(_envf("CATALYST_AUTOTUNE_LOOKBACK_DAYS", 30))


def _loosen_min_hits() -> int:
    return int(_envf("CATALYST_AUTOTUNE_LOOSEN_HITS", 3))


def _envf(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


# ── SQLite change-log ──
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        parent = os.path.dirname(_DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


def _log_change(knob: str, old: float, new: float, evidence: dict) -> None:
    try:
        _ensure_init()
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                """INSERT INTO catalyst_tuning_log (ts, knob, old_value,
                   new_value, evidence) VALUES (?, ?, ?, ?, ?)""",
                (int(time.time()), knob, old, new, json.dumps(evidence)),
            )
            c.commit()
    except Exception:
        logger.exception("[catalyst-tuning] log_change failed")


def recent_log(limit: int = 100) -> list[dict]:
    try:
        _ensure_init()
        with contextlib.closing(_connect()) as c:
            rows = c.execute(
                "SELECT * FROM catalyst_tuning_log ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
            return [dict(r) for r in rows]
    except Exception:
        logger.exception("[catalyst-tuning] recent_log failed")
        return []


# ── overrides file (mtime-cached) ──
def _read_overrides() -> dict:
    """Return the overrides dict, reloading the JSON only when the file mtime
    changes. Never raises — returns the last good value (or {}) on any error."""
    global _OVR_CACHE, _OVR_MTIME
    with _OVR_LOCK:
        try:
            mtime = os.path.getmtime(_OVERRIDES_PATH)
        except OSError:
            # File doesn't exist (yet) -> no overrides.
            _OVR_CACHE = {}
            _OVR_MTIME = -1.0
            return {}
        if mtime != _OVR_MTIME:
            try:
                with open(_OVERRIDES_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                _OVR_CACHE = data if isinstance(data, dict) else {}
                _OVR_MTIME = mtime
            except Exception:
                logger.exception("[catalyst-tuning] reading overrides failed")
                # keep last good cache
        return dict(_OVR_CACHE)


def _write_overrides(d: dict) -> None:
    """Atomically write the overrides JSON (tmp + os.replace) and bust cache."""
    global _OVR_MTIME
    try:
        parent = os.path.dirname(_OVERRIDES_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = _OVERRIDES_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, _OVERRIDES_PATH)
        with _OVR_LOCK:
            _OVR_MTIME = -1.0  # force reload next read
    except Exception:
        logger.exception("[catalyst-tuning] writing overrides failed")


def _clamp_to_bounds(name: str, value: float) -> float:
    spec = KNOBS.get(name)
    if not spec:
        return value
    _, lo, hi = spec
    return max(lo, min(hi, value))


def get_threshold(name: str, default: float) -> float:
    """Effective threshold for a knob. Precedence:
       ENV (if set & parseable) -> overrides-file -> default.
    Override values are clamped to KNOBS bounds when the name is a known knob.
    Never raises."""
    # 1) ENV wins.
    raw = os.environ.get(name)
    if raw not in (None, ""):
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    # 2) overrides file.
    try:
        ovr = _read_overrides()
        if name in ovr:
            val = float(ovr[name])
            if name in KNOBS:
                val = _clamp_to_bounds(name, val)
            return val
    except Exception:
        logger.exception("[catalyst-tuning] get_threshold override read failed")
    # 3) default.
    return default


# ── analyzer helpers ──
def percentile(vals: list[float], p: float) -> float:
    """Sorted nearest-rank percentile (p in 0..100). No numpy."""
    if not vals:
        return 0.0
    s = sorted(vals)
    if len(s) == 1:
        return float(s[0])
    # nearest-rank: rank = ceil(p/100 * N), 1-indexed.
    import math
    rank = max(1, math.ceil((p / 100.0) * len(s)))
    rank = min(rank, len(s))
    return float(s[rank - 1])


def _loosen_hits() -> dict:
    """Tally per-knob loosen signals from the last LOOKBACK_DAYS coverage
    audits: each excluded big-mover whose rejection reason maps to a knob is a
    vote to loosen that knob. Never raises."""
    hits: dict[str, int] = {}
    try:
        from api.services.catalyst import coverage_audit
    except Exception:
        return hits
    days = _lookback_days()
    today = datetime.now(timezone.utc).date()
    for i in range(days + 1):
        d = (today - timedelta(days=i)).isoformat()
        try:
            report = coverage_audit.get_audit(d)
        except Exception:
            report = None
        if not report:
            continue
        excluded = (((report.get("buckets") or {}).get("excluded")) or [])
        for ex in excluded:
            reason = (ex.get("reason") or "")
            word = reason.split(" ")[0].lower() if reason else ""
            knob = _REASON_KNOB.get(word)
            if knob:
                hits[knob] = hits.get(knob, 0) + 1
    return hits


def _num_metric_vals(rows: list[dict], metric: str) -> list[float]:
    out = []
    for r in rows:
        v = r.get(metric)
        if isinstance(v, (int, float)) and v > 0:
            out.append(float(v))
    return out


def _sign(x: float) -> float:
    return 1.0 if x > 0 else (-1.0 if x < 0 else 0.0)


def run_autotune() -> dict:
    """Run one tuning pass over recent feedback + coverage audits. Applies at
    most one bounded step per knob, writes overrides + logs, and returns a
    summary. Never raises — returns an error dict on failure."""
    enabled = os.environ.get("CATALYST_AUTOTUNE_ENABLED", "1")
    if str(enabled).strip().lower() in ("0", "false", "no", "off"):
        return {"enabled": False, "changes": []}
    try:
        from api.services.catalyst import store
        lookback = _lookback_days()
        max_step = _max_step_frac()
        min_samples = _min_samples()
        loosen_min = _loosen_min_hits()

        bad = store.recent_feedback("bad", lookback)
        good = store.recent_feedback("good", lookback)
        loosen_hits = _loosen_hits()

        overrides = _read_overrides()
        changes = []

        for knob, (default, lo, hi) in KNOBS.items():
            metric = _METRIC[knob]
            cur = get_threshold(knob, default)
            target = None
            evidence: dict = {}

            # ── LOOSEN takes priority over TIGHTEN ──
            hits = loosen_hits.get(knob, 0)
            if hits >= loosen_min:
                target = cur * (1 - max_step)  # one step down
                evidence = {"action": "loosen", "loosen_hits": hits}
            else:
                bad_vals = _num_metric_vals(bad, metric)
                if len(bad_vals) >= min_samples:
                    cand = percentile(bad_vals, 75)
                    good_vals = _num_metric_vals(good, metric)
                    if good_vals:
                        cand = min(cand, min(good_vals))
                    if cand > cur:
                        target = cand
                        evidence = {
                            "action": "tighten",
                            "bad_samples": len(bad_vals),
                            "p75_bad": round(percentile(bad_vals, 75), 4),
                            "good_floor": (round(min(good_vals), 4)
                                           if good_vals else None),
                            "candidate": round(cand, 4),
                        }

            if target is None:
                continue

            # ── bounded step toward target, then clamp ──
            delta = target - cur
            stepped = cur + _sign(delta) * min(abs(delta), cur * max_step)
            stepped = max(lo, min(hi, stepped))

            if abs(stepped - cur) / max(cur, 1e-9) >= 0.01:
                overrides[knob] = stepped
                evidence["old"] = round(cur, 4)
                evidence["new"] = round(stepped, 4)
                _log_change(knob, cur, stepped, evidence)
                changes.append({"knob": knob, "old": cur, "new": stepped,
                                "evidence": evidence})

        if changes:
            _write_overrides(overrides)

        effective = {k: get_threshold(k, KNOBS[k][0]) for k in KNOBS}
        return {"enabled": True, "changes": changes, "effective": effective}
    except Exception as e:
        logger.exception("[catalyst-tuning] run_autotune failed")
        return {"enabled": True, "error": str(e), "changes": []}


def revert(clear: bool = False) -> dict:
    """Undo auto-tuning. clear=True wipes all overrides; otherwise restores
    each knob to the most-recent log entry's old_value. Logs the revert.
    Returns what changed. Never raises."""
    try:
        overrides = _read_overrides()
        if clear:
            reverted = list(overrides.keys())
            for knob in reverted:
                old = overrides.get(knob)
                _log_change(knob, old, None, {"action": "revert_clear"})
            _write_overrides({})
            return {"cleared": True, "reverted": reverted}

        # Restore the most-recent old_value per currently-set knob.
        log = recent_log(limit=500)
        prior_by_knob: dict[str, float] = {}
        for entry in log:  # newest first
            k = entry.get("knob")
            if k in overrides and k not in prior_by_knob:
                prior_by_knob[k] = entry.get("old_value")

        reverted = []
        for knob, old_val in prior_by_knob.items():
            new_overrides_val = old_val
            cur = overrides.get(knob)
            if new_overrides_val is None:
                overrides.pop(knob, None)
            else:
                overrides[knob] = new_overrides_val
            _log_change(knob, cur, new_overrides_val, {"action": "revert"})
            reverted.append({"knob": knob, "from": cur, "to": new_overrides_val})
        _write_overrides(overrides)
        return {"cleared": False, "reverted": reverted}
    except Exception as e:
        logger.exception("[catalyst-tuning] revert failed")
        return {"error": str(e)}


def effective_thresholds() -> dict:
    """Per knob: {value, source} where source is env/auto/default."""
    out = {}
    ovr = _read_overrides()
    for knob, (default, _lo, _hi) in KNOBS.items():
        raw = os.environ.get(knob)
        if raw not in (None, ""):
            try:
                float(raw)
                source = "env"
            except (TypeError, ValueError):
                source = "auto" if knob in ovr else "default"
        elif knob in ovr:
            source = "auto"
        else:
            source = "default"
        out[knob] = {"value": get_threshold(knob, default), "source": source}
    return out
