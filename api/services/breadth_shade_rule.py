"""The Breadth Monitor's shading rule, ONCE, for every Python reader.

`app/src/pages/breadth/shading.js` draws a Monitor cell's shade; this module is its Python twin,
line for line. Two readers use it and neither keeps a copy:

  • tools/breadth/calibrate_breadth_shading.py — freezes the cutoffs and prints the value-free
    report (re-exports everything below under its historical names);
  • api/services/breadth_reading.py — the drill window's "where does this reading sit" answer
    (`GET /api/breadth-monitor/reading`), so the level a member reads in the window is the level
    the cell was shaded with.

⛔ Change the rule here AND in shading.js, never in one of them.
"""
from __future__ import annotations

import json
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPEC_PATH = os.path.join(ROOT, "app", "src", "pages", "breadth", "shadeSpec.json")
CUTOFFS_PATH = os.path.join(ROOT, "app", "src", "pages", "breadth", "shadeCutoffs.generated.json")

LEVELS = ("notable", "strong", "extreme")
LEVEL_WORDS = {1: "Notable", 2: "Strong", 3: "Extreme"}

#: ⭐ THE WINDOW (owner 2026-11-19): every universe over ALL of its point-in-time history from here
#: (NYSE's own history starts 2009-06-11). Nothing earlier is ranked.
WINDOW_FLOOR = "2008-01-02"

#: Columns the UI shades by UCT's cutoffs on every universe (monitorUniverses.js MARKET_WIDE_COLS).
MARKET_WIDE_COLS = frozenset({
    "uct_exposure", "is_ftd", "spy_ma_stack", "qqq_ma_stack", "sp500_close", "qqq_close", "vix",
    "spy_dist_days", "qqq_dist_days", "rsp_spy_ratio", "iwm_qqq_ratio", "vix_term_structure",
    "cnn_fear_greed", "aaii_bulls", "aaii_neutral", "aaii_bears", "aaii_spread", "naaim", "cboe_putcall",
})
#: Not yet available off UCT (monitorUniverses.js). Health left this set on 2026-11-23: each
#: universe scores it with its own bands and ranks it in its own history.
NOT_PER_UNIVERSE = frozenset({"up_vol_ratio", "hvc_52w", "atr_ext_7", "new_ath"})

def numeric(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def quantile(sorted_vals: list, q: float) -> float:
    """Linear-interpolated quantile (q in 0..1) of an ascending list."""
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    pos = q * (n - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, n - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def cut_key(c: dict, field: str) -> str:
    """Mirrors shading.js `cutKey`: a share-ranked column's cutoffs live under '<key>/<per>'."""
    return f"{field}/{c['per']}" if c.get("per") else field


def shade_value(c: dict, field: str, row: dict):
    """Mirrors shading.js `shadeValue`: the raw value, or its share of row[per] for a count column."""
    v = numeric(row.get(field))
    if v is None or not c.get("per"):
        return v
    d = numeric(row.get(c["per"]))
    return v / d if d and d > 0 else None


def _paired(u, d, side):
    if u is None or d is None or u + d == 0:
        return None
    r = u / (u + d)
    if side == "up":
        return ("bull", 2) if r >= 0.70 else ("bull", 1) if r >= 0.60 else None
    return ("bear", 2) if r <= 0.30 else ("bear", 1) if r <= 0.40 else None


def is_backtested_row(row: dict, universe: str = "uct") -> bool:
    """A UCT row before the collector's first session (`_reconstructed`): today's UCT list run
    backward, not the universe as it was (owner 2026-11-22). shading.js `isBacktestedRow`."""
    # a rebuilt point-in-time row (`_uct_pit`, breadth_uct_pit.py) is real history again
    r = row or {}
    return (not universe or universe == "uct") and bool(r.get("_reconstructed")) and not r.get("_uct_pit")


def is_backtested_cell(key: str, row: dict, universe: str = "uct") -> bool:
    """Never shaded and never ranked: a per-universe column on a back-tested UCT row. Market-wide
    columns do not depend on the list. shading.js `isBacktestedCell`."""
    return is_backtested_row(row, universe) and key not in MARKET_WIDE_COLS


def shade(row: dict, key: str, spec: dict, cut: dict, universe: str = "uct"):
    """(tone 'bull'|'bear', level 1..3) or None — shading.js `shadeFor`, line for line."""
    c = spec["cols"].get(key)
    if not c or cut is None:
        return None
    if is_backtested_cell(key, row, universe):
        return None
    kind = c.get("kind")
    if kind == "flag":
        return ("bull", 2) if row.get(key) else None
    if kind == "pair":
        mine, other = numeric(row.get(key)), numeric(row.get(c["with"]))
        u, d = (mine, other) if c["side"] == "up" else (other, mine)
        return _paired(u, d, c["side"])
    field = c.get("basis") or key
    v = shade_value(c, field, row)
    t = cut["cols"].get(cut_key(c, field))
    if v is None or t is None:
        return None
    idx = {lv: cut["grid"].index(spec["pcts"][lv]) for lv in LEVELS}
    sides = c.get("sides", "both")
    floors = (c.get("shareFloors") if (c.get("per") and universe != "uct") else c.get("floors")) or {}
    fv = numeric(row.get(field)) if (c.get("per") and universe == "uct") else v
    level, end = 0, None
    if c.get("zero"):
        if v > 0:
            for i, lv in enumerate(LEVELS, 1):
                if v >= max(t["hi"][idx[lv]], 0):
                    level, end = i, "high"
            if "high" in floors and fv >= floors["high"]:
                level, end = max(level, 2), "high"
        elif v < 0:
            for i, lv in enumerate(LEVELS, 1):
                if v <= min(t["lo"][idx[lv]], -max(t["hi"][idx[lv]], 0)):
                    level, end = i, "low"
            if "low" in floors and fv <= floors["low"]:
                level, end = max(level, 2), "low"
        if not level:
            return None
        return ("bull" if end == c["bull"] else "bear", level)
    if sides in ("both", "high") and v > t["mid"]:
        for i, lv in enumerate(LEVELS, 1):
            if v >= t["hi"][idx[lv]]:
                level, end = i, "high"
        if "high" in floors and fv >= floors["high"]:
            level, end = max(level, 2), "high"
    if not level and sides in ("both", "low") and v < t["mid"]:
        for i, lv in enumerate(LEVELS, 1):
            if v <= t["lo"][idx[lv]]:
                level, end = i, "low"
    if sides in ("both", "low") and "low" in floors and fv <= floors["low"]:
        level, end = max(level, 2), "low"
    if not level:
        return None
    return ("bull" if end == c["bull"] else "bear", level)


# ── The committed spec + frozen cutoffs (the files the UI imports) ───────────────
_FILES: dict = {}


def _load(path: str):
    try:
        st = os.stat(path).st_mtime_ns
    except OSError:
        return None
    hit = _FILES.get(path)
    if hit and hit[0] == st:
        return hit[1]
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    _FILES[path] = (st, doc)
    return doc


def load_spec() -> dict:
    return _load(SPEC_PATH) or {"pcts": {}, "cols": {}}


def load_cutoffs() -> dict:
    """`{universe: cutoffs}` (a pre-universe single-cutoffs file is UCT's)."""
    doc = _load(CUTOFFS_PATH) or {}
    if "cols" in doc:
        doc = {"uct": {k: v for k, v in doc.items() if k != "_doc"}}
    return {k: v for k, v in doc.items() if k != "_doc"}


def cutoffs_for(universe: str, key: str):
    """shading.js `cutoffsFor`: UCT's for UCT and every market-wide column, else the universe's own."""
    every = load_cutoffs()
    if not universe or universe == "uct" or key in MARKET_WIDE_COLS:
        return every.get("uct")
    return every.get(universe)


# ── UCT's long window: the Monitor's deep rows with the point-in-time series laid over ───
def read_export(path: str):
    """A `===BEGIN===` gzip+base64 JSON export (tools' read-only production copies)."""
    import base64
    import gzip
    txt = open(path, encoding="utf-8").read()
    b64 = txt.split("===BEGIN===", 1)[1].split("===END===", 1)[0].strip()
    return json.loads(gzip.decompress(base64.b64decode(b64)))


def load_uct_deep_rows(deep_path: str, exposure_db: str = "") -> list:
    """ASC rows of a read-only export of the Monitor's own UCT deep history (what the cells show),
    `exposure_db`'s `uct_exposure` laid over where it has one.

    ⛔ (2026-11-22) No `uct_backtest` overlay any more. That V2 series is "today's pinned list"
    run backward (tools/breadth_v2/pinned/breadth_corrected_pass.py), not a point-in-time
    universe, and it replaced values the cells never displayed, so the cutoffs and the drill
    window's reading did not describe the sheet. Back-tested sessions are excluded from every
    ranking by `is_backtested_cell` instead."""
    exp = {}
    if exposure_db:
        import sqlite3
        c = sqlite3.connect(f"file:{exposure_db}?mode=ro", uri=True)
        for d, mj in c.execute("SELECT date, metrics FROM breadth_snapshot_numeric"):
            v = json.loads(mj).get("uct_exposure")
            if v is not None:
                exp[d] = v
        c.close()
    deep = {r["date"]: r for r in read_export(deep_path) if r.get("date") and not r.get("_live")}
    rows = []
    for d in sorted(deep):
        r = dict(deep[d])
        if d in exp:
            r["uct_exposure"] = exp[d]
        rows.append(r)
    return rows
