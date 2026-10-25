"""Task 8.5 fuzz rail: hostile or awkward member text never reaches SQL text.

For every filterable text, enum and tag field of every source, and every value in a corpus of
quotes, comment markers, statement breaks, JSON paths, LIKE wildcards, backslashes, `__proto__`,
emoji and 200-character strings: the compiled SQL contains none of the value, the parameter list
carries it exactly as given (escaped only for `contains`), and the scan and the aggregator run
on an empty seeded database without raising. A seeded control proves the parameters still match
the member's exact text.
"""
from __future__ import annotations

import re
from datetime import date

import pytest

from api.services.journal_two.widget_engine import aggregate, plan, sources
from api.services.journal_two.widget_engine import compile as wcompile
from tests.test_widget_sources import UID, add_trade, conn, raw_plan  # noqa: F401  (fixture)

TODAY = date(2026, 10, 24)
#: Wave 9: a field that names a routine or tracker needs one (`ref`); any member's id will do here.
REF = "0b0e8a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b"
#: Task 10.7: a note-property filter names one (`prop`); one that is not the member's is dropped.
PROP = "5c2e1d3f4a5b46c7d8e9f0a1b2c3d4e5"

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
            if not getattr(fld, "filterable", True) or getattr(fld, "choices", None):
                continue                  # split-only, or fixed codes (refused below, never run)
            for op in fld.ops:
                if op in ("in", "not_in", "has_any", "contains"):
                    yield src.key, fld.key, op


CASES = list(_cases())


@pytest.fixture(autouse=True)
def _note_kinds_on(monkeypatch):
    """W10-R62: the notes `kind` field is offered (and fuzzed) while note kinds are."""
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")


def _plan(source, field, op, value, view=None):
    measures = {"closed_trades": ("net_pnl",), "open_positions": ("open_positions",),
                "trading_days": ("avg_day_pnl",), "routine_history": ("routine_consistency",),
                "tracker_history": ("tracker_avg",),
                "options_strategies": ("strategies",), "notes": ("notes",)}[source]
    f = {"field": field, "op": op, "values": [value]}
    if getattr(sources.SOURCES[source].fields[field], "ref_kind", None):
        f["ref"] = REF
    if field == plan.PROPERTY_FIELD:
        f["prop"] = PROP
    raw = raw_plan(source=source, measures=measures, filters=[f],
                   range={"from": "2026-09-01", "to": "2026-10-23"})
    if view:
        raw["view"] = {"type": view}
    return plan.validate_plan(raw, sources.CATALOG)


def test_a_field_with_fixed_codes_refuses_every_hostile_value():
    coded = [(s.key, f.key) for s in sources.SOURCES.values() for f in s.fields.values()
             if getattr(f, "choices", None)]
    assert ("routine_history", "state") in coded and ("trading_days", "routine_done") in coded
    for source, field in coded:
        for op in ("in", "not_in"):
            for value in CORPUS:
                with pytest.raises(plan.PlanError) as e:
                    _plan(source, field, op, value)
                assert e.value.sentence == plan.S_FILTER_VALUE_TYPE


def test_the_corpus_covers_every_source_and_kind_of_field():
    kinds = {(s, sources.SOURCES[s].fields[f].type) for s, f, _op in CASES}
    assert {("closed_trades", "text"), ("closed_trades", "enum"), ("closed_trades", "tag"),
            ("open_positions", "text"), ("open_positions", "enum"),
            ("trading_days", "enum"), ("options_strategies", "text"),
            ("options_strategies", "enum"), ("notes", "text"), ("notes", "enum"),
            ("notes", "tag"), ("notes", None)} <= kinds
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


_LITERAL = re.compile(r"'(?:[^']|'')*'")


def _outside_literals(sql: str) -> str:
    """The executed statement with every quoted string literal removed. SQLite's trace hook shows
    bound parameters expanded INTO quoted literals, so member text found anywhere else was
    spliced into the SQL itself."""
    return _LITERAL.sub("''", sql)


@pytest.mark.parametrize("source,field,op", CASES)
def test_hostile_text_scans_an_empty_database_without_raising(conn, source, field, op):  # noqa: F811
    executed: list[str] = []
    conn.set_trace_callback(executed.append)
    try:
        for value in CORPUS:
            p = _plan(source, field, op, value)
            rng = plan.resolve_range(p["range"], TODAY)
            sc = sources.scan(conn, p, {}, rng, UID, today=TODAY)
            res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
            if source != "trading_days":
                assert sc.rows == [] and res.count == 0
    finally:
        conn.set_trace_callback(None)
    assert executed, "control: the trace hook saw the scans"
    for sql in executed:
        bare = _outside_literals(sql)
        for value in CORPUS:
            assert value not in bare, (source, field, op, value, sql[:200])


def test_the_trace_check_can_fail(conn):  # noqa: F811
    """Control: text spliced into SQL is caught; the same text bound as a parameter is not."""
    executed: list[str] = []
    conn.set_trace_callback(executed.append)
    try:
        conn.execute("SELECT 1 WHERE 'a' = ?", (CORPUS[3],)).fetchall()
        conn.execute("SELECT 1 /* " + CORPUS[3] + " */").fetchall()
    finally:
        conn.set_trace_callback(None)
    bound, spliced = (_outside_literals(x) for x in executed[-2:])
    assert CORPUS[3] not in bound and CORPUS[3] in spliced


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


# -- wave 10 (Task 10.4): a member formula never reaches SQL ---------------------------------------

def _formula_plan(source: str, value: str) -> dict:
    """Two formulas carrying `value`: an aggregate whose text literal is the value, and a row formula
    named by it (names are at most 60 characters)."""
    quoted = '"' + value.replace('"', '""') + '"'
    field_ = {"closed_trades": "setup", "trading_days": "weekday"}[source]
    num = {"closed_trades": "net", "trading_days": "day_net"}[source]
    formulas = [
        {"id": "f1", "name": "Count of it", "expr": f"CountIf([{field_}] = {quoted})"},
        {"id": "f2", "name": value[:60].strip() or "x",
         "expr": f"If([{field_}] = {quoted}, [{num}], 0)", "format": "money"},
    ]
    raw = raw_plan(source=source, measures=(), formulas=formulas,
                   range={"from": "2026-09-01", "to": "2026-10-23"})
    raw["measures"] = [{"formula": "f1"}, {"formula": "f2", "agg": "sum"}]
    return plan.validate_plan(raw, sources.CATALOG)


@pytest.mark.parametrize("source", ["closed_trades", "trading_days"])
def test_formula_text_is_never_sql_text(conn, source):  # noqa: F811
    executed: list[str] = []
    seen_plans = 0
    for value in CORPUS:
        p = _formula_plan(source, value)
        assert p["v"] == 3 and value in p["formulas"][0]["expr"].replace('""', '"')
        seen_plans += 1
        rng = plan.ResolvedRange("2026-09-01", "2026-10-23", None, "x")
        sql, params = wcompile.compile_scan(sources.SOURCES[source], p, {}, rng, UID)
        for planted in (value, p["formulas"][0]["expr"], p["formulas"][1]["expr"],
                        p["formulas"][1]["name"]):
            assert planted not in sql, (source, value)
            assert planted not in params, (source, value)
        conn.set_trace_callback(executed.append)
        try:
            sources.scan(conn, p, {}, rng, UID, today=TODAY)
        finally:
            conn.set_trace_callback(None)
    assert seen_plans == len(CORPUS) and executed
    for sql in executed:                     # not even as a bound parameter
        for value in CORPUS:
            assert value not in sql, (source, value, sql[:200])


# -- Task 10.6 (10.4's M7): formula FILTERS and SPLITS never reach SQL, on every source that scans ---

_FS_SOURCES = {"closed_trades": ("setup", "net_pnl"), "trading_days": ("weekday", "avg_day_pnl"),
               "options_strategies": ("underlying", "net_pnl"),
               "open_positions": ("setup", "open_positions"), "notes": ("ticker", "notes")}


def _formula_filter_split_plans(source: str, value: str) -> list[dict]:
    """Two plans carrying `value` in a row formula's text literal and name: one FILTERS on the
    formula (a yes / no formula, `is`), one SPLITS by it (a text formula, `If`)."""
    quoted = '"' + value.replace('"', '""') + '"'
    field_, measure = _FS_SOURCES[source]
    name = value[:60].strip() or "x"
    rng = {"token": "all"} if source == "open_positions" else {"from": "2026-09-01",
                                                                "to": "2026-10-23"}
    flt = raw_plan(source=source, measures=(measure,), range=rng)
    flt["formulas"] = [{"id": "f1", "name": name, "expr": f"[{field_}] = {quoted}"}]
    flt["filters"] = [{"field": "formula:f1", "op": "is", "values": [True]}]
    spl = raw_plan(source=source, measures=(measure,), range=rng, view={"type": "bar"})
    spl["formulas"] = [{"id": "f1", "name": name,
                        "expr": f"If([{field_}] = {quoted}, {quoted}, \"other\")"}]
    spl["split"] = {"by": "formula:f1"}
    return [plan.validate_plan(flt, sources.CATALOG), plan.validate_plan(spl, sources.CATALOG)]


@pytest.mark.parametrize("source", sorted(_FS_SOURCES))
def test_formula_filter_and_split_text_is_never_sql_text(conn, source):  # noqa: F811
    executed: list[str] = []
    planted_any = 0
    for value in CORPUS:
        for p in _formula_filter_split_plans(source, value):
            planted_any += 1
            rng = plan.resolve_range(p["range"], TODAY)
            if source == "trading_days":
                rng = plan.ResolvedRange("2026-09-01", "2026-10-23", None, "x")
            sql, params = wcompile.compile_scan(sources.SOURCES[source], p, {}, rng, UID)
            for planted in (value, p["formulas"][0]["expr"], p["formulas"][0]["name"],
                            "formula:f1"):
                assert planted not in sql, (source, value)
                assert planted not in params, (source, value)
            conn.set_trace_callback(executed.append)
            try:
                sc = sources.scan(conn, p, {}, rng, UID, today=TODAY)
                aggregate.evaluate(sc.rows, p, sources.CATALOG)      # runs in Python, never raises
            finally:
                conn.set_trace_callback(None)
    assert planted_any == 2 * len(CORPUS) and executed
    for sql in executed:                     # not even as a bound parameter
        for value in CORPUS:
            assert value not in sql, (source, value, sql[:200])


def test_a_formula_filter_leaves_the_sql_exactly_as_without_it():
    """Control for the rail above: the compiled scan with a formula filter equals the scan without
    it (the filter is Python-only), and a SQL-filterable filter DOES change it (the comparison can
    see a difference)."""
    for source in ("closed_trades", "options_strategies", "open_positions"):
        p = _formula_filter_split_plans(source, "x")[0]
        bare = {**p, "filters": []}
        rng = plan.resolve_range(p["range"], TODAY)
        src = sources.SOURCES[source]
        assert wcompile.compile_scan(src, p, {}, rng, UID) ==             wcompile.compile_scan(src, bare, {}, rng, UID), source
        field_ = _FS_SOURCES[source][0]
        real = {**bare, "filters": [{"field": field_, "op": "in", "values": ["x"]}]}
        assert wcompile.compile_scan(src, real, {}, rng, UID) !=             wcompile.compile_scan(src, bare, {}, rng, UID), source
