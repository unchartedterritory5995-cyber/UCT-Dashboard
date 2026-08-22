"""Whole-market Finviz pull — float/short/ownership for the screener.

ONE export.ashx request per night (02:45 ET job), pinned `c=` ids measured
by tools/screener_wave2_finviz_ids.py on 2026-08-22, parsed BY HEADER NAME
(the contract), written atomically to a JSON artifact the builder joins.

⛔ The whole-market pull carries NO `f=` filter, so the fail-open token
trap cannot bite — there is no clause to silently drop. What CAN bite is
units: Finviz mixes suffixed absolutes ('1.5B'), raw-thousands, '3.45%'
strings, and — for `shares_outstanding`/`float_shares` specifically, per the
2026-08-22 SCALE ASSUMPTION adjudication below `_C_IDS` — a BARE number
that is raw millions, no suffix. `_parse` handles all these shapes and the
tests pin each.
⛔ Never on a request path (90s-class fetch); the job owns it, with an
in-flight flag. ⛔ An empty/short result never overwrites a good artifact.

──────────────────────────────────────────────────────────────────────────
THE AUTH/URL/UA/TIMEOUT/REDIRECT PLUMBING — MIRRORED, NOT IMPORTED
──────────────────────────────────────────────────────────────────────────
`api.services.industry_map._fetch_finviz_universe` already owns this exact
token/URL/User-Agent/timeout/redirect handling (`FINVIZ_API_KEY` env var,
`https://elite.finviz.com/export.ashx?v=152&c=...&auth=...`,
`{"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}`, `timeout=90.0`,
`follow_redirects=True`), and it was READ first, per the task ruling. It was
**mirrored rather than imported**: its `c=1,2,3,4` is hardcoded for
Ticker/Company/Sector/Industry, so calling it directly can never return the
seven float/short/ownership columns this module needs — there is no way to
"import it instead of mirroring" a helper whose column list is baked in.
`_fetch_finviz_csv_text` below is the parametrized twin: identical fetch
contract (never raises; "" on a missing token or any request failure),
different (configurable) `c=` list.

──────────────────────────────────────────────────────────────────────────
STEP 0 — DONE_WITH_CONCERNS: the id probe could not be run against a real
token in this environment (no `FINVIZ_API_KEY` in this worktree's shell or
`.env`; `tools/screener_wave2_finviz_ids.py` was run and printed exactly
that). `_C_IDS` below is therefore the WAVE-1 MEMORY CENSUS — the classic
Finviz export field numbering already relied on elsewhere in this repo
(`industry_map.py`'s `c=1,2,3,4` == Ticker/Company/Sector/Industry is that
same numbering) — not a fresh measurement:

    24 Shares Outstanding · 25 Shares Float · 26 Insider Ownership ·
    28 Institutional Ownership · 30 Float Short (Short Float) ·
    31 Short Ratio (Days to Cover)

`float_pct` ("Float %") had NO confident id in that classic ~70-field
census — Finviz's `v152` elite export runs to ~150 columns, and Float % was
assumed to be a newer field somewhere past the classic range. `_C_IDS`
carried a placeholder (129) inside the valid 0-149 span, flagged UNVERIFIED.

⭐ THIS WAS SAFE BY CONSTRUCTION, NOT BY LUCK: the parse contract is HEADER
NAME, never id. A wrong `_C_IDS` entry just changes which (irrelevant)
column Finviz happens to return at that position — it cannot silently swap
in the wrong VALUE, because that returned column's header will not equal
the `_HEADERS` string being matched, so it would be counted in
`missing_headers` exactly like a column Finviz dropped outright.

⛔ 2026-08-22 ADJUDICATION — closes the loop above: `c=129` was measured
LIVE against elite.finviz.com and is "Exchange", not "Float %". The full
125-153 id range was walked end to end (All-Time High/Low, EPS/Revenue
Surprise, Exchange, Dividend TTM/Ex Date, EPS/Sales YoY TTM, 52W Range,
News Time/URL/Title, Perf 3Y/5Y/10Y, AH Volume, EPS/Sales Past 3Y, EV,
EV/EBITDA, EV/Sales, Div Gr 1Y/3Y/5Y, Daily Digest, Security Type) and NO
"Float %" column exists anywhere in the v152 export — Finviz only ever
renders it computed, on the UI. `float_pct` is therefore no longer
requested at all (removed from `_C_IDS`/`_HEADERS`); it is DERIVED instead
from the two share counts this module already carries
(`float_shares / shares_outstanding * 100`, both post-SCALE-ASSUMPTION-fix
absolute counts — see that comment below `_C_IDS`), honest-`None` when
either side is absent or `shares_outstanding` is `0`. This module remains
`float_pct`'s ONE writer — see `_derive_float_pct` and `read_finviz_fields`.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import tempfile
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# ── column contract ──────────────────────────────────────────────────────

_TICKER_ID = 1  # matches industry_map's c=1,2,3,4 (Ticker/Company/Sector/Industry)

# snapshot column -> Finviz `c=` id. See the module docstring's
# DONE_WITH_CONCERNS note (all six MEASURED — the former seventh,
# `float_pct`, was an UNVERIFIED placeholder that the 2026-08-22
# ADJUDICATION removed rather than confirmed; it is derived, not requested).
# Ids only SELECT which columns come back; parsing is by the header name in
# `_HEADERS`, so a wrong id here degrades to a `missing_headers` entry
# rather than a wrong value.
_C_IDS = {
    "shares_outstanding": 24,
    "float_shares": 25,
    # float_pct ("Float %") REMOVED 2026-08-22 — no such column exists in the
    # v152 export (see the module docstring's ADJUDICATION). Derived instead
    # in `_derive_float_pct` / `read_finviz_fields`.
    "short_float_pct": 30,
    "short_ratio": 31,
    "insider_own_pct": 26,
    "inst_pct": 28,
}

_HEADERS = {
    # snapshot column -> the header Finviz returns (measured; ids in _C_IDS)
    "shares_outstanding": "Shares Outstanding",
    "float_shares":       "Shares Float",
    "short_float_pct":    "Short Float",
    "short_ratio":         "Short Ratio",
    "insider_own_pct":    "Insider Ownership",
    "inst_pct":           "Institutional Ownership",
}
# SCALE ASSUMPTION — ADJUDICATED 2026-08-22 (prod receipt): `shares_outstanding`
# /`float_shares` do NOT arrive suffixed. Finviz's elite export serves these
# two columns as BARE RAW MILLIONS, no suffix at all (Market Cap was the
# Wave-1 instance of the same trap) — confirmed on the first production
# pull's NVDA row (`shares_outstanding=24221`, `float_shares=23280.5`; true
# values 24.22B/23.28B, eyeballed against a known float) and fixed at the
# `_parse` boundary: a SUFFIXED value ("1.5B") still parses via the suffix
# exactly as before; a BARE numeric value on one of these two columns is
# Finviz raw-millions and is multiplied by 1e6. Never guess per-magnitude
# beyond that one rule — a bare "8.2" IS a legitimate 8.2M-share microcap
# float; the export never emits an absolute bare share count, which is the
# whole asymmetry the rule leans on. See `_RAW_MILLIONS_COLUMNS` and
# `_parse`'s `raw_millions` argument.
_RAW_MILLIONS_COLUMNS = {"shares_outstanding", "float_shares"}
_PCT_COLUMNS = {"short_float_pct", "insider_own_pct", "inst_pct"}
_MIN_ROWS = 1000        # an artifact below this is a failed pull, not a market
_STALE_DAYS = 4


def _parse(text, is_pct, raw_millions=False):
    """'1.5B' -> 1.5e9 · '3.45%' -> 3.45 · '12.3' -> 12.3 · '-'/'' -> None.

    ``raw_millions=True`` (only ever passed for `_RAW_MILLIONS_COLUMNS`) marks
    a column where Finviz serves a BARE (no-suffix) number as raw millions —
    2026-08-22 adjudication, see the SCALE ASSUMPTION comment above
    `_RAW_MILLIONS_COLUMNS`. A SUFFIXED value on that same column ("1.5B")
    still parses via the suffix exactly like any other column; the ×1e6 only
    applies when NO suffix was present.
    """
    s = (text or "").strip().replace(",", "")
    if not s or s == "-":
        return None
    if s.endswith("%"):
        s = s[:-1]
        try:
            return float(s)
        except ValueError:
            return None
    mult = 1.0
    suffixed = False
    if s and s[-1] in "KMBT":
        mult = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[s[-1]]
        s = s[:-1]
        suffixed = True
    try:
        val = float(s) * mult
    except ValueError:
        return None
    if raw_millions and not suffixed:
        val *= 1e6
    return val


def _derive_float_pct(row):
    """``float_shares / shares_outstanding * 100``, honest-``None``.

    2026-08-22: Finviz's v152 export has NO "Float %" column (see the module
    docstring's ADJUDICATION) — this is `float_pct`'s ONE writer, deriving it
    from the two already-scaled (SCALE ASSUMPTION fix, above) share counts
    this module carries. `None` when either side is absent or
    `shares_outstanding` is `0` — never a divide-by-zero, never a fabricated
    percentage.
    """
    fs = row.get("float_shares")
    so = row.get("shares_outstanding")
    if fs is None or so is None or not so:
        return None
    return round(fs / so * 100, 2)


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


# ── the provider (network; thin; monkeypatchable) ────────────────────────

def _fetch_finviz_csv_text() -> str:
    """Mirror of industry_map._fetch_finviz_universe's fetch contract
    (same token env var, URL shape, UA, timeout, redirect handling),
    parametrized to the Wave 2 `c=` ids instead of the hardcoded 1,2,3,4.

    Returns raw CSV text, or "" on a missing token or any request failure
    — never raises, identical failure contract to the mirrored helper.
    """
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        log.warning("[finviz_universe] FINVIZ_API_KEY not set — pull skipped")
        return ""
    c = ",".join(str(i) for i in sorted({_TICKER_ID, *_C_IDS.values()}))
    url = f"https://elite.finviz.com/export.ashx?v=152&c={c}&auth={token}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}
    try:
        import httpx
        r = httpx.get(url, headers=headers, timeout=90.0, follow_redirects=True)
        r.raise_for_status()
        return r.text
    except Exception as e:                                     # noqa: BLE001
        log.warning("[finviz_universe] Finviz whole-market fetch failed: %s", e)
        return ""


# ── the artifact ──────────────────────────────────────────────────────────

def _artifact_path() -> str:
    override = os.environ.get("SCREENER_FINVIZ_ARTIFACT")
    if override:
        return override
    base = os.environ.get("DATA_DIR", "/data")
    if os.path.isdir(base):
        return os.path.join(base, "screener_finviz.json")
    # Local dev fallback — repo-local data dir, mirrors snapshot_db.get_db_path.
    os.makedirs("./data", exist_ok=True)
    return "./data/screener_finviz.json"


def _atomic_write_json(path: str, payload: dict) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".screener_finviz_", suffix=".tmp",
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


# ── the entry points ────────────────────────────────────────────────────

def run_pull() -> dict:
    """Fetch the whole market once, parse by header name, atomically write
    the artifact. Receipt: {rows, kept, missing_headers, wrote, as_of}.

    `rows` is every CSV data row seen (regardless of parse outcome); `kept`
    is tickers that ended up with at least one parsed column. A header
    Finviz didn't return drops ONLY that column (`missing_headers`,
    recorded by snapshot-column name), never the whole pull. A `kept` below
    `_MIN_ROWS` is treated as a failed pull, not a quiet market — nothing
    is written and the prior artifact (if any) is left completely alone.
    """
    as_of = _now_iso()
    text = _fetch_finviz_csv_text()
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = list(reader.fieldnames or [])
    data_rows = list(reader)

    missing_headers = sorted(col for col, hdr in _HEADERS.items()
                              if hdr not in fieldnames)
    present = {col: hdr for col, hdr in _HEADERS.items() if hdr in fieldnames}

    out_rows: dict[str, dict] = {}
    for raw in data_rows:
        ticker = (raw.get("Ticker") or "").strip().upper()
        if not ticker:
            continue
        row = {}
        for col, hdr in present.items():
            val = _parse(raw.get(hdr), col in _PCT_COLUMNS,
                         raw_millions=col in _RAW_MILLIONS_COLUMNS)
            if val is not None:
                row[col] = val
        if row:
            out_rows[ticker] = row

    kept = len(out_rows)
    receipt = {
        "rows": len(data_rows),
        "kept": kept,
        "missing_headers": missing_headers,
        "wrote": False,
        "as_of": as_of,
    }

    if kept < _MIN_ROWS:
        log.warning("[finviz_universe] refusing to write: kept=%d < "
                    "_MIN_ROWS=%d — prior artifact preserved", kept, _MIN_ROWS)
        return receipt

    _atomic_write_json(_artifact_path(), {
        "as_of": as_of,
        "missing_headers": missing_headers,
        "rows": out_rows,
    })
    receipt["wrote"] = True
    log.info("[finviz_universe] pull complete: rows=%d kept=%d "
             "missing_headers=%s wrote=True", len(data_rows), kept,
             missing_headers)
    return receipt


def read_finviz_fields(targets, failures=None) -> dict:
    """{TICKER: {column: value}} with PER-COLUMN presence.

    A column named in the stored `missing_headers` census is absent from
    EVERY ticker's dict (the `context_joins.read_index_flags` idiom) — a
    guarded subscript-assign, never a blanket `.get(col, None)` default, so
    downstream can tell "this source never answered for this column" apart
    from "this ticker's value is genuinely unknown". A ticker with no row in
    the artifact at all (not covered by the whole-market pull) gets `{}`.

    Artifact absent or short (< `_MIN_ROWS`) -> `_note(..., "missing")` ->
    `{}`. Artifact older than `_STALE_DAYS` -> served but counted
    (`_note(..., f"stale:{age_days}d")`).

    ⚠️ FIX ROUND 1 (2026-08-22 review, Important 2): valid JSON that is not
    an object (`null`, a bare list, ...) used to reach `payload.get("rows")`
    unguarded and raise `AttributeError` — the sibling reader
    `earnings_dates.read_earnings_dates` already guards this exact shape
    (see its own `isinstance(blob, dict)` check); mirrored here.

    ⚠️ FIX ROUND 2 (2026-08-22 receipts-fix): `float_pct` is no longer a
    requested Finviz column (see the module docstring's 2026-08-22
    ADJUDICATION) — it is DERIVED here, per ticker, from the already-returned
    `float_shares`/`shares_outstanding` (both post-SCALE-ASSUMPTION-fix
    absolute counts): `float_shares / shares_outstanding * 100`, rounded to
    2, honest-`None` when either side is absent (including when its own
    header was in `missing_headers`, which drops it from `row` before the
    derivation ever sees it) or `shares_outstanding` is `0`. See
    `_derive_float_pct` — this is the one place `float_pct` reaches a caller.
    """
    path = _artifact_path()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        _note(failures, "finviz_universe", "missing")
        return {}
    if not isinstance(payload, dict):
        _note(failures, "finviz_universe", "missing")
        return {}

    rows = payload.get("rows") or {}
    if len(rows) < _MIN_ROWS:
        _note(failures, "finviz_universe", "missing")
        return {}

    missing_headers = set(payload.get("missing_headers") or ())
    age_days = _artifact_age_days(payload.get("as_of"))
    if age_days is not None and age_days > _STALE_DAYS:
        _note(failures, "finviz_universe", f"stale:{age_days}d")

    cols = [c for c in _HEADERS if c not in missing_headers]

    out = {}
    for t in (targets or ()):
        tu = str(t).upper()
        src = rows.get(tu) or {}
        row = {}
        for col in cols:
            if col in src:
                row[col] = src[col]
        fp = _derive_float_pct(row)
        if fp is not None:
            row["float_pct"] = fp
        out[tu] = row
    return out
