"""Task 8.10 -- the ready-made widget examples (now `shelf/` revision files, Task 10.8) and `run.run_examples`.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import copy
import json
from datetime import datetime, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run, shelf, sources
from api.services.journal_two.widget_engine.plan import PlanError
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_trade, add_user, conn,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)   # ET day 2026-10-24

#: The spec section 8 rows the shelf holds, in shelf order: wave 8's 23 and wave 10's three new ones
#: (Task 10.13: MAE vs MFE, Process vs results, Goals progress).
SECTION_8_ROWS = 26
#: Task 10.13: the revisions wave 10 adds. Each needs plan format 3 (`plan.needed_version`).
W10_REVISIONS = {
    "shelf:equity-curve": 2, "shelf:r-equity-curve": 2, "shelf:pnl-by-hold-time": 2,
    "shelf:exit-quality": 2, "shelf:fees-drag": 2, "shelf:loss-streak": 2,
    "shelf:mae-vs-mfe": 1, "shelf:process-vs-results": 1, "shelf:goals-progress": 1,
}


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-shelf-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def _ids(source=None):
    return [e["id"] for e in shelf.examples() if source is None or e["plan"]["source"] == source]


def _seed(c, n=12):
    """`n` closed trades over the last few months, a flagged one and a date-only one among them.
    The flagged one is broker-imported and the rest are not, so a card that let it into its rows
    would say "mixed" where its own run says "manual"."""
    days = ["2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-16", "2026-10-09",
            "2026-09-30", "2026-09-15", "2026-08-20", "2026-07-14", "2026-06-02", "2026-04-01"]
    for i in range(n):
        d = days[i % len(days)]
        kw = {}
        if i == 3:
            kw = {"hour": None, "entry_iso": "2026-10-19", "exit_iso": d}
        add_trade(c, UID, day=d, pnl=(-1) ** i * (40 + 7 * i), fees=1.0, r=(-1) ** i * 0.5,
                  symbol=("NVDA", "AAPL", "MSFT")[i % 3], side="Short" if i % 4 == 0 else "Long",
                  setup=("Flag", "VCP")[i % 2], excluded=1 if i == 5 else 0, hold=i % 4,
                  source="broker" if i == 5 else None, **kw)


# -- the shelf file ----------------------------------------------------------------------------------

def test_every_example_validates():
    exs = shelf.examples()
    assert len(exs) == SECTION_8_ROWS
    for e in exs:
        assert wplan.validate_plan(copy.deepcopy(e["plan"]), sources.CATALOG) == e["plan"], e["id"]
        assert e["name"].strip() and e["description"].strip()
        assert e["plan"]["display"]["title"] == e["name"]          # the card is called its name
    # every source the shelf uses, and every view it uses, is one the catalog has
    assert {e["plan"]["source"] for e in exs} <= set(sources.SOURCES)


def test_ids_namespaced_and_unique():
    ids = _ids()
    assert len(ids) == len(set(ids)) == SECTION_8_ROWS
    assert all(i.startswith("shelf:") and shelf._ID_RE.fullmatch(i) for i in ids)
    raw = json.loads(shelf.MANIFEST_PATH.read_text(encoding="utf-8"))
    assert raw["version"] == 1 and raw["order"] == ids


def _all_revisions():
    """Every revision on the shelf, `(id, rev, entry)`, in shelf order then revision order."""
    out = []
    for sid in shelf._STATE[0]:
        rev = 1
        while (r := shelf.revision(sid, rev)) is not None:
            out.append((sid, rev, r))
            rev += 1
    return out


def test_synonyms_present_on_newest_revision():
    by_name = {e["name"]: {k.lower() for k in e["keywords"]} for e in shelf.examples()}
    want = {
        "Win rate": {"hit rate", "batting average", "win %"},
        "Profit factor": {"pf"},
        "Expectancy": {"edge", "ev", "avg r"},
        "Max drawdown": {"dd", "drawdown"},
        "Weekly scorecard": {"report card", "review"},
    }
    for name, words in want.items():
        assert words <= by_name[name], name
    # a revision keeps every keyword of the revision before it (Task 10.13: r1's words stay findable)
    revs = _all_revisions()
    assert sum(1 for _sid, rev, _r in revs if rev > 1) >= 6            # non-vacuity: the six r2s
    for sid, rev, r in revs:
        if rev > 1:
            assert set(shelf.revision(sid, rev - 1)["keywords"]) <= set(r["keywords"]), (sid, rev)


#: "plan" is internal when it means a widget's recipe; "your plan" is the member's trading plan
#: (Task 10.13: Process vs results, "how closely you followed your plan").
_MEMBER_PHRASES = ("your plan",)


def _internal_words(text):
    banned = ("definition", "shelf", "built widget", "source", "plan", "scope")
    low = text.lower()
    for phrase in _MEMBER_PHRASES:
        low = low.replace(phrase, "")
    return [b for b in banned if b in low]


def test_member_copy_avoids_internal_words():
    for _sid, _rev, e in _all_revisions():
        for text in (e["name"], e["description"], *e["keywords"]):
            assert not _internal_words(text), (e["id"], e["rev"], text)
    # control: the trading-plan phrase passes, the recipe word does not
    assert _internal_words("Your results by how closely you followed your plan.") == []
    assert _internal_words("Edit the plan of this widget.") == ["plan"]


def test_a_broken_example_fails_the_load(tmp_path):
    from tests.test_widget_shelf_files import planted, rev2_of
    bad = rev2_of("shelf:win-rate", measures=[{"key": "no_such_measure"}])
    with pytest.raises(shelf.ShelfError, match="shelf:win-rate"):
        with planted(tmp_path, [bad]):
            pass
    shelf.load()
    assert len(shelf.examples()) == SECTION_8_ROWS                # control: the real shelf loads


def test_examples_newest_allowed_revision(tmp_path):
    from tests.test_widget_shelf_files import planted, rev2_of
    r2 = rev2_of("shelf:win-rate", range={"token": "last_30d"},
                 display={"title": "Win rate, revision two", "titleAuto": False, "accent": "gold"})
    refuse_r2 = lambda p: p["display"]["title"] != "Win rate, revision two"   # "needs wave 10"
    with planted(tmp_path, [r2]):
        served = {e["id"]: e for e in shelf.examples()}
        assert served["shelf:win-rate"]["rev"] == 2
        assert served["shelf:win-rate"]["plan"]["range"] == {"token": "last_30d"}
        gated = {e["id"]: e for e in shelf.examples(allowed=refuse_r2)}
        assert gated["shelf:win-rate"]["rev"] == 1                 # rev 1 is offered instead
        assert gated["shelf:win-rate"]["plan"]["range"] == {"token": "last_90d"}
        assert gated["shelf:win-rate"]["summary"] == wplan.summary(
            gated["shelf:win-rate"]["plan"], sources.CATALOG, None,
            sources.CATALOG.sources["closed_trades"].unit)
        assert shelf.example("shelf:win-rate", allowed=refuse_r2)["rev"] == 1
        assert shelf.latest_rev("shelf:win-rate", allowed=refuse_r2) == 1
        assert shelf.latest_rev("shelf:win-rate") == 2
        # an id with no allowed revision is left out, the rest keep their order
        none = shelf.examples(allowed=lambda p: p["source"] != "closed_trades")
        assert all(e["plan"]["source"] != "closed_trades" for e in none)
        assert shelf.example("shelf:win-rate", allowed=lambda p: False) is None
        assert shelf.latest_rev("shelf:win-rate", allowed=lambda p: False) is None
        assert [e["id"] for e in shelf.examples(allowed=refuse_r2)] == [e["id"] for e in shelf.examples()]


def test_example_lookup_hands_out_copies():
    e = shelf.example("shelf:win-rate")
    assert e is not None and e["id"] == "shelf:win-rate"
    e["plan"]["measures"] = []
    assert shelf.example("shelf:win-rate")["plan"]["measures"] == [{"key": "win_rate"}]
    assert shelf.example("shelf:nope") is None and shelf.example(None) is None


# -- run_examples ------------------------------------------------------------------------------------

def _spy(monkeypatch):
    calls = []
    real = wcompile.compile_scan

    def spy(source, *a, **k):
        calls.append(source.key)
        return real(source, *a, **k)

    monkeypatch.setattr(wcompile, "compile_scan", spy)
    return calls


def _with_days_example(monkeypatch) -> str:
    """The shelf this wave ships reads closed trades only; add one trading-days example so a batch
    spans two sources (the mechanism under test, not the shelf's contents)."""
    sid = "shelf:test-green-days"
    plan = wplan.validate_plan({"v": 1, "source": "trading_days", "range": {"token": "last_30d"},
                                "measures": [{"key": "avg_day_pnl"}, {"key": "green_day_pct"}]},
                               sources.CATALOG)
    order, revisions = shelf._STATE
    revisions = dict(revisions)
    revisions[sid] = ({"id": sid, "rev": 1, "name": "Green days", "description": "d",
                       "keywords": [], "plan": plan, "summary": "s"},)
    monkeypatch.setattr(shelf, "_STATE", (order, revisions))
    return sid


def test_examples_one_scan_per_source(conn, monkeypatch):
    _seed(conn)
    days_id = _with_days_example(monkeypatch)
    ids = _ids("closed_trades")[:7] + [days_id]
    calls = _spy(monkeypatch)
    out = run.run_examples(UID, ids, now=NOW)
    assert out["sample"] is False and list(out["cards"]) == ids
    assert sorted(calls) == ["closed_trades", "trading_days"]        # 2 scans for 8 cards
    # every card is exactly what that example run on its own would answer
    for sid in ids:
        alone = run.run_plan(UID, shelf.example(sid)["plan"], {}, lane="preview", now=NOW)
        assert out["cards"][sid] == alone, sid


def test_every_example_on_real_rows_matches_its_own_run(conn):
    """All 23, in batches of 8: the one-scan cut gives each card the payload its own run gives."""
    _seed(conn)
    ids = _ids()
    for i in range(0, len(ids), run.MAX_EXAMPLES):
        batch = ids[i:i + run.MAX_EXAMPLES]
        out = run.run_examples(UID, batch, now=NOW)
        for sid in batch:
            alone = run.run_plan(UID, shelf.example(sid)["plan"], {}, lane="preview", now=NOW)
            alone.pop("probe", None)          # the builder's formula probe rides the preview only
            assert out["cards"][sid] == alone, sid


def test_examples_use_sample_under_5_trades_and_label(conn, monkeypatch):
    for d in ("2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"):
        add_trade(conn, UID, day=d, pnl=25)
    calls = _spy(monkeypatch)
    ids = _ids()
    for i in range(0, len(ids), run.MAX_EXAMPLES):
        out = run.run_examples(UID, ids[i:i + run.MAX_EXAMPLES], now=NOW)
        assert out["sample"] is True
        for sid, card in out["cards"].items():
            assert card["sample"] is True, sid
            assert card["count"] > 4 and card["empty"] is None, sid   # the book, not the 4 trades
    assert calls == []                                                 # no member scan at all
    # the same card on the book alone, through run_plan(sample=True)
    out = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)
    alone = run.run_plan(UID, shelf.example("shelf:profit-factor")["plan"], {}, lane="preview",
                         now=NOW, sample=True)
    assert out["cards"]["shelf:profit-factor"] == alone


def test_examples_switch_to_real_at_5(conn):
    for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"):
        add_trade(conn, UID, day=d, pnl=25)
    first = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)
    assert first["sample"] is True
    add_trade(conn, UID, day="2026-10-23", pnl=-10)
    second = run.run_examples(UID, ["shelf:profit-factor"], now=NOW)     # within the cache TTL
    assert second["sample"] is False
    card = second["cards"]["shelf:profit-factor"]
    assert card["sample"] is False and card["value"]["v2"] == 5          # trades: the member's five


def test_examples_more_than_8_refused(conn):
    with pytest.raises(PlanError) as e:
        run.run_examples(UID, _ids()[:9], now=NOW)
    assert e.value.sentence == run.S_TOO_MANY_EXAMPLES
    with pytest.raises(PlanError) as e:
        run.run_examples(UID, ["shelf:no-such-example"], now=NOW)
    assert e.value.sentence == run.S_UNKNOWN_EXAMPLE
    # control: 8 distinct ids (and a repeat of one of them) are accepted
    out = run.run_examples(UID, _ids()[:8] + _ids()[:1], now=NOW)
    assert len(out["cards"]) == 8


def test_examples_cached_per_member_and_counted_as_one_preview(conn, monkeypatch):
    _seed(conn)
    other = "u-wsrc-other"
    add_user(conn, other)
    lanes = []
    real_admit = run.admit

    def counting_admit(user_id, lane):
        lanes.append((user_id, lane))
        return real_admit(user_id, lane)

    monkeypatch.setattr(run, "admit", counting_admit)
    calls = _spy(monkeypatch)
    ids = _ids()[:8]
    a = run.run_examples(UID, ids, now=NOW)
    assert lanes == [(UID, "example")]                    # ONE preview admission for 8 cards
    assert run._pending(UID) == 0                         # never a saved-widget run
    n = len(calls)
    assert run.run_examples(UID, ids, now=NOW) == a       # a cache hit: no new admission or scan
    assert lanes == [(UID, "example")] and len(calls) == n
    b = run.run_examples(other, ids, now=NOW)             # another member: own answer (the sample)
    assert b["sample"] is True and a["sample"] is False
    assert lanes == [(UID, "example"), (other, "example")]


# -- fix round 1: no example's column is hidden on the sample book ---------------------------------
# Task 10.13 extends the rail (ruling R-24) to EVERY revision, formula measures included.

def _mkey(m):
    return m["key"] if "key" in m else wplan.FORMULA_PREFIX + m["formula"]


def _columns(plan):
    """Per measure, the small-sample state of each row / point / cell the example shows on the sample
    book (the total for a one-number view). Flagged List rows carry no values and are left out.

    A scatter point carries no small-sample state (`payload._from_result` sends `{x, y, d, r}` and
    the client reads no `s`), so a point is shown whenever its value is known: it reads "hide" only
    when the value is missing (Task 10.13)."""
    rng = wplan.resolve_range(plan["range"], run.sample_today())
    sc = run._narrow(plan["source"], run._sample_scan(plan["source"]), plan, rng)
    res = aggregate.evaluate(sc.rows, plan, sources.CATALOG)
    groups = [g for g in res.groups if not g.flagged]
    if plan["view"]["type"] == "scatter":
        return [["hide" if g.values.cells[i].value is None else "" for g in groups]
                for i in range(len(plan["measures"]))]
    if res.groups:
        return [[g.values.cells[i].sample for g in groups] for i in range(len(plan["measures"]))]
    return [[c.sample] for c in res.total.cells]


def _hidden_everywhere(plan):
    return [_mkey(plan["measures"][i]) for i, col in enumerate(_columns(plan))
            if not col or all(s == "hide" for s in col)]


def _hidden_over_half(plan):
    return [_mkey(plan["measures"][i]) for i, col in enumerate(_columns(plan))
            if len(col) > 1 and sum(s == "hide" for s in col) * 2 > len(col)]


def _swapped(sid, i, key, rev=1):
    p = copy.deepcopy(shelf.revision(sid, rev)["plan"])
    p["measures"][i] = {"key": key}
    return wplan.validate_plan(p, sources.CATALOG)


def test_every_shelf_revision_renders_on_the_sample_book_without_a_hidden_column():
    revs = _all_revisions()
    assert len(revs) == SECTION_8_ROWS + 6                         # 23 + 3 new r1s + 6 r2s = 32
    bad = {(sid, rev): _hidden_everywhere(r["plan"]) for sid, rev, r in revs}
    assert {k: v for k, v in bad.items() if v} == {}
    over = {(sid, rev): _hidden_over_half(r["plan"]) for sid, rev, r in revs}
    assert {k: v for k, v in over.items() if v} == {}
    # controls (the review's I-1, reverted in memory): an average on one-trade rows is all hidden
    assert _hidden_everywhere(_swapped("shelf:best-trades", 1, "expectancy_r")) == ["expectancy_r"]
    assert _hidden_everywhere(_swapped("shelf:recent-trades", 1, "expectancy_r")) == ["expectancy_r"]
    # ruling R-24, reverted in memory: win rate per symbol hides on most of the top 10
    assert _hidden_over_half(_swapped("shelf:performance-by-symbol", 1, "win_rate")) == ["win_rate"]
    # Process vs results over the last 90 days: expectancy hides in 2 of its 3 adherence bands
    p = copy.deepcopy(shelf.revision("shelf:process-vs-results", 1)["plan"])
    p["range"] = {"token": "last_90d"}
    assert _hidden_over_half(wplan.validate_plan(p, sources.CATALOG)) == ["expectancy"]
    # a scatter point is hidden only where its value is missing: divide by zero is "no data"
    p = copy.deepcopy(shelf.revision("shelf:mae-vs-mfe", 1)["plan"])
    p["formulas"][1]["expr"] = "[mfe_r] / 0"
    assert _hidden_everywhere(wplan.validate_plan(p, sources.CATALOG)) == ["formula:f2"]


def test_sample_runs_refuse_the_run_and_drill_lanes():
    p = shelf.example("shelf:profit-factor")["plan"]
    for lane in ("run", "drill"):
        with pytest.raises(ValueError, match="preview and example"):
            run.run_plan(UID, p, {}, lane=lane, now=NOW, sample=True)
    assert run._pending(UID) == 0                         # nothing counted toward the daily cap
    for lane in ("preview", "example"):                   # control: the sample lanes run
        assert run.run_plan(UID, p, {}, lane=lane, now=NOW, sample=True)["sample"] is True


def test_examples_with_no_ids_take_no_permit_and_scan_nothing(conn, monkeypatch):
    calls = _spy(monkeypatch)

    def no_admit(*a, **k):
        raise AssertionError("no permit for an empty batch")

    monkeypatch.setattr(run, "admit", no_admit)
    assert run.run_examples(UID, [], now=NOW) == {"sample": True, "cards": {}}
    for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"):
        add_trade(conn, UID, day=d, pnl=25)
    assert run.run_examples(UID, [], now=NOW) == {"sample": False, "cards": {}}
    assert calls == []


# -- Task 10.13: the wave 10 revisions and the three new entries ------------------------------------

@pytest.fixture
def w10(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")


def test_new_revisions_validate_and_need_wave10():
    for sid, rev in W10_REVISIONS.items():
        r = shelf.revision(sid, rev)
        assert r is not None, (sid, rev)
        assert shelf.revision(sid, rev + 1) is None, (sid, rev)          # the newest revision
        raw = json.loads((shelf.SHELF_DIR / f"{sid[len(shelf.ID_PREFIX):]}.r{rev}.json")
                         .read_text(encoding="utf-8"))["plan"]
        assert wplan.validate_plan(copy.deepcopy(raw), sources.CATALOG) == r["plan"], sid
        assert wplan.needed_version(r["plan"]) == 3 and r["plan"]["v"] == 3, sid
        assert wplan.uses_wave10(r["plan"]), sid
        assert r["plan"]["display"]["title"] == r["name"], sid
        if rev > 1:                                   # the revision before it is still wave 9's
            assert wplan.needed_version(shelf.revision(sid, rev - 1)["plan"]) == 1, sid
    # with wave 10 off each revised id offers its revision 1, and the three new ids are not offered
    w9 = {e["id"]: e["rev"] for e in shelf.examples(allowed=lambda p: not wplan.uses_wave10(p))}
    assert all(w9[sid] == 1 for sid, rev in W10_REVISIONS.items() if rev > 1)
    assert not {sid for sid, rev in W10_REVISIONS.items() if rev == 1} & set(w9)
    assert len(w9) == 23


def test_manifest_order_places_the_new_ids_beside_their_neighbours():
    order = list(shelf._STATE[0])
    for new, after in (("shelf:mae-vs-mfe", "shelf:r-vs-pnl-scatter"),
                       ("shelf:process-vs-results", "shelf:month-in-review"),
                       ("shelf:goals-progress", "shelf:fees-drag")):
        assert order.index(new) == order.index(after) + 1, new


def _sample_card(sid, rev):
    return run.run_plan(UID, shelf.revision(sid, rev)["plan"], {}, lane="preview", now=NOW,
                        sample=True)


def test_cumulative_equity_curve_ends_at_total_net(w10):
    for sid in ("shelf:equity-curve", "shelf:r-equity-curve"):
        card = _sample_card(sid, 2)
        series = card["series"]
        assert len(series) > 10 and card["value"]["v1"] is not None, sid
        assert series[-1]["v1"] == pytest.approx(card["value"]["v1"]), sid     # the running total
        assert sum(s["d1"] for s in series if s["d1"] is not None) == pytest.approx(card["value"]["v1"]), sid
        peak = 0.0                                     # the drawdown under the running peak (floor 0)
        for s in series:
            peak = max(peak, s["v1"])
            assert s["dd1"] == pytest.approx(s["v1"] - peak) and s["dd1"] <= 0, (sid, s["label"])
        # control: revision 1 is the day-by-day amount, not a running total
        one = _sample_card(sid, 1)["series"]
        assert [s["label"] for s in one] == [s["label"] for s in series], sid
        for a, b in zip(one, series):
            assert (a["v1"] is None and b["d1"] is None) or a["v1"] == pytest.approx(b["d1"]), sid
        assert one[-1]["v1"] != pytest.approx(series[-1]["v1"]), sid


def test_hold_minutes_revision_says_dates_only_on_a_dates_only_book(conn, w10):
    for i, d in enumerate(("2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22")):
        add_trade(conn, UID, day=d, pnl=(-1) ** i * 50, hour=None, entry_iso="2026-10-15", exit_iso=d)
    plan = shelf.revision("shelf:pnl-by-hold-time", 2)["plan"]
    card = run.run_plan(UID, plan, {}, lane="preview", now=NOW)
    words = json.dumps(card)
    assert aggregate.S_HOLD_MINUTES_NO_TIMES in words
    assert card["rows"] == [] or all(r["v1"] is None for r in card["rows"])
    # control: one timed trade, and the dates-only sentence gives way to the count of the others
    add_trade(conn, UID, day="2026-10-23", pnl=80)
    run._reset_state()
    card = run.run_plan(UID, plan, {}, lane="preview", now=NOW)
    words = json.dumps(card)
    assert aggregate.S_HOLD_MINUTES_NO_TIMES not in words
    assert [r["label"] for r in card["rows"]] == ["240 to 1440"]               # 14:00 to 18:00 ET


def test_mae_vs_mfe_points_are_trades(w10):
    card = _sample_card("shelf:mae-vs-mfe", 1)
    plan = shelf.revision("shelf:mae-vs-mfe", 1)["plan"]
    rng = wplan.resolve_range(plan["range"], run.sample_today())
    rows = run._narrow("closed_trades", run._sample_scan("closed_trades"), plan, rng).rows
    rows = [r for r in rows if not r.get("flagged")]
    assert len(card["points"]) == len(rows) == card["count"] > 20        # one point per trade
    def key(t):
        return tuple("" if v is None else v for v in t[:1]) + tuple(
            (-1.0 if v is None else v) for v in t[1:])
    want = sorted(((r["day"], None if r["mae_r"] is None else round(abs(r["mae_r"]), 6),
                    None if r["mfe_r"] is None else round(r["mfe_r"], 6)) for r in rows), key=key)
    got = sorted(((p["d"], None if p["x"] is None else round(p["x"], 6),
                   None if p["y"] is None else round(p["y"], 6)) for p in card["points"]), key=key)
    assert got == want
    assert any(p["x"] is not None for p in card["points"])               # non-vacuity: real values
    assert all(p["x"] is None or p["x"] >= 0 for p in card["points"])    # MAE across, as a size
    assert card["def"]["display"]["quadrants"] == "excursion"


def test_goals_progress_without_goal_sentence(conn, w10):
    from api.services.journal_two.widget_engine import payload as wpayload
    from tests.test_widget_sources import add_account
    aid = add_account(conn, UID)
    for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"):
        add_trade(conn, UID, day=d, pnl=100, account=aid)
    plan = shelf.revision("shelf:goals-progress", 1)["plan"]
    card = run.run_plan(UID, plan, {}, lane="preview", now=NOW)
    sentence = "Set a weekly goal in your account settings to see progress."
    assert wpayload.S_GOAL_NONE.format(period="weekly") == sentence
    assert card["target"] is None and card["targetLabel"] == "Weekly goal"
    assert sentence in json.dumps(card)
    assert card["value"]["v1"] == pytest.approx(500.0)
    # control: a weekly goal set, the target is the goal and the sentence is gone
    conn.execute("UPDATE j2_accounts SET goals = ? WHERE id = ?", (json.dumps({"weekly": 1000}), aid))
    conn.commit()
    run._reset_state()
    card = run.run_plan(UID, plan, {}, lane="preview", now=NOW)
    assert card["target"] == pytest.approx(1000.0) and sentence not in json.dumps(card)


def test_examples_run_the_allowed_revision_and_cache_on_it(conn, w10):
    """`run_examples(allowed=...)` runs each id's newest allowed revision (the router passes its flag
    reader), and the cache keys on the revisions run: a flag flip within the TTL never serves the
    other revision's card."""
    _seed(conn)
    only_r1 = lambda p: not wplan.uses_wave10(p)                     # "wave 10 is off"
    off = run.run_examples(UID, ["shelf:equity-curve"], now=NOW, allowed=only_r1)
    assert off["cards"]["shelf:equity-curve"]["def"] == shelf.revision("shelf:equity-curve", 1)["plan"]
    on = run.run_examples(UID, ["shelf:equity-curve"], now=NOW, allowed=lambda p: True)
    assert on["cards"]["shelf:equity-curve"]["def"] == shelf.revision("shelf:equity-curve", 2)["plan"]
    assert run.run_examples(UID, ["shelf:equity-curve"], now=NOW) == on       # default: the newest
    with pytest.raises(PlanError) as e:                              # no allowed revision: unknown
        run.run_examples(UID, ["shelf:goals-progress"], now=NOW, allowed=only_r1)
    assert e.value.sentence == run.S_UNKNOWN_EXAMPLE
