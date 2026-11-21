"""MD-1 kinds of terminal data wave 8: `stock.corporateActions`, `calendar.ipos`, `calendar.dividends` — the Agent half
of the CACT, IPO and DVD terminal panels.

No network and no real store: the chart markers record is a temp file, and every held answer is put where its service
keeps it BY the service (the markers record by `earnings_estimates._markers_disk_write`, the IPO calendar by
`ipo_calendar.get_ipos_with_status` over invented vendor rows, the dividend calendar by
`dividends_calendar.get_events_with_status` over invented vendor rows). Every number, name, ticker and date is invented.
Pinned per kind: an ok read (envelope conformance, every row the service's own, the data's own date as `as_of` or null
with the read time beside it), a missing number null and never 0, the cut stated and from which end, `unavailable` kept
apart from a healthy answer with each state said in its own note, a malformed request refused before any read, a
failing service answered `unavailable`, and THE BUDGET RULE: no read starts a build, a thread or a vendor request and
none writes to the cache, with the member path's own reader shown to do exactly that in the same state (so the rail can
fail). For all three: registered dark, model-isolated, dormant until armed one by one. The cross-file facts (the
services' own constants, the panels' own row counts and window) are read from the other file rather than retyped. The
licensing rows the isolation cites are read from the register. And the contract: MD-1 §4.17 quotes every note these
adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import json
import os
import re
import threading
import time
from pathlib import Path

import pytest

from api.routers import calendar as calendar_route
from api.routers import corporate_actions as corporate_actions_route
from api.services import corporate_actions_held as cah
from api.services import dividends_calendar as dc
from api.services import dividends_calendar_held
from api.services import earnings_estimates as ee
from api.services import finnhub_client, fmp_client, ipo_calendar_held, massive, massive_adapter
from api.services import ipo_calendar as ipo
from api.services import reference_corp_actions as rca
from api.services.cache import cache
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import corporate_actions_read as car
from api.services.uct_agent.marketdata import dividends_calendar_read as dcr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import ipo_calendar_read as icr
from api.services.uct_agent.marketdata.short_interest import day_as_of

REPO = Path(__file__).resolve().parents[1]
MODULES = (car, icr, dcr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all three. They are the builder's defaults; a kind leaving this set is an
#: owner decision that has not been made.
ISOLATED = set(KINDS)
GOOD = {car.KIND: {"symbol": "AAA"}, icr.KIND: {}, dcr.KIND: {"symbols": ["AAA"]}}
ACTIONS = {"stock.splitsDividends", "stock.ipoCalendar", "stock.dividendsCalendar"}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
UTC = dt.timezone.utc
TODAY = dt.date(2026, 11, 19)                          # a Thursday: the IPO window is Mon Nov 9 to Fri Nov 27
WINDOW = ("2026-11-09", "2026-11-27")
#: every module that holds a provider client under its own name
PROVIDER_DOORS = (massive,)
#: what a turn must never reach, per service: every builder, background refresh, vendor read, route reader and writer
FORBIDDEN = {
    ee: ("get_chart_markers", "_build_chart_markers", "_schedule_markers_refresh", "_markers_disk_write"),
    rca: ("fetch_ticker_splits", "fetch_ticker_dividends", "_ticker_read"),
    ipo: ("get_ipos_with_status", "get_ipos", "_fh_ipo_get", "_fmp_ipo_get", "_build", "fh_get"),
    finnhub_client: ("fh_get",),
    fmp_client: ("get_ipo_calendar",),
    dc: ("get_events_with_status", "get_events", "_get_forward_dividend", "_get_forward_splits"),
    calendar_route._cp: ("get_user_ticker_sets",),
}
READS = [(car.KIND, {"symbol": "AAA"}), (car.KIND, {"symbol": "AAA", "rows": 1}), (icr.KIND, {}), (icr.KIND, {"rows": 1}),
         (dcr.KIND, {"symbols": ["AAA"]}), (dcr.KIND, {"symbols": ["AAA", "BBB"]})]


# ── the chart markers record (stock.corporateActions) ─────────────────────────────────────────────────────────
SPLITS = [{"date": "2011-03-02", "ratio": "1:4", "from_factor": 1, "to_factor": 0.25, "source": "massive"},
          {"date": "2019-05-14", "ratio": "3:2", "from_factor": 1, "to_factor": 1.5, "source": "massive"}]
DIVIDENDS = [{"date": "2025-11-14", "amount": 0.1125, "source": "massive"}, {"date": "2026-02-13", "amount": 0.1125, "source": "massive"},
             {"date": "2026-05-15", "amount": 0.1375, "source": "massive"}, {"date": "2026-08-14", "amount": 0.1375, "source": "massive"}]


def _hold_record(splits=None, dividends=None, sym="AAA", age_s=None):
    """The chart markers record as the chart's build stores it, by the service's own writer."""
    ee._markers_disk_write(sym, {"earnings": [], "splits": SPLITS if splits is None else splits,
                                 "dividends": DIVIDENDS if dividends is None else dividends})
    if age_s is not None:                               # an older record: the same file, saved earlier
        path = ee._markers_disk_path(sym)
        blob = json.loads(Path(path).read_text())
        blob["saved_at"] = time.time() - age_s if age_s >= 0 else 0
        Path(path).write_text(json.dumps(blob))
    return cah.held_actions(sym)


# ── the IPO calendar (calendar.ipos) ──────────────────────────────────────────────────────────────────────────
FH_ROWS = [
    {"date": "2026-11-20", "exchange": "NASDAQ", "name": "Example Robotics Inc", "numberOfShares": 12500000,
     "price": "$18.00-$20.00", "status": "expected", "symbol": "EXRB", "totalSharesValue": 250000000},
    {"date": "2026-11-12", "exchange": "NYSE", "name": "Sample Foods Corp", "numberOfShares": 8000000, "price": "$21.00",
     "status": "priced", "symbol": "SMPF", "totalSharesValue": 168000000},
]
FMP_ROWS = [
    {"symbol": "EXRB", "company": "Example Robotics Inc", "date": "2026-11-20", "exchange": "NASDAQ", "actions": "Expected",
     "shares": None, "priceRange": None, "marketCap": None},
    {"symbol": "ZZQX", "company": "Placeholder Bio Ltd", "date": "2026-11-24", "exchange": "NASDAQ", "actions": "Expected",
     "shares": None, "priceRange": None, "marketCap": None},
    {"symbol": "", "company": "Nameonly Holdings", "date": "2026-11-10", "exchange": "NYSE", "actions": "Priced",
     "shares": 4000000, "priceRange": "$10.00", "marketCap": 900000000},
]


def _hold_ipos(mp, fh=FH_ROWS, fmp=FMP_ROWS, window=WINDOW):
    """The IPO calendar for a range as the route's service stores it, over invented vendor rows."""
    mp.setattr(ipo, "_fh_ipo_get", lambda f, t: fh)
    mp.setattr(ipo, "_fmp_ipo_get", lambda f, t: fmp)
    mp.setattr(ipo, "resolve_entity", lambda sym: ({"status": "resolved", "entityId": f"e-{sym}"}, sym))
    return ipo.get_ipos_with_status(*window)


# ── the dividend calendar (calendar.dividends) ────────────────────────────────────────────────────────────────
VENDOR = {
    "AAA": {"dividends": [{"ex_dividend_date": "2026-12-04", "cash_amount": 0.26}, {"ex_dividend_date": "2027-03-05", "cash_amount": 0.26}],
            "splits": [{"execution_date": "2027-01-15", "split_from": 1, "split_to": 4}]},
    "BBB": {"dividends": [{"ex_dividend_date": "2026-11-27", "cash_amount": None}], "splits": []},
    "CCC": {"dividends": [], "splits": []},
}


class _Today(dt.date):
    @classmethod
    def today(cls):
        return TODAY


def _hold_dividends(mp, sym, vendor=None, fail=None):
    """One stock's forward calendar as the route's service stores it (`?syms=<sym>`), over invented vendor rows. `fail`
    names a leg ('dividends' or 'splits') whose vendor read fails."""
    v = (vendor or VENDOR)[sym]

    def read(path, date_field, ticker, gte, lte):
        leg = "splits" if "splits" in path else "dividends"
        if leg == fail:
            raise rca.CorpActionsUnavailable("an invented vendor failure")
        return [{**r, "ticker": ticker} for r in v[leg]]
    mp.setattr(rca, "_ticker_read", read)
    mp.setattr(dc, "date", _Today)
    mp.setattr(dc, "resolve_entity", lambda s: ({"status": "resolved", "entityId": f"e-{s}"}, s))
    return dc.get_events_with_status([sym])


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    for prefix in ("ipo_calendar_", "dividends_calendar_", "chart_markers_"):
        cache.delete_prefix(prefix)


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ee, "_MARKERS_DISK_DIR", str(tmp_path / "chart_markers"))
    monkeypatch.setattr(icr, "today_et", lambda: TODAY)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    _forget()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every provider client asked for, every request to the vendor adapter,
    and every thread started (by name). `work["threads"]` is cleared after a held answer is put in place by a service
    that uses threads of its own (the dividend calendar's pool)."""
    seen = {"provider": 0, "threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)

    def client(*a, **kw):
        seen["provider"] += 1
        raise AssertionError("a provider client was asked for inside a turn")
    monkeypatch.setattr(threading.Thread, "start", start)
    for door in PROVIDER_DOORS:
        monkeypatch.setattr(door, "_get_client", client)
    for name in ("get", "get_pages"):
        monkeypatch.setattr(massive_adapter, name, client)
    return seen


def _quiet(work) -> bool:
    return work == {"provider": 0, "threads": []}


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w8-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == ("historical" if kind == car.KIND else "periodic")
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        else:
            assert not out["as_of"].startswith(TODAY.isoformat())       # the data's own date, never the read day
            assert not out["as_of"].startswith(dt.datetime.now(UTC).date().isoformat())
        assert out["as_of"] != out["fetched_at"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    """A read's data without the gateway's isolation stamps."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _made_from(template):
    """A pattern for the notes a template makes: its fixed text, with anything where a placeholder stands."""
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{\w+\}", template)), re.S)


def _note(out, template):
    """The one note of `out` made from `template`."""
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


def _lacks(out, template):
    return not [n for n in out["notes"] if _made_from(template).fullmatch(n)]


def _zeros(v, path=""):
    """Every place in `v` holding a number equal to 0 (not a bool)."""
    if isinstance(v, dict):
        return [p for k, x in v.items() for p in _zeros(x, f"{path}.{k}")]
    if isinstance(v, list):
        return [p for i, x in enumerate(v) for p in _zeros(x, f"{path}[{i}]")]
    return [path] if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0 else []


def _keys(v):
    """Every dict key anywhere in `v`."""
    if isinstance(v, dict):
        return set(v) | {k for x in v.values() for k in _keys(x)}
    return {k for x in v for k in _keys(x)} if isinstance(v, list) else set()


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


def _utc(ts: float) -> str:
    return env.utc_iso(dt.datetime.fromtimestamp(ts, tz=UTC))


def _near(iso: str, ts: float, slack: float = 3.0) -> bool:
    return abs(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() - ts) <= slack


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────
def test_all_three_kinds_are_registered_once_by_their_modules_and_all_three_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "never a vendor request" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert [r.get(k).max_symbols for k in KINDS] == [1, 0, dcr.MAX_SYMBOLS] and dcr.MAX_SYMBOLS == 10
    assert KINDS == ("stock.corporateActions", "calendar.ipos", "calendar.dividends")
    assert [m.SOURCE for m in MODULES] == ["uct-chart-markers", "uct-ipo-calendar", "uct-dividend-calendar"]
    assert [fn.__name__ for fn in (r.get(k).fn for k in KINDS)] == ["read_corporate_actions", "read_ipos", "read_dividends"]
    # the three capabilities that read them are local-only on the server, by name
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)
    # no kind for the markets board: its figures are live quotes the production `quotes` kind and wave 6's
    # `rates.treasury` already read, and the snapshot behind it is a live vendor read
    assert not [n for n in r.names() if n.startswith("markets.")]
    assert {"quotes", "rates.treasury"} <= set(r.names())


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    monkeypatch.setattr(car, "held_answer", lambda sym: ran.append("car") or {"status": "not_held"})
    monkeypatch.setattr(icr, "held_answer", lambda a, b: ran.append("icr") or (None, None, "not_held"))
    monkeypatch.setattr(dcr, "held_answer", lambda sym: ran.append("dcr") or (None, None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,dilution.watch,rates.treasury")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_record()
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, car.KIND)                 # arming ONE arms one
    assert _read(car.KIND)["status"] == "ok"
    for kind in KINDS[1:]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(car.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(icr.KIND)["status"] == "unavailable"                   # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all three off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_words_bounds_and_fields_are_the_services_and_the_panels_own():
    # corporate actions: the CACT panel's own row count, the service's own cap, windows and basis
    model = (PANELS / "corporateActionsModel.js").read_text(encoding="utf-8")
    assert int(re.search(r"export const CACT_ROWS_SHOWN = (\d+)", model).group(1)) == car.DEFAULT_ROWS
    assert car.MAX_ROWS == cah.ROW_CAP
    assert car.BASIS == "split_adjusted" and 'basis="split_adjusted"' in inspect.getsource(cah.held_actions)
    assert (cah.SPLIT_WINDOW_YEARS, cah.DIVIDEND_WINDOW_YEARS) == (45, 5)
    assert car.refresh_seconds() == ee._MARKERS_REFRESH_SECONDS
    # the IPO calendar: the panel's own window, the service's own lifetime
    ipo_model = (PANELS / "ipoCalendarModel.js").read_text(encoding="utf-8")
    assert f"from: addDays(monday, -{icr.WINDOW_BACK_DAYS})" in ipo_model
    assert f"to: addDays(monday, {icr.WINDOW_FORWARD_DAYS})" in ipo_model
    assert icr.window(TODAY) == WINDOW and icr.window(dt.date(2026, 11, 22)) == WINDOW     # Sunday: the same week
    assert icr.window(dt.date(2026, 11, 23)) == ("2026-11-16", "2026-12-04")                # the next Monday moves it
    assert icr.hold_hours() == ipo._CACHE_TTL // 3600 == 6
    assert ipo_calendar_held.rows_key(*WINDOW) == "ipo_calendar_2026-11-09_2026-11-27"
    # the dividend calendar: the service's own event types and lifetime; the route's own symbol cap is far above ours
    assert set(dcr.EVENT_TYPES) == {"dividend", "split"}
    for t in dcr.EVENT_TYPES:
        assert f'"type":   "{t}"' in inspect.getsource(dc), t
    assert dcr.hold_hours() == dc._CACHE_TTL // 3600 == 12
    assert dcr.MAX_SYMBOLS < 200 and "[:200]" in inspect.getsource(dc._clean)
    dvd = (PANELS / "dividendCalendarModel.js").read_text(encoding="utf-8")
    assert "export const DVD_SYMBOL_CAP = 200" in dvd
    # each reader this wave reads through says, in its own words, that it never fetches
    for fn in (car.held_answer, icr.held_answer, dcr.held_answer, ipo_calendar_held.held_ipos,
               dividends_calendar_held.held_events):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__
    # the route's own spelling of a ticker
    assert car._clean("brk.b") == dcr._clean("$brk.b") == "BRK-B"
    assert inspect.getsource(corporate_actions_route.get_corporate_actions).count("require_route_symbol") == 1


# ── stock.corporateActions ────────────────────────────────────────────────────────────────────────────────────
def test_corporate_actions_reads_the_held_record_with_every_row_the_services_own(world, work):
    held = _hold_record()
    out = _read(car.KIND, {"symbol": "aaa", "rows": car.MAX_ROWS})
    _conforms(out, car.KIND)
    assert out["status"] == "ok" and out["source"] == car.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert d["symbol"] == "AAA" and d["state"] == "ok"
    assert [(r["date"], r["ratio"]) for r in d["splits"]["rows"]] == [(r["date"], r["ratio"]) for r in held["splits"]["rows"]]
    assert [r["date"] for r in d["splits"]["rows"]] == ["2019-05-14", "2011-03-02"]            # newest first
    assert [r["to_factor"] for r in d["splits"]["rows"]] == [1.5, 0.25]
    assert d["dividends"]["rows"] == [{"date": r["date"], "amount": r["amount"]} for r in held["dividends"]["rows"]]
    assert [r["date"] for r in d["dividends"]["rows"]] == ["2026-08-14", "2026-05-15", "2026-02-13", "2025-11-14"]
    assert d["splits"]["window_years"] == cah.SPLIT_WINDOW_YEARS and d["dividends"]["window_years"] == cah.DIVIDEND_WINDOW_YEARS
    assert d["dividends"]["basis"] == "split_adjusted"
    assert (d["splits"]["count"], d["splits"]["total"], d["splits"]["cut"]) == (2, 2, False)
    assert (d["dividends"]["count"], d["dividends"]["total"], d["dividends"]["cut"]) == (4, 4, False)
    # each block carries its own newest date; as_of is the newest event of either, never the time of the read
    assert (d["splits"]["as_of"], d["dividends"]["as_of"], d["as_of"]) == ("2019-05-14", "2026-08-14", "2026-08-14")
    assert out["as_of"] == day_as_of("2026-08-14")
    assert d["read_at"] == env.utc_iso(dt.datetime.fromisoformat(held["held_at"])) and _near(d["read_at"], time.time())
    assert d["left_out"] == ["names"] and "source" not in _keys(d)
    assert out["notes"] == [car.NOTE_WHAT.format(symbol="AAA", split_years=45, dividend_years=5),
                            car.NOTE_AS_OF.format(day="2026-08-14", at=d["read_at"]), car.NOTE_LEFT_OUT]
    assert "split-adjusted" in car.NOTE_WHAT and "not the amounts as declared" in car.NOTE_WHAT
    assert out["coverage"] == {"evaluated": 6, "answered": 6, "dropped": 0, "not_computable": 0}
    assert _quiet(work)


def test_corporate_actions_a_long_block_is_cut_from_the_old_end_and_says_so(world):
    _hold_record()
    out = _read(car.KIND, {"symbol": "AAA", "rows": 1})
    _conforms(out, car.KIND)
    d = _plain(out["data"])
    assert [r["date"] for r in d["splits"]["rows"]] == ["2019-05-14"] and [r["date"] for r in d["dividends"]["rows"]] == ["2026-08-14"]
    assert (d["splits"]["total"], d["splits"]["cut"], d["dividends"]["total"], d["dividends"]["cut"]) == (2, True, 4, True)
    assert _note(out, car.NOTE_CUT.replace("{what}", "splits")) == car.NOTE_CUT.format(total=2, what="splits", shown=1)
    assert _note(out, car.NOTE_CUT.replace("{what}", "cash dividends")) == car.NOTE_CUT.format(total=4, what="cash dividends", shown=1)
    assert "cut from the OLD end" in car.NOTE_CUT
    assert d["as_of"] == "2026-08-14"                                    # the whole record's newest event, whatever the cut
    # the service's own cut (its ROW_CAP) is said the same way: 70 held, 60 carried
    many = [{"date": (dt.date(2020, 1, 1) + dt.timedelta(days=7 * i)).isoformat(), "amount": 0.05} for i in range(70)]
    _hold_record(dividends=many)
    d = _plain(_read(car.KIND, {"symbol": "AAA", "rows": car.MAX_ROWS})["data"])
    assert (d["dividends"]["count"], d["dividends"]["total"], d["dividends"]["cut"]) == (cah.ROW_CAP, 70, True)
    assert _read(car.KIND)["data"]["dividends"]["count"] == car.DEFAULT_ROWS


def test_corporate_actions_an_empty_block_is_what_the_record_lists_never_proof_of_none(world):
    _hold_record(dividends=[])                                           # the chart's build withholds these when its split read fails
    out = _read(car.KIND)
    _conforms(out, car.KIND)
    d = _plain(out["data"])
    assert d["dividends"]["rows"] == [] and d["dividends"]["as_of"] is None and d["dividends"]["total"] == 0
    assert d["as_of"] == "2019-05-14"
    note = _note(out, car.NOTE_EMPTY_BLOCK)
    assert note == car.NOTE_EMPTY_BLOCK.format(symbol="AAA", what="cash dividend", years=5)
    assert "not proof that none happened" in note
    # neither block: a healthy answer with no row, as_of null and said
    _hold_record(splits=[], dividends=[])
    out = _read(car.KIND)
    _conforms(out, car.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and out["data"]["as_of"] is None
    assert _note(out, car.NOTE_NO_EVENT) == car.NOTE_NO_EVENT.format(symbol="AAA", at=out["data"]["read_at"])
    assert _lacks(out, car.NOTE_EMPTY_BLOCK) and _lacks(out, car.NOTE_AS_OF)


def test_corporate_actions_a_ratio_the_record_cannot_state_is_null_never_zero(world):
    _hold_record(splits=[{"date": "2019-05-14", "ratio": "", "to_factor": None}, {"date": "2011-03-02", "ratio": "1:4", "to_factor": 0}])
    out = _read(car.KIND)
    _conforms(out, car.KIND)
    rows = _plain(out["data"])["splits"]["rows"]
    assert rows == [{"date": "2019-05-14", "ratio": None, "to_factor": None}, {"date": "2011-03-02", "ratio": "1:4", "to_factor": None}]
    assert _zeros(rows) == []
    assert _note(out, car.NOTE_NO_RATIO) == car.NOTE_NO_RATIO.format(n=1) and out["coverage"]["not_computable"] == 1


def test_corporate_actions_an_old_record_and_one_with_no_read_time_are_stale_and_never_refreshed(world, work):
    _hold_record(age_s=3 * 86400)
    work["threads"].clear()
    out = _read(car.KIND)
    _conforms(out, car.KIND)
    assert out["status"] == "ok" and out["stale"] is True
    assert _note(out, car.NOTE_STALE) == car.NOTE_STALE.format(at=out["data"]["read_at"], hours=24)
    _hold_record(age_s=3600)                                             # an hour old: fresh
    assert _read(car.KIND)["stale"] is False
    _hold_record(age_s=-1)                                               # saved_at 0: no read time
    out = _read(car.KIND)
    _conforms(out, car.KIND)
    assert out["stale"] is True and out["data"]["read_at"] is None
    assert _note(out, car.NOTE_NO_READ_TIME) == car.NOTE_NO_READ_TIME and _lacks(out, car.NOTE_STALE)
    assert "a time it did not record" in _note(out, car.NOTE_AS_OF)
    assert _quiet(work)


def test_corporate_actions_nothing_held_is_unavailable_and_nothing_is_built(world, work):
    _unavailable(_read(car.KIND), car.KIND, car.NOTE_NOT_HELD.format(symbol="AAA"))
    assert "not the same as no splits or dividends" in car.NOTE_NOT_HELD
    assert not os.path.exists(ee._markers_disk_path("AAA")) and cache.get("chart_markers_AAA") is None
    assert _quiet(work)


def test_corporate_actions_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(car, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": "<x>"}, {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": car.MAX_ROWS + 1},
                {"symbol": "AAA", "rows": 2.5}, {"symbol": "AAA", "rows": True}):
        out = _read(car.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(car.KIND), car.KIND, car.NOTE_FAILED)
    for junk in (None, "x", {"status": "ok", "splits": None, "dividends": {"rows": []}}, {"status": "weird", "splits": {"rows": []},
                                                                                         "dividends": {"rows": []}}):
        monkeypatch.setattr(car, "held_answer", lambda sym, _j=junk: _j)
        _unavailable(_read(car.KIND), car.KIND, car.NOTE_FAILED)


# ── calendar.ipos ─────────────────────────────────────────────────────────────────────────────────────────────
def test_ipos_reads_the_held_calendar_with_every_field_the_routes_own(world, work, monkeypatch):
    rows, answered = _hold_ipos(monkeypatch)
    stored = time.time()
    assert answered and len(rows) == 4
    work["threads"].clear()
    out = _read(icr.KIND)
    _conforms(out, icr.KIND)
    assert out["status"] == "ok" and out["source"] == icr.SOURCE and out["stale"] is False and out["as_of"] is None
    d = _plain(out["data"])
    assert d["window"] == {"from": WINDOW[0], "to": WINDOW[1]} and d["split_day"] == TODAY.isoformat()
    # today and ahead soonest first; before today newest first (the panel's two lists)
    assert [r["symbol"] or r["name"] for r in d["ahead"]["rows"]] == ["EXRB", "ZZQX"]
    assert [r["symbol"] or r["name"] for r in d["earlier"]["rows"]] == ["SMPF", "Nameonly Holdings"]
    exrb = d["ahead"]["rows"][0]
    served = next(r for r in rows if r["sym"] == "EXRB")
    assert exrb == {"symbol": "EXRB", "name": served["name"], "date": served["date"], "exchange": served["exchange"],
                    "price_range": served["price_range"], "shares": served["shares"], "value": served["value"], "status": "expected"}
    assert (exrb["shares"], exrb["value"], exrb["price_range"]) == (12500000, 250000000.0, "$18.00-$20.00")   # Finnhub's detail wins the merge
    assert d["earlier"]["rows"][1] == {"symbol": None, "name": "Nameonly Holdings", "date": "2026-11-10", "exchange": "NYSE",
                                       "price_range": "$10.00", "shares": 4000000, "value": 900000000.0, "status": "priced"}
    assert set(d["ahead"]["rows"][0]) == set(icr.FIELDS) and "entity" not in _keys(d)
    assert (d["total"], d["dropped"], d["ahead"]["total"], d["earlier"]["total"]) == (4, 0, 2, 2)
    # the calendars carry no as-of; when UCT read them rides beside the null
    assert d["as_of"] is None and _near(d["read_at"], stored)
    assert out["notes"] == [icr.NOTE_WHAT.format(start=WINDOW[0], end=WINDOW[1]), icr.NOTE_AS_OF.format(at=d["read_at"], hours=6),
                            icr.NOTE_VALUE, icr.NOTE_MISSING.format(n=1)]
    assert "the merged row does not say which" in icr.NOTE_VALUE
    assert out["coverage"] == {"evaluated": 4, "answered": 4, "dropped": 0, "not_computable": 1}
    assert _quiet(work)


def test_ipos_a_field_the_calendars_leave_empty_is_null_never_zero(world, monkeypatch):
    _hold_ipos(monkeypatch, fh=[], fmp=[{"symbol": "ZZQX", "company": "Placeholder Bio Ltd", "date": "2026-11-24", "exchange": None,
                                         "actions": "Expected", "shares": 0, "priceRange": "-", "marketCap": None}])
    out = _read(icr.KIND)
    _conforms(out, icr.KIND)
    row = _plain(out["data"])["ahead"]["rows"][0]
    assert (row["shares"], row["value"], row["price_range"], row["exchange"]) == (None, None, None, None)
    assert _zeros(_plain(out["data"])["ahead"]["rows"]) == []
    assert _note(out, icr.NOTE_MISSING) == icr.NOTE_MISSING.format(n=1)


def test_ipos_long_lists_are_cut_from_their_far_ends_and_say_so(world, monkeypatch):
    _hold_ipos(monkeypatch)
    out = _read(icr.KIND, {"rows": 1})
    _conforms(out, icr.KIND)
    d = _plain(out["data"])
    assert [r["symbol"] for r in d["ahead"]["rows"]] == ["EXRB"] and [r["symbol"] for r in d["earlier"]["rows"]] == ["SMPF"]
    assert (d["ahead"]["cut"], d["earlier"]["cut"], d["ahead"]["total"], d["earlier"]["total"]) == (True, True, 2, 2)
    assert _note(out, icr.NOTE_CUT_AHEAD) == icr.NOTE_CUT_AHEAD.format(total=2, shown=1) and "cut from the FAR end" in icr.NOTE_CUT_AHEAD
    assert _note(out, icr.NOTE_CUT_EARLIER) == icr.NOTE_CUT_EARLIER.format(total=2, shown=1) and "cut from the OLD end" in icr.NOTE_CUT_EARLIER
    assert out["coverage"]["dropped"] == 2


def test_ipos_an_answered_empty_calendar_is_healthy_and_two_failed_vendors_are_unavailable(world, work, monkeypatch):
    rows, answered = _hold_ipos(monkeypatch, fh=[], fmp=None)            # one vendor answered with nothing, one failed
    assert (rows, answered) == ([], True)
    out = _read(icr.KIND)
    _conforms(out, icr.KIND)
    assert out["status"] == "ok" and _plain(out["data"])["total"] == 0
    assert _note(out, icr.NOTE_NONE) == icr.NOTE_NONE.format(start=WINDOW[0], end=WINDOW[1]) and _lacks(out, icr.NOTE_VALUE)
    _forget()
    rows, answered = _hold_ipos(monkeypatch, fh=None, fmp=None)          # both failed: the service records it
    assert (rows, answered) == ([], False) and ipo.read_failed(*WINDOW)
    held, stored_at, how = ipo_calendar_held.held_ipos(*WINDOW)
    assert (held, how) == (None, "failed")
    _unavailable(_read(icr.KIND), icr.KIND, icr.NOTE_SOURCE_FAILED.format(start=WINDOW[0], end=WINDOW[1], at=_utc(stored_at)))
    assert "not the same as no IPOs" in icr.NOTE_SOURCE_FAILED
    assert _quiet(work)


def test_ipos_nothing_held_for_the_panels_window_is_unavailable_never_no_ipos(world, work, monkeypatch):
    _unavailable(_read(icr.KIND), icr.KIND, icr.NOTE_NOT_HELD.format(start=WINDOW[0], end=WINDOW[1]))
    # a calendar held for ANOTHER range (the Calendar page's week) is not this window's
    _hold_ipos(monkeypatch, window=("2026-11-16", "2026-11-20"))
    work["threads"].clear()
    _unavailable(_read(icr.KIND), icr.KIND, icr.NOTE_NOT_HELD.format(start=WINDOW[0], end=WINDOW[1]))
    assert "not the same as no IPOs" in icr.NOTE_NOT_HELD
    assert cache.get(ipo_calendar_held.rows_key(*WINDOW)) is None and cache.get(ipo_calendar_held.failed_key(*WINDOW)) is None
    assert _quiet(work)


def test_ipos_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(icr, "held_answer", lambda a, b: ran.append(a) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({"rows": 0}, {"rows": icr.MAX_ROWS + 1}, {"rows": "5"}, {"rows": 1.5}):
        out = _read(icr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(icr.KIND), icr.KIND, icr.NOTE_FAILED)
    for junk in ((None, time.time(), "held"), ("x", time.time(), "held"), ([], None, "held"), ([], time.time(), "weird")):
        monkeypatch.setattr(icr, "held_answer", lambda a, b, _j=junk: _j)
        _unavailable(_read(icr.KIND), icr.KIND, icr.NOTE_FAILED)


# ── calendar.dividends ────────────────────────────────────────────────────────────────────────────────────────
def test_dividends_reads_one_stocks_held_calendar_with_every_event_the_routes_own(world, work, monkeypatch):
    rows, complete = _hold_dividends(monkeypatch, "AAA")
    stored = time.time()
    assert complete and len(rows) == 2                                   # ONE dividend (the next ex-date) and the split ahead
    work["threads"].clear()
    out = _read(dcr.KIND, {"symbols": ["aaa"]})
    _conforms(out, dcr.KIND)
    assert out["status"] == "ok" and out["source"] == dcr.SOURCE and out["stale"] is False and out["as_of"] is None
    d = _plain(out["data"])
    assert d["rows"] == [{"symbol": "AAA", "type": "dividend", "date": "2026-12-04", "amount": 0.26, "ratio": None},
                         {"symbol": "AAA", "type": "split", "date": "2027-01-15", "amount": None, "ratio": "4:1"}]
    assert [(r["type"], r["date"]) for r in d["rows"]] == [(r["type"], r["date"]) for r in rows]            # the route's own, soonest first
    assert d["symbols"] == ["AAA"] and d["stocks"] == [{"symbol": "AAA", "state": "complete", "read_at": d["read_at"], "events": 2}]
    assert (d["count"], d["total"], d["cut"]) == (2, 2, False)
    assert d["as_of"] is None and _near(d["read_at"], stored) and "entity" not in _keys(d)
    assert out["notes"] == [dcr.NOTE_WHAT.format(symbols="AAA"), dcr.NOTE_AS_OF.format(at=d["read_at"], hours=12), dcr.NOTE_NAMED_ONLY]
    assert "as declared" in dcr.NOTE_WHAT and "never reads the member's own" in dcr.NOTE_NAMED_ONLY
    assert out["coverage"] == {"evaluated": 1, "answered": 1, "dropped": 0, "not_computable": 0}
    assert _quiet(work)


def test_dividends_a_stock_not_held_is_named_and_left_out_and_none_held_is_unavailable(world, work, monkeypatch):
    _unavailable(_read(dcr.KIND, {"symbols": ["AAA", "BBB"]}), dcr.KIND, dcr.NOTE_NOT_HELD.format(list="AAA, BBB"))
    assert "not the same as no dividend or split" in dcr.NOTE_NOT_HELD
    _hold_dividends(monkeypatch, "AAA")
    _hold_dividends(monkeypatch, "CCC")
    work["threads"].clear()
    out = _read(dcr.KIND, {"symbols": ["BBB", "AAA", "CCC", "aaa"]})
    _conforms(out, dcr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "partial" and d["symbols"] == ["BBB", "AAA", "CCC"]               # each named once, in order
    assert [(s["symbol"], s["state"], s["events"]) for s in d["stocks"]] == [("BBB", "not_held", None), ("AAA", "complete", 2), ("CCC", "complete", 0)]
    assert d["stocks"][0]["read_at"] is None
    assert _note(out, dcr.NOTE_SOME_NOT_HELD) == dcr.NOTE_SOME_NOT_HELD.format(list="BBB")
    assert _note(out, dcr.NOTE_NONE) == dcr.NOTE_NONE.format(list="CCC")                      # held whole, nothing ahead: healthy
    assert {r["symbol"] for r in d["rows"]} == {"AAA"}
    assert out["coverage"] == {"evaluated": 3, "answered": 2, "dropped": 0, "not_computable": 1}
    assert _quiet(work)


def test_dividends_an_incomplete_read_keeps_what_is_held_and_is_never_none(world, work, monkeypatch):
    rows, complete = _hold_dividends(monkeypatch, "AAA", fail="splits")  # the split read failed: the dividend is held
    assert not complete and dc.read_partial(["AAA"])
    held, stored_at, how = dividends_calendar_held.held_events("AAA")
    assert how == "incomplete" and held == rows
    work["threads"].clear()
    out = _read(dcr.KIND)
    _conforms(out, dcr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "partial" and [r["type"] for r in d["rows"]] == ["dividend"]
    assert d["stocks"][0]["state"] == "incomplete" and d["read_at"] == _utc(stored_at)
    assert _note(out, dcr.NOTE_INCOMPLETE) == dcr.NOTE_INCOMPLETE.format(list="AAA") and _lacks(out, dcr.NOTE_NONE)
    _forget()
    _hold_dividends(monkeypatch, "CCC", fail="dividends")               # incomplete AND nothing held: still never "none"
    work["threads"].clear()
    out = _read(dcr.KIND, {"symbols": ["CCC"]})
    assert out["status"] == "partial" and _plain(out["data"])["rows"] == [] and _lacks(out, dcr.NOTE_NONE)
    assert _quiet(work)


def test_dividends_an_amount_not_declared_is_null_never_zero_and_another_stocks_row_is_not_carried(world, monkeypatch):
    _hold_dividends(monkeypatch, "BBB")
    out = _read(dcr.KIND, {"symbols": ["BBB"]})
    _conforms(out, dcr.KIND)
    d = _plain(out["data"])
    assert d["rows"] == [{"symbol": "BBB", "type": "dividend", "date": "2026-11-27", "amount": None, "ratio": None}]
    assert _zeros(d["rows"]) == [] and _note(out, dcr.NOTE_NO_AMOUNT) == dcr.NOTE_NO_AMOUNT.format(n=1)
    # an entry whose rows name another stock: that row is not this stock's
    key = dc._syms_cache_key(["BBB"])
    cache.set(key, [{"sym": "ZZZ", "type": "dividend", "date": "2026-12-01", "amount": 1.0}], ttl=dc._CACHE_TTL)
    assert _plain(_read(dcr.KIND, {"symbols": ["BBB"]})["data"])["rows"] == []


def test_dividends_a_long_list_is_cut_from_the_far_end_and_says_so(world, monkeypatch):
    many = {"AAA": {"dividends": [{"ex_dividend_date": "2026-12-04", "cash_amount": 0.26}],
                    "splits": [{"execution_date": (dt.date(2027, 1, 1) + dt.timedelta(days=i)).isoformat(), "split_from": 1, "split_to": 2}
                               for i in range(50)]}}
    _hold_dividends(monkeypatch, "AAA", vendor=many)
    out = _read(dcr.KIND)
    _conforms(out, dcr.KIND)
    d = _plain(out["data"])
    assert (d["count"], d["total"], d["cut"]) == (dcr.MAX_ROWS, 51, True)
    assert d["rows"][0]["date"] == "2026-12-04" and d["rows"][-1]["date"] == (dt.date(2027, 1, 1) + dt.timedelta(days=38)).isoformat()
    assert _note(out, dcr.NOTE_CUT) == dcr.NOTE_CUT.format(total=51, shown=dcr.MAX_ROWS) and "cut from the FAR end" in dcr.NOTE_CUT


def test_dividends_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(dcr, "held_answer", lambda sym: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "AAA"}, {"symbols": []}, {"symbols": "AAA"}, {"symbols": ["AAA", "A B"]},
                {"symbols": [f"A{i}" for i in range(dcr.MAX_SYMBOLS + 1)]}, {"symbols": [None]}):
        out = _read(dcr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(dcr.KIND), dcr.KIND, dcr.NOTE_FAILED)
    for junk in (None, ("x", time.time(), "complete"), ([], None, "complete"), ([], time.time(), "weird")):
        monkeypatch.setattr(dcr, "held_answer", lambda sym, _j=junk: _j)
        _unavailable(_read(dcr.KIND), dcr.KIND, dcr.NOTE_FAILED)


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (getattr(owner, "__name__", owner), name)   # a rename fails here, by name
            label = f"{getattr(owner, '__name__', type(owner).__name__)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    # and a read never writes to the shared cache
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_reaches_a_build_a_vendor_a_thread_or_a_cache_write_held_or_not(world, work, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the chart's
    markers reader with its build, its background refresh and its writer; the vendor's reference reads; the IPO
    calendar's route reader, its merge-and-store and both vendor readers; the dividend calendar's route reader and its
    per-stock vendor reads; the route's read of the member's own stocks; and the shared cache's writer."""
    reached = []
    expected_cold = {car.KIND: "unavailable", icr.KIND: "unavailable", dcr.KIND: "unavailable"}
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == expected_cold[kind], (kind, params, out["notes"])
        assert reached == [] and _quiet(work)
    _hold_record(age_s=3 * 86400)                                        # old enough that the chart would refresh it
    _hold_ipos(monkeypatch)
    _hold_dividends(monkeypatch, "AAA")
    _hold_dividends(monkeypatch, "BBB")
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                            # everything held
        _forbid(mp, reached)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, params, out["notes"])
        assert reached == [] and _quiet(work)


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses starts the work."""
    hits = []
    # the chart's markers reader: nothing held is BUILT (the CACT route only reads what this leaves behind)
    monkeypatch.setattr(ee, "_build_chart_markers", lambda t: hits.append(f"build {t}") or {"earnings": [], "splits": SPLITS, "dividends": []})
    assert _read(car.KIND)["status"] == "unavailable" and hits == []
    ee.get_chart_markers("AAA")
    assert hits == ["build AAA"]
    assert _read(car.KIND)["status"] == "ok"                             # and the record it stored is what the kind reads
    # the IPO calendar: nothing held asks both vendors
    monkeypatch.setattr(ipo, "_fh_ipo_get", lambda f, t: hits.append("finnhub") or [])
    monkeypatch.setattr(ipo, "_fmp_ipo_get", lambda f, t: hits.append("fmp") or [])
    assert _read(icr.KIND)["status"] == "unavailable" and hits[1:] == []
    ipo.get_ipos_with_status(*WINDOW)
    assert hits[1:] == ["finnhub", "fmp"]
    # the dividend calendar: nothing held asks the vendor for each stock
    monkeypatch.setattr(rca, "_ticker_read", lambda path, f, t, g, l: hits.append(path) or [])
    monkeypatch.setattr(dc, "resolve_entity", lambda s: ({"status": "resolved", "entityId": None}, s))
    assert _read(dcr.KIND)["status"] == "unavailable" and hits[3:] == []
    dc.get_events_with_status(["AAA"])
    assert sorted(hits[3:]) == ["/v3/reference/dividends", "/v3/reference/splits"]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    t07 = row("T-07")
    assert t07.startswith("| T-07 | Member display + external — reference data (splits, dividends, tickers, conditions) | Massive · reference |")
    assert "| **R** |" in t07 and "Ind **R** · Bus **LA (incl. external)**" in t07
    t14 = row("T-14")
    assert t14.startswith("| T-14 | AI processing — Massive numbers into Claude")
    assert "| **R** |" in t14 and "Ind **R** · Bus **LA**" in t14
    t52 = row("T-52")
    assert t52.startswith("| T-52 | Member display — earnings-calendar past-day backfill; company profile / metrics / logo; "
                          "insider transactions; IPO calendar | Finnhub · calendars + reference | member |")
    t54 = row("T-54")
    assert t54.startswith("| T-54 | AI processing — Finnhub fields in Compass / AI Search tool packs | Finnhub | member |")
    assert "| **R** |" in t54 and "| ANSWERED — see T-51 | LA |" in t54
    t44 = row("T-44")
    assert t44.startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)")
    assert "| **U** |" in t44 and "No AI clause" in t44
    # the 2026-09-19 note's restatement: member display only, AI use its own row
    assert "each scoped to member display (AI use, external publication and attribution stay their own rows)" in register
    assert "**LA** Likely Allowed (verify contract)" in register
    # no row names FMP's IPO calendar, and the code's licensing table says the same
    fmp_rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln) and "| FMP" in ln]
    assert fmp_rows and not [ln for ln in fmp_rows if "ipo" in ln.lower()]
    from api.services import provider_licensing_class as plc
    assert 'No ("fmp", "ipo") row' in inspect.getsource(plc)
    cites = {car: ("T-07", "T-14"), icr: ("T-52", "T-54", "T-44"), dcr: ("T-07", "T-14")}
    for m, rows in cites.items():                                      # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(rows), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
        assert "no other row does" in doc, m.KIND
    for m in (car, dcr):
        assert "verify the contract" in " ".join(m.__doc__.split()), m.KIND


# ── the contract (MD-1 v1.14 §4.17) ───────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_17_and_every_note_the_adapters_emit():
    """MD-1 §4.17 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = ("### 4.17 Terminal data wave 8: `stock.corporateActions`, `calendar.ipos`, `calendar.dividends` "
            "(v1.14, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in [w for pair in car.WHAT_WORDS.values() for w in pair]:
        assert words in section, words                                 # the words a note is filled with
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a vendor request.**", "`corporate_actions_held.held_actions`",
              "`ipo_calendar_held.held_ipos`", "`dividends_calendar_held.held_events`", "row T-07", "row T-14", "row T-52",
              "row T-54", "row T-44", "verify contract", "No AI clause", "for a model provider", "never the time of the read",
              "the builder's default", "`leaders.longRun`", "`quotes`", "`rates.treasury`", "MKTS", "COT", "ANLG",
              "rename-notice"):
        assert s in prose, s
    assert doc.index("### 4.16 Terminal data wave 7") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 14
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.14 addition (2026-11-21, terminal-data, data wave 8):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.17 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.13 addition (2026-11-20, terminal-data, data wave 7):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13", "v1.14"))
    # nothing in the section or the entry records or implies an owner decision about these kinds
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
