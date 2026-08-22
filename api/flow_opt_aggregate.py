"""flow_opt_aggregate.py — nightly per-ticker options-flow aggregate for the
Screener (Wave 5, Task A4).

Computes THREE snapshot columns from the raw `flow` ledger and ships them to
the web pod as a small JSON artifact:
    opt_net_premium_1d   — bull premium minus bear premium, newest session only
    opt_bull_pct_1d       — bull premium as a % of CLASSIFIED premium, newest
                             session only (K3: unclassified/blank-Side rows
                             are directionless by honesty, not by bug, and are
                             excluded from BOTH the numerator and denominator)
    opt_net_premium_5d    — the same net-premium math over the 5 newest
                             sessions

SCOPE: `source='stocks'` ONLY. SPY/QQQ/IWM/XL* and the rest of the ETF
complex live under `source='indexes'` in flow.db (routers/signature.py) — an
unscoped scan would silently zero every ETF. This is a deliberate absence
recorded in the Wave 5 plan (map 3 §2, plan "Deliberate absences"), not an
oversight; ETF opt_* coverage is out of scope for this column family.

WHY THIS RUNS HERE: flow.db lives on the flow-worker's own Railway volume
(single-attach) post P5-cutover; web's copy is a FROZEN pre-cutover snapshot
that must never be read for anything live. Shipping ~700k raw tape rows to
web nightly to compute a ~200KB aggregate would be wasteful and would put a
live cross-service HTTP dependency inside web's 03:00 build window — so the
aggregation happens where the data already is, and only the small result
crosses the wire (R2, `api/services/data_sync.py` — the same rail
`flow_backup.py` already proves nightly).

WHY 02:35 ET: the job trails the 02:30 ET R2 backup (`flow_backup.py`)
deliberately — different files, and the tape is idle at that hour, so there
is no read/write contention with either the backup snapshot or the (long
since idle) OPRA writer.

DATE WINDOWS (K1): `CreatedDate` is unpadded `M/D/YYYY` TEXT — lexicographic
ordering is wrong by construction ("9/9/2026" > "10/1/2026" as strings, even
though October is newer). Windows are resolved by pulling every DISTINCT
CreatedDate and parsing+sorting in Python (mirrors `FlowDB._resolve_dates` /
`flow_summary._latest_date`, both of which do the same thing independently
rather than share one helper — this module continues that established
per-module idiom rather than introducing a new cross-module dependency).

DIRECTION / DROP MATH — SINGLE AUTHORITY, TRANSCRIBED NOT RE-DERIVED:
`api.flow_summary.compute_top_conviction` is the one authority for "what
counts as a bullish/bearish print" (ML/-type drop, RED-color drop, the
C/P x Side direction table, the lottery-ticket OTM filter, the deep-ITM
block/arb filter). Its small format-parsing primitives (`_f`, `_to_cp`,
`_side`, `_color`, `_parse_exp`) are IMPORTED as-is below. The larger inline
rule block (direction + lottery + arb) is TRANSCRIBED into `_classify()` rather than
extracted into a shared helper, because `api/flow_summary.py` is NOT in the
flow-worker's Railway watch-path list (K8) — editing it to carve out a
shared function would change live flow-worker behavior (the board math every
user-facing conviction read depends on) without a watched-path deploy
actually shipping that edit. `_classify()` names `compute_top_conviction` as
its authority in its own docstring, and
`tests/test_flow_opt_aggregate.py::test_agrees_with_compute_top_conviction`
is the MANDATORY agreement test that keeps the transcription honest: it runs
one shared fixture through both `compute_top_conviction` and this module's
full pipeline and asserts they agree on each ticker's net sign and bull %.

Never raises: `run_aggregate()` is called from an APScheduler job. Every
failure mode (missing/corrupt DB, R2 unconfigured, local-disk write failure)
degrades to a receipt field, never an exception. A DB read failure OR a
zero-row scan REFUSES to write either artifact at all (receipt `"db":
"failed"`) rather than let an empty/partial read clobber a last-known-good
artifact — see `run_aggregate`'s own docstring for the exact rule.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
from datetime import date as _date

from api.flow_summary import _color, _f, _parse_exp, _side, _to_cp
from api.services import data_sync

log = logging.getLogger(__name__)

# ── contract (mirrors api/services/screener/opt_flow.py, the web-side reader) ──
R2_KEY = "screener/opt_flow_agg.json"
_ARTIFACT_ENV = "FLOW_OPT_AGG_ARTIFACT"
_DEFAULT_ARTIFACT = "/data/flow_opt_agg.json"

_WINDOW_DAYS = 5

_SELECT_COLS = (
    "CreatedDate", "Symbol", "Type", "CallPut", "Side", "Strike", "Spot",
    "Premium", "Volume", "Color", "ExpirationDate", "Dte", "MktCap",
)


def _db_path() -> str:
    """Read at CALL TIME (never cached at import) so a test's
    `monkeypatch.setenv("FLOW_DB_PATH", tmp)` reaches this even though the
    module was already imported."""
    return os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def _artifact_path() -> str:
    """Local mirror path — env/monkeypatch seam first, the real flow-worker
    volume path only as the production default. Read at call time, same
    reasoning as `_db_path`."""
    return os.environ.get(_ARTIFACT_ENV) or _DEFAULT_ARTIFACT


# ── date-window resolution (K1) ─────────────────────────────────────────────

def _parse_date_mdy(raw) -> _date | None:
    """Parse an unpadded `M/D/YYYY` CreatedDate string to a `date`.

    Small transcription of the same 5-line parse that already lives
    independently in both `FlowDB._parse_date_mdy` and
    `flow_summary._parse_date_mdy` — not the direction/drop math this module
    is careful to single-source, just format parsing."""
    try:
        parts = str(raw).strip().split("/")
        if len(parts) == 3:
            m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
            return _date(y, m, d)
    except (ValueError, IndexError, TypeError):
        pass
    return None


def _resolve_windows(conn) -> list[tuple[_date, str]]:
    """Distinct `CreatedDate` values for `source='stocks'`, parsed and sorted
    newest-first, capped to the `_WINDOW_DAYS` newest — the
    `FlowDB._resolve_dates(conn, source, days=5)` precedent (K1: a string
    ORDER BY / MAX / BETWEEN on this column is wrong by construction)."""
    cur = conn.execute("SELECT DISTINCT CreatedDate FROM flow WHERE source = 'stocks'")
    dated = []
    for (raw,) in cur.fetchall():
        d = _parse_date_mdy(raw)
        if d is not None:
            dated.append((d, raw))
    dated.sort(key=lambda x: x[0], reverse=True)
    return dated[:_WINDOW_DAYS]


# ── direction/drop math — TRANSCRIBED, see module docstring ─────────────────
# (`_parse_exp` itself is NOT transcribed — it's the same private-helper
# category as `_f`/`_to_cp`/`_side`/`_color` above, so it's imported alongside
# them rather than copied.)

def _classify(row: dict, as_of: _date | None) -> tuple[str, float] | None:
    """Direction + premium for one flow row, or None if the row is dropped.

    TRANSCRIBED from `api.flow_summary.compute_top_conviction` (the C/P x
    Side direction table, the ML/-type + RED-color drops, the lottery-ticket
    OTM filter, and the deep-ITM block/arb filter) — see the module
    docstring for why this is a transcription rather than a shared import,
    and `tests/test_flow_opt_aggregate.py::test_agrees_with_compute_top_conviction`
    for the mandatory agreement test.

    `as_of` is this ROW's own trade date (its parsed `CreatedDate`), not a
    single "today" for the whole run — unlike the live conviction board
    (which only ever looks at one day), this aggregate mixes up to 5
    different trade dates in one pass, and DTE must be measured as-of each
    trade's own date to mean anything.

    K3: a blank/unclassified `Side` falls through every direction branch
    below to `direction = None` and is dropped here — excluded from both the
    net-premium numerator and the bull-% denominator, by honesty, not by bug.
    """
    type_raw = (row.get("Type") or "").upper().strip()
    is_ml = type_raw == "ML/" or type_raw.startswith("ML/")
    is_swp = type_raw == "SWEEP" or "SWP" in type_raw
    is_blk = type_raw == "BLOCK" or "BLK" in type_raw
    if is_ml or not (is_swp or is_blk):
        return None

    cp = _to_cp(row.get("CallPut"))
    if not cp:
        return None
    if _color(row.get("Color")) == "RED":
        return None

    premium = _f(row.get("Premium"))
    volume = _f(row.get("Volume"))
    if premium <= 0 or volume <= 0:
        return None

    strike = _f(row.get("Strike"))
    spot = _f(row.get("Spot"))
    mktcap = _f(row.get("MktCap"))
    exp = _parse_exp(row.get("ExpirationDate"))
    dte = (exp - as_of).days if (exp is not None and as_of is not None) else -1
    if dte < 0:
        try:
            dte = int(_f(row.get("Dte")))
        except (ValueError, TypeError):
            dte = -1
    if dte < 0:
        return None

    side = _side(row.get("Side"))

    direction = None
    if cp == "C":
        if side in ("AA", "A"):
            direction = "BULL"
        elif side == "BB" and is_swp:
            direction = "BEAR"
    else:
        if side in ("AA", "A"):
            direction = "BEAR"
        elif side == "BB" and is_swp:
            direction = "BULL"
    if not direction:
        return None

    # Lottery-ticket filter: way-OTM + short-DTE on mega/large caps = noise.
    if spot > 0 and 0 <= dte <= 7 and mktcap >= 10e9:
        is_otm = (cp == "C" and strike > spot) or (cp == "P" and strike < spot)
        if is_otm:
            otm_pct = abs(strike - spot) / spot * 100
            limit_pct = 10 if mktcap >= 200e9 else 15
            if otm_pct >= limit_pct:
                return None

    # Deep-ITM block = arb/rebalancing, drop it.
    if spot > 0:
        pct_from_spot = abs(strike - spot) / spot * 100
        is_itm = (cp == "C" and strike < spot) or (cp == "P" and strike > spot)
        if is_blk and is_itm and pct_from_spot >= 10:
            return None

    return direction, premium


# ── local-mirror artifact write (tmp-write + os.replace idiom) ─────────────

def _atomic_write_local(payload: dict) -> None:
    """`flow_summary._persist_board` / `finviz_universe._atomic_write_json`
    idiom: tempfile in the SAME directory, then `os.replace` — a reader never
    observes a partially-written file."""
    path = _artifact_path()
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".flow_opt_agg_", suffix=".tmp", dir=parent)
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


# ── the entry point ─────────────────────────────────────────────────────────

def run_aggregate() -> dict:
    """ONE bounded pass over the 5 newest `source='stocks'` sessions ->
    per-ticker `opt_net_premium_1d` / `opt_bull_pct_1d` / `opt_net_premium_5d`
    -> R2 (`data_sync.put_bytes`) + a local mirror. Returns the receipt
    (the artifact dict plus `"db"`/`"r2"` status keys). Never raises.

    REFUSAL (fix-round Important 2): a `sqlite3.Error` during the read, OR a
    scan that touched literally zero rows (`rows_scanned == 0` — covers a
    missing/never-initialized DB, an empty table, AND the near-impossible
    case of a mid-scan exception before any row was counted), makes BOTH
    artifacts untouched — R2 is never `put_bytes`'d and the local mirror
    keeps whatever it already had. The receipt cannot reliably tell "the DB
    failed" apart from "a genuinely quiet night" from rows_scanned alone, so
    both degrade to the same refusal rather than risk overwriting a
    last-known-good artifact with an empty one (the same non-destructive
    contract as `finviz_universe`'s `_MIN_ROWS` refusal / `opt_flow`'s
    `_MIN_TICKERS` refusal on the read side of this same bridge).
    """
    db_path = _db_path()
    windows: list[tuple[_date, str]] = []
    rows_scanned = 0
    rows_classified = 0
    by_sym: dict[str, dict] = {}
    db_error: str | None = None

    try:
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path, timeout=10)
            try:
                conn.row_factory = sqlite3.Row
                windows = _resolve_windows(conn)
                if windows:
                    date_by_raw = {raw: d for d, raw in windows}
                    days_raw = [raw for _d, raw in windows]
                    newest_raw = days_raw[0]
                    placeholders = ",".join("?" for _ in days_raw)
                    # ONE bulk scan riding idx_flow_created_symbol(CreatedDate,
                    # Symbol) — never a per-ticker loop (K1 + the "aggregate
                    # job vs OPRA writer contention" trap).
                    cur = conn.execute(
                        "SELECT " + ", ".join(_SELECT_COLS) + " FROM flow "
                        "WHERE source = 'stocks' AND CreatedDate IN (" + placeholders + ")",
                        days_raw,
                    )
                    for r in cur:
                        rows_scanned += 1
                        row = dict(r)
                        row_date = date_by_raw.get(row.get("CreatedDate"))
                        cls = _classify(row, row_date)
                        if cls is None:
                            continue
                        rows_classified += 1
                        direction, premium = cls
                        sym = (row.get("Symbol") or "").upper().strip()
                        if not sym:
                            continue
                        agg = by_sym.setdefault(sym, {
                            "bull_1d": 0.0, "bear_1d": 0.0,
                            "bull_5d": 0.0, "bear_5d": 0.0,
                        })
                        is_newest = row.get("CreatedDate") == newest_raw
                        if direction == "BULL":
                            agg["bull_5d"] += premium
                            if is_newest:
                                agg["bull_1d"] += premium
                        else:
                            agg["bear_5d"] += premium
                            if is_newest:
                                agg["bear_1d"] += premium
            finally:
                conn.close()
    except sqlite3.Error as e:  # noqa: BLE001 — degrade, never raise
        db_error = str(e)
        log.warning("[flow_opt_aggregate] flow.db read failed: %s", e)

    rows_out: dict[str, dict] = {}
    for sym, agg in by_sym.items():
        entry: dict = {}
        total_1d = agg["bull_1d"] + agg["bear_1d"]
        if total_1d > 0:
            entry["opt_net_premium_1d"] = round(agg["bull_1d"] - agg["bear_1d"])
            entry["opt_bull_pct_1d"] = round(agg["bull_1d"] / total_1d * 100)
        total_5d = agg["bull_5d"] + agg["bear_5d"]
        if total_5d > 0:
            entry["opt_net_premium_5d"] = round(agg["bull_5d"] - agg["bear_5d"])
        if entry:
            rows_out[sym] = entry

    as_of = windows[0][0].isoformat() if windows else None
    days_iso = [d.isoformat() for d, _raw in windows]

    artifact = {
        "as_of": as_of,
        "days": days_iso,
        "rows": rows_out,
        "census": {
            "rows_scanned": rows_scanned,
            "rows_classified": rows_classified,
            "tickers": len(rows_out),
        },
    }

    db_failed = db_error is not None or rows_scanned == 0
    if db_failed:
        reason = db_error or "rows_scanned=0 (missing/empty DB or a quiet " \
                              "night we cannot tell apart from a failure)"
        log.warning("[flow_opt_aggregate] REFUSING to write: db=%s — R2 and "
                    "the local mirror are left untouched", reason)
        receipt = dict(artifact)
        receipt["db"] = "failed"
        receipt["db_reason"] = reason
        receipt["r2"] = "skipped"
        return receipt

    ok = False
    try:
        ok = data_sync.put_bytes(
            R2_KEY, json.dumps(artifact).encode("utf-8"), "application/json")
    except Exception as e:  # noqa: BLE001 — never raise out of a scheduler job
        log.warning("[flow_opt_aggregate] R2 put_bytes failed: %s", e)

    try:
        _atomic_write_local(artifact)
    except Exception as e:  # noqa: BLE001
        log.warning("[flow_opt_aggregate] local mirror write failed: %s", e)

    receipt = dict(artifact)
    receipt["db"] = "ok"
    receipt["r2"] = "ok" if ok else "failed"
    log.info("[flow_opt_aggregate] as_of=%s tickers=%d rows_scanned=%d "
              "rows_classified=%d db=%s r2=%s", as_of, len(rows_out), rows_scanned,
              rows_classified, receipt["db"], receipt["r2"])
    return receipt
