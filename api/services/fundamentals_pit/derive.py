"""Derived-series builder: store raw truth -> versioned sparse PIT series.

DERIVATION_VERSION names the METHOD. Bump it whenever a rule in knowledge /
quarters / metrics / series / split_ledger changes what a value would be; the
new version is built beside the served one (store.replace_series never touches
another version) and serving switches only when told to.

A build is skipped when its INPUT HASH (raw facts, signals, split rows, method
version) is unchanged -- rebuilding is cheap but a no-op should stay a no-op.
"""
from __future__ import annotations

import hashlib
import json
import time

from . import store as S
from .knowledge import build as build_knowledge
from .metrics import METRICS
from .series import build_series
from .split_ledger import PRODUCTION_SOURCES, SPLIT_SENSITIVE_METRICS, LedgerConflict, ledger_from_rows, verify
from .splits import Ledger

DERIVATION_VERSION = 1


def load_knowledge(conn, cik: int):
    kb = build_knowledge(S.load_facts(conn, cik), S.load_filings(conn, cik))
    kb.filing_epochs = S.load_signals(conn, cik)
    return kb


def company_ledger(conn, cik: int, sources: tuple[str, ...] = PRODUCTION_SOURCES) -> tuple[Ledger | None, list, str | None]:
    sec = S.security(conn, cik)
    rows = S.load_splits(conn, sec["tickers"] if sec else [], sources)
    try:
        return ledger_from_rows(rows), rows, None
    except LedgerConflict as e:
        return None, rows, str(e)


def _input_hash(conn, cik: int, split_rows: list, version: int) -> str:
    f = conn.execute("SELECT count(*), coalesce(max(first_seen_at), 0) FROM fact WHERE cik=?", (cik,)).fetchone()
    s = conn.execute("SELECT count(*) FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=?",
                     (cik,)).fetchone()
    blob = json.dumps([version, list(f), list(s), [list(r) for r in split_rows]], default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def build_company(conn, cik: int, *, sources: tuple[str, ...] = PRODUCTION_SOURCES,
                  version: int = DERIVATION_VERSION, force: bool = False, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    ledger, split_rows, conflict = company_ledger(conn, cik, sources)
    h = _input_hash(conn, cik, split_rows, version)
    info = S.build_info(conn, cik, version)
    if not force and info and info["input_hash"] == h and info["status"] == "ok":
        return {"cik": cik, "skipped": True}
    kb = load_knowledge(conn, cik)
    if conflict:
        verification = {"status": "unverified", "reasons": [["ledger_conflict", conflict]]}
        split_ok = False
    else:
        v = verify(kb, ledger)
        verification = {"status": v.status, "reasons": v.reasons,
                        "inferred": [[a.isoformat(), b.isoformat(), r] for a, b, r in v.inferred]}
        split_ok = v.ok
    metrics = [m for m in METRICS if split_ok or m not in SPLIT_SENSITIVE_METRICS]
    series = build_series(kb, metrics, ledger if split_ok else None)
    detail = {"split_verification": verification, "split_rows": len(split_rows),
              "withheld_split_sensitive": not split_ok, "quarantined": len(kb.quarantined),
              "conflicts": len(kb.conflicts), "unjoined": len(kb.unjoined),
              "signals": len(kb.filing_epochs), "metrics_with_points": sum(1 for p in series.values() if p)}
    with S.tx(conn):
        n = S.replace_series(conn, cik, version, series, h, detail, "ok", now)
    return {"cik": cik, "skipped": False, "points": n, **{k: detail[k] for k in ("withheld_split_sensitive",)},
            "split_status": verification["status"]}


def explain(conn, cik: int, metric: str, t_eff: int, version: int = DERIVATION_VERSION,
            sources: tuple[str, ...] = PRODUCTION_SOURCES) -> dict:
    """PROVENANCE, reproduced: re-derive the metric from raw truth at the
    instant the served point became effective, and return every fact it used
    with that fact's filing and acceptance time. `matches_served` proves the
    stored point is exactly what the raw facts yield (determinism)."""
    from datetime import datetime, timezone
    from .metrics import build_book, latest
    served = conn.execute("SELECT v, period_end, method FROM series_point WHERE cik=? AND metric=? "
                          "AND derivation_version=? AND t_eff=?", (cik, metric, version, t_eff)).fetchone()
    kb = load_knowledge(conn, cik)
    ledger, _rows, _c = company_ledger(conn, cik, sources)
    at = datetime.fromtimestamp(t_eff, tz=timezone.utc)
    book = build_book(kb.state_at(at), ledger, kb, at)
    val = latest(book, metric)
    filings = S.load_filings(conn, cik)
    facts = []
    for tag, start, end, accn in (val.sources if val else ()):
        f = filings.get(accn)
        keys = [key for key in kb.history if key[0] == tag and key[2] == start and key[3] == end]
        k = next((kb.known(key, at) for key in keys if kb.known(key, at) and kb.known(key, at).fact.accn == accn), None)
        facts.append({"tag": tag, "period_start": start.isoformat() if start else None,
                      "period_end": end.isoformat() if end else None, "accn": accn,
                      "reported_value": k.fact.val if k else None,
                      "form": f.form if f else None,
                      "accepted_at": f.accepted_at.isoformat() if f and f.accepted_at else None,
                      "public_at": f.public_at.isoformat() if f else None})
    return {"cik": cik, "metric": metric, "t_eff": t_eff, "derivation_version": version,
            "served": None if served is None else {"v": served[0], "period_end": served[1], "method": served[2]},
            "rederived": None if val is None else {"v": val.v, "period_end": val.period_end.isoformat(),
                                                   "method": val.note},
            "matches_served": bool(served and val and abs(served[0] - val.v) <= 1e-9 * max(1, abs(val.v))),
            "facts": facts}
