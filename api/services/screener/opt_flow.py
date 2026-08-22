"""Web-side reader + nightly pull for the flow-worker's per-ticker options
aggregate.

`api/flow_opt_aggregate.py` (flow-worker, Task A4) computes a per-ticker
options-flow aggregate nightly from the raw `flow` ledger and uploads it to
R2 at `screener/opt_flow_agg.json`: `{"as_of": ..., "days": [...], "rows":
{SYM: {"opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d"}},
"census": {...}}`.

This module is the WEB side of that bridge: `run_pull()` (02:55 ET, after the
02:45/02:50 Wave 2 siblings) pulls that R2 object down to a local artifact,
and `read_opt_flow_fields()` serves it to the snapshot builder — the
`finviz_universe` per-column-presence clone (`api/services/screener/finviz_universe.py`).

⛔ A short/absent/malformed R2 object REFUSES: nothing is written and the
prior local artifact (if any) is left completely alone — the same
`_MIN_ROWS`-shaped contract finviz_universe uses, here `_MIN_TICKERS = 25`
(an aggregate with a dozen names is a failed nightly run upstream, not a
quiet options market).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from api.services import data_sync

log = logging.getLogger(__name__)

# ── contract ─────────────────────────────────────────────────────────────

_R2_KEY = "screener/opt_flow_agg.json"
_MIN_TICKERS = 25       # an artifact below this is a failed nightly run, not a quiet market
_STALE_DAYS = 3

_FIELDS = ("opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d")


def _artifact_path() -> str:
    override = os.environ.get("SCREENER_OPTFLOW_ARTIFACT")
    if override:
        return override
    base = os.environ.get("DATA_DIR", "/data")
    if os.path.isdir(base):
        return os.path.join(base, "screener_opt_flow.json")
    # Local dev fallback — repo-local data dir, mirrors finviz_universe.
    os.makedirs("./data", exist_ok=True)
    return "./data/screener_opt_flow.json"


def _atomic_write_json(path: str, payload: dict) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".screener_opt_flow_", suffix=".tmp",
                                     dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def _artifact_age_days(as_of):
    if not as_of:
        return None
    try:
        dt = datetime.fromisoformat(str(as_of))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).days


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


# ── the entry points ────────────────────────────────────────────────────

def run_pull() -> dict:
    """Pull A4's nightly `screener/opt_flow_agg.json` R2 object down to the
    web pod's local artifact.

    Receipt: `{"tickers": n, "wrote": bool, "as_of": <payload's as_of, or
    None>, "reason": None | "no_r2_object" | "not_a_dict" |
    "rows_not_a_dict" | "below_floor"}`.

    A missing R2 object (`get_bytes` -> None; unconfigured R2 or the key
    absent — never raises), a payload that isn't a JSON object (incl. a bare
    `null`), a payload whose `rows` isn't a dict, or fewer than
    `_MIN_TICKERS` rows all REFUSE: nothing is written, the prior local
    artifact (if any) is preserved byte-for-byte.
    """
    raw = data_sync.get_bytes(_R2_KEY)
    if raw is None:
        log.warning("[opt_flow] R2 object %s missing/unconfigured — refusing, "
                    "prior artifact preserved", _R2_KEY)
        return {"tickers": 0, "wrote": False, "as_of": None, "reason": "no_r2_object"}

    try:
        payload = json.loads(raw)
    except ValueError:
        log.warning("[opt_flow] R2 object %s is not valid JSON — refusing", _R2_KEY)
        return {"tickers": 0, "wrote": False, "as_of": None, "reason": "not_a_dict"}

    if not isinstance(payload, dict):
        log.warning("[opt_flow] R2 object %s is not a JSON object — refusing", _R2_KEY)
        return {"tickers": 0, "wrote": False, "as_of": None, "reason": "not_a_dict"}

    rows = payload.get("rows")
    if not isinstance(rows, dict):
        log.warning("[opt_flow] R2 payload has no dict 'rows' — refusing")
        return {"tickers": 0, "wrote": False, "as_of": payload.get("as_of"),
                 "reason": "rows_not_a_dict"}

    tickers = len(rows)
    if tickers < _MIN_TICKERS:
        log.warning("[opt_flow] refusing to write: tickers=%d < _MIN_TICKERS=%d "
                    "— prior artifact preserved", tickers, _MIN_TICKERS)
        return {"tickers": tickers, "wrote": False, "as_of": payload.get("as_of"),
                 "reason": "below_floor"}

    _atomic_write_json(_artifact_path(), payload)
    log.info("[opt_flow] pull complete: tickers=%d as_of=%s wrote=True",
             tickers, payload.get("as_of"))
    return {"tickers": tickers, "wrote": True, "as_of": payload.get("as_of"),
             "reason": None}


def read_opt_flow_fields(targets, failures=None) -> dict:
    """`{TICKER: {opt_net_premium_1d, opt_bull_pct_1d, opt_net_premium_5d}}`
    with PER-COLUMN presence — the `finviz_universe.read_finviz_fields` clone.

    A guarded subscript-assign per column, never a blanket `.get(col, None)`
    default: a column A4's aggregate never computed for a given ticker is
    absent from that ticker's dict, not a fabricated `None`. A ticker with
    no row in the artifact at all gets `{}`.

    Artifact absent, unreadable, not a JSON object (incl. a bare `null`), or
    short (< `_MIN_TICKERS`) -> `_note(..., "missing")` -> `{}`. Artifact
    older than `_STALE_DAYS` -> served but counted (`_note(...,
    f"stale:{age_days}d")`).
    """
    path = _artifact_path()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        _note(failures, "opt_flow", "missing")
        return {}
    if not isinstance(payload, dict):
        _note(failures, "opt_flow", "missing")
        return {}

    rows = payload.get("rows")
    if not isinstance(rows, dict) or len(rows) < _MIN_TICKERS:
        _note(failures, "opt_flow", "missing")
        return {}

    age_days = _artifact_age_days(payload.get("as_of"))
    if age_days is not None and age_days > _STALE_DAYS:
        _note(failures, "opt_flow", f"stale:{age_days}d")

    out = {}
    for t in (targets or ()):
        tu = str(t).upper()
        src = rows.get(tu)
        if not isinstance(src, dict):
            src = {}
        row = {}
        for col in _FIELDS:
            if col in src:
                row[col] = src[col]
        out[tu] = row
    return out
