"""Task 8.6 -- the `builtWidget` payload: fixed keys, per-view trimming, no trade ids.

Real-data tests seed a temp sqlite file through the Task 8.5 fixtures (`tests.test_widget_sources`);
nothing here reaches `C:\\data`. Trim tests use a hand-built `aggregate.Result`, the shape
`aggregate.evaluate` returns, so the trim is tested without 5,000 seeded trades.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate, payload, plan, sources
from api.services.journal_two.widget_engine import measures as wmeasures
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    TODAY, UID, add_position, add_trade, conn, raw_plan,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)

FIXED_KEYS = {
    "asOf", "source", "sourceDetail", "sourceKey", "view", "title", "summary", "defId", "defRev",
    "latestRev", "scopeLabel", "rangeLabel", "range", "accountId", "filter", "count", "capped",
    "sample", "notice", "truncated", "measures", "value", "compare", "compareLabel", "rows",
    "series", "points", "cells", "coverage", "footnotes", "empty",
}
ROW_KEYS = {"label", "label2", "v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n",
            "flagged"}
VALUE_KEYS = {"v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n"}


def vplan(raw):
    return plan.validate_plan(raw, sources.CATALOG)


def scan_of(source="closed_trades", rows=(), *, capped=False, earliest=None, count=None,
            account_id=None, footnotes=()):
    rows = list(rows)
    return sources.Scan(source, rows, capped, earliest, len(rows) if count is None else count,
                        account_id, list(footnotes))


def cell(v, n=1, sample=""):
    return wmeasures.Cell(v, n, None, sample)


def group(label, values, *, n=1, key=None, label2=None, flagged=False, day=None, result=None):
    return aggregate.Group(key=key if key is not None else label, label=label,
                           values=aggregate.GroupValues([cell(v, n) for v in values], n),
                           label2=label2, flagged=flagged, day=day, result=result)


def result_of(groups=(), total=(10.0,), count=1, coverage=None, footnotes=()):
    groups = list(groups)
    cov = coverage if coverage is not None else [aggregate.Coverage(count, count, None)
                                                 for _ in total]
    return aggregate.Result(groups, aggregate.GroupValues([cell(v, count) for v in total], count),
                            cov, list(footnotes), count)


def build(p, res, sc, *, settings=None, def_id="w1", def_rev=3, latest_rev=4, today=TODAY,
          sample=False, **kw):
    rng = plan.resolve_range(p["range"], today)
    return payload.build_payload(result=res, plan=p, settings=settings or {}, def_id=def_id,
                                 def_rev=def_rev, latest_rev=latest_rev, rng=rng, scan=sc,
                                 sample=sample, now=NOW, **kw)


def run_real(c, raw, *, settings=None):
    p = vplan(raw)
    rng = plan.resolve_range(p["range"], TODAY)
    sc = sources.scan(c, p, settings or {}, rng, UID, today=TODAY)
    res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
    return payload.build_payload(result=res, plan=p, settings=settings or {}, def_id="w1",
                                 def_rev=1, latest_rev=1, rng=rng, scan=sc, sample=False, now=NOW)


# -- keys and echoes --------------------------------------------------------------------------

def test_payload_echoes_def_and_settings():
    p = vplan(raw_plan(measures=("net_pnl", "win_rate"), range={"token": "last_90d"},
                       filters=[{"field": "setup", "op": "in", "values": ["VCP"],
                                 "overridable": True}]))
    settings = {"range": {"token": "last_30d"}, "accountId": None,
                "filter": {"field": "setup", "values": ["Flag"]}}
    out = build(p, result_of(total=(120.5, 0.6), count=7), scan_of(count=7), settings=settings)
    assert set(out) == FIXED_KEYS | {"def"}
    assert out["def"] == p
    assert (out["defId"], out["defRev"], out["latestRev"]) == ("w1", 3, 4)
    assert out["range"] == {"token": "last_30d"}
    assert out["filter"] == {"field": "setup", "values": ["Flag"]}
    assert out["accountId"] is None
    assert out["scopeLabel"] == "All my accounts"
    assert out["sourceKey"] == "closed_trades" and out["view"] == "number"
    assert out["title"] == plan.default_name(p, sources.CATALOG)
    assert out["summary"] == plan.summary(p, sources.CATALOG, 7, "trades")
    assert out["asOf"] == "2026-10-24T15:30:00Z"
    assert out["count"] == 7 and out["capped"] is False and out["sample"] is False
    assert out["rangeLabel"] == "Last 90 days"
    assert out["value"] == {"v1": 120.5, "v2": 0.6, "v3": None, "n1": 7, "n2": 7, "n3": None,
                            "s1": "", "s2": "", "s3": None, "n": 7}
    assert out["measures"] == [
        {"label": "Net P&L", "unit": "trades", "kind": "sum", "fmt": "money"},
        {"label": "Win rate", "unit": "decisive", "kind": "rate", "fmt": "pct"}]
    assert out["sourceDetail"] == "Your closed trades in the Journal."
    assert out["empty"] is None and out["truncated"] == 0


def test_member_title_wins_over_the_automatic_one():
    p = vplan(raw_plan(display={"title": "My edge", "titleAuto": False}))
    assert build(p, result_of(), scan_of())["title"] == "My edge"


def test_a_foreign_account_id_in_settings_is_never_echoed():
    p = vplan(raw_plan())
    out = build(p, result_of(), scan_of(account_id=None), settings={"accountId": "not-mine"})
    assert out["accountId"] is None and out["scopeLabel"] == "All my accounts"
    out = build(p, result_of(), scan_of(account_id="acc-1"), settings={"accountId": "acc-1"},
                account_name="Swing")
    assert out["accountId"] == "acc-1" and out["scopeLabel"] == "Swing"


def test_def_over_4kb_becomes_defref():
    vals = [f"SYMBOL{i:03d}" + "X" * 150 for i in range(30)]
    p = vplan(raw_plan(filters=[{"field": "symbol", "op": "in", "values": vals}]))
    assert len(json.dumps(p, separators=(",", ":")).encode()) > payload.DEF_MAX_BYTES
    out = build(p, result_of(), scan_of(), def_id="w9", def_rev=2)
    assert "def" not in out
    assert out["defRef"] == {"id": "w9", "rev": 2}
    small = build(vplan(raw_plan()), result_of(), scan_of())
    assert "defRef" not in small and small["def"]["source"] == "closed_trades"


# -- trimming ---------------------------------------------------------------------------------

def test_line_trimmed_from_start():
    p = vplan(raw_plan(split={"by": "day"}, view={"type": "line"}))
    start = date(2025, 1, 1)
    days = [(start + timedelta(days=i)).isoformat() for i in range(400)]
    groups = [group(d, (float(i),), key=d) for i, d in enumerate(days)]
    out = build(p, result_of(groups, count=400), scan_of(count=400))
    kept = out["series"]
    assert 1 < len(kept) < 400
    assert [r["label"] for r in kept] == days[-len(kept):]      # newest buckets, oldest first
    assert out["truncated"] == 400 - len(kept)
    assert out["rows"] == [] and set(kept[0]) == ROW_KEYS
    assert len(json.dumps(out, separators=(",", ":")).encode()) <= nw.PAYLOAD_CAP_BYTES


def test_line_series_is_oldest_first_even_when_groups_arrive_newest_first():
    p = vplan(raw_plan(split={"by": "month"}, view={"type": "line"}))
    groups = [group(m, (1.0,), key=m) for m in ("2026-10", "2026-08", "2026-09")]
    out = build(p, result_of(groups, count=3), scan_of(count=3))
    assert [r["label"] for r in out["series"]] == ["2026-08", "2026-09", "2026-10"]


def test_rows_trimmed_from_end_after_sort():
    p = vplan(raw_plan(view={"type": "list"}, sort={"measure": 0, "dir": "desc", "top": 40}))
    groups = [group(f"SYM{i:04d}" + "Z" * 40, (float(1000 - i),), key=str(i),
                    label2="2026-10-01", day="2026-10-01") for i in range(600)]
    out = build(p, result_of(groups, count=600), scan_of(count=600))
    kept = out["rows"]
    assert 1 < len(kept) < 600
    assert [r["v1"] for r in kept] == [float(1000 - i) for i in range(len(kept))]  # the top ones
    assert out["truncated"] == 600 - len(kept)
    assert kept[0]["label2"] == "2026-10-01" and kept[0]["flagged"] is False


def test_scatter_and_heat_trim_oldest_first():
    sp = vplan(raw_plan(view={"type": "scatter"}, measures=("net_pnl", "total_r")))
    start = date(2020, 1, 1)
    newest_first = [group("NVDA", (float(i), 1.0), key=str(i), result="Win",
                          day=(start + timedelta(days=999 - i)).isoformat()) for i in range(1000)]
    out = build(sp, result_of(newest_first, total=(1.0, 1.0), count=1000), scan_of(count=1000))
    pts = out["points"]
    assert 1 < len(pts) < 1000 and out["truncated"] == 1000 - len(pts)
    assert pts[-1]["d"] == (start + timedelta(days=999)).isoformat()   # the newest kept
    assert [x["d"] for x in pts] == sorted(x["d"] for x in pts)
    assert set(pts[0]) == {"x", "y", "d", "r"} and pts[0]["r"] == "win"

    hp = vplan(raw_plan(split={"by": "day"}, view={"type": "heat"}))
    days = [(start + timedelta(days=i)).isoformat() for i in range(1500)]
    out = build(hp, result_of([group(d, (1.0,), key=d) for d in days], count=1500),
                scan_of(count=1500))
    cells = out["cells"]
    assert [c["label"] for c in cells] == days[-len(cells):]
    assert set(cells[0]) == {"label", "v1", "n1", "s1"}


def test_scatter_result_codes():
    sp = vplan(raw_plan(view={"type": "scatter"}, measures=("net_pnl", "total_r")))
    gs = [group("A", (1.0, 1.0), key="0", result="Win", day="2026-10-01"),
          group("B", (-1.0, -1.0), key="1", result="Loss", day="2026-10-02"),
          group("C", (0.0, None), key="2", result="BE", day="2026-10-03")]
    out = build(sp, result_of(gs, total=(0.0, 0.0), count=3), scan_of(count=3))
    assert [x["r"] for x in out["points"]] == ["win", "loss", "be"]
    assert out["points"][2]["y"] is None


# -- privacy and numbers ----------------------------------------------------------------------

def test_no_trade_id_anywhere(conn):
    tids = [add_trade(conn, UID, day=f"2026-10-{d:02d}", setup=s, pnl=p, r=r,
                      mistakes=["fomo"], symbol=sym)
            for d, s, p, r, sym in ((1, "VCP", 120.0, 1.5, "NVDA"), (2, "Flag", -60.0, -1.0, "AMD"),
                                    (5, None, 0.0, None, "TSLA"), (6, "VCP", 40.0, 0.5, "NVDA"))]
    tids.append(add_trade(conn, UID, day="2026-10-07", excluded=1, symbol="META"))
    pos = add_position(conn, UID)
    cases = [
        raw_plan(view={"type": "list"}),
        raw_plan(view={"type": "bar"}, split={"by": "setup"}),
        raw_plan(view={"type": "table"}, split={"by": "setup", "then": "mistake"}),
        raw_plan(view={"type": "number"}),
        raw_plan(view={"type": "scatter"}, measures=("net_pnl", "total_r")),
        raw_plan(view={"type": "line"}, split={"by": "day"}),
        raw_plan(view={"type": "heat"}, split={"by": "day"}),
        raw_plan(source="open_positions", measures=("open_positions",), view={"type": "list"}),
    ]
    for raw in cases:
        blob = json.dumps(run_real(conn, raw))
        for tid in [*tids, pos]:
            assert tid not in blob, raw
    listed = run_real(conn, raw_plan(view={"type": "list"}))
    assert [r["flagged"] for r in listed["rows"] if r["label"] == "META"] == [True]


def test_nan_in_result_is_null():
    p = vplan(raw_plan(measures=("net_pnl", "win_rate"), split={"by": "setup"},
                       view={"type": "bar"}))
    nan, inf = float("nan"), float("inf")
    res = aggregate.Result([group("VCP", (nan, inf))],
                           aggregate.GroupValues([cell(nan), cell(-inf)], 1),
                           [aggregate.Coverage(1, 1, None)] * 2, [], 1)
    out = build(p, res, scan_of(count=1))
    json.dumps(out, allow_nan=False)                     # raises on any NaN or Infinity
    assert out["value"]["v1"] is None and out["value"]["v2"] is None
    assert out["rows"][0]["v1"] is None and out["rows"][0]["v2"] is None


# -- empty, capped, ranges --------------------------------------------------------------------

@pytest.mark.parametrize("source,measure,sentence", [
    ("closed_trades", "net_pnl", "No closed trades in this range. Widen the range, or log a trade."),
    ("open_positions", "open_positions", "No open positions."),
    ("trading_days", "avg_day_pnl", "No sessions in this range."),
])
def test_empty_sentence_per_source(source, measure, sentence):
    p = vplan(raw_plan(source=source, measures=(measure,)))
    out = build(p, result_of(total=(None,), count=0), scan_of(source, count=0))
    assert out["count"] == 0 and out["empty"] == sentence
    full = build(p, result_of(total=(1.0,), count=3), scan_of(source, count=3))
    assert full["empty"] is None


def test_capped_labels():
    p = vplan(raw_plan(measures=("net_pnl", "max_drawdown", "max_win_streak")))
    out = build(p, result_of(total=(1.0, -50.0, 4.0), count=5000),
                scan_of(count=5000, capped=True, earliest="2026-03-04"))
    assert out["capped"] is True
    assert out["rangeLabel"] == "From Mar 4, newest 5,000 trades"
    assert out["notice"] == ("Based on your newest 5,000 trades. "
                             "Narrow the range to include all trades.")
    notes = [n for n in out["footnotes"] if "within your newest 5,000 trades" in n]
    assert len(notes) == 2
    assert any(n.startswith("Max drawdown") for n in notes)
    assert any(n.startswith("Longest win streak") for n in notes)
    plain = build(p, result_of(total=(1.0, -50.0, 4.0), count=10), scan_of(count=10))
    assert plain["notice"] is None and plain["footnotes"] == []


def test_footnotes_carry_result_and_scan_notes():
    p = vplan(raw_plan())
    out = build(p, result_of(footnotes=["3 trades have no time and are not in this split."]),
                scan_of(footnotes=["Market calendar note."]))
    assert out["footnotes"] == ["3 trades have no time and are not in this split.",
                                "Market calendar note."]


def test_last_n_trades_label_when_fewer(conn):
    for i in range(12):
        add_trade(conn, UID, day=f"2026-10-{i + 1:02d}")
    out = run_real(conn, raw_plan(measures=("trades",), range={"token": "last_100_trades"}))
    assert out["count"] == 12
    assert out["rangeLabel"] == "Last 100 trades (you have 12)"


def test_last_n_trades_label_when_enough():
    p = vplan(raw_plan(range={"token": "last_20_trades"}))
    out = build(p, result_of(count=20), scan_of(count=20))
    assert out["rangeLabel"] == "Last 20 trades"


def test_compare_value_and_label():
    p = vplan(raw_plan(view={"type": "compare"}, compare={"mode": "previous"},
                       range={"token": "last_30d"}))
    out = build(p, result_of(total=(10.0,), count=4), scan_of(count=4),
                compare_result=result_of(total=(4.0,), count=2), compare_label="Aug 26 to Sep 24, 2026")
    assert out["compare"]["v1"] == 4.0 and out["compare"]["n"] == 2
    assert set(out["compare"]) == VALUE_KEYS
    assert out["compareLabel"] == "Aug 26 to Sep 24, 2026"


def test_every_builder_measure_has_a_format():
    for key in sources.CATALOG.measures:
        assert key in payload.MEASURE_FMT, key


def test_profit_factor_has_its_own_format_so_the_client_can_show_its_cap():
    # Ruling R-29: "pf", not "ratio" -- the client renders a value at the cap (measures.PF_CAP) as "5+".
    assert payload.MEASURE_FMT["profit_factor"] == "pf"
    assert payload.MEASURE_FMT["payoff"] == "ratio"
    p = vplan(raw_plan(measures=("profit_factor",)))
    out = build(p, result_of(total=(5.0,), count=4), scan_of(count=4))
    assert out["measures"][0]["fmt"] == "pf"


# -- notebook_widgets: source_detail and cap_payload -----------------------------------------

def test_source_detail_built_widget_sentences():
    assert nw.BUILT_KIND == "builtWidget"
    assert nw.source_detail("builtWidget", {"sourceKey": "closed_trades"}) == \
        "Your closed trades in the Journal."
    assert nw.source_detail("builtWidget", {"sourceKey": "open_positions"}) == \
        "Your open positions in the Journal."
    assert nw.source_detail("builtWidget", {"sourceKey": "trading_days"}) == \
        "Your trading days in the Journal (day P&L incl. options)."


def test_cap_payload_explicit_list_key_wins_and_trims_from_start():
    big = {"asOf": "x", "source": "manual", "rows": [{"k": "r" * 50}] * 3,
           "series": [{"i": i, "pad": "p" * 100} for i in range(400)], "truncated": 0}
    out = nw.cap_payload(big, "myWatchlistToday", list_key="series", trim_from="start")
    assert out["rows"] == big["rows"]
    assert out["series"][-1]["i"] == 399 and out["series"][0]["i"] > 0
    assert out["truncated"] == 400 - len(out["series"])
    end = nw.cap_payload(big, list_key="series")
    assert end["series"][0]["i"] == 0 and end["truncated"] == 400 - len(end["series"])


def _old_cap(payload, kind=None):
    """`cap_payload` as it stood before Task 8.6 (39ada5e36a), the reference the bisection must match."""
    out = nw._clip_member_text(payload)
    if nw._payload_size(out) <= nw.PAYLOAD_CAP_BYTES:
        return out
    key = nw.LIST_KEY.get(kind) if kind else next(
        (k for k in nw._ANY_LIST_KEYS if isinstance(out.get(k), list)), None)
    items = out.get(key) if key else None
    if isinstance(items, list) and items:
        prior = out.get("truncated")
        kept = list(items)
        while len(kept) > 1 and nw._payload_size({**out, key: kept}) > nw.PAYLOAD_CAP_BYTES:
            kept.pop()
        trimmed = {**out, key: kept}
        dropped = len(items) - len(kept)
        if dropped:
            trimmed["truncated"] = True if isinstance(prior, bool) and prior else int(prior or 0) + dropped
        if nw._payload_size(trimmed) <= nw.PAYLOAD_CAP_BYTES:
            return trimmed
    return nw._too_large(out)


def _count_digit_case(kind="myWatchlistToday"):
    """A phase 1 payload whose trimmed list lands within ~20 bytes of the cap, so the `truncated` count
    the trim then writes tips it over: the old loop answered this with the too-large form."""
    for pad in range(1, 400):
        p = {"asOf": "x", "source": "manual", "rows": [{"p": "y" * pad}] * 2000}
        if _old_cap(p, kind).get("tooLarge"):
            return p
    return None


def test_phase1_trim_counts_its_own_truncated_digits():
    """Ruling R-18: live for phase 1 widgets. The old loop lost every row here; now the rows stay."""
    p = _count_digit_case()
    assert p is not None, "no count-digit case found: the reference stopped reproducing it"
    assert _old_cap(p, "myWatchlistToday").get("tooLarge") is True       # the defect, reproduced
    out = nw.cap_payload(p, "myWatchlistToday")
    assert not out.get("tooLarge")
    assert len(out["rows"]) > 1 and out["truncated"] == 2000 - len(out["rows"])
    size = nw._payload_size(out)
    assert nw.PAYLOAD_CAP_BYTES - 40 < size <= nw.PAYLOAD_CAP_BYTES       # it really was at the edge


def test_cap_payload_sweep_never_over_cap_and_never_too_large_when_one_item_fits():
    import random
    rnd = random.Random(86)
    trimmed = 0
    for case in range(400):
        n = rnd.randint(1, 700)
        rows = [{"n": i, "pad": "x" * rnd.randint(0, 80)} for i in range(n)]
        prior = rnd.choice([None, 0, 3, True, False])
        p = {"asOf": "x", "source": "market", "rows": rows,
             **({} if prior is None else {"truncated": prior})}
        kind = rnd.choice([None, "myWatchlistToday", "tickerCard", nw.BUILT_KIND])
        out = nw.cap_payload(p, kind, list_key="rows" if kind == nw.BUILT_KIND else None)
        assert nw._payload_size(out) <= nw.PAYLOAD_CAP_BYTES, case
        if kind == "tickerCard":
            continue                       # no list key: over the cap it is too large by design
        one = {**p, "rows": rows[:1]}
        if n > 1:
            one["truncated"] = True if prior is True else int(prior or 0) + n - 1
        if nw._payload_size(one) <= nw.PAYLOAD_CAP_BYTES:
            assert not out.get("tooLarge"), case
        if len(out.get("rows", [])) < n:
            trimmed += 1
    assert trimmed > 50                    # the trim branch was actually exercised


def test_built_widget_trim_counts_its_own_truncated_digits():
    p = _count_digit_case()
    assert p is not None
    out = nw.cap_payload(p, nw.BUILT_KIND, list_key="rows")
    assert not out.get("tooLarge") and out["truncated"] == 2000 - len(out["rows"])
    assert nw._payload_size(out) <= nw.PAYLOAD_CAP_BYTES


def test_positions_range_label_is_right_now():
    p = vplan(raw_plan(source="open_positions", measures=("open_positions",)))
    assert build(p, result_of(count=2), scan_of("open_positions", count=2))["rangeLabel"] == "Right now"


def test_source_reads_an_origin_key_on_any_scan_row():
    p = vplan(raw_plan(source="open_positions", measures=("open_positions",)))
    assert build(p, result_of(count=1), scan_of("open_positions", [{}], count=1))["source"] == "manual"
    rows = [{"origin": "broker"}, {"origin": "broker"}]
    assert build(p, result_of(count=2), scan_of("open_positions", rows))["source"] == "broker"
    rows = [{"origin": "broker"}, {"origin": "manual"}]
    assert build(p, result_of(count=2), scan_of("open_positions", rows))["source"] == "mixed"


def test_built_widget_too_large_keeps_what_see_it_now_needs():
    big = {"asOf": "x", "source": "manual", "title": "T", "defId": "w1", "defRev": 2,
           "def": {"v": 1, "source": "closed_trades"}, "view": "table", "sourceKey": "closed_trades",
           "pad": "p" * 20000, "rows": []}
    out = nw.cap_payload(big, nw.BUILT_KIND, list_key="rows")
    assert out["tooLarge"] is True
    assert (out["defId"], out["defRev"], out["title"]) == ("w1", 2, "T")
    assert out["def"] == {"v": 1, "source": "closed_trades"}


# -- Task 8.7 follow-ups: one range-label authority, and an origin on every source's rows ---------

@pytest.mark.parametrize("source, measure, token", [
    ("closed_trades", "net_pnl", "last_30d"),
    ("open_positions", "open_positions", "last_30d"),
    ("trading_days", "avg_day_pnl", "last_30d"),
    ("closed_trades", "net_pnl", "this_month"),
])
def test_range_label_comes_from_plan_range_label_for(source, measure, token):
    p = vplan(raw_plan(source=source, measures=(measure,), range={"token": token}))
    rng = plan.resolve_range(p["range"], TODAY)
    out = build(p, result_of(count=2), scan_of(source, count=2))
    assert out["rangeLabel"] == payload._upper_first(plan.range_label_for(p, rng))
    assert not hasattr(payload, "S_OPEN_NOW")              # the duplicate is gone


def test_open_position_rows_carry_their_origin(conn):
    a = add_position(conn, UID, symbol="AAPL")
    add_position(conn, UID, symbol="MSFT")
    conn.execute("UPDATE j2_positions SET source = 'broker' WHERE id = ?", (a,))
    conn.commit()
    p = vplan(raw_plan(source="open_positions", measures=("open_positions",)))
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID, today=TODAY)
    assert sorted(r["origin"] for r in sc.rows) == ["broker", "manual"]
    assert run_real(conn, raw_plan(source="open_positions", measures=("open_positions",)))[
        "source"] == "mixed"
    conn.execute("UPDATE j2_positions SET source = 'broker'")
    conn.commit()
    assert run_real(conn, raw_plan(source="open_positions", measures=("open_positions",)))[
        "source"] == "broker"


def test_trading_day_rows_carry_their_origin(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=10, source="broker", external_id="b1")
    add_trade(conn, UID, day="2026-10-20", pnl=20)
    add_trade(conn, UID, day="2026-10-21", pnl=30, source="broker", external_id="b2")
    add_trade(conn, UID, day="2026-10-22", pnl=40, source="csv")
    add_trade(conn, UID, day="2026-10-23", pnl=5, source="csv")
    add_trade(conn, UID, day="2026-10-23", pnl=6)
    raw = raw_plan(source="trading_days", measures=("avg_day_pnl",), range={"token": "this_week"})
    p = vplan(raw)
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID, today=TODAY)
    by_day = {r["day"]: r.get("origin") for r in sc.rows}
    assert by_day["2026-10-20"] == "mixed" and by_day["2026-10-21"] == "broker"
    # a CSV-only day reads "csv", like a closed trade's origin; CSV plus hand-logged is "mixed"
    assert by_day["2026-10-22"] == "csv" and by_day["2026-10-23"] == "mixed"
    assert all("origin" not in r for r in sc.rows if r["day"] == "2026-10-19")
    assert run_real(conn, raw)["source"] == "mixed"
    days = {r["day"]: r for r in sc.rows}
    assert days["2026-10-23"]["origins"] == ["csv", "manual"]
    # the same week without its broker days: CSV + hand-logged only reads "manual"
    assert payload._source(type("S", (), {"rows": [days["2026-10-22"], days["2026-10-23"]]})()) == "manual"


def test_a_csv_and_manual_day_with_no_broker_trade_reads_manual():
    p = vplan(raw_plan(source="trading_days", measures=("avg_day_pnl",), range={"token": "last_7d"}))
    rows = [{"origin": "mixed", "origins": ["csv", "manual"]}, {"origin": "csv"}]
    assert build(p, result_of(count=2), scan_of("trading_days", rows))["source"] == "manual"
    rows.append({"origin": "mixed", "origins": ["broker", "csv"]})
    assert build(p, result_of(count=3), scan_of("trading_days", rows))["source"] == "mixed"


def test_a_mixed_row_counts_as_both():
    p = vplan(raw_plan(source="trading_days", measures=("avg_day_pnl",), range={"token": "last_7d"}))
    assert build(p, result_of(count=1), scan_of("trading_days", [{"origin": "mixed"}]))[
        "source"] == "mixed"
    assert build(p, result_of(count=1), scan_of("trading_days", [{"origin": "broker"}, {}]))[
        "source"] == "broker"


def test_notices_lead_the_capped_notice():
    p = vplan(raw_plan())
    sc = scan_of("closed_trades", count=5000, capped=True, earliest="2026-03-04")
    out = build(p, result_of(count=5000), sc, notices=["Running from the saved copy in this note."])
    assert out["notice"].startswith("Running from the saved copy in this note. Based on your newest")
    assert build(p, result_of(count=1), scan_of(count=1))["notice"] is None


def test_account_split_marks_label_kind_and_other_splits_do_not():
    """Ruling R-25: the payload says which label fields are account names, so a public page can number them."""
    p = vplan(raw_plan(measures=("net_pnl",), split={"by": "account", "then": "setup"}, view={"type": "table"}))
    out = build(p, result_of(), scan_of())
    assert out["labelKind"] == "account" and "label2Kind" not in out
    p = vplan(raw_plan(measures=("net_pnl",), split={"by": "setup", "then": "account"}, view={"type": "table"}))
    out = build(p, result_of(), scan_of())
    assert out["label2Kind"] == "account" and "labelKind" not in out
    p = vplan(raw_plan(measures=("net_pnl",), split={"by": "setup", "then": None}))
    out = build(p, result_of(), scan_of())
    assert "labelKind" not in out and "label2Kind" not in out

