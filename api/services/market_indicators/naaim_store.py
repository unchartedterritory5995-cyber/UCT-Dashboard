"""THE CANONICAL NAAIM SERIES — one truth, two consumers.

⭐⭐ THE WHOLE POINT OF THIS FILE IS THAT THERE IS ONLY ONE OF IT. Before this, the
Breadth page's NAAIM tile and any future NAAIM chart would each have had to find the
number themselves, and two ingestion paths for one weekly scalar is how a tile and a
chart come to disagree about what the market's managers were holding. The architecture
is:

    NAAIM INGESTION  (seed file · Breadth collector push · later, the licensed API)
            ↓
    CANONICAL NAAIM SERIES   ← this module
            ├──→ latest observation  → Breadth page
            └──→ full history        → the NAAIM chart

⛔⛔ OBSERVATION DATE IS NOT KNOWLEDGE DATE, AND BOTH ARE STORED. NAAIM members report
their exposure as of each WEDNESDAY's close and the number is published the following
THURSDAY. A historical read keyed on the Wednesday would let a backtest know on
Wednesday something that was not public until Thursday. `observed_on` is the Wednesday,
`known_on` is when it became public, and `values_asof` reads by `known_on` precisely so
that lookahead is unrepresentable rather than merely discouraged.

⛔ NO PLACEHOLDER MAY ENTER THIS STORE. The existing collector chain reads a morning-wire
cache whose checked-in value is the literal default `{"exposure": 75.0, "date": ""}`, and
the repo's own open-check rail records what that cost: *"an undated reading is how it
froze at 75.00 for 93 sessions"*. `accept()` refuses that signature outright and refuses
a frozen undated feed, and the refusal REASON is stored so a silent drop is impossible.

⚠️ AND THIS IS A PROOF OF CONCEPT. NAAIM publish their free table "for use in tracking
only" and require express permission for commercial use; the redistribution licence that
a paid UCT product needs is their Program Partner tier. `ingest()` takes a `source` so
swapping the POC feed for that API changes this module's INPUT and nothing above it.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import logging
import math
import os
import sqlite3
import threading
from bisect import bisect_right
from typing import Optional

_log = logging.getLogger("market_indicators.naaim")
_WRITE_LOCK = threading.Lock()

# ── The official range ───────────────────────────────────────────────────────
#
# ⛔⛔ THE EXISTING COLLECTOR GATE IS `0 <= v <= 200` AND IT IS WRONG. NAAIM's own
# published scale runs from −200 (leveraged short) through 0 (cash / market neutral) and
# +100 (fully invested) to +200 (leveraged long). A genuinely negative week — which is
# what the index exists to capture — is silently discarded by that gate and the reading
# falls through to the next source or to nothing. Confirmed against naaim.org's own
# programme page before widening it, per the owner's instruction.
NAAIM_MIN = -200.0
NAAIM_MAX = 200.0

#: The exact signature of the morning-wire default. Value AND absent date together —
#: 75.0 is a perfectly legal reading on its own and must not be blanket-refused.
_PLACEHOLDER_VALUE = 75.0

#: How many consecutive undated observations may repeat the same value before the feed
#: is treated as frozen rather than as a market that did not move. Three weeks of a
#: bit-identical undated number is a stuck source, not consensus.
_FROZEN_RUN = 3

SOURCE_SEED = "seed"                 # the bundled historical file
SOURCE_COLLECTOR = "collector"       # the Breadth collector's accepted weekly value
SOURCE_LICENSED = "licensed_api"     # the future NAAIM Program Partner feed
#: ⭐ ORDERED BY AUTHORITY. A licensed reading may overwrite a collector one; a seed
#: never overwrites anything newer. This is the seam that makes the commercial swap a
#: data change rather than a redesign.
_SOURCE_RANK = {SOURCE_SEED: 0, SOURCE_COLLECTOR: 1, SOURCE_LICENSED: 2}


def _db_path() -> str:
    override = os.environ.get("NAAIM_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/naaim_series.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                         "data", "naaim_series.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


@contextlib.contextmanager
def _conn():
    """A connection that COMMITS then CLOSES — closing matters on Windows, where a
    leaked WAL handle blocks a temp-dir teardown."""
    c = sqlite3.connect(_db_path(), timeout=5.0)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=3000")
        yield c
        c.commit()
    finally:
        c.close()


_INIT_DONE = False


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _WRITE_LOCK:
        if _INIT_DONE:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS naaim_observations (
                    observed_on TEXT PRIMARY KEY,   -- the WEDNESDAY the exposure is for
                    value       REAL NOT NULL,
                    known_on    TEXT NOT NULL,      -- when it became public
                    source      TEXT NOT NULL,
                    date_inferred INTEGER NOT NULL DEFAULT 0,
                    revision    INTEGER NOT NULL DEFAULT 0,
                    ingested_at TEXT DEFAULT (datetime('now'))
                )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_naaim_known "
                      "ON naaim_observations(known_on)")
            # ⭐ A REFUSAL IS A RECORD, NOT A LOG LINE. The whole reason NAAIM froze at
            # 75.00 for 93 sessions is that nothing wrote down what it had rejected or
            # accepted. An operator must be able to ask "why is there no reading for
            # last week" and get an answer from the data.
            c.execute("""
                CREATE TABLE IF NOT EXISTS naaim_ingest_log (
                    at          TEXT DEFAULT (datetime('now')),
                    observed_on TEXT,
                    value       REAL,
                    source      TEXT,
                    accepted    INTEGER NOT NULL,
                    reason      TEXT
                )""")
        _INIT_DONE = True


# ── Date semantics ───────────────────────────────────────────────────────────

def survey_wednesday(on_or_before: str) -> Optional[str]:
    """The Wednesday a reading seen on `on_or_before` most plausibly refers to.

    ⚠️ THIS IS AN INFERENCE AND EVERY ROW IT PRODUCES IS FLAGGED `date_inferred=1`.
    NAAIM survey Wednesday, publish Thursday — so a value first seen on Thursday or
    later in the same week refers to THAT week's Wednesday, and a value seen on the
    Wednesday itself cannot yet be that day's (it is not published) and therefore refers
    to the previous week.

    ⛔ IT IS NOT A SUBSTITUTE FOR THE REAL DATE. When the collector supplies
    `naaim_date` that value wins outright, and a dated row can never be overwritten by
    an inferred one.
    """
    try:
        d = _dt.date.fromisoformat(str(on_or_before)[:10])
    except Exception:
        return None
    # Monday=0 … Wednesday=2
    delta = (d.weekday() - 2) % 7
    wed = d - _dt.timedelta(days=delta)
    if wed == d:
        wed = d - _dt.timedelta(days=7)
    return wed.isoformat()


def publication_thursday(observed_on: str) -> Optional[str]:
    """The Thursday an observation became public — the day after its Wednesday."""
    try:
        d = _dt.date.fromisoformat(str(observed_on)[:10])
    except Exception:
        return None
    return (d + _dt.timedelta(days=1)).isoformat()


# ── The accept gate ──────────────────────────────────────────────────────────

class Rejected(Exception):
    """An observation the canonical series refused, with the reason."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def accept(value, observed_on: Optional[str] = None,
           seen_on: Optional[str] = None,
           source: str = SOURCE_COLLECTOR) -> dict:
    """Decide whether one incoming reading may enter the canonical series.

    Returns the row that WOULD be written. Raises `Rejected` with a reason otherwise.
    Pure apart from one read (the frozen-run check), so it is testable on its own —
    which matters because this function is the entire defence against the placeholder.
    """
    fv = _finite(value)
    if fv is None:
        raise Rejected("value is not a finite number")
    if not (NAAIM_MIN <= fv <= NAAIM_MAX):
        raise Rejected(f"value {fv} is outside NAAIM's published range "
                       f"[{NAAIM_MIN}, {NAAIM_MAX}]")
    if source not in _SOURCE_RANK:
        raise Rejected(f"unknown source {source!r}")

    dated = bool(observed_on)
    if dated:
        obs = str(observed_on)[:10]
        try:
            _dt.date.fromisoformat(obs)
        except Exception:
            raise Rejected(f"observed_on {observed_on!r} is not an ISO date")
        inferred = 0
    else:
        # ⛔ THE PLACEHOLDER SIGNATURE. Undated AND exactly the morning-wire default.
        if fv == _PLACEHOLDER_VALUE:
            raise Rejected(
                "undated reading of exactly 75.0 is the morning-wire placeholder "
                "(`naaim_cache` default), not an observation")
        obs = survey_wednesday(seen_on or _dt.date.today().isoformat())
        if not obs:
            raise Rejected("cannot infer an observation week without a valid seen_on")
        inferred = 1
        if _undated_run_would_freeze(obs, fv):
            raise Rejected(
                f"the same undated value {fv} has repeated for {_FROZEN_RUN} "
                f"consecutive weeks — that is a stuck source, not a survey")

    known = publication_thursday(obs) if dated or inferred else None
    if seen_on:
        # ⭐ KNOWLEDGE DATE IS THE LATER OF "when it was published" AND "when we saw
        # it". If our feed lags — and the free NAAIM table currently lags by about
        # three months — we did not know the number on publication day, and a
        # point-in-time read must not pretend we did.
        known = max(known or seen_on, str(seen_on)[:10])
    return {"observed_on": obs, "value": fv, "known_on": known or obs,
            "source": source, "date_inferred": inferred}


def _undated_run_would_freeze(obs: str, value: float) -> bool:
    _ensure_init()
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT value FROM naaim_observations "
                "WHERE date_inferred=1 AND observed_on < ? "
                "ORDER BY observed_on DESC LIMIT ?",
                (obs, _FROZEN_RUN - 1)).fetchall()
    except Exception:
        return False
    if len(rows) < _FROZEN_RUN - 1:
        return False
    return all(abs(float(r[0]) - value) < 1e-9 for r in rows)


# ── Writing ──────────────────────────────────────────────────────────────────

def ingest(value, observed_on: Optional[str] = None, seen_on: Optional[str] = None,
           source: str = SOURCE_COLLECTOR) -> dict:
    """THE ONE WRITE DOOR. Accept-or-refuse, then upsert, then log either way.

    ⛔ AN INFERRED-DATE ROW MAY NEVER OVERWRITE A DATED ONE, and a lower-authority
    source may never overwrite a higher one. Those two rules are what let the POC
    collector feed and the future licensed API coexist in the same table without the
    weaker one clobbering the stronger.
    """
    _ensure_init()
    try:
        row = accept(value, observed_on, seen_on, source)
    except Rejected as e:
        _log_ingest(observed_on, _finite(value), source, False, e.reason)
        return {"accepted": False, "reason": e.reason}

    with _WRITE_LOCK:
        with _conn() as c:
            prior = c.execute(
                "SELECT value, source, date_inferred, revision FROM naaim_observations "
                "WHERE observed_on=?", (row["observed_on"],)).fetchone()
            if prior is not None:
                p_val, p_src, p_inf, p_rev = prior
                if row["date_inferred"] and not p_inf:
                    _log_ingest(row["observed_on"], row["value"], source, False,
                                "an inferred-date reading may not overwrite a dated one")
                    return {"accepted": False,
                            "reason": "inferred date cannot overwrite a dated row"}
                if _SOURCE_RANK[source] < _SOURCE_RANK.get(p_src, 0):
                    _log_ingest(row["observed_on"], row["value"], source, False,
                                f"{source} may not overwrite {p_src}")
                    return {"accepted": False,
                            "reason": f"{source} may not overwrite {p_src}"}
                if abs(float(p_val) - row["value"]) < 1e-9 and p_src == source:
                    return {"accepted": True, "changed": False, **row}
                row["revision"] = int(p_rev) + 1
            c.execute(
                "INSERT INTO naaim_observations"
                "(observed_on, value, known_on, source, date_inferred, revision, ingested_at) "
                "VALUES(?,?,?,?,?,?, datetime('now')) "
                "ON CONFLICT(observed_on) DO UPDATE SET "
                "value=excluded.value, known_on=excluded.known_on, "
                "source=excluded.source, date_inferred=excluded.date_inferred, "
                "revision=excluded.revision, ingested_at=datetime('now')",
                (row["observed_on"], row["value"], row["known_on"], row["source"],
                 row["date_inferred"], row.get("revision", 0)))
    _log_ingest(row["observed_on"], row["value"], source, True, "")
    return {"accepted": True, "changed": True, **row}


def _log_ingest(observed_on, value, source, accepted, reason) -> None:
    try:
        with _conn() as c:
            c.execute("INSERT INTO naaim_ingest_log"
                      "(observed_on, value, source, accepted, reason) VALUES(?,?,?,?,?)",
                      (observed_on, value, source, 1 if accepted else 0, reason))
    except Exception:
        pass


def ingest_many(rows, source: str = SOURCE_SEED) -> dict:
    """Bulk ingest `[(observed_on, value)]` or `[{observed_on, value, known_on}]`."""
    ok = refused = 0
    reasons: dict = {}
    for r in rows:
        if isinstance(r, dict):
            res = ingest(r.get("value"), r.get("observed_on"), r.get("known_on"), source)
        else:
            res = ingest(r[1], r[0], None, source)
        if res.get("accepted"):
            ok += 1
        else:
            refused += 1
            reasons[res.get("reason", "?")] = reasons.get(res.get("reason", "?"), 0) + 1
    return {"accepted": ok, "refused": refused, "reasons": reasons}


# ── Reading ──────────────────────────────────────────────────────────────────

def observations(limit: int = 5000, asof: Optional[str] = None) -> list[dict]:
    """The canonical series, oldest first.

    ⭐ `asof` READS BY `known_on`, NOT BY `observed_on`. That is the point-in-time
    guarantee: asking for the series as it stood on a Wednesday cannot return the value
    that was published the next day.
    """
    _ensure_init()
    try:
        with _conn() as c:
            if asof:
                rows = c.execute(
                    "SELECT observed_on, value, known_on, source, date_inferred, revision "
                    "FROM naaim_observations WHERE known_on <= ? "
                    "ORDER BY observed_on ASC LIMIT ?", (str(asof)[:10], int(limit))
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT observed_on, value, known_on, source, date_inferred, revision "
                    "FROM naaim_observations ORDER BY observed_on ASC LIMIT ?",
                    (int(limit),)).fetchall()
    except Exception:
        return []
    return [{"observed_on": r[0], "value": r[1], "known_on": r[2], "source": r[3],
             "date_inferred": bool(r[4]), "revision": r[5]} for r in rows]


def latest(asof: Optional[str] = None) -> Optional[dict]:
    """The newest observation the caller is allowed to know about.

    ⭐ THIS IS WHAT THE BREADTH PAGE READS. Same store, same row, same number the chart
    draws — which is the whole architectural requirement.
    """
    rows = observations(limit=5000, asof=asof)
    return rows[-1] if rows else None


def bounds() -> dict:
    _ensure_init()
    try:
        with _conn() as c:
            r = c.execute("SELECT MIN(observed_on), MAX(observed_on), COUNT(*) "
                          "FROM naaim_observations").fetchone()
        return {"first": r[0], "last": r[1], "count": r[2] or 0}
    except Exception:
        return {"first": None, "last": None, "count": 0}


def stats() -> dict:
    _ensure_init()
    out = dict(bounds())
    try:
        with _conn() as c:
            out["by_source"] = {row[0]: row[1] for row in c.execute(
                "SELECT source, COUNT(*) FROM naaim_observations GROUP BY source")}
            out["inferred_dates"] = c.execute(
                "SELECT COUNT(*) FROM naaim_observations WHERE date_inferred=1"
            ).fetchone()[0]
            out["recent_refusals"] = [
                {"at": r[0], "observed_on": r[1], "value": r[2],
                 "source": r[3], "reason": r[4]}
                for r in c.execute(
                    "SELECT at, observed_on, value, source, reason FROM naaim_ingest_log "
                    "WHERE accepted=0 ORDER BY at DESC LIMIT 10")]
    except Exception:
        pass
    return out


# ── Seeding from the bundled historical file ─────────────────────────────────

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
#: ⭐ THIS PROJECT'S OWN SEED FIRST, the shared sentiment file as the fallback.
#: `naaim_history.csv` is built by `tools/build_naaim_seed.py` and is a SUPERSET of the
#: `naaim` rows in `breadth_sentiment_history.csv` — same provenance (NAAIM's public
#: embeddable table), more weeks. The fallback exists so a checkout without the new
#: file still seeds rather than starting empty.
#:
#: ⛔ AND THE SHARED FILE IS NEVER WRITTEN BY THIS PROJECT. It is owned by
#: `tools/build_breadth_sentiment.py` and read by production breadth; a second writer
#: would be exactly the split-brain this store exists to remove.
_SEED_PRIMARY = os.path.join(_DATA_DIR, "naaim_history.csv")
_SEED_FALLBACK = os.path.join(_DATA_DIR, "breadth_sentiment_history.csv")


def _read_seed_rows() -> list[dict]:
    import csv as _csv
    primary = os.path.abspath(_SEED_PRIMARY)
    if os.path.exists(primary):
        with open(primary, newline="", encoding="utf-8") as f:
            lines = [ln for ln in f if not ln.startswith("#")]
        return [{"observed_on": r["observed_on"], "value": r["value"]}
                for r in _csv.DictReader(lines) if r.get("observed_on")]
    fallback = os.path.abspath(_SEED_FALLBACK)
    if os.path.exists(fallback):
        with open(fallback, newline="", encoding="utf-8") as f:
            return [{"observed_on": r["date"], "value": r["value"]}
                    for r in _csv.DictReader(f) if r.get("key") == "naaim"]
    return []


def seed_from_bundled_csv(force: bool = False) -> dict:
    """Load the versioned historical seed into the canonical store.

    ⭐ THE SEED IS ALREADY LEGITIMATE. Both files were built from NAAIM's own public
    embeddable table — no key, no paywall, no access control worked around — and their
    dates are the survey Wednesdays, so rows land dated (`date_inferred=0`) and their
    knowledge date is the publication Thursday.

    Idempotent: `ingest` upserts, and a seed row can never overwrite a
    higher-authority source.
    """
    _ensure_init()
    if not force and bounds().get("count", 0) > 0:
        return {"ok": True, "skipped": True, **bounds()}
    try:
        rows = _read_seed_rows()
    except Exception as e:
        return {"ok": False, "reason": f"read error: {e}"}
    if not rows:
        return {"ok": False, "reason": "no seed file found"}
    res = ingest_many(rows, source=SOURCE_SEED)
    return {"ok": True, **res, **bounds()}
