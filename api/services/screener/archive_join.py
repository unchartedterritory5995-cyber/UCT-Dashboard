"""Archive join — the TSDR trader archive's context as snapshot columns. DISPLAY ONLY.

ONE bulk read of wisdom.db per build (calls grouped in Python, never a per-ticker query),
emitting DICT LITERALS keyed by the snapshot column names (the scalar-population rail
derives writers by AST over ``{"col": v}`` shapes; see context_joins' docstring).

⛔ NOTHING HERE CHANGES WHAT FIRES OR HOW IT SCORES (owner decision 2026-10-16: archive
context on scanner/screener surfaces is display-only while the recognition hold stands).
No price level from a call is emitted — only counts, a date, a setup id and outcomes.

THE GATE: ``WISDOM_ARCHIVE_ENABLED`` (read per build). Off -> ``{}``, so every archive
column stays None on every row: "the archive was not asked" is never written as
"the team never called it".

THE HONESTY RULE (context_joins' contract): a dead or empty store returns ``{}``; a
healthy one answers for the whole target list, so a ticker the team never called is a
real ``archive_calls_n = 0``, while its date/setup/outcome stay None (nothing to show).

THE SETUP EDGE is the archive playbook's CONTROL-RELATIVE measurement for the setup the
row's best pattern-engine detection maps to (``setup_map.setup_for_pattern``; the best
detection is pattern_join's own rule, carried in as ``pattern_best_id`` -- never
re-decided here): mean trade R minus the same stock on a random day
(``archive_setup_edge_r``), median 20-day edge vs the same stock
(``archive_setup_edge_20d``, percent) and the scored-call count behind both
(``archive_setup_n``). Never a raw win rate alone (lift_ledger.py: lift, not hit rate).
"""
from __future__ import annotations

import json


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _pct(v):
    try:
        return round(float(v) * 100.0, 2)
    except (TypeError, ValueError):
        return None


def _setup_edges(conn) -> dict:
    """{setup_id: (mean_edgeR, med_edge20, n_scored)} from the playbooks' all-calls stats."""
    out = {}
    for sid, stats_json in conn.execute("SELECT setup_id, stats_json FROM wisdom_archive_setups"):
        try:
            st = (json.loads(stats_json or "{}") or {}).get("all") or {}
        except ValueError:
            continue
        out[sid] = (st.get("mean_edgeR"), st.get("med_edge20"), st.get("n_scored"))
    return out


def read_archive_fields(targets, best_ids=None, failures=None):
    """``{TICKER: {archive_* columns}}`` for every target, or ``{}`` when the archive
    cannot answer. ``best_ids`` is ``{TICKER: pattern_id}`` from pattern_join's carrier."""
    try:
        from api.services.wisdom.core import flags

        if not flags.archive_enabled():
            return {}
        from api.services.wisdom.archive import setup_map
        from api.services.wisdom.core import store

        per: dict = {}
        with store.read() as conn:
            rows = conn.execute(
                "SELECT ticker, author_id, setup, posted, call_id, "
                "json_extract(outcome_json, '$.r20') FROM wisdom_archive_calls").fetchall()
            edges = _setup_edges(conn)
    except Exception as e:  # noqa: BLE001 -- a dead store is COUNTED and degrades to {}
        _note(failures, "archive_join", e)
        return {}
    if not rows:
        _note(failures, "archive_join", "empty")
        return {}

    for ticker, author, setup, posted, call_id, r20 in rows:
        t = str(ticker or "").upper()
        if not t:
            continue
        agg = per.get(t)
        if agg is None:
            agg = per[t] = {"n": 0, "authors": set(), "last": None}
        agg["n"] += 1
        agg["authors"].add(author)
        key = (posted or "", call_id or "")
        if agg["last"] is None or key > agg["last"][0]:
            agg["last"] = (key, posted, setup, r20)

    best_ids = best_ids or {}
    out = {}
    for t in targets:
        tu = str(t).upper()
        agg = per.get(tu)
        if agg is None:
            row = {"archive_calls_n": 0, "archive_traders_n": 0}
        else:
            _, posted, setup, r20 = agg["last"]
            row = {"archive_calls_n": agg["n"], "archive_traders_n": len(agg["authors"]),
                   "archive_last_call_date": (posted or "")[:10] or None,
                   "archive_last_setup": setup or None,
                   "archive_last_r20": _pct(r20)}
        mapped = setup_map.setup_for_pattern(best_ids.get(tu))
        edge = edges.get(mapped) if mapped else None
        if edge is not None and edge[2]:
            row["archive_setup"] = mapped
            row["archive_setup_edge_r"] = edge[0]
            row["archive_setup_edge_20d"] = _pct(edge[1])
            row["archive_setup_n"] = edge[2]
        out[tu] = row
    return out
