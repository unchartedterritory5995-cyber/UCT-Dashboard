"""MD-1 kinds of terminal data wave 9: `rates.auctions`, `rates.realYields`, `fed.watch` — the Agent half of the AUCT
panel, the real-yield block of RATES and the FED panel.

No network and no real store: every held answer is put where its service keeps it BY the service, over the invented
publishers its own test file already stands in for (the Treasury's Fiscal Data datasets through
`tests/test_treasury_auctions.Publisher`, the Treasury's real curve feed through `tests/test_treasury_real_yields.Site`,
the Board's and the New York Fed's pages through `tests/test_fed_watch.ANSWERS`; the economics store's serving cache by
`econ.serving.series` over an invented series body). Every number, name and date is invented. Pinned per kind: an ok
read (envelope conformance, every row the service's own, the data's own date as `as_of`, or null with each block's own
date), a missing number null and never 0, the cut stated and from which end, `unavailable` kept apart from a healthy
answer with each state said in its own note, a malformed request refused before any read, a failing service answered
`unavailable`, and THE BUDGET RULE: no read starts a build, a thread, a request or a cache write, with the member path's
own reader shown to do exactly that in the same state (so the rail can fail). For all three: registered dark,
model-isolated, dormant until armed one by one. The cross-file facts (the services' own constants, the panels' own row
counts) are read from the other file rather than retyped. The licensing rows the isolation cites are read from the
register. And the contract: MD-1 §4.18 quotes every note these adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import re
import threading
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import data_sync, fed_watch as fw, fed_watch_held, held_build
from api.services import treasury_auctions as ta
from api.services import treasury_auctions_held, treasury_real_yields_held
from api.services import treasury_real_yields as real
from api.services import treasury_yields as ty
from api.services.cache import cache
from api.services.econ import http as econ_http
from api.services.econ import serving
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import fed_watch_read as fwr
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import real_yields_read as ryr
from api.services.uct_agent.marketdata import treasury_auctions_read as tar
from api.services.uct_agent.marketdata.short_interest import day_as_of
from tests.test_fed_watch import ANSWERS as FED_ANSWERS
from tests.test_fed_watch import ROSTER, _Store
from tests.test_treasury_auctions import Publisher
from tests.test_treasury_real_yields import NOMINAL, Site

REPO = Path(__file__).resolve().parents[1]
MODULES = (tar, ryr, fwr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all three. They are the builder's defaults; a kind leaving this set is an
#: owner decision that has not been made.
ISOLATED = set(KINDS)
GOOD = {tar.KIND: {}, ryr.KIND: {}, fwr.KIND: {}}
ACTIONS = {"stock.auctionCalendar", "stock.realCurve", "stock.fomcWatch"}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
NY = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=NY)             # a Wednesday: the Treasury's newest figure is the 17th
FED_NOW = dt.datetime(2031, 3, 20, 11, 0, tzinfo=NY)          # the Fed samples' own invented year
RATE_BODIES = {
    "USEFFR": {"symbol": "USEFFR", "points": [[1, 9.11, "2031-03-17", "2031-03-17", "U"], [2, 9.12, "2031-03-18", "2031-03-18", "U"]]},
    "USFEDFUNDSU": {"symbol": "USFEDFUNDSU", "points": [[1, 9.25, "2031-03-18", "2031-03-18", "U"]]},
    "USFEDFUNDSL": {"symbol": "USFEDFUNDSL", "points": [[1, 9.0, "2031-03-18", "2031-03-18", "U"]]},
}
HEADLINES = [(i, "TX-News", (f"Fed's Quillfeather invented remark {i}" if i % 2 else f"FedEx invented parcel item {i}")
              + (" ZZZQ" if i == 27 else ""), 1_900_000_000_000 + i * 1000, f"e{i}", "push", 0) for i in range(1, 30)]
#: what a turn must never reach, per service: every builder, background job, publisher read, route reader and writer
FORBIDDEN = {
    ta: ("get_auctions", "build", "_client", "_read"),
    real: ("get_real", "build"),
    ty: ("get_yields", "fetch_period", "_http_get", "_start_job", "_build_bg"),
    held_build.HeldBuild: ("get", "_start", "_run"),
    fw: ("get_fed_watch", "build", "fetch", "_http_get", "_start_job", "_build_bg", "rates_block", "_latest_point",
         "_read_feed", "_read_statement", "_read_projections", "_read_survey_page", "_read_survey_file",
         # speed pass 3: the route's rates refresh and headline pass, and the boot warm, are never a turn's to start
         "rates_served", "headlines_served", "_start_rates", "_rates_refresh_bg", "_start_headlines", "_headlines_pass",
         "warm"),
    serving: ("series", "_read_key", "_from_artifacts", "_from_db", "_artifact"),
    data_sync: ("get_bytes",),
}
READS = [(tar.KIND, {}), (tar.KIND, {"rows": 1}), (ryr.KIND, {}), (fwr.KIND, {}), (fwr.KIND, {"rows": 1})]


# ── holding each answer, by its own service ───────────────────────────────────────────────────────────────────
def _hold_auctions(mp, pub=None):
    p = pub or Publisher()
    mp.setattr(ta, "_client", lambda: econ_http.HttpClient(transport=p, max_retries=0, sleep=lambda s: None))
    out = ta.get_auctions(wait_s=10)
    ta._held.drain(10)
    return out, p


def _hold_real(mp, site=None, nominal=None):
    s = site or Site()
    days = NOMINAL if nominal is None else nominal
    mp.setattr(ty, "_http_get", s.get)
    mp.setattr(ty, "_pause", s.pauses.append)
    mp.setattr(ty, "held_rows", lambda want=None: {d: dict(v) for d, v in days.items() if want is None or d in want})
    out = real.get_real(wait_s=10)
    real._held.drain(10)
    return out, s


def _hold_fed(mp, answers=None):
    """The Board's feeds and pages and the New York Fed's survey, read by the service's own build."""
    got = dict(FED_ANSWERS if answers is None else answers)
    asked: list[str] = []

    def fake_get(url, accept, max_bytes):
        asked.append(url)
        hit = got.get(url)
        return (404, "text/html", b"not here") if hit is None else (hit[0], "text/xml", hit[1])
    mp.setattr(fw, "_http_get", fake_get)
    mp.setattr(fw, "_pause", lambda s: None)
    fw.get_fed_watch(wait_s=10)
    _fed_idle()
    return asked


def _fed_idle(timeout: float = 10.0) -> None:
    with fw._lock:
        done = fw._state["inflight"]
    if done is not None:
        done.wait(timeout)


def _hold_headlines(mp, rows=HEADLINES):
    """The news wire's store, as the Fed headlines block reads it (an invented store in its shape)."""
    from api.services.trade_exchange_news import archive, config, pipeline
    store = _Store(rows)
    mp.setattr(config, "enabled", lambda: True)
    mp.setattr(pipeline, "get", lambda: type("Pipe", (), {"store": store})())
    mp.setattr(archive, "event_fields", lambda source, content: {"tickers": ["ZZZQ"] if "ZZZQ" in content else []})
    mp.setattr(fw, "_surnames", lambda: ROSTER)
    return store


def _hold_rates(mp, bodies=RATE_BODIES):
    """The economics store's serving cache, filled by `serving.series` itself over invented series bodies."""
    mp.setenv("ECON_ENABLED", "1")
    mp.setattr(serving, "_read_key", lambda key: None)
    mp.setattr(serving, "_from_artifacts", lambda sym, asof, start, end: bodies.get(sym))
    serving.clear_cache()                                    # what an earlier read of the store left (its miss marker) goes
    for sym in bodies:
        serving.series(sym)


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    ta.reset_for_tests()
    real.reset_for_tests()
    ty.reset_for_tests()
    fw.reset_for_tests()
    serving.clear_cache()


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    monkeypatch.setattr(fw, "now_et", lambda: FED_NOW)
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [])
    monkeypatch.setattr(serving, "_read_key", lambda key: None)        # the data bucket is never reached from a test
    from api.services.trade_exchange_news import config as txn_config
    monkeypatch.setattr(txn_config, "enabled", lambda: False)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    ta._held.drain(10)
    real._held.drain(10)
    _fed_idle()
    _forget()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every thread started (by name). `work["threads"]` is cleared after a
    held answer is put in place by a service that builds on a thread of its own."""
    seen = {"threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)
    monkeypatch.setattr(threading.Thread, "start", start)
    return seen


def _quiet(work) -> bool:
    return work == {"threads": []}


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w9-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == ("historical" if kind == ryr.KIND else "periodic")
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        else:
            for today in (NOW.date(), FED_NOW.date(), dt.datetime.now(UTC).date()):
                assert not out["as_of"].startswith(today.isoformat())   # the data's own date, never the read day
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


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────
def test_all_three_kinds_are_registered_once_by_their_modules_and_all_three_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "never a build or a request" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert [r.get(k).max_symbols for k in KINDS] == [0, 0, 0]
    assert KINDS == ("rates.auctions", "rates.realYields", "fed.watch")
    assert [m.SOURCE for m in MODULES] == ["us-treasury-fiscal-data", "us-treasury-real-curve", "uct-fed-watch"]
    assert [fn.__name__ for fn in (r.get(k).fn for k in KINDS)] == ["read_auctions", "read_real", "read_fed_watch"]
    # the three capabilities that read them are local-only on the server, by name
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)
    # wave 6's `rates.treasury` is untouched: the real yields are a kind of their own
    from api.services.uct_agent.marketdata import treasury_read
    assert r.get("rates.treasury").fn is treasury_read.read_treasury and "real" not in treasury_read.read_treasury.__code__.co_names


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    monkeypatch.setattr(tar, "held_answer", lambda: ran.append("tar") or (None, "not_held"))
    monkeypatch.setattr(ryr, "held_answer", lambda: ran.append("ryr") or (None, "not_held"))
    monkeypatch.setattr(fwr, "held_answer", lambda: ran.append("fwr") or ({}, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,rates.treasury,calendar.ipos")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_auctions(monkeypatch)
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, tar.KIND)                 # arming ONE arms one
    assert _read(tar.KIND)["status"] == "ok"
    for kind in KINDS[1:]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(tar.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(ryr.KIND)["status"] == "unavailable"                   # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all three off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_words_bounds_and_fields_are_the_services_and_the_panels_own():
    # the auctions: the AUCT panel's own row count, the service's own rate kinds, bidder classes and window
    model = (PANELS / "treasuryAuctionsModel.js").read_text(encoding="utf-8")
    assert int(re.search(r"export const AUCT_RESULTS_SHOWN = (\d+)", model).group(1)) == tar.DEFAULT_ROWS
    assert tar.RATE_KINDS == tuple(kind for _field, kind in ta.RATE_FIELDS)
    assert tar.BIDDER_CLASSES == tuple(name for name, _field in ta.BIDDER_FIELDS)
    assert ta.WINDOW_DAYS == 45 and "the last 45" in gw.registry().get(tar.KIND).description
    # every field the adapter carries is the service's own name (its shaping functions write them)
    shaping = inspect.getsource(ta.shape_upcoming) + inspect.getsource(ta.shape_results)
    for f in set(tar.UPCOMING_FIELDS) | set(tar.RESULT_FIELDS):
        assert f'"{f}"' in shaping, f
    assert tar.last_slot() == env.utc_iso(ty.last_daily_slot(ty.now_et())) and "last_daily_slot" in inspect.getsource(ta.refresh_due)
    # the real yields: the service's own horizons and maturities, the nominal read's own "behind" rule
    assert ryr.HORIZONS == real.HORIZONS
    assert [k for k, *_ in real.MATURITIES] == ["5y", "7y", "10y", "20y", "30y"] and len(real.MATURITIES) <= ryr.MAX_MATURITIES
    assert "last_weekday_before" in inspect.getsource(ty.refresh_due)
    # the Fed watch: the service's own caps, block functions and rates series
    import api.services.fed_watch_parse as P
    assert fwr.MAX_ROWS == P.MAX_SPEECHES <= P.MAX_HEADLINES
    src = inspect.getsource(fw.rates_block)
    for _name, symbol in fed_watch_held.RATE_SERIES:
        assert f'"{symbol}"' in src, symbol
    held_src = inspect.getsource(fed_watch_held.held_answer)
    for fn in ("statement_block", "speeches_block", "projections_block", "survey_block", "headlines_block", "calendar_block"):
        assert f"fw.{fn}(" in held_src and f"{fn}(" in inspect.getsource(fw._assemble), fn
    assert "fw.rates_block" not in held_src and "held_rates()" in held_src
    # each reader this wave reads through says, in its own words, that it never builds
    for fn in (tar.held_answer, ryr.held_answer, fwr.held_answer, treasury_auctions_held.held_auctions,
               treasury_real_yields_held.held_real, fed_watch_held.held_answer, fed_watch_held.held_point, fed_watch_held.held_rates):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__


# ── rates.auctions ────────────────────────────────────────────────────────────────────────────────────────────
def test_auctions_reads_the_held_answer_with_every_row_and_figure_the_services_own(world, work, monkeypatch):
    served, _pub = _hold_auctions(monkeypatch)
    work["threads"].clear()
    out = _read(tar.KIND, {"rows": tar.MAX_ROWS})
    _conforms(out, tar.KIND)
    assert out["status"] == "ok" and out["source"] == tar.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert d["upcoming"]["rows"] == [{k: r[k] for k in tar.UPCOMING_FIELDS} for r in served["upcoming"]]
    assert d["results"]["rows"] == [{k: r[k] for k in tar.RESULT_FIELDS} for r in served["results"]]
    assert [r["auction_date"] for r in d["upcoming"]["rows"]] == ["2026-11-19", "2026-11-23", "2026-11-24"]     # soonest first
    assert [r["auction_date"] for r in d["results"]["rows"]] == ["2026-11-17", "2026-11-13", "2026-11-12", "2026-11-10", "2026-11-05"]
    note10 = next(r for r in d["results"]["rows"] if r["security_term"] == "10-Year")
    assert (note10["rate"], note10["rate_kind"], note10["bid_to_cover"]) == (4.117, "high_yield", 2.58)
    assert note10["bidders"]["indirect"] == served["results"][2]["bidders"]["indirect"]          # the service's own shares
    assert (d["upcoming"]["count"], d["upcoming"]["total"], d["upcoming"]["cut"]) == (3, 3, False)
    assert (d["results"]["count"], d["results"]["total"], d["results"]["cut"]) == (5, 5, False)
    # the newest record's date is the as-of, with when the site read it beside it
    assert (d["as_of"], d["upcoming_as_of"], d["results_through"], d["window_days"]) == ("2026-11-17", "2026-11-17", "2026-11-17", 45)
    assert out["as_of"] == day_as_of("2026-11-17") and d["read_at"] == env.utc_iso(dt.datetime.fromisoformat(served["read_at"]))
    assert (d["basis"], d["source"], d["check"], d["dropped"], d["publisher_cut"]) == (
        "as_published", ta.SOURCE, None, 3, {"upcoming": False, "results": False})
    assert out["notes"] == [tar.NOTE_WHAT.format(days=45),
                            tar.NOTE_AS_OF.format(day="2026-11-17", upcoming="2026-11-17", through="2026-11-17", at=d["read_at"]),
                            tar.NOTE_MISSING.format(n=2), tar.NOTE_DROPPED.format(n=3)]
    assert out["coverage"] == {"evaluated": 8, "answered": 8, "dropped": 0, "not_computable": 2}
    assert _quiet(work)


def test_auctions_a_figure_the_treasury_left_empty_is_null_never_zero(world, monkeypatch):
    _hold_auctions(monkeypatch)
    d = _plain(_read(tar.KIND)["data"])
    bill = next(r for r in d["results"]["rows"] if r["security_term"] == "4-Week")
    bond = next(r for r in d["results"]["rows"] if r["auction_date"] == "2026-11-13")
    assert bill["bidders"] is None                                       # a class missing: no split, never a share of 0
    assert (bond["rate"], bond["rate_kind"], bond["bid_to_cover"]) == (None, None, None)
    rows = d["upcoming"]["rows"] + d["results"]["rows"]
    assert _zeros([{k: v for k, v in r.items() if k not in ("bidders",)} for r in rows]) == []


def test_auctions_long_lists_are_cut_from_their_far_and_old_ends_and_the_publishers_own_cut_is_said(world, monkeypatch):
    pub = Publisher()
    pub.total["treasury_securities_auctions_v2"] = 99
    _hold_auctions(monkeypatch, pub)
    out = _read(tar.KIND, {"rows": 1})
    _conforms(out, tar.KIND)
    d = _plain(out["data"])
    assert [r["auction_date"] for r in d["upcoming"]["rows"]] == ["2026-11-19"] and [r["auction_date"] for r in d["results"]["rows"]] == ["2026-11-17"]
    assert (d["upcoming"]["cut"], d["upcoming"]["total"], d["results"]["cut"], d["results"]["total"]) == (True, 3, True, 5)
    assert _note(out, tar.NOTE_CUT_UPCOMING) == tar.NOTE_CUT_UPCOMING.format(total=3, shown=1) and "cut from the FAR end" in tar.NOTE_CUT_UPCOMING
    assert _note(out, tar.NOTE_CUT_RESULTS) == tar.NOTE_CUT_RESULTS.format(total=5, shown=1) and "cut from the OLD end" in tar.NOTE_CUT_RESULTS
    assert d["publisher_cut"] == {"upcoming": False, "results": True}
    assert _note(out, tar.NOTE_PUBLISHER_CUT) == tar.NOTE_PUBLISHER_CUT.format(what="the oldest results")
    assert d["as_of"] == "2026-11-17" and out["coverage"]["dropped"] == 6
    assert _read(tar.KIND)["data"]["results"]["count"] == 5                 # the default is the panel's twelve


def test_auctions_empty_lists_are_what_the_records_list_and_never_none_held(world, monkeypatch):
    pub = Publisher()
    pub.upcoming, pub.results = [], []
    served, _ = _hold_auctions(monkeypatch, pub)
    assert served["status"] == "ok" and served["upcoming"] == [] and served["as_of"] is None
    out = _read(tar.KIND)
    _conforms(out, tar.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and out["data"]["as_of"] is None
    assert _note(out, tar.NOTE_NO_DATE) == tar.NOTE_NO_DATE.format(at=out["data"]["read_at"])
    assert _note(out, tar.NOTE_NO_UPCOMING) and _note(out, tar.NOTE_NO_RESULTS) == tar.NOTE_NO_RESULTS.format(days=45)
    assert _lacks(out, tar.NOTE_AS_OF)


def test_auctions_an_old_answer_or_a_look_that_went_badly_is_stale_and_no_look_is_started(world, work, monkeypatch):
    first, pub = _hold_auctions(monkeypatch)
    pub.answer["treasury_securities_auctions_v2"] = (503, "text/plain", b"")
    with ta._held._lock:
        ta._held._state["checked"] = 0.0
    ta.get_auctions(wait_s=0)                                            # the service's own refresh fails
    ta._held.drain(10)
    calls = len(pub.calls)
    work["threads"].clear()
    out = _read(tar.KIND)
    _conforms(out, tar.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["stale"] is True and d["check"]["reason"] == "source"
    assert d["results"]["rows"][0] == {k: first["results"][0][k] for k in tar.RESULT_FIELDS}       # the last good records
    assert _note(out, tar.NOTE_CHECK) == tar.NOTE_CHECK.format(at=d["check"]["at"], why=tar.CHECK_WORDS["source"])
    assert len(pub.calls) == calls and _quiet(work)
    # the evening slot after the read has passed: stale, said, and nothing is looked for
    monkeypatch.setattr(ty, "now_et", lambda: dt.datetime(2031, 1, 6, 20, 0, tzinfo=NY))
    out = _read(tar.KIND)
    assert out["stale"] is True and _note(out, tar.NOTE_STALE) == tar.NOTE_STALE.format(
        at=out["data"]["read_at"], slot=env.utc_iso(dt.datetime(2031, 1, 6, 18, 15, tzinfo=NY)))
    assert len(pub.calls) == calls and _quiet(work)


def test_auctions_nothing_held_is_unavailable_and_nothing_is_built(world, work):
    _unavailable(_read(tar.KIND), tar.KIND, tar.NOTE_NOT_HELD)
    assert "not the same as no auctions" in tar.NOTE_NOT_HELD
    assert ta._held.peek() is None and _quiet(work)


def test_auctions_an_answer_held_only_on_disk_is_read_and_the_publisher_is_not_asked(world, work, monkeypatch):
    _hold_auctions(monkeypatch)
    ta.reset_for_tests()                                                 # a restart: memory is empty, the disk copy is kept
    work["threads"].clear()
    out = _read(tar.KIND)
    assert out["status"] == "ok" and out["data"]["as_of"] == "2026-11-17" and _quiet(work)


def test_auctions_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(tar, "held_answer", lambda: ran.append(1) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({"rows": 0}, {"rows": tar.MAX_ROWS + 1}, {"rows": "5"}, {"rows": 1.5}, {"rows": True}):
        out = _read(tar.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(tar.KIND), tar.KIND, tar.NOTE_FAILED)
    for junk in (({"status": "ok", "upcoming": None, "results": [], "read_at": "2026-11-17T23:20:00+00:00"}, "held"),
                 ({"status": "ok", "upcoming": [], "results": [], "read_at": None}, "held"), ("x", "held"),
                 ({"status": "ok", "upcoming": [], "results": [], "read_at": "2026-11-17T23:20:00+00:00"}, "weird")):
        monkeypatch.setattr(tar, "held_answer", lambda _j=junk: _j)
        _unavailable(_read(tar.KIND), tar.KIND, tar.NOTE_FAILED)


# ── rates.realYields ──────────────────────────────────────────────────────────────────────────────────────────
def test_real_yields_reads_the_held_block_with_every_figure_the_services_own(world, work, monkeypatch):
    served, _site = _hold_real(monkeypatch)
    work["threads"].clear()
    out = _read(ryr.KIND)
    _conforms(out, ryr.KIND)
    assert out["status"] == "ok" and out["source"] == ryr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    assert d["maturities"] == served["maturities"] and d["ref_dates"] == served["ref_dates"]
    ten = next(m for m in d["maturities"] if m["key"] == "10y")
    assert (ten["yield"], ten["was"], ten["change_bp"]) == (1.64, {"d1": 1.60, "w1": 1.50}, {"d1": 4.0, "w1": 14.0})
    # the breakevens are the service's own arithmetic, with their own date
    assert d["breakevens"] == served["breakevens"]
    be10 = next(r for r in d["breakevens"]["rows"] if r["key"] == "10y")
    assert (be10["date"], be10["nominal"], be10["real"], be10["value"]) == ("2026-11-17", 4.12, 1.64, 2.48)
    assert (d["as_of"], d["rows"], d["basis"], d["source"], d["check"]) == ("2026-11-17", 7, "end_of_day", real.SOURCE, None)
    assert out["as_of"] == day_as_of("2026-11-17") and d["read_at"] == env.utc_iso(dt.datetime.fromisoformat(served["read_at"]))
    assert out["notes"] == [ryr.NOTE_WHAT, ryr.NOTE_AS_OF.format(day="2026-11-17", at=served["read_at"]),
                            ryr.NOTE_MISSING_BREAKEVEN.format(n=2, day="2026-11-17", list="20-year, 30-year"),
                            ryr.NOTE_MISSING.format(n=1, day="2026-11-17", list="30-year")]
    assert out["coverage"] == {"evaluated": 5, "answered": 4, "dropped": 0, "not_computable": 1}
    assert _quiet(work)


def test_real_yields_a_missing_figure_or_breakeven_is_null_never_zero_and_no_common_day_is_said(world, monkeypatch):
    _hold_real(monkeypatch)
    d = _plain(_read(ryr.KIND)["data"])
    by = {m["key"]: m for m in d["maturities"]}
    assert by["30y"]["yield"] is None and by["30y"]["change_bp"] == {"d1": None, "w1": None}
    be = {r["key"]: r for r in d["breakevens"]["rows"]}
    assert be["20y"]["value"] is None and be["20y"]["nominal"] is None and be["30y"]["value"] is None
    assert _zeros([m["yield"] for m in d["maturities"]] + [r["value"] for r in d["breakevens"]["rows"]]) == []
    # the nominal curve holds no day the real one does: every breakeven null, said
    _forget()
    _hold_real(monkeypatch, nominal={"2025-01-02": {"5y": 3.0}})
    out = _read(ryr.KIND)
    _conforms(out, ryr.KIND)
    d = _plain(out["data"])
    assert d["breakevens"]["as_of"] is None and all(r["value"] is None and r["date"] is None for r in d["breakevens"]["rows"])
    assert _note(out, ryr.NOTE_NO_BREAKEVEN) == ryr.NOTE_NO_BREAKEVEN and _lacks(out, ryr.NOTE_MISSING_BREAKEVEN)
    # an older common day is the breakevens' own date, said
    _forget()
    _hold_real(monkeypatch, nominal={"2026-11-16": NOMINAL["2026-11-16"]})
    out = _read(ryr.KIND)
    assert out["data"]["breakevens"]["as_of"] == "2026-11-16" and out["data"]["as_of"] == "2026-11-17"
    assert _note(out, ryr.NOTE_BREAKEVEN_DAY) == ryr.NOTE_BREAKEVEN_DAY.format(day="2026-11-16")


def test_real_yields_a_curve_that_is_behind_or_a_look_that_went_badly_is_stale_and_no_look_is_started(world, work, monkeypatch):
    _served, site = _hold_real(monkeypatch)
    site.answer = (503, "text/plain", b"")
    with real._held._lock:
        real._held._state["checked"] = 0.0
    real.get_real(wait_s=0)                                              # the service's own refresh fails
    real._held.drain(10)
    calls = len(site.calls)
    work["threads"].clear()
    out = _read(ryr.KIND)
    _conforms(out, ryr.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["check"]["http_status"] == 503
    assert _note(out, ryr.NOTE_CHECK) == ryr.NOTE_CHECK.format(at=out["data"]["check"]["at"], why=ryr.CHECK_WORDS["source"])
    monkeypatch.setattr(ty, "now_et", lambda: dt.datetime(2026, 11, 20, 12, 0, tzinfo=NY))     # a Friday: the 19th is due
    out = _read(ryr.KIND)
    assert out["stale"] is True and _note(out, ryr.NOTE_STALE) == ryr.NOTE_STALE.format(day="2026-11-17", expected="2026-11-19")
    assert len(site.calls) == calls and _quiet(work)


def test_real_yields_nothing_held_is_unavailable_and_nothing_is_built(world, work, monkeypatch):
    monkeypatch.setattr(ty, "held_rows", lambda want=None: {d: dict(v) for d, v in NOMINAL.items()})   # nominal held, real not
    _unavailable(_read(ryr.KIND), ryr.KIND, ryr.NOTE_NOT_HELD)
    assert "not the same as no figure" in ryr.NOTE_NOT_HELD and real._held.peek() is None and _quiet(work)


def test_real_yields_bad_requests_are_refused_and_a_failing_service_or_a_block_that_is_not_the_curve_is_unavailable(world, monkeypatch):
    out = _read(ryr.KIND, ["not", "an", "object"])
    assert out["status"] in ("refused", "unavailable")
    monkeypatch.setattr(ryr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(ryr.KIND), ryr.KIND, ryr.NOTE_FAILED)
    ok = {"status": "ok", "as_of": "2026-11-17", "maturities": [{"key": "5y", "yield": 1.2}], "breakevens": {"as_of": None, "rows": []}}
    for junk in (({**ok, "as_of": None}, "held"), ({**ok, "maturities": None}, "held"), ({**ok, "maturities": [{"key": "5y", "yield": None}]}, "held"),
                 ({**ok, "status": "failed"}, "held"), (ok, "weird")):
        monkeypatch.setattr(ryr, "held_answer", lambda _j=junk: _j)
        _unavailable(_read(ryr.KIND), ryr.KIND, ryr.NOTE_FAILED)


# ── fed.watch ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_fed_watch_reads_every_block_the_service_holds_each_with_its_own_state_source_and_date(world, work, monkeypatch):
    _hold_fed(monkeypatch)
    _hold_headlines(monkeypatch)
    _hold_rates(monkeypatch)
    work["threads"].clear()
    out = _read(fwr.KIND)
    _conforms(out, fwr.KIND)
    assert out["status"] == "ok" and out["source"] == fwr.SOURCE and out["stale"] is False and out["as_of"] is None
    d = _plain(out["data"])
    assert {k: d[k]["state"] for k in fwr.BLOCKS} == {k: "ok" for k in fwr.BLOCKS}
    st = d["statement"]
    assert (st["date"], st["source"], st["url"]) == ("2031-03-04", "Federal Reserve Board",
                                                     "https://www.federalreserve.gov/newsevents/pressreleases/monetary20310304a.htm")
    assert st["minutes"] == {"meeting": "March 3-4, 2031", "url": "https://www.federalreserve.gov/newsevents/pressreleases/monetary20310325a.htm",
                             "date": "2031-03-25"}
    red = st["redline"]
    assert red["state"] == "ok" and red["previous"]["date"] == "2031-01-28" and (red["added"], red["removed"]) == (14, 6)
    assert red["changes"]["rows"][0] == {"text": "The Committee voted 10-0 on this invented statement.",
                                         "was": "The Committee voted 9-1 on this invented statement.", "added": 1, "removed": 1}
    assert red["changes"]["rows"][-1] == {"text": "Voting for the action were every invented member.", "was": None, "added": 8, "removed": 0}
    assert (red["changes"]["count"], red["changes"]["total"], red["changes"]["cut"]) == (4, 4, False)
    assert "paragraphs" not in st and "segments" not in red                 # the full text is left out
    sp = d["speeches"]
    assert (sp["count"], sp["total"], sp["cut"]) == (3, 3, False) and [s["kind"] for s in sp["rows"]] == ["speech", "testimony", "speech"]
    assert sp["rows"][0] == {"kind": "speech", "speaker": "Quillfeather", "title": "Notes on Orchard Credit", "where": "the Invented Lending Forum, Lakeview, Minnesota",
                             "published": "2031-03-20T15:00:00Z", "url": "https://www.federalreserve.gov/newsevents/speech/quillfeather20310320a.htm"}
    hd = d["headlines"]
    assert hd["source"] == "news wire" and (hd["count"], hd["matched"], hd["scanned"], hd["cut"]) == (10, 15, 29, True)
    assert hd["rows"][0] == {"text": "Fed's Quillfeather invented remark 29", "received_at": "2030-03-17T17:47:09Z", "tickers": []}
    assert next(h for h in hd["rows"] if h["text"].endswith("ZZZQ"))["tickers"] == ["ZZZQ"]
    assert d["next_meeting"] == {"state": "ok", "source": "Federal Reserve Bank of New York (the meeting dates in its Survey of Market Expectations)",
                                 "date": "2031-04-29", "time": None, "event": None, "label": "Apr. 28-29 2031", "days_to_go": 40}
    rt = d["rates"]
    assert (rt["effective"], rt["upper"], rt["lower"]) == ({"value": 9.12, "date": "2031-03-18"}, {"value": 9.25, "date": "2031-03-18"},
                                                           {"value": 9.0, "date": "2031-03-18"})
    assert rt["notice"] == fw.NYFED_RATE_NOTICE and rt["source"] == "Federal Reserve Bank of New York"
    pr = d["projections"]
    assert (pr["date"], pr["meeting"], pr["medians"][0]) == ("2031-03-04", "March 3-4", {"label": "2031", "value": 7.4})
    sv = d["survey"]
    assert (sv["survey"], sv["source"]) == ("March 2031", "Federal Reserve Bank of New York")
    assert [h["label"] for h in sv["path"]] == ["Apr. 28-29 2031", "Jun. 9-10 2031", "Jul. 28-29 2031"]
    assert sv["credit"].startswith("© 2031 Federal Reserve Bank of New York") and "distributions" not in sv
    assert d["board_cite"] == fw.BOARD_CITE and d["left_out"] == list(fwr.LEFT_OUT) and d["as_of"] is None
    assert out["notes"][:2] == [fwr.NOTE_WHAT, fwr.NOTE_AS_OF]
    assert _note(out, fwr.NOTE_HEADLINES) == fwr.NOTE_HEADLINES.format(matched=15, scanned=29)
    assert _note(out, fwr.NOTE_HEADLINES_CUT) == fwr.NOTE_HEADLINES_CUT.format(matched=15, shown=10)
    assert _note(out, fwr.NOTE_RATES_NOTICE) == fwr.NOTE_RATES_NOTICE.format(notice=fw.NYFED_RATE_NOTICE)
    assert _note(out, fwr.NOTE_SURVEY) == fwr.NOTE_SURVEY.format(credit=sv["credit"])
    assert _note(out, fwr.NOTE_DAYS_TO_GO) == fwr.NOTE_DAYS_TO_GO.format(today="2031-03-20")
    assert fwr.NOTE_LEFT_OUT in out["notes"] and _note(out, fwr.NOTE_BOARD_CITE) == fwr.NOTE_BOARD_CITE.format(cite=fw.BOARD_CITE)
    assert _lacks(out, fwr.NOTE_STATE) and _lacks(out, fwr.NOTE_CHECK)
    assert out["coverage"] == {"evaluated": 7, "answered": 7, "dropped": 0, "not_computable": 0}
    assert _quiet(work)


def test_fed_watch_a_block_that_is_switched_off_or_not_held_keeps_its_place_and_is_said(world, work, monkeypatch):
    _hold_fed(monkeypatch)                                               # the wire and the economics feature are off
    work["threads"].clear()
    out = _read(fwr.KIND)
    _conforms(out, fwr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "partial" and set(d) >= set(fwr.BLOCKS)
    assert (d["headlines"]["state"], d["rates"]["state"]) == ("off", "off")
    assert d["rates"]["effective"] == {"value": None, "date": None}          # never 0
    assert _note(out, fwr.NOTE_STATE.replace("{block}", "Fed headlines")) == fwr.NOTE_STATE.format(block="Fed headlines", why=fwr.STATE_WORDS["off"])
    assert _note(out, fwr.NOTE_STATE.replace("{block}", "federal funds rates")) == fwr.NOTE_STATE.format(block="federal funds rates", why=fwr.STATE_WORDS["off"])
    assert out["coverage"] == {"evaluated": 7, "answered": 5, "dropped": 0, "not_computable": 2}
    # the economics feature on, and nothing in its serving cache: not held, said; the store's files are never read
    monkeypatch.setenv("ECON_ENABLED", "1")
    reads = []
    monkeypatch.setattr(serving, "_read_key", lambda key: reads.append(key))
    out = _read(fwr.KIND)
    assert out["data"]["rates"]["state"] == "not_held" and reads == []
    assert _note(out, fwr.NOTE_STATE.replace("{block}", "federal funds rates")) == fwr.NOTE_STATE.format(block="federal funds rates", why=fwr.STATE_WORDS["not_held"])
    # one series held, two not: ok, the two missing said, never 0
    _hold_rates(monkeypatch, {"USEFFR": RATE_BODIES["USEFFR"]})
    out = _read(fwr.KIND)
    rt = _plain(out["data"])["rates"]
    assert rt["state"] == "ok" and rt["upper"] == {"value": None, "date": None} and rt["lower"] == {"value": None, "date": None}
    assert _note(out, fwr.NOTE_RATES_MISSING) == fwr.NOTE_RATES_MISSING.format(n=2, list="upper, lower")
    assert _quiet(work)


def test_fed_watch_blocks_never_read_are_not_held_never_failed_while_another_block_is_held(world, work, monkeypatch):
    _hold_headlines(monkeypatch)                                         # only the news wire: the Board was never read here
    work["threads"].clear()
    out = _read(fwr.KIND)
    _conforms(out, fwr.KIND)
    d = _plain(out["data"])
    never = ("statement", "speeches", "projections", "survey", "next_meeting")
    assert out["status"] == "partial" and d["headlines"]["state"] == "ok"
    assert {k: d[k]["state"] for k in never} == {k: "not_held" for k in never}
    for k in never:
        block = fwr.BLOCK_WORDS[k]
        assert _note(out, fwr.NOTE_STATE.replace("{block}", block)) == fwr.NOTE_STATE.format(block=block, why=fwr.STATE_WORDS["not_held"])
    # a look that really failed keeps the service's own state
    with fw._lock:
        fw._state["feeds"]["monetary"] = {"checked": 1.0, "retry_at": 0.0,
                                          "check": {"state": "unavailable", "reason": "refused", "http_status": 403, "at": "2031-03-20T15:00:00+00:00"}}
    d = _plain(_read(fwr.KIND)["data"])
    assert (d["statement"]["state"], d["projections"]["state"]) == ("unavailable", "unavailable") and d["speeches"]["state"] == "not_held"
    assert _quiet(work)


def test_fed_watch_a_statement_with_no_earlier_one_held_and_a_page_not_read_are_said_never_no_change(world, monkeypatch):
    only_one = dict(FED_ANSWERS)
    del only_one["https://www.federalreserve.gov/newsevents/pressreleases/monetary20310128a.htm"]
    _hold_fed(monkeypatch, only_one)
    out = _read(fwr.KIND)
    red = _plain(out["data"])["statement"]["redline"]
    assert red["state"] == "unreadable" and (red["added"], red["removed"], red["changes"]) == (None, None, None)
    assert _note(out, fwr.NOTE_REDLINE_UNREADABLE) == fwr.NOTE_REDLINE_UNREADABLE.format(previous="2031-01-28")
    assert "not the same as no change" in fwr.NOTE_REDLINE_UNREADABLE and "not the same as no change" in fwr.NOTE_REDLINE_NOT_HELD
    # the changed passages are cut from the END, in the statement's order
    segs = [{"op": "same", "text": "A."}] + [s for i in range(12) for s in ({"op": "added", "text": f"new{i}."}, {"op": "break", "text": ""})]
    found = fwr.changes(segs)
    assert len(found) == 12 and found[0] == {"text": "new0.", "was": None, "added": 1, "removed": 0}
    monkeypatch.setattr(fw, "statement_block", lambda computing: {"state": "ok", "source": "Federal Reserve Board", "date": "2031-03-04",
                                                                   "redline": {"state": "ok", "segments": segs, "added": 12, "removed": 0,
                                                                               "previous": {"date": "2031-01-28"}}})
    out = _read(fwr.KIND)
    ch = _plain(out["data"])["statement"]["redline"]["changes"]
    assert (ch["count"], ch["total"], ch["cut"]) == (fwr.MAX_CHANGES, 12, True) and ch["rows"][0]["text"] == "new0."
    assert _note(out, fwr.NOTE_CHANGES_CUT) == fwr.NOTE_CHANGES_CUT.format(total=12, shown=fwr.MAX_CHANGES) and "cut from the END" in fwr.NOTE_CHANGES_CUT


def test_fed_watch_a_look_that_went_badly_while_held_is_stale_and_no_look_is_started(world, work, monkeypatch):
    asked = _hold_fed(monkeypatch)
    with fw._lock:                                                       # the Board's monetary feed refused the last look
        fw._state["feeds"]["monetary"]["check"] = {"state": "unavailable", "reason": "refused", "http_status": 403, "at": "2031-03-20T15:00:00+00:00"}
    work["threads"].clear()
    n = len(asked)
    out = _read(fwr.KIND)
    _conforms(out, fwr.KIND)
    assert out["stale"] is True and _plain(out["data"])["statement"]["state"] == "ok"
    for what in ("FOMC statements", "rate projections"):               # one feed: the statement and the projections read it
        assert _note(out, fwr.NOTE_CHECK.replace("{what}", what)) == fwr.NOTE_CHECK.format(
            what=what, at="2031-03-20T15:00:00+00:00", why=fwr.CHECK_WORDS["refused"])
    assert len(asked) == n and _quiet(work)


def test_fed_watch_nothing_held_is_unavailable_and_nothing_is_built(world, work):
    out = _read(fwr.KIND)
    _unavailable(out, fwr.KIND, fwr.NOTE_NOT_HELD)
    assert "not the same as no statement" in fwr.NOTE_NOT_HELD and _quiet(work)
    with fw._lock:
        assert fw._state["feeds"] == {} and fw._state["inflight"] is None


def test_fed_watch_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(fwr, "held_answer", lambda: ran.append(1) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({"rows": 0}, {"rows": fwr.MAX_ROWS + 1}, {"rows": "5"}, {"rows": 2.5}, {"rows": False}):
        out = _read(fwr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(fwr.KIND), fwr.KIND, fwr.NOTE_FAILED)
    for junk in ((None, "held"), ({"status": "failed"}, "held"), ({"status": "ok"}, "weird"), ({"status": "ok"}, "held")):
        monkeypatch.setattr(fwr, "held_answer", lambda _j=junk: _j)
        _unavailable(_read(fwr.KIND), fwr.KIND, fwr.NOTE_FAILED)


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (getattr(owner, "__name__", owner), name)   # a rename fails here, by name
            label = f"{getattr(owner, '__name__', type(owner).__name__)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    # and a read never writes to the shared cache
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_reaches_a_build_a_request_a_thread_or_a_cache_write_held_or_not(world, work, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the auctions'
    route reader, its build and its publisher reads; the real curve's route reader and build, and the nominal read's
    reader, feed reader and jobs; the shared hold's get, start and run; the Fed watch's route reader, build, every page
    reader and job, its own rates block; the economics store's series reader, its bucket reads and its loaders; the data
    bucket's reader; and the shared cache's writer."""
    reached = []
    monkeypatch.setenv("ECON_ENABLED", "1")
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, params, out["notes"])
        assert reached == [] and _quiet(work)
    _hold_auctions(monkeypatch)
    _hold_real(monkeypatch)
    _hold_fed(monkeypatch)
    _hold_headlines(monkeypatch)
    _hold_rates(monkeypatch)
    with fw._lock:                                                       # and every Board feed is due again
        for f in fw._state["feeds"].values():
            f["checked"] = 0.0
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                            # everything held, refreshes due
        _forbid(mp, reached)
        mp.setattr(ty, "now_et", lambda: dt.datetime(2031, 1, 6, 20, 0, tzinfo=NY))
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, params, out["notes"])
        assert reached == [] and _quiet(work)


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses starts the work."""
    # the auctions: nothing held starts the build, which asks the publisher
    pub = Publisher()
    monkeypatch.setattr(ta, "_client", lambda: econ_http.HttpClient(transport=pub, max_retries=0, sleep=lambda s: None))
    assert _read(tar.KIND)["status"] == "unavailable" and pub.calls == []
    ta.get_auctions(wait_s=10)
    ta._held.drain(10)
    assert len(pub.calls) == 2 and _read(tar.KIND)["status"] == "ok"     # and what it stored is what the kind reads
    # the real curve: nothing held starts the build, which asks the Treasury's website
    site = Site()
    monkeypatch.setattr(ty, "_http_get", site.get)
    monkeypatch.setattr(ty, "_pause", site.pauses.append)
    monkeypatch.setattr(ty, "held_rows", lambda want=None: {d: dict(v) for d, v in NOMINAL.items()})
    assert _read(ryr.KIND)["status"] == "unavailable" and site.calls == []
    real.get_real(wait_s=10)
    real._held.drain(10)
    assert len(site.calls) == 2 and _read(ryr.KIND)["status"] == "ok"
    # the Fed watch: nothing held starts the build, which asks the Board and the New York Fed
    assert _read(fwr.KIND)["status"] == "unavailable"
    asked = _hold_fed(monkeypatch)
    assert set(asked) == set(FED_ANSWERS) and _read(fwr.KIND)["status"] == "partial"
    # and the service's own read-only answer asks the economics store for its rates, which reads the bucket
    monkeypatch.setenv("ECON_ENABLED", "1")
    bucket = []
    monkeypatch.setattr(serving, "_read_key", lambda key: bucket.append(key))
    assert _plain(_read(fwr.KIND)["data"])["rates"]["state"] == "not_held" and bucket == []
    fw.held_answer()
    assert bucket                                                        # the member path's reader reached the bucket


# ── the held readers against their services ───────────────────────────────────────────────────────────────────
def test_the_fed_watch_held_reader_is_the_services_own_answer_and_the_rates_it_finds_are_what_the_service_read(world, monkeypatch):
    _hold_fed(monkeypatch)
    _hold_headlines(monkeypatch)
    mine, how = fed_watch_held.held_answer()
    theirs, how2 = fw.held_answer()                                      # the economics feature off: no request either way
    assert how == how2 == "held"
    assert {k: v for k, v in mine.items() if k != "built_at"} == {k: v for k, v in theirs.items() if k != "built_at"}
    _hold_rates(monkeypatch)                                             # on: the service's reader fills the serving cache
    served = fw.rates_block()
    assert fed_watch_held.held_rates() == served and served["state"] == "ok"
    for name, _symbol in fed_watch_held.RATE_SERIES:
        assert fed_watch_held.held_rates()[name] == served[name]
    # the same body gives the same newest point (the two readers' arithmetic agree)
    for body in (RATE_BODIES["USEFFR"], {"points": []}, {"points": [[1, True, "x", "2031-01-01"]]}, None):
        monkeypatch.setattr(serving, "series", lambda sym, _b=body: (200, _b, None) if isinstance(_b, dict) else (404, {}, None))
        assert fed_watch_held.latest_point(body) == fw._latest_point("USEFFR"), body


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    t95 = row("T-95")
    assert t95.startswith("| T-95 | Member display / storage — daily **US Treasury par yields** at eleven maturities")
    assert "Nothing else reads it (no AI lane, no export, no external publication)." in t95 and "| **A** |" in t95
    t97 = row("T-97")
    assert t97.startswith("| T-97 | Member display / storage — the Terminal's `FED` panel (Fed watch)")
    assert "Nothing else reads it (no AI lane, no export, no external publication)." in t97 and "| **A** |" in t97
    assert "Please cite to the Board as the source of the information." in t97
    t98 = row("T-98")
    assert t98.startswith("| T-98 | Member display / storage — the same `FED` panel's \"What the professionals expect\" block")
    assert "The Terms of Use page itself was not read for this row" in t98 and "| **A** |" in t98
    t37 = row("T-37")
    assert t37.startswith("| T-37 | Member display — economic calendar (all non-current weeks; ForexFactory `thisweek` is the other leg) | FMP · econ calendar |")
    assert "| **R** |" in t37
    t44 = row("T-44")
    assert t44.startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)") and "| **U** |" in t44 and "No AI clause" in t44
    t92 = row("T-92")
    assert "ForexFactory `thisweek`" in t92 and "**U — not researched**" in t92
    # no row names the Treasury's auction records, its real yield curve or the news wire behind the Fed headlines
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("auction", "fiscal data", "real yield", "tips", "trade exchange", "tradexchange", "txnews"):
        assert not [ln for ln in rows if re.search(rf"{words}", ln.lower())], words
    cites = {tar: ("T-95",), ryr: ("T-95",), fwr: ("T-97", "T-98", "T-37", "T-44", "T-92")}
    for m, cited in cites.items():                                     # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(cited), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
    for m in (tar, ryr):
        assert "no other row does" in " ".join(m.__doc__.split()), m.KIND
    assert "has no row in the register at all" in " ".join(fwr.__doc__.split())


# ── the contract (MD-1 v1.15 §4.18) ───────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_18_and_every_note_the_adapters_emit():
    """MD-1 §4.18 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = "### 4.18 Terminal data wave 9: `rates.auctions`, `rates.realYields`, `fed.watch` (v1.15, terminal-data)"
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in [*fwr.BLOCK_WORDS.values(), *fwr.STATE_WORDS.values(), *tar.PUBLISHER_CUT_WORDS.values()]:
        assert words in section, words                                 # the words a note is filled with
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`treasury_auctions_held.held_auctions`",
              "`treasury_real_yields_held.held_real`", "`fed_watch_held.held_answer`", "row T-95", "row T-97", "row T-98",
              "row T-37", "row T-44", "row T-92", "ECON_ENABLED", "for a model provider", "never the time of the read",
              "the builder's default", "`rates.treasury`", "no row in the register", "`marketRates`", "51st"):
        assert s in prose, s
    assert doc.index("### 4.17 Terminal data wave 8") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 15
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.15 addition (2026-11-21, terminal-data, data wave 9):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.18 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.14 addition (2026-11-21, terminal-data, data wave 8):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13", "v1.14", "v1.15"))
    # nothing in the section or the entry records or implies an owner decision about these kinds
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
