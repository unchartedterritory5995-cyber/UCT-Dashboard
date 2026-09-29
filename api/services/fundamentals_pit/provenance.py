"""PROVENANCE that reproduces the SERVED value (tooling; never used to serve or to change stored data).

⛔⛔ ROOT CAUSE of the 6 known explain() divergences (2026-09-29): `metrics.build_book` breaks ties between
equal-rank candidates by the insertion order of the state dict it is given. `series.build_series` walks
`Knowledge.iter_states`, whose dict gains keys in order of FIRST APPEARANCE OVER TIME; `derive.explain` used
`Knowledge.state_at`, whose order is the history dict's. Same facts, same stale sets, a different pick on a tie
(e.g. cik 1173313 roe_ttm 2017-05-22: served 49.78 vs explain 0.2576). The stored value is the deterministic
series-path result (a truncation rebuild reproduces it); `explain` below rebuilds the book along the SAME walk.

FCF: the book materialises free cash flow as OCF - CapEx under a composite label ("<ocf tag>-<capex tag>") that has
no accession of its own, so stored `sources` are empty. `explain` expands every composite source into the operating
cash flow and capital expenditure facts (tag, period, accession, filing, acceptance) it was computed from.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import derive as D, store as S
from .concepts import PRIMITIVES
from .metrics import METRICS, anchor_ends, build_book, latest
from .series import GAP
from .split_ledger import SPLIT_SENSITIVE_METRICS, verify

_TAGS = frozenset(tg for p in PRIMITIVES.values() for tg in p.tags)


def series_book(conn, cik: int, t_eff: int):
    """(book, kb, ledger_used) exactly as build_series saw it at the event t_eff (or the last event before it)."""
    kb = D.load_knowledge(conn, cik)
    ledger, _rows, conflict = D.company_ledger(conn, cik)
    split_ok = conflict is None and verify(kb, ledger).ok
    used = ledger if split_ok else None
    at = datetime.fromtimestamp(t_eff, tz=timezone.utc)
    state = {}
    for te, st in kb.iter_states(set(_TAGS)):
        if te > at:
            break
        state = dict(st)                      # the SAME dict order build_series passed to build_book
    return build_book(state, used, kb, at), kb, used, split_ok


def _fact(kb, filings, tag, start, end, accn, at, role=None):
    keys = [k for k in kb.history if k[0] == tag and k[2] == start and k[3] == end]
    k = next((kb.known(key, at) for key in keys if kb.known(key, at) and kb.known(key, at).fact.accn == accn), None)
    f = filings.get(accn)
    out = {"tag": tag, "period_start": start.isoformat() if start else None, "period_end": end.isoformat() if end else None,
           "accn": accn, "reported_value": k.fact.val if k else None, "form": f.form if f else None,
           "accepted_at": f.accepted_at.isoformat() if f and f.accepted_at else None,
           "public_at": f.public_at.isoformat() if f else None}
    if role:
        out["role"] = role
    return out


def explain(conn, cik: int, metric: str, t_eff: int, version: int = 5) -> dict:
    served = conn.execute("SELECT v, period_end, method FROM series_point WHERE cik=? AND metric=? AND derivation_version=? "
                          "AND t_eff=?", (cik, metric, version, t_eff)).fetchone()
    book, kb, _ledger, split_ok = series_book(conn, cik, t_eff)
    at = datetime.fromtimestamp(t_eff, tz=timezone.utc)
    filings = S.load_filings(conn, cik)
    withheld = (metric in SPLIT_SENSITIVE_METRICS) and not split_ok
    val = None if withheld else latest(book, metric)
    facts = []
    for tag, start, end, accn in (val.sources if val else ()):
        if accn is None and ("-" in tag or tag == "fcf"):                 # FCF: expand to its OCF and CapEx inputs
            if "-" in tag:
                labels = tag.split("-", 1)
            else:                                                         # fiscal-year FCF: labels from the book
                labels = [(book.fiscal_years.get(pr, {}).get(end) or (None, None))[1] for pr in ("operating_cash_flow", "capex")]
            for role, comp in zip(("operating_cash_flow", "capex"), labels):
                c_accn = book.provenance.get((comp, start, end)) if comp else None
                if c_accn:
                    facts.append(_fact(kb, filings, book.source_tag.get((comp, start, end), comp), start, end, c_accn, at, role))
                else:
                    facts.append({"role": role, "tag": comp, "period_start": start.isoformat() if start else None,
                                  "period_end": end.isoformat() if end else None, "accn": None,
                                  "note": "input period not directly reported (derived from year-to-date differences)"})
            continue
        facts.append(_fact(kb, filings, tag, start, end, accn, at))
    base = {"cik": cik, "metric": metric, "t_eff": t_eff, "derivation_version": version, "method": "series_walk",
            "split_verified": split_ok, "facts": facts}
    if served and served[2] == GAP:
        ends = anchor_ends(book, METRICS[metric][1])
        newest = ends[0].strftime("%Y%m%d") if ends else None
        ok = newest is not None and int(newest) == served[1] and (val is None or int(val.period_end.strftime("%Y%m%d")) < served[1])
        return {**base, "served": {"v": None, "period_end": served[1], "method": GAP},
                "rederived": {"newest_anchor_period": newest, "latest_derivable_period": val.period_end.isoformat() if val else None},
                "matches_served": ok}
    return {**base, "served": None if served is None else {"v": served[0], "period_end": served[1], "method": served[2]},
            "rederived": None if val is None else {"v": val.v, "period_end": val.period_end.isoformat(), "method": val.note},
            "matches_served": bool(served and val and abs(served[0] - val.v) <= 1e-9 * max(1, abs(val.v))
                                   and int(val.period_end.strftime("%Y%m%d")) == served[1])}
