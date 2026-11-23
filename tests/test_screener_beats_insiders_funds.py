"""Beats, insiders & funds Screener columns (`api/services/screener/beats_insiders_funds.py`).

Every company, filing and fund figure here is invented. Each reader is fed its store through the store's own
read-only accessor (never a vendor, never the SEC), and each column is held to the rule it reuses: ERNSC's beat rule
for the earnings pair, INS CLUSTER's purchase records for the insider pair, GRPS CROWDING's fund rule for the adds.
"""
from __future__ import annotations

import importlib
from datetime import date, timedelta

import pytest

from api.services import sector_earnings_calc as EC
from api.services.screener import beats_insiders_funds as BIF

SESSION = date(2026, 11, 20)


# ── earnings: one copy ────────────────────────────────────────────────────────────────────────

def _q(fy, fq, day, actual, estimate, *, basis="consensus_comparable", reported=True):
    from api.services import earnings_intel as EI
    q = {"reported": reported, "report_date": day, "fiscal_year": fy, "fiscal_quarter": fq, "eps_basis": basis,
         "eps_actual": actual, "eps_estimate": estimate}
    if basis == "consensus_comparable":
        q["eps_surprise_pct"], q["eps_surprise_abs"], _note = EI._surprise(actual, estimate, eps=True)
    return q


def _copy(*quarters, nxt=None):
    out = {"quarters": list(quarters)}
    if nxt:
        out["summary"] = {"next_report_date": nxt}
    return out


def test_the_newest_reports_surprise_and_a_beat_streak_by_ernscs_rule():
    copy = _copy(_q(2026, 3, "2026-11-05", 1.10, 1.00),           # +10% beat
                 _q(2026, 2, "2026-08-06", 0.92, 0.90),           # +2.2% beat
                 _q(2026, 1, "2026-05-07", 0.81, 0.80),           # +1.25% beat
                 _q(2025, 4, "2026-02-05", 0.802, 0.80),          # +0.25%: in line, ends the streak
                 _q(2025, 3, "2025-11-06", 0.90, 0.70))           # a beat beyond the break does not count
    vals, state = BIF.stock_earnings(copy, SESSION.isoformat())
    assert state == "ok" and vals == {"eps_surprise_last": 10.0, "eps_beat_streak": 3}
    # each quarter judged exactly as ERNSC judges it
    rows = [EC.reporter_row("X", q, {}, None, lambda d: False) for q in copy["quarters"]]
    assert [r[EC.EPS_STATE] for r in rows] == ["beat", "beat", "beat", "in_line", "beat"]


def test_a_miss_or_an_in_line_newest_quarter_is_a_streak_of_zero_not_null():
    vals, _ = BIF.stock_earnings(_copy(_q(2026, 3, "2026-11-05", 0.90, 1.00), _q(2026, 2, "2026-08-06", 1.2, 1.0)),
                                 SESSION.isoformat())
    assert vals == {"eps_surprise_last": -10.0, "eps_beat_streak": 0}


def test_a_missing_fiscal_quarter_ends_the_streak():
    vals, _ = BIF.stock_earnings(_copy(_q(2026, 3, "2026-11-05", 1.1, 1.0), _q(2026, 1, "2026-05-07", 1.1, 1.0)),
                                 SESSION.isoformat())
    assert vals["eps_beat_streak"] == 1, "2026 Q2 is missing: never counted across"


def test_no_comparable_consensus_on_the_newest_quarter_blanks_both():
    vals, state = BIF.stock_earnings(_copy(_q(2026, 3, "2026-11-05", 1.1, None, basis="gaap_diluted"),
                                           _q(2026, 2, "2026-08-06", 1.1, 1.0)), SESSION.isoformat())
    assert state == "ok" and vals == {}, "never a guessed 0"


def test_a_consensus_under_five_cents_has_no_percent_but_still_judges_the_beat():
    vals, _ = BIF.stock_earnings(_copy(_q(2026, 3, "2026-11-05", 0.04, 0.02), _q(2026, 2, "2026-08-06", 1.1, 1.0)),
                                 SESSION.isoformat())
    assert "eps_surprise_last" not in vals and vals["eps_beat_streak"] == 2


def test_no_look_ahead_a_report_after_the_session_is_not_read():
    copy = _copy(_q(2026, 4, "2026-11-23", 0.5, 1.0), _q(2026, 3, "2026-11-05", 1.1, 1.0))
    vals, _ = BIF.stock_earnings(copy, SESSION.isoformat())
    assert vals == {"eps_surprise_last": 10.0, "eps_beat_streak": 1}
    later, _ = BIF.stock_earnings(copy, "2026-11-23")
    assert later == {"eps_surprise_last": -50.0, "eps_beat_streak": 0}


def test_a_copy_behind_its_own_next_report_date_is_blank():
    copy = _copy(_q(2026, 3, "2026-08-06", 1.1, 1.0), nxt="2026-11-12")
    assert BIF.stock_earnings(copy, SESSION.isoformat()) == ({}, "awaiting")
    assert BIF.stock_earnings(copy, "2026-11-11")[1] == "ok", "a report date still ahead is not behind"
    assert BIF.stock_earnings(_copy(), SESSION.isoformat()) == ({}, "no_report")
    undated = _copy(_q(2026, 3, None, 1.1, 1.0))
    assert BIF.stock_earnings(undated, SESSION.isoformat()) == ({}, "no_report"), "an undated report is not placed"


def test_the_reader_makes_one_pass_over_the_held_copies(monkeypatch):
    from api.services import sector_earnings as SE
    passes = []

    def held(symbols):
        passes.append(list(symbols))
        for s in symbols:
            yield s, ({"quarters": [_q(2026, 3, "2026-11-05", 1.1, 1.0)]} if s == "ZZQA" else None)
    monkeypatch.setattr(SE, "held_copies", held)
    receipt = {}
    got = BIF.read_earnings_fields(["ZZQA", "ZZQB"], session=SESSION, receipt=receipt)
    assert got == {"ZZQA": {"eps_surprise_last": 10.0, "eps_beat_streak": 1}}
    assert len(passes) == 1, "one pass per build, never a read per stock"
    assert receipt["state"] == "served" and receipt["held"] == 1 and receipt["not_held"] == 1
    assert BIF.read_earnings_fields(["ZZQA"], session=None, receipt=receipt) == {}
    assert receipt["state"] == "no_session" and len(passes) == 1


def test_the_held_copy_read_is_ernscs_own():
    """The reader goes through `sector_earnings.held_copies`, the one-connection read ERNSC uses (and whose
    agreement with `earnings_intel.get_earnings_held` tests/test_sector_earnings.py holds case by case)."""
    import inspect
    src = inspect.getsource(BIF.read_earnings_fields)
    assert "SE.held_copies(" in src and "get_earnings_held" not in src


# ── insider buys ──────────────────────────────────────────────────────────────────────────────

def _days(newest=SESSION, back=40, state="complete"):
    out = []
    for k in range(back):
        d = newest - timedelta(days=k)
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "state": state})
    return out


def _purchase(ticker, filed, value=1000.0, unpriced=0):
    return {"ticker": ticker, "filed": filed, "date": filed, "shares": 10.0, "value": value, "unpriced": unpriced,
            "roles": ["director"]}


def test_insider_counts_cover_the_30_days_ending_on_the_session_inclusive():
    lo = (SESSION - timedelta(days=29)).isoformat()
    buys = [_purchase("ZZQA", lo, 1000.0), _purchase("ZZQA", SESSION.isoformat(), 2500.5),
            _purchase("ZZQA", (SESSION - timedelta(days=30)).isoformat(), 9e9),      # a day too old
            _purchase("ZZQA", (SESSION + timedelta(days=1)).isoformat(), 9e9),      # after the session
            _purchase("zzqb", SESSION.isoformat(), None, unpriced=2),               # no price stated
            _purchase(None, SESSION.isoformat()), _purchase("ZZQX", SESSION.isoformat())]
    got, unmatched = BIF.insider_counts(buys, ["ZZQA", "ZZQB", "ZZQC"], lo, SESSION.isoformat())
    assert got["ZZQA"] == {"insider_buys_30d": 2, "insider_buy_value_30d": 3500.5}
    assert got["ZZQB"] == {"insider_buys_30d": 1}, "an unpriced purchase is counted, never valued at $0"
    assert got["ZZQC"] == {"insider_buys_30d": 0}, "the store reads every Form 4: none filed is a real 0"
    assert unmatched == 2


def test_a_dot_spelled_share_class_matches_the_universes_hyphen():
    got, _ = BIF.insider_counts([_purchase("ZZQ.B", SESSION.isoformat())], ["ZZQ-B"], "2026-10-22", "2026-11-20")
    assert got["ZZQ-B"]["insider_buys_30d"] == 1


@pytest.fixture
def insider_store(monkeypatch):
    from api.services import insider_clusters_sec as ics
    state = {"answer": None, "how": "not_held"}
    monkeypatch.setattr(ics, "held_purchases", lambda today=None: (state["answer"], state["how"]))
    return state


def test_the_insider_reader_is_blank_while_the_store_is_not_held(insider_store):
    receipt = {}
    assert BIF.read_insider_fields(["ZZQA"], session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "not_held"


def test_the_insider_reader_is_blank_until_the_store_reaches_back_over_the_window(insider_store):
    insider_store.update(how="held", answer={"purchases": [_purchase("ZZQA", "2026-11-18")],
                                             "coverage": {"days": _days(back=17)}})     # a first night's backfill
    receipt = {}
    assert BIF.read_insider_fields(["ZZQA"], session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "window_not_held" and receipt["store_from"] > receipt["window_from"]
    insider_store["answer"]["coverage"]["days"] = _days(back=30)
    got = BIF.read_insider_fields(["ZZQA", "ZZQB"], session=SESSION, receipt=receipt)
    assert got == {"ZZQA": {"insider_buys_30d": 1, "insider_buy_value_30d": 1000.0}, "ZZQB": {"insider_buys_30d": 0}}
    assert receipt["state"] == "served" and receipt["complete"] is True and receipt["lag_sessions"] == 0


def test_the_insider_reader_is_blank_when_the_store_has_stopped_reading(insider_store):
    insider_store.update(how="held", answer={"purchases": [], "coverage": {"days": _days(newest=SESSION - timedelta(
        days=14), back=60)}})
    receipt = {}
    assert BIF.read_insider_fields(["ZZQA"], session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "stale" and receipt["lag_sessions"] > 3


def test_a_partly_read_day_is_counted_and_said(insider_store):
    days = _days(back=35)
    days[3]["state"] = "partial"
    insider_store.update(how="held", answer={"purchases": [], "coverage": {"days": days}})
    receipt = {}
    assert BIF.read_insider_fields(["ZZQA"], session=SESSION, receipt=receipt) == {"ZZQA": {"insider_buys_30d": 0}}
    assert receipt["complete"] is False


# ── fund adds ─────────────────────────────────────────────────────────────────────────────────

def _summary(**kw):
    s = {"funds": 10, "added": 0, "cut": 0, "unchanged": 0, "new": 0, "no_prior": 0, "sold_out": 0,
         "both_now": 100.0, "both_prior": 90.0, "not_comparable": 0}
    s.update(kw)
    return s


def test_fund_net_adds_is_grps_crowdings_rule(monkeypatch):
    from api.services import group_positioning as GP
    rows = {"ZZQA": _summary(added=6, new=2, cut=3, sold_out=1, unchanged=4),
            "ZZQB": _summary(added=1, cut=5),
            "ZZQC": _summary(added=4, not_comparable=1),                      # a split that could not be checked
            "ZZQD": _summary(no_prior=3),                                     # no fund's change is known
            "ZZQ-E": _summary(added=2)}
    asked = []
    monkeypatch.setattr(GP, "read_nport", lambda symbols: asked.append(set(symbols)) or
                        {"state": "ok", "rows": rows, "meta": {"quarter": "2026Q3", "prior_quarter": "2026Q2"}})
    receipt = {}
    got = BIF.read_fund_fields(["ZZQA", "ZZQB", "ZZQC", "ZZQD", "ZZQ.E", "ZZQF"], receipt=receipt)
    assert got == {"ZZQA": {"fund_net_adds": 4}, "ZZQB": {"fund_net_adds": -4}, "ZZQ.E": {"fund_net_adds": 2}}
    for sym in ("ZZQA", "ZZQB", "ZZQC", "ZZQD"):
        f = GP.fund_figures(rows[sym])
        want = None if f[1] is None else f[1] - f[2]
        assert got.get(sym, {}).get("fund_net_adds") == want, sym
    assert len(asked) == 1 and "ZZQ-E" in asked[0]
    assert receipt["state"] == "served" and receipt["in_index"] == 5 and receipt["known"] == 3
    assert receipt["quarter"] == "2026Q3"


def test_fund_net_adds_is_blank_while_the_index_is_not_built(monkeypatch):
    from api.services import group_positioning as GP
    monkeypatch.setattr(GP, "read_nport", lambda symbols: {"state": "not_built", "rows": {}, "meta": {}})
    failures, receipt = {}, {}
    assert BIF.read_fund_fields(["ZZQA"], failures=failures, receipt=receipt) == {}
    assert receipt["state"] == "not_built" and failures == {"fund_adds": {"not_built": 1}}


# ── the build: each store read once, the columns land, the filters screen them ────────────────

def test_the_build_reads_each_store_once_and_writes_the_five_columns(tmp_path, monkeypatch, insider_store):
    from api.services import group_positioning as GP, sector_earnings as SE
    from api.services.screener import snapshot_builder as sb, snapshot_db, volume_volatility as VV
    from api.services.screener import (finviz_universe, earnings_dates, earnings_context, analyst_pass,
                                       insider_capture, short_columns, fund_trends, context_joins as cj)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    d = date(2026, 9, 1)
    rows = []
    while len(rows) < 60:
        if d.weekday() < 5:
            rows.append((int(d.strftime("%Y%m%d")), 20.0, 20.2, 19.8, 20.0, 1000))
        d += timedelta(days=1)
    monkeypatch.setattr(sb, "_load_universe", lambda: ["ZZQA", "ZZQB", "ZZQC"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: rows)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "settled_session", lambda now=None: SESSION)
    monkeypatch.setattr(sb, "_read_settled_bars", lambda d: {"error": "not in this test"})
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"), (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"), (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"), (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    monkeypatch.setattr(short_columns, "read_short_columns", lambda t, failures=None, receipt=None: {})
    monkeypatch.setattr(fund_trends, "read_fields", lambda t, failures=None, settled=None, receipt=None: {})
    monkeypatch.setattr(VV, "index_context", lambda now=None: {"state": "not_held", "rows": 0, "ms": 0.0,
                                                               "seam_withheld": 0})
    calls = {"earnings": 0, "insider": 0, "funds": 0}

    def held(symbols):
        calls["earnings"] += 1
        for s in symbols:
            yield s, ({"quarters": [_q(2026, 3, "2026-11-05", 1.1, 1.0), _q(2026, 2, "2026-08-06", 0.95, 1.0)]}
                      if s == "ZZQA" else None)
    monkeypatch.setattr(SE, "held_copies", held)
    insider_store.update(how="held", answer={"purchases": [_purchase("ZZQB", "2026-11-18", 52000.0),
                                                           _purchase("ZZQB", "2026-11-10", None, unpriced=1)],
                                             "coverage": {"days": _days(back=35)}})
    real_insider = BIF.read_insider_fields
    monkeypatch.setattr(BIF, "read_insider_fields",
                        lambda *a, **k: calls.__setitem__("insider", calls["insider"] + 1) or real_insider(*a, **k))
    monkeypatch.setattr(GP, "read_nport", lambda symbols: calls.__setitem__("funds", calls["funds"] + 1) or {
        "state": "ok", "meta": {}, "rows": {"ZZQC": _summary(added=7, cut=2)}})

    out = sb.run_build(max_tickers=3)
    assert out["built"] == 3 and calls == {"earnings": 1, "insider": 1, "funds": 1}, \
        "one read of each store per build, never one per ticker"
    rec = out["beats_insiders_funds"]
    assert rec["earnings"]["state"] == "served" and rec["insider"]["state"] == "served"
    assert rec["funds"]["state"] == "served" and all("seconds" in rec[k] for k in rec)
    a, b, c = (snapshot_db.get_row(t) for t in ("ZZQA", "ZZQB", "ZZQC"))
    assert (a["eps_surprise_last"], a["eps_beat_streak"]) == (10.0, 1)
    assert (b["insider_buys_30d"], b["insider_buy_value_30d"]) == (2, 52000.0)
    assert (a["insider_buys_30d"], a["insider_buy_value_30d"]) == (0, None)
    assert c["fund_net_adds"] == 5 and a["fund_net_adds"] is None
    assert b["eps_surprise_last"] is None and b["eps_beat_streak"] is None, "no copy held: NULL, never 0"


def test_the_filters_screen_the_five_columns_end_to_end(tmp_path, monkeypatch):
    from tests.test_screener_filters import _snapshot
    day = SESSION.isoformat()
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ZZQA", "eps_surprise_last": 12.5, "eps_beat_streak": 4, "insider_buys_30d": 3,
         "insider_buy_value_30d": 1_250_000.0, "fund_net_adds": 9, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQB", "eps_surprise_last": -3.0, "eps_beat_streak": 0, "insider_buys_30d": 0,
         "fund_net_adds": -6, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQC", "eps_beat_streak": 2, "insider_buys_30d": 1, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQD", "snapshot_date": day, "built_at": 1},       # NULL: inside no range
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    assert tickers({"key": "eps_surprise_last", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "eps_beat_streak", "op": "gte", "min": 2}) == ["ZZQA", "ZZQC"]
    assert tickers({"key": "insider_buys_30d", "op": "gte", "min": 1}) == ["ZZQA", "ZZQC"]
    assert tickers({"key": "insider_buys_30d", "op": "lte", "max": 0}) == ["ZZQB"]
    assert tickers({"key": "insider_buy_value_30d", "op": "gte", "min": 1_000_000}) == ["ZZQA"]
    assert tickers({"key": "fund_net_adds", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "fund_net_adds", "op": "lt", "max": 0}) == ["ZZQB"]


# ── the registry, the client text, the methodology ────────────────────────────────────────────

def test_each_column_is_a_bare_member_control_in_its_own_family_with_a_seat_in_its_view():
    from api.services.screener import filters, snapshot_db
    assert {"key": "beats_insiders_funds", "label": "Beats, Insiders & Funds"} in filters.CATEGORIES
    family = {k for k, f in filters.FILTERS.items() if f["category"] == "beats_insiders_funds"}
    assert family == set(BIF.COLUMNS)
    view = filters.VIEWS["beats_insiders_funds"]["columns"]
    catalog = {f["key"]: f for f in filters.field_catalog()}
    for c in BIF.COLUMNS:
        f = filters.FILTERS[c]
        assert f["column"] == c and f["type"] == "range" and f["allow_custom"] is True
        assert [p["label"] for p in f["presets"]] == ["Any"] and f["presets_deferred"] is True
        assert f.get("agent_omit") is True and catalog[c].get("agent_omit") is True, c
        assert c in view and c in snapshot_db.COLUMNS, c
    assert set(BIF.INT_COLUMNS) <= snapshot_db._INT
    assert not (set(BIF.COLUMNS) - set(BIF.INT_COLUMNS)) & snapshot_db._INT
    assert {"next_earnings_date", "last_report_move_pct"} <= set(view)


def test_the_client_text_states_the_owners_numbers():
    from api.services import earnings_intel as EI
    from tests.test_screener_filters import _column_def_block as block
    streak = block("eps_beat_streak")
    assert f"above {EC.IN_LINE_PCT:g}% is a beat" in streak and f"within {EC.IN_LINE_PCT:g}% either way" in streak
    assert f"at most the {EI._QUARTERS_BACK} quarters" in streak
    assert f"in the last {BIF.INSIDER_DAYS} days" in block("insider_buys_30d")
    assert f"the {BIF.INSIDER_DAYS} calendar days ending on the last session" in block("insider_buys_30d")


def test_every_column_publishes_a_method_with_its_store_and_rule():
    from api.services import insider_clusters_sec as ics
    from api.services.screener import methodology as M
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    for c in BIF.COLUMNS:
        m = published.get(c)
        assert m is not None, f"{c} ships without a method"
        assert m["family"] == "beats_insiders_funds" and m["one_line"] and m["scale"] and m["how"] and m["caveat"]
        assert "never 0" in m["caveat"], c
    assert f"above {EC.IN_LINE_PCT:g}%" in published["eps_beat_streak"]["how"]
    assert ics.SOURCE in published["insider_buys_30d"]["how"]
    assert f"keeps {ics.KEEP_DAYS} calendar days" in published["insider_buys_30d"]["caveat"]
    assert "never valued at $0" in published["insider_buy_value_30d"]["caveat"]
    assert "not comparable" in published["fund_net_adds"]["caveat"]
    assert doc["beats_insiders_funds"]["columns"] == list(BIF.COLUMNS)


def test_the_beats_methods_are_read_from_the_owners(monkeypatch):
    from api.services import insider_clusters_sec as ics
    from api.services.screener import methodology as M
    monkeypatch.setattr(EC, "IN_LINE_PCT", 1.0)
    monkeypatch.setattr(ics, "KEEP_DAYS", 45)
    monkeypatch.setattr(BIF, "INSIDER_DAYS", 21)
    by = {m["column"]: m for m in M._beats_methods()}
    assert "a surprise above 1% " in by["eps_beat_streak"]["how"]
    assert "keeps 45 calendar days" in by["insider_buys_30d"]["caveat"]
    assert by["insider_buys_30d"]["label"] == "Insider Buy Filings, Last 21 Days"
