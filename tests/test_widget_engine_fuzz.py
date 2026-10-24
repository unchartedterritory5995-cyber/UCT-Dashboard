"""Task 8.5 fuzz rail: hostile or awkward member text never reaches SQL text.

For every filterable text, enum and tag field of every source, and every value in a corpus of
quotes, comment markers, statement breaks, JSON paths, LIKE wildcards, backslashes, `__proto__`,
emoji and 200-character strings: the compiled SQL contains none of the value, the parameter list
carries it exactly as given (escaped only for `contains`), and the scan and the aggregator run
on an empty seeded database without raising. A seeded control proves the parameters still match
the member's exact text.
"""
from __future__ import annotations

from datetime import date

import pytest

from api.services.journal_two.widget_engine import aggregate, plan, sources
from api.services.journal_two.widget_engine import compile as wcompile
from tests.test_widget_sources import UID, add_trade, conn, raw_plan  # noqa: F401  (fixture)

TODAY = date(2026, 10, 24)
#: Wave 9: a field that names a routine or tracker needs one (`ref`); any member's id will do here.
REF = "0b0e8a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b"

CORPUS = [
    "it's",
    'say "hi"',
    "x -- y",
    "a; DROP TABLE j2_trades",
    "x' OR '1'='1",
    "'); --",
    "$.a[0].b",
    "50%off",
    "a_b_c",
    "%_%",
    "back\\slash",
    "\\%",
    "__proto__",
    "constructor",
    "🚀 to the moon 🌙",
    "q" * 200,
    "é" * 200,
]


def _cases():
    for src in sources.SOURCES.values():
        for fld in src.fields.values():
            if not getattr(fld, "filterable", True):
                continue                                  # a split-only field takes no filter
            for op in fld.ops:
                if op in ("in", "not_in", "has_any", "contains"):
                    yield src.key, fld.key, op


CASES = list(_cases())


def _plan(source, field, op, value, view=None):
    measures = {"closed_trades": ("net_pnl",), "open_positions": ("open_positions",),
                "trading_days": ("avg_day_pnl",), "routine_history": ("routine_consistency",),
                "tracker_history": ("tracker_avg",)}[source]
    f = {"field": field, "op": op, "values": [value]}
    if getattr(sources.SOURCES[source].fields[field], "ref_kind", None):
        f["ref"] = REF
    raw = raw_plan(source=source, measures=measures, filters=[f],
                   range={"from": "2026-09-01", "to": "2026-10-23"})
    if view:
        raw["view"] = {"type": view}
    return plan.validate_plan(raw, sources.CATALOG)


def test_the_corpus_covers_every_source_and_kind_of_field():
    kinds = {(s, sources.SOURCES[s].fields[f].type) for s, f, _op in CASES}
    assert {("closed_trades", "text"), ("closed_trades", "enum"), ("closed_trades", "tag"),
            ("open_positions", "text"), ("open_positions", "enum"),
            ("trading_days", "enum")} <= kinds
    assert all(len(v) <= plan.MAX_TEXT for v in CORPUS)


@pytest.mark.parametrize("source,field,op", CASES)
def test_member_text_is_never_sql_text(source, field, op):
    src = sources.SOURCES[source]
    fld = src.fields[field]
    if source in plan.TOOL_SOURCES:
        # Wave 9: routine and tracker history compile no SQL from a plan; every filter on them runs
        # in Python over the member's own rows, so no member text can reach SQL at all.
        assert not wcompile.sql_filterable(fld)
        for value in CORPUS:
            _plan(source, field, op, value)
        return
    for value in CORPUS:
        for view in (None, "list"):
            if view == "list" and source == "trading_days":
                continue
            p = _plan(source, field, op, value, view)
            rng = plan.resolve_range(p["range"], TODAY)
            if source == "trading_days":
                rng = plan.ResolvedRange("2026-09-01", "2026-10-23", None, "x")
            sql, params = wcompile.compile_scan(src, p, {}, rng, UID)
            assert value not in sql, (source, field, op, value)
            if not wcompile.sql_filterable(fld):
                assert value not in params            # filtered in Python, never in SQL
            elif op == "contains":
                assert ("%" + wcompile.escape_like(value) + "%") in params
            else:
                assert params.count(value) == 1, (source, field, op, value)
                assert any(x is value or (isinstance(x, str) and x == value) for x in params)


@pytest.mark.parametrize("source,field,op", CASES)
def test_hostile_text_scans_an_empty_database_without_raising(conn, source, field, op):  # noqa: F811
    for value in CORPUS:
        p = _plan(source, field, op, value)
        rng = plan.resolve_range(p["range"], TODAY)
        sc = sources.scan(conn, p, {}, rng, UID, today=TODAY)
        res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
        if source != "trading_days":
            assert sc.rows == [] and res.count == 0


def test_hostile_text_matches_exactly_once_seeded(conn):  # noqa: F811
    for i, value in enumerate(CORPUS):
        add_trade(conn, UID, day=f"2026-10-{(i % 20) + 1:02d}", setup=value, symbol=value,
                  mistakes=[value], emotions=[value], regime=value, commit=False)
    conn.commit()
    for value in CORPUS:
        for field, op in (("setup", "in"), ("symbol", "in"), ("mistake", "has_any"),
                          ("emotion", "has_any"), ("regime", "in")):
            p = _plan("closed_trades", field, op, value, "list")
            rng = plan.resolve_range(p["range"], TODAY)
            sc = sources.scan(conn, p, {}, rng, UID)
            res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
            assert len(sc.rows) == 1 and sc.rows[0]["setup"] == value, (field, value)
            assert len(res.groups) == 1, (field, value)
        # contains finds the trade whose symbol holds the text (wildcards are literal)
        p = _plan("closed_trades", "symbol", "contains", value, "list")
        sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID)
        assert value in {r["symbol"] for r in sc.rows}, value
        assert all(value.lower() in r["symbol"].lower() or value in r["symbol"]
                   for r in sc.rows), value
    # split by setup: every hostile value is its own group, keyed by its own text
    p = plan.validate_plan(raw_plan(measures=("trades",), split={"by": "setup"},
                                    range={"from": "2026-09-01", "to": "2026-10-23"}),
                           sources.CATALOG)
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID)
    res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
    assert sorted(g.key for g in res.groups) == sorted(CORPUS)
    assert all(len(g.label) <= 60 for g in res.groups)
