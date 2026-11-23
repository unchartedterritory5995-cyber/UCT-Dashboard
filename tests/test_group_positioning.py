"""GRPS CROWDING: short interest, insider buying and fund holdings by sector and industry
(api/services/group_positioning.py, its place in api/services/group_stats.py's evening build, and the route's
`part=positioning`). Every company, symbol, filing and figure here is INVENTED.

  * one stock's figures: short interest (a row with no short interest, a withheld percent), funds (added counts new
    positions, cut counts sold-outs, no change known when no fund has a previous report, the net in percent of what
    the funds with both reports held, none from a base of zero);
  * the groups: medians resting on their members with the five-member floor, the most shorted (ties by symbol), the
    insider buyers among all members (a share needs five), purchase dollars that leave out an unpriced purchase and
    count it, the largest purchases, the funds adding share and the median net change;
  * each store read once, a store that cannot be read is that part's state (never a failed build), a purchase whose
    ticker is not a member is counted, the 13F part says why it is left out;
  * the three reads of what the server holds (the short list, the insider store, the N-PORT index file), each never
    a vendor or SEC call;
  * the evening build: positioning from the same build, a failure there leaves the rest standing, an answer held from
    before it is rebuilt;
  * the reads: the table, one group's members (most shorted first, the cut said), a group not held, pending, never a
    build or a store read on a request; the route's `part`, its gate unchanged.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import group_stats as route
from api.services import group_positioning as GP
from api.services import group_stats as gs
from api.services import group_stats_calc as C
from api.services import insider_clusters_sec as ics

ET = ZoneInfo("America/New_York")
EVENING = datetime(2031, 6, 4, 21, 0, tzinfo=ET)          # a Wednesday evening, after 20:15 New York time
FREE_USER = {"id": "gpo-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "gpo-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}

SOFT = ["QAA", "QAB", "QAC", "QAD", "QAE", "QAF"]           # six invented software stocks
CHIP = ["QBA", "QBB"]                                       # two invented chip stocks (too few for a figure)
SYM_GROUPS = {**{s: (("sector", "Technology"), ("industry", "Software")) for s in SOFT},
              **{s: (("sector", "Technology"), ("industry", "Chips")) for s in CHIP}}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, tmp_path):
    gs.reset_for_tests()
    ics.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(gs, "YIELD_S", 0.0)
    yield
    gs.reset_for_tests()
    ics.reset_for_tests()


def short_row(si, pct, dtc, chg):
    return {"short_interest": si, "pct_float": pct, "days_to_cover": dtc, "change_pct": chg}


SHORT = {"state": "ok", "meta": {"settlement_date": "2031-05-15", "previous_settlement_date": "2031-04-30",
                                 "publication_estimate": "2031-05-27", "read_at": "2031-05-28T10:00:00+00:00",
                                 "source": "FINRA, through Massive", "float_source": "nightly screener export"},
         "rows": {"QAA": short_row(1_000_000, 4.0, 2.0, 10.0), "QAB": short_row(2_000_000, 8.0, 3.0, -5.0),
                  "QAC": short_row(3_000_000, 12.0, 4.0, 0.0), "QAD": short_row(4_000_000, 16.0, 5.0, 20.0),
                  "QAE": short_row(5_000_000, 16.0, 6.0, None), "QAF": short_row(500_000, None, None, 40.0),
                  "QBA": short_row(900_000, 30.0, 9.0, 1.0), "ZZZQ": short_row(7_000_000, 50.0, 9.0, 1.0)}}


def buy(sym, value, day, unpriced=0, roles=("director",)):
    return {"ticker": sym, "issuer_cik": "0000000001", "filed": day, "date": day, "shares": 1000.0, "value": value,
            "unpriced": unpriced, "roles": list(roles)}


INSIDER = {"state": "ok", "source": ics.SOURCE, "keep_days": ics.KEEP_DAYS,
           "coverage": {"from": "2031-05-06", "to": "2031-06-03", "complete": True, "listed": 900, "read": 900,
                        "given_up": 0},
           "purchases": [buy("QAA", 250_000.0, "2031-05-20", roles=("ceo", "director")), buy("QAA", 50_000.0, "2031-05-28"),
                         buy("QAB", None, "2031-05-21", unpriced=2), buy("QAC", 900_000.0, "2031-06-02"),
                         buy("QBA", 75_000.0, "2031-05-30"), buy(None, 10_000.0, "2031-05-30"),
                         buy("ZZZQ", 5_000_000.0, "2031-05-30")]}


def nport(funds, added, cut, unchanged, new, no_prior, sold_out, now, prior):
    return {"funds": funds, "added": added, "cut": cut, "unchanged": unchanged, "new": new, "no_prior": no_prior,
            "sold_out": sold_out, "both_now": now, "both_prior": prior, "period_from": "2031-01-31",
            "period_to": "2031-03-31"}


NPORT = {"state": "ok", "meta": {"source": "SEC Form N-PORT", "quarter": "2031Q1", "prior_quarter": "2030Q4",
                                 "built_at": "2031-05-20T05:00:00+00:00", "matched_value_pct": 97.5},
         "rows": {"QAA": nport(10, 6, 2, 1, 1, 0, 0, 1100.0, 1000.0),       # 7 adding, 2 cutting: +10%
                  "QAB": nport(8, 1, 4, 1, 0, 2, 1, 900.0, 1200.0),         # 1 adding, 5 cutting: -25%
                  "QAC": nport(5, 2, 2, 1, 0, 0, 0, 500.0, 500.0),          # equal: not adding, 0%
                  "QAD": nport(4, 3, 0, 1, 0, 0, 0, 800.0, 400.0),          # +100%
                  "QAE": nport(3, 2, 0, 0, 1, 0, 0, 300.0, 0.0),            # adding, no base: no net
                  "QAF": nport(2, 0, 0, 0, 0, 2, 0, 0.0, 0.0),              # no fund has a previous report
                  "QBA": nport(6, 4, 1, 1, 0, 0, 0, 120.0, 100.0)}}


def _build(**kw):
    seen = []
    readers = dict(short_reader=lambda: seen.append("short") or SHORT, insider_reader=lambda: seen.append("insider") or INSIDER,
                   nport_reader=lambda syms: seen.append(("nport", sorted(syms))) or NPORT)
    readers.update(kw)
    return GP.build(SYM_GROUPS, **readers), seen


# ── one stock's figures ──────────────────────────────────────────────────────────────────────────────────

def test_one_stocks_short_figures_and_a_row_with_no_short_interest():
    assert GP.short_figures(short_row(1_000_000, 4.0, 2.0, 10.0)) == (1_000_000.0, 4.0, 2.0, 10.0)
    assert GP.short_figures(short_row(1_000_000, None, 2.0, None)) == (1_000_000.0, None, 2.0, None)   # withheld percent
    assert GP.short_figures(short_row(None, 4.0, 2.0, 1.0)) is None
    assert GP.short_figures({"short_interest": True}) is None and GP.short_figures(None) is None


def test_one_stocks_fund_figures_added_counts_new_cut_counts_sold_out_and_unknown_is_none():
    assert GP.fund_figures(NPORT["rows"]["QAA"]) == (10, 7, 2, 10.0)
    assert GP.fund_figures(NPORT["rows"]["QAB"]) == (8, 1, 5, -25.0)
    assert GP.fund_figures(NPORT["rows"]["QAE"]) == (3, 3, 0, None)          # held none before: no percent
    assert GP.fund_figures(NPORT["rows"]["QAF"]) == (2, None, None, None)    # no change known, never "0 added"
    assert GP.fund_figures(nport(0, 0, 0, 0, 0, 0, 3, 0.0, 600.0)) == (0, 0, 3, -100.0)   # every fund sold out
    assert GP.fund_figures(None) is None


def test_a_stock_with_a_fund_whose_change_is_not_comparable_has_no_known_change_never_a_guess():
    """A stock split may fall between a fund's two reports and could not be checked (2026-11-22): its funds' adds and
    cuts are not counted at all, so the new positions and sold-out funds alone never read as the stock's change."""
    assert GP.fund_figures({**nport(10, 0, 0, 0, 2, 1, 1, 40.0, 0.0), "not_comparable": 6}) == (10, None, None, None)
    assert GP.fund_figures({**NPORT["rows"]["QAA"], "not_comparable": 0}) == (10, 7, 2, 10.0)
    assert "not_comparable" in GP.NPORT_FIELDS
    pos, _ = _build(nport_reader=lambda syms: {**NPORT, "rows": {**NPORT["rows"], "QAA": {**NPORT["rows"]["QAA"], "not_comparable": 1}},
                                               "meta": {**NPORT["meta"], "splits": "unavailable"}})
    assert pos["stocks"]["QAA"][-3:] == [None, None, None] and pos["parts"]["funds"]["known"] == 5
    assert pos["parts"]["funds"]["splits"] == "unavailable"


# ── the groups ───────────────────────────────────────────────────────────────────────────────────────────

def test_each_store_is_read_once_and_only_the_universe_is_asked_of_the_index():
    _pos, seen = _build()
    assert seen == ["short", "insider", ("nport", sorted(SOFT + CHIP))]


def test_short_interest_medians_rest_on_their_members_and_five_is_the_floor():
    pos, _ = _build()
    soft = pos["kinds"]["industry"]["Software"]["short"]
    assert soft["reported"] == 6
    assert soft["pct_float"] == {"n": 5, "median": 12.0, "q1": 8.0, "q3": 16.0}          # QAF's percent is withheld
    assert soft["days_to_cover"] == {"n": 5, "median": 4.0, "q1": 3.0, "q3": 5.0}
    assert soft["change"] == {"n": 5, "median": 10.0, "q1": 0.0, "q3": 20.0}             # QAE has no previous report
    assert soft["top"] == [{"sym": "QAD", "pct_float": 16.0, "days_to_cover": 5.0},     # a tie goes by symbol
                           {"sym": "QAE", "pct_float": 16.0, "days_to_cover": 6.0},
                           {"sym": "QAC", "pct_float": 12.0, "days_to_cover": 4.0}]
    chips = pos["kinds"]["industry"]["Chips"]["short"]
    assert chips["reported"] == 1 and chips["pct_float"] == {"n": 1, "median": None, "q1": None, "q3": None}
    assert chips["top"] == [{"sym": "QBA", "pct_float": 30.0, "days_to_cover": 9.0}]
    assert pos["parts"]["short"]["covered"] == 7 and pos["parts"]["short"]["universe"] == 8   # ZZZQ is not a member
    assert pos["parts"]["short"]["settlement_date"] == "2031-05-15"


def test_insider_buyers_among_all_members_dollars_leave_out_the_unpriced_and_the_largest_buys():
    pos, _ = _build()
    soft = pos["kinds"]["industry"]["Software"]["insider"]
    assert soft["members"] == 6 and soft["buyers"] == {"n": 6, "count": 3, "share": 50.0}
    assert soft["purchases"] == 4 and soft["value"] == 1_200_000.0 and soft["unpriced"] == 2
    assert soft["top"] == [{"sym": "QAC", "value": 900_000.0, "date": "2031-06-02", "role": "director"},
                           {"sym": "QAA", "value": 250_000.0, "date": "2031-05-20", "role": "ceo"},
                           {"sym": "QAA", "value": 50_000.0, "date": "2031-05-28", "role": "director"}]
    chips = pos["kinds"]["industry"]["Chips"]["insider"]
    assert chips["buyers"] == {"n": 2, "count": 1, "share": None}                       # two members: no share
    part = pos["parts"]["insider"]
    assert part["matched"] == 5 and part["unmatched"] == 2 and part["sales"] == "not_held"
    assert part["keep_days"] == ics.KEEP_DAYS and (part["from"], part["to"]) == ("2031-05-06", "2031-06-03")


def test_a_group_whose_members_bought_nothing_priced_has_no_dollars_never_zero():
    pos, _ = _build(insider_reader=lambda: {**INSIDER, "purchases": [buy("QAB", None, "2031-05-21", unpriced=1)]})
    soft = pos["kinds"]["industry"]["Software"]["insider"]
    assert soft["value"] is None and soft["purchases"] == 1 and soft["unpriced"] == 1 and soft["top"] == []


def test_funds_adding_share_and_the_median_net_change_rest_on_the_members_whose_change_is_known():
    pos, _ = _build()
    soft = pos["kinds"]["industry"]["Software"]["funds"]
    assert soft["held"] == 6 and soft["known"] == 5                                      # QAF: no previous report
    assert soft["adding"] == {"n": 5, "count": 3, "share": 60.0}
    assert soft["net"] == {"n": 4, "median": None, "q1": None, "q3": None}               # QAE has no base: four, no median
    assert pos["kinds"]["sector"]["Technology"]["funds"]["net"] == {"n": 5, "median": 10.0, "q1": 0.0, "q3": 20.0}
    assert pos["kinds"]["industry"]["Chips"]["funds"]["adding"]["share"] is None
    part = pos["parts"]["funds"]
    assert part["covered"] == 7 and part["known"] == 6 and part["quarter"] == "2031Q1"
    assert (part["period_from"], part["period_to"]) == ("2031-01-31", "2031-03-31")


def test_the_sector_holds_every_member_of_its_industries():
    pos, _ = _build()
    tech = pos["kinds"]["sector"]["Technology"]
    assert tech["members"] == 8 and tech["syms"] == sorted(SOFT + CHIP)
    assert tech["insider"]["buyers"] == {"n": 8, "count": 4, "share": 50.0}
    assert set(pos["kinds"]["industry"]) == {"Software", "Chips"}


def test_a_store_that_cannot_be_read_is_that_parts_state_and_never_a_failed_build():
    def boom():
        raise RuntimeError("invented")
    pos, _ = _build(short_reader=boom, nport_reader=lambda syms: {"state": "not_built", "rows": {}, "meta": {}})
    assert pos["parts"]["short"]["state"] == "failed" and pos["parts"]["funds"]["state"] == "not_built"
    soft = pos["kinds"]["industry"]["Software"]
    assert soft["short"] is None and soft["funds"] is None and soft["insider"]["buyers"]["count"] == 3
    assert pos["parts"]["institutions"]["state"] == "not_held" and "13F" in pos["parts"]["institutions"]["detail"]


def test_the_held_stock_figures_are_one_short_list_per_stock_with_a_figure():
    pos, _ = _build()
    assert pos["fields"] == list(GP.STOCK_FIELDS)
    assert pos["stocks"]["QAA"] == [1_000_000.0, 4.0, 2.0, 10.0, 2, 300_000.0, 0, "2031-05-28", 10, 7, 2, 10.0]
    assert "QBB" not in pos["stocks"] and "ZZZQ" not in pos["stocks"]


# ── the reads of what the server holds ───────────────────────────────────────────────────────────────────

def test_the_short_read_is_short_datas_held_list_and_says_a_refusal(monkeypatch):
    from api.services import short_data
    monkeypatch.setattr(short_data, "held_market_rows",
                        lambda: ({"rows": {"QAA": short_row(1, 2.0, 3.0, 4.0)}, "settlement_date": "2031-05-15"}, "held"))
    got = GP.read_short()
    assert got["state"] == "ok" and got["rows"]["QAA"]["pct_float"] == 2.0 and got["meta"]["settlement_date"] == "2031-05-15"
    monkeypatch.setattr(short_data, "held_market_rows", lambda: ({"status": "unavailable", "reason": "refused"}, "not_held"))
    assert GP.read_short()["state"] == "unavailable" and GP.read_short()["meta"]["reason"] == "refused"
    monkeypatch.setattr(short_data, "held_market_rows", lambda: (None, "not_held"))
    assert GP.read_short()["state"] == "not_held"


def _store():
    owners = [{"cik": "0000000009", "name": "Invented Holder", "roles": ["director"], "title": None},
              {"cik": "0000000010", "name": "Invented Fund", "roles": ["ten_percent"], "title": None}]
    rec = {"accession": "0000000001-31-000001", "filed": "2031-06-02", "issuer_cik": "0000000001", "ticker": "QAA",
           "company": "Invented Co", "owners": owners, "txns": [], "first_date": "2031-06-01", "date": "2031-06-02",
           "shares": 100.0, "value": 1234.0, "avg_price": 12.34, "unpriced": 0, "url": "https://www.sec.gov/x"}
    return {"v": ics.DISK_VERSION, "days": {"2031-06-02": {"state": "complete", "listed": 3, "read": 3, "unreadable": 0,
                                                           "given_up": 0, "purchases": 1}}, "buys": {rec["accession"]: rec}}


def test_the_insider_read_is_the_stores_purchases_never_a_read_of_the_sec(monkeypatch):
    monkeypatch.setattr(ics, "_sec_get", lambda url: (_ for _ in ()).throw(AssertionError("read the SEC")))
    assert ics.held_purchases(date(2031, 6, 4)) == (None, "not_held")
    assert GP.read_insider()["state"] == "not_held"
    with ics._lock:
        ics._state.update(store=_store(), loaded=True)
    ans, how = ics.held_purchases(date(2031, 6, 4))
    assert how == "held" and ans["source"] == ics.SOURCE
    (row,) = ans["purchases"]
    assert set(row) == set(ics.PURCHASE_FIELDS) and "owners" not in row          # never the owners' names
    assert row["roles"] == ["director", "ten_percent"] and row["value"] == 1234.0
    assert ans["coverage"]["to"] == "2031-06-02"
    got = GP.read_insider()
    assert got["state"] == "ok" and got["purchases"][0]["ticker"] == "QAA" and got["keep_days"] == ics.KEEP_DAYS


def _index(path, rows, meta=None):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    con.execute("CREATE TABLE stock (sym TEXT PRIMARY KEY, summary TEXT NOT NULL) WITHOUT ROWID")
    for k, v in (meta or {"quarter": "2031Q1", "prior_quarter": "2030Q4", "coverage": {"matched_value_pct": 96.0}}).items():
        con.execute("INSERT INTO meta VALUES (?, ?)", (k, json.dumps(v)))
    for sym, s in rows.items():
        con.execute("INSERT INTO stock VALUES (?, ?)", (sym, json.dumps(s) if isinstance(s, dict) else s))
    con.commit()
    con.close()


def test_the_nport_read_is_the_held_index_file_for_the_members_only(monkeypatch, tmp_path):
    from api.services import fund_holders_nport as fhn
    path = tmp_path / "index.sqlite"
    monkeypatch.setattr(fhn, "index_path", lambda: str(path))
    assert GP.read_nport(["QAA"])["state"] == "not_built"
    _index(path, {"QAA": {**NPORT["rows"]["QAA"], "tier": "sec_ftd"}, "QZZ": NPORT["rows"]["QAB"], "QAB": "not json"})
    got = GP.read_nport(["QAA", "QAB"])
    assert got["state"] == "ok" and set(got["rows"]) == {"QAA"} and set(got["rows"]["QAA"]) == set(GP.NPORT_FIELDS)
    assert got["meta"]["quarter"] == "2031Q1" and got["meta"]["matched_value_pct"] == 96.0
    assert got["meta"]["splits"] is None                                 # an index from before the split list
    _index(tmp_path / "v2.sqlite", {"QAA": NPORT["rows"]["QAA"]}, {"quarter": "2031Q1", "splits": {"state": "ok", "events": 2}})
    monkeypatch.setattr(fhn, "index_path", lambda: str(tmp_path / "v2.sqlite"))
    assert GP.read_nport(["QAA"])["meta"]["splits"] == "ok"
    monkeypatch.setattr(fhn, "index_path", lambda: str(path))
    path.write_bytes(b"not a database at all, invented")
    assert GP.read_nport(["QAA"])["state"] == "unavailable"


# ── the evening build ────────────────────────────────────────────────────────────────────────────────────

def _closes(n=300, end=date(2031, 6, 4)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return [(day, 10.0 + i * 0.01) for i, day in enumerate(reversed(out))]


GROUPS = {**{s: {"sector": "Technology", "industry": "Software"} for s in SOFT},
          **{s: {"sector": "Technology", "industry": "Chips"} for s in CHIP}}


def _gs_build(**kw):
    closes = _closes()
    args = dict(read_closes=lambda s: {"status": "ok", "closes": closes}, symbols=SOFT + CHIP + ["QZZZ"],
                groups=GROUPS, pause=lambda s: None, yield_s=0.0, fund_on=False)
    args.update(kw)
    return gs.build(EVENING, **args)


def test_the_evening_build_adds_positioning_from_its_own_mapped_universe():
    given = []
    ans = _gs_build(positioning=lambda sg: given.append(dict(sg)) or GP.build(
        sg, short_reader=lambda: SHORT, insider_reader=lambda: INSIDER, nport_reader=lambda syms: NPORT))
    assert set(given[0]) == set(SOFT + CHIP)                                  # QZZZ has no group: not asked
    assert given[0]["QAA"] == (("sector", "Technology"), ("industry", "Software"))
    assert ans["positioning"]["kinds"]["industry"]["Software"]["short"]["pct_float"]["median"] == 12.0
    assert ans["kinds"]["sector"]["Technology"]["breadth"] is not None        # the rest of the build is unchanged
    assert isinstance(ans["build"]["positioning_cpu_s"], float)


def test_a_failure_in_positioning_leaves_the_rest_of_the_build_standing():
    ans = _gs_build(positioning=lambda sg: (_ for _ in ()).throw(RuntimeError("invented")))
    assert ans["status"] == "ok" and ans["kinds"]["industry"]["Software"]["breadth"] is not None
    assert {p: ans["positioning"]["parts"][p]["state"] for p in ("short", "insider", "funds")} == \
        {"short": "failed", "insider": "failed", "funds": "failed"}
    assert gs._positioning_said(ans["positioning"]) == "short=failed/- insider=failed/- funds=failed/-"


def _held(pos=True, **kw):
    ans = _gs_build(positioning=lambda sg: GP.build(sg, short_reader=lambda: SHORT, insider_reader=lambda: INSIDER,
                                                    nport_reader=lambda syms: NPORT), **kw)
    if not pos:
        ans.pop("positioning")
    with gs._lock:
        gs._state.update(answer=ans, built_for=ans["built_for"], loaded=True)
    return ans


def test_an_answer_held_from_before_positioning_says_pending_and_is_rebuilt():
    _held(pos=False)
    t = gs.get_group_positioning("industry")
    assert t["sources"]["positioning"]["state"] == "pending" and t["sources"]["positioning"]["short"] == {"state": "pending"}
    assert all(g["positioning"] is None for g in t["groups"]) and t["count"] == 2
    assert gs.refresh_due(EVENING) is True
    _held()
    assert gs.refresh_due(EVENING) is False


# ── the reads the route makes ────────────────────────────────────────────────────────────────────────────

def test_before_the_first_build_the_read_says_not_built_and_never_builds(monkeypatch):
    monkeypatch.setattr(gs, "_start_job", lambda: (_ for _ in ()).throw(AssertionError("started on a request")))
    for name in (None, "Software"):
        got = gs.get_group_positioning("industry", name)
        assert got["status"] == "not_built" and got["part"] == "positioning"
    assert gs.get_group_positioning("theme")["status"] == "error"


def test_the_table_lists_every_group_with_its_positioning_and_never_reads_a_store(monkeypatch):
    _held()
    for name in ("read_short", "read_insider", "read_nport"):
        monkeypatch.setattr(GP, name, lambda *a: (_ for _ in ()).throw(AssertionError("read a store on a request")))
    monkeypatch.setattr(gs, "build", lambda *a, **k: (_ for _ in ()).throw(AssertionError("built on a request")))
    t = gs.get_group_positioning("industry")
    assert t["status"] == "ok" and t["part"] == "positioning" and t["count"] == 2 and t["min_members"] == C.MIN_MEMBERS
    soft = next(g for g in t["groups"] if g["name"] == "Software")
    assert soft["members"] == 6 and "syms" not in soft["positioning"]
    assert soft["positioning"]["short"]["pct_float"]["median"] == 12.0
    src = t["sources"]["positioning"]
    assert src["state"] == "ok" and src["short"]["settlement_date"] == "2031-05-15" and src["institutions"]["state"] == "not_held"
    assert src["min_members"] == C.MIN_MEMBERS and src["top_n"] == GP.TOP_N
    assert "fund" not in soft and "breadth" not in soft and "rank" not in soft          # the lean answer


def test_one_groups_members_with_their_figures_most_shorted_first_and_the_cut_said(monkeypatch):
    _held()
    g = gs.get_group_positioning("industry", "software")                                # compared loosely
    assert g["found"] is True and g["name"] == "Software" and g["members"] == 6 and g["peers"] == 2
    assert [r["sym"] for r in g["member_rows"]] == ["QAD", "QAE", "QAC", "QAB", "QAA", "QAF"]
    assert g["member_rows"][0] == {"sym": "QAD", **dict(zip(GP.STOCK_FIELDS,
                                   [4_000_000.0, 16.0, 5.0, 20.0, None, None, None, None, 4, 3, 0, 100.0]))}
    assert g["member_total"] == 6 and g["member_cut"] is False and g["member_limit"] == GP.MEMBERS_MAX
    monkeypatch.setattr(GP, "MEMBERS_MAX", 4)
    g = gs.get_group_positioning("industry", "Software")
    assert len(g["member_rows"]) == 4 and g["member_cut"] is True and g["member_total"] == 6
    missing = gs.get_group_positioning("industry", "Shipping")
    assert missing["found"] is False and missing["status"] == "ok" and "member_rows" not in missing


def test_the_other_views_answers_are_unchanged():
    _held()
    t = gs.get_group_stats("industry")
    assert "part" not in t and "positioning" not in t["sources"]
    assert all("positioning" not in g for g in t["groups"])
    assert "member_rows" not in gs.get_group_stats("industry", "Software")


# ── the route ────────────────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_takes_part_positioning_behind_the_same_paid_gate(monkeypatch):
    asked = []
    monkeypatch.setattr(gs, "get_group_positioning", lambda kind, name: asked.append(("pos", kind, name)) or {"status": "ok"})
    monkeypatch.setattr(gs, "get_group_stats", lambda kind, name: asked.append(("stats", kind, name)) or {"status": "ok"})
    assert _client(None).get("/api/research/group-stats?part=positioning").status_code == 401
    assert _client(FREE_USER).get("/api/research/group-stats?part=positioning").status_code == 402
    assert asked == []
    paid = _client(PAID_USER)
    assert paid.get("/api/research/group-stats?kind=industry&part=positioning").json() == {"status": "ok"}
    assert paid.get("/api/research/group-stats?kind=sector&name=Technology&part=positioning").status_code == 200
    assert paid.get("/api/research/group-stats?kind=sector").status_code == 200
    assert asked == [("pos", "industry", None), ("pos", "sector", "Technology"), ("stats", "sector", None)]
    assert paid.get("/api/research/group-stats?part=breadth").status_code == 422
    assert len(asked) == 3
