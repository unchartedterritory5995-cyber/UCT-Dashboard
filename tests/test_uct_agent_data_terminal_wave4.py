"""MD-1 kinds of terminal data wave 4: `earnings.season`, `earnings.callThemes`, `group.drill` — the Agent half of the
ERNS, CEOS and GRP terminal panels. And the two datasets of the wave that get NO kind: the UNVOL panel (already
answerable by `screen.run`) and the MYH panel (the member's own Journal).

No network, no database of the product: every held answer is put where its service keeps it through that service's
own writer (`earnings_season._remember`, `call_themes._save`, `scan_period._period_remember`, the confluence board's
own cache, the RS ranking's own cache and snapshot file), and every clock is pinned. Pinned per kind: an ok read
(envelope conformance, the documented fields only, the data's own time or null with a note), `unavailable` kept apart
from a healthy empty answer, a malformed request refused before any read, a failing service answered `unavailable`, a
read never fresher than its kind declares, and THE BUDGET RULE: no read ever starts a build, starts a thread or
touches a provider client, with the service's own entry point shown to do exactly that in the same state (so the rail
can fail). For all three: registered dark, model-isolated, dormant until armed one by one. The cross-file facts (the
panels' own keys, words and numbers, the services' own constants) are read from the other file rather than retyped.
And the contract: MD-1 §4.13 quotes every note these adapters emit, verbatim.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from api import confluence_screen
from api.routers import calendar as calendar_route
from api.routers import live_prices
from api.services import bars_fetch, call_themes
from api.services import earnings_season as es
from api.services import massive, rs_ranking
from api.services import scan_period as sp
from api.services.cache import cache
from api.services.uct_agent.marketdata import (earnings_call_themes as ct, earnings_season as sn, group_drill as gd)
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.scan import sources as scan_sources
from api.services.uct_agent.scan import spec as scan_spec

REPO = Path(__file__).resolve().parents[1]
MODULES = (sn, ct, gd)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005): all three. A kind leaving this set is an owner decision.
ISOLATED = set(KINDS)
TODAY = date(2026, 11, 17)                                          # a Tuesday
DS, YESTERDAY, TOMORROW = "2026-11-17", "2026-11-16", "2026-11-18"
#: a well-formed request per kind (the gateway rails below need one that passes each kind's own validate)
GOOD = {sn.KIND: {"date": DS}, ct.KIND: {}, gd.KIND: {"kind": "sector", "group": "Technology"}}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
#: the threads the four member routes start when they hold nothing (each service's own thread name)
BUILD_THREADS = ("earnings-season-build", "call-themes-build", "period-build", "confluence-build", "rs-rankings")
#: every module that holds the provider client under its own name (two bind it when they are imported)
PROVIDER_DOORS = (massive, bars_fetch, live_prices)


class Clock:
    """Stands in for a service's `time` module, so a test can move its clock without moving the real one."""

    def __init__(self):
        self.now = time.time()

    def time(self):
        return self.now


def _forget_everything():
    for store in (es._done, es._old, es._inflight, es._events_memo):
        store.clear()
    call_themes._reset_for_tests()
    cache.delete_prefix("scan_period_")
    for store in (sp._period_done, sp._period_old, sp._period_last, sp._period_inflight):
        store.clear()
    confluence_screen._CACHES.clear()
    rs_ranking._rs_cache.invalidate(rs_ranking._CACHE_KEY)
    rs_ranking.invalidate_ibd_cache()


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))                   # call_themes.json lives here
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    monkeypatch.setattr(rs_ranking, "_SNAPSHOT_PATH", str(tmp_path / "rs_rankings_snapshot.json"))
    monkeypatch.setattr(es, "today_et", lambda: TODAY)
    monkeypatch.setattr(calendar_route, "_today_et", lambda: TODAY)
    monkeypatch.setattr(gd, "today_et", lambda: TODAY)
    monkeypatch.setattr(sp, "_PERIOD_WARM_ENABLED", False)          # the route's own bars warm after a build: never in a test
    gw._reset_for_test(None)
    _forget_everything()
    yield
    for done in list(es._inflight.values()) + [call_themes._inflight] + list(sp._period_inflight.values()):
        if done is not None:
            done.wait(10)                                           # a build a test started on purpose finishes first
    _forget_everything()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every provider client asked for, and every thread started (by name)."""
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
    return seen


def _builds(seen) -> list:
    return [n for n in seen["threads"] if n.startswith(BUILD_THREADS)]


_turn = iter(range(10_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w4-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["as_of"] is not None or out["notes"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway


def _plain(v):
    """A read's data without the gateway's isolation stamps."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


# ── registration, dark by default, isolation ─────────────────────────────────────────────────────────────────────────
def test_every_kind_is_registered_once_by_its_module_and_all_three_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description, m.KIND
        assert k.max_symbols == 0, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert KINDS == ("earnings.season", "earnings.callThemes", "group.drill")


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(monkeypatch):
    ran = []
    monkeypatch.setattr(sn, "held_answer", lambda ds: ran.append("sn") or (None, "not_held"))
    monkeypatch.setattr(ct, "held_answer", lambda month: ran.append("ct"))
    monkeypatch.setattr(gd, "held_ranking", lambda name: ran.append("gd") or (None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,earnings.reactions,earnings.callSearch,confluence.board")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(monkeypatch):
    _hold_themes()
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ct.KIND)                  # arming ONE arms one
    assert _read(ct.KIND)["status"] == "ok"
    for kind in sorted(ISOLATED - {ct.KIND}):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(ct.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns every one off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


# ── earnings.season ──────────────────────────────────────────────────────────────────────────────────────────────────
def _e(sym, **over):
    return {"sym": sym, "name": f"{sym} Corp", "eps_est": 1.0, "eps_act": None, "rev_est": 100.0, "rev_act": None,
            "mc_b": 10.0, "ew": 0, "internal": "dropped", **over}


def _capture(sym, pct=6.2, dollar=12.4, source="massive-chain"):
    return {"sym": sym, "report_date": DS, "captured_at": "2026-11-16T16:35:04-05:00", "pct": pct, "dollar": dollar,
            "expiry": "2026-11-20", "spot": 200.0, "source": source}


PAST = [{"date": "2026-08-18", "pct": 3.1}, {"date": "2026-05-19", "pct": -2.0}]
TUESDAY = {"bmo": [_e("SML", mc_b=2.0), _e("BIG", mc_b=900.0, eps_act=1.5, eps_est=1.0, rev_act=120.0),
                   _e("NOCAP", mc_b=None), _e("MID", mc_b=50.0, eps_act=0.8, eps_est=1.0, rev_act=90.0)],
           "amc": [_e("EVE", mc_b=300.0, eps_act=2.0, rev_act=110.0), _e("BIG", mc_b=900.0)],
           "tbd": [_e("LATE", mc_b=1.0)]}


def _day_answer(ds=DS, today=DS, day=None, *, priced="default", moves="default", moves_state="live", default=False):
    """One day's answer as the service's own `assemble_day` puts it together (what its build stores)."""
    if priced == "default":
        priced = {"BIG": _capture("BIG"), "MID": _capture("MID", source="yfinance")}       # MID's is withheld
    if moves == "default":
        moves = {"BIG": 3.214, "MID": -4.5}
    held = {"BIG": (PAST, "ok"), "MID": (None, "not_measured")}
    out = es.assemble_day(ds, today, TUESDAY if day is None else day, priced=priced,
                          held_events=lambda sym: held.get(sym, (None, "not_held")), moves=moves, moves_state=moves_state,
                          calendar_as_of="2026-11-17T14:00:00+00:00", built_at="2026-11-17T14:05:00+00:00")
    return {**out, "default": default, "range": {"from": "2026-11-09", "to": "2026-11-27"}}


def _hold_day(answer=None, key=DS, ttl=es.FRESH_TODAY_S):
    """Hold an answer where the service's own build leaves it (`_remember`), then return it."""
    answer = _day_answer() if answer is None else answer
    es._remember(key, answer, ttl)
    return answer


def test_the_session_keys_fields_and_states_are_the_services_and_the_erns_panels_own():
    assert sn.SESSIONS == es.SESSIONS
    js = (PANELS / "earningsSeasonModel.js").read_text(encoding="utf-8")
    block = js[js.index("export const EARNINGS_SESSIONS = Object.freeze({"):js.index("export const DEFAULT_EARNINGS_DAY")]
    assert tuple(re.findall(r"^  (\w+): Object\.freeze", block, flags=re.M)) == sn.SESSION_CHOICES
    assert f"export const SESSION_ORDER = Object.freeze({list(sn.SESSIONS)!r})" in js
    assert re.search(r"movesState: \[([^\]]+)\]\.includes", js).group(1).replace("'", "").split(", ") == list(sn.MOVES_STATES)
    answer = _day_answer()
    row = answer["sessions"]["bmo"][0]
    assert set(row) == set(sn.ROW_FIELDS)                             # every field the service sends, and no other
    assert set(row["priced"]) == set(sn.PRICED_FIELDS) and set(row["past"]) == set(sn.PAST_FIELDS)
    assert tuple(answer["counts"]) == sn.COUNT_FIELDS
    assert answer["day_kind"] in sn.DAY_KINDS and es.FRESH_OTHER_S == 300 and es.STALE_EXTRA_S == 900


def test_held_day_is_get_days_own_answer_and_never_starts_the_build_get_day_starts(monkeypatch, work):
    """⚠️ the accessor, railed against the route's reader: the same answer whenever `get_day` would not build, and in
    the states where `get_day` DOES start a build, `held_day` starts none."""
    clock = Clock()
    monkeypatch.setattr(es, "time", clock)
    built = []
    monkeypatch.setattr(es, "build_day", lambda ds: built.append(ds) or _day_answer())
    assert es.held_day(DS) == (None, "not_held") and built == [] and es._inflight == {} and _builds(work) == []
    first = es.get_day(DS)                                            # the route: starts ONE build and waits on it
    assert first["status"] == "ok" and built == [DS] and _builds(work) == ["earnings-season-build"]
    assert es.held_day(DS) == (first, "fresh") and es.held_day(DS)[0] is es.get_day(DS)
    clock.now += es.FRESH_TODAY_S + 1                                 # past its freshness: the last good answer
    held, how = es.held_day(DS)
    assert how == "last_good" and held is first and "refreshing" not in held      # nothing here refreshes it
    assert built == [DS] and es._inflight == {}
    again = es.get_day(DS)                                            # the route: serves it AND starts the rebuild
    assert again == {**first, "refreshing": True} and _builds(work) == ["earnings-season-build"] * 2
    rebuilding = es._inflight.get(DS)
    assert rebuilding is None or rebuilding.wait(10)
    clock.now += es.FRESH_TODAY_S + es.STALE_EXTRA_S + 5              # past the last good copy too
    assert es.held_day(DS) == (None, "not_held")
    # a refusal is the same one `get_day` gives, and reads nothing
    for bad in ("2026-12-15", "yesterday"):
        assert es.held_day(bad) == (es.get_day(bad), "refused")
    assert es.held_day("2026-12-15")[0]["status"] == "out_of_range" and es.held_day("nope")[0] == {"status": "bad_date", "date": None}
    assert work["provider"] == 0


def test_season_reads_the_held_day_with_every_number_the_services_own(work):
    held = _hold_day()
    out = _read(sn.KIND, {"date": DS})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False and out["as_of"] is None
    d = out["data"]
    assert (d["date"], d["today"], d["day_kind"], d["session"], d["held"], d["default"], d["no_day"]) == (DS, DS, "today", "all", "fresh", False, False)
    assert {s: [r["sym"] for r in d["sessions"][s]] for s in sn.SESSIONS} == {"bmo": ["BIG", "MID", "SML", "NOCAP"], "amc": ["EVE"], "tbd": ["LATE"]}
    assert _plain(d["sessions"]) == {s: [{k: r[k] for k in sn.ROW_FIELDS} for r in held["sessions"][s]] for s in sn.SESSIONS}
    big, mid, nocap, eve = (next(r for s in sn.SESSIONS for r in d["sessions"][s] if r["sym"] == sym) for sym in ("BIG", "MID", "NOCAP", "EVE"))
    assert set(big) - {"isolated"} == set(sn.ROW_FIELDS)              # the documented fields only
    assert _plain(big["priced"]) == {"pct": 6.2, "dollar": 12.4, "captured_at": "2026-11-16T16:35:04-05:00", "expiry": "2026-11-20"}
    assert _plain(big["past"]) == {"moves": PAST, "avg_abs": 2.55, "n": 2} and big["past_state"] == "ok"
    assert (big["move"], big["move_state"], big["verdict"], big["reported"]) == (3.21, "live", "beat", True)
    # a number that does not exist is null, never 0: a withheld priced move, no past move, no market cap, no result
    assert mid["priced"] is None and mid["past"] is None and mid["past_state"] == "not_measured" and mid["move"] == -4.5
    assert nocap["mc_b"] is None and nocap["eps_act"] is None and nocap["move"] is None and nocap["move_state"] is None and nocap["reported"] is False
    assert (eve["move"], eve["move_state"]) == (None, "next_close")   # today, after the close: none until the next close
    assert (d["count"], d["shown"], d["scheduled"]) == (6, 6, 6) and _plain(d["counts"]) == held["counts"]
    assert d["counts"]["priced_withheld"] == 1 and d["priced_state"] == "read" and d["moves_state"] == "live"
    assert d["built_at"] == "2026-11-17T14:05:00Z" and d["calendar_as_of"] == "2026-11-17T14:00:00Z"
    assert _plain(d["capture"]) == held["capture"] and _plain(d["range"]) == held["range"]
    for note in (sn.NOTE_WHAT.format(date=DS), sn.NOTE_PRICED, sn.NOTE_PAST, sn.NOTE_MOVE_TODAY, sn.NOTE_TIME.format(at=d["built_at"]),
                 sn.NOTE_PRICED_WITHHELD.format(n=1), sn.NOTE_PAST_NOT_HELD.format(n=4, total=6)):
        assert note in out["notes"], note
    assert sn.NOTE_CUT.format(n=6, total=6) not in out["notes"] and sn.NOTE_DEFAULT not in out["notes"]
    assert out["coverage"] == {"evaluated": 6, "answered": 6, "dropped": 0, "not_computable": 1}
    assert "internal" not in json.dumps(out) and '"ew"' not in json.dumps(out)
    assert work == {"provider": 0, "threads": []}


def test_season_a_session_and_a_limit_are_applied_and_the_cut_is_stated():
    _hold_day()
    out = _read(sn.KIND, {"date": DS, "limit": 3})
    _conforms(out, sn.KIND)
    d = out["data"]                                                    # the three biggest of the day, each under its own session
    assert {s: [r["sym"] for r in d["sessions"][s]] for s in sn.SESSIONS} == {"bmo": ["BIG", "MID"], "amc": ["EVE"], "tbd": []}
    assert (d["count"], d["shown"], d["scheduled"]) == (6, 3, 6) and sn.NOTE_CUT.format(n=3, total=6) in out["notes"]
    assert out["coverage"] == {"evaluated": 6, "answered": 3, "dropped": 3, "not_computable": 1}
    out = _read(sn.KIND, {"date": DS, "session": "bmo", "limit": 4})
    assert [r["sym"] for r in out["data"]["sessions"]["bmo"]] == ["BIG", "MID", "SML", "NOCAP"]        # no market cap on file: last
    assert out["data"]["sessions"]["amc"] == [] and (out["data"]["count"], out["data"]["scheduled"]) == (4, 6)
    _hold_day(_day_answer(day={"bmo": [_e("AAA")], "amc": [], "tbd": []}, moves=None, moves_state=None))
    out = _read(sn.KIND, {"date": DS, "session": "amc"})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["data"]["count"] == 0 and out["data"]["scheduled"] == 1
    assert sn.NOTE_NO_MATCH.format(total=1, date=DS, when="after the close") in out["notes"]


def test_season_nobody_reporting_and_a_day_the_calendar_does_not_carry_are_healthy_answers():
    _hold_day(_day_answer(day={"bmo": [], "amc": [], "tbd": []}, moves=None, moves_state=None))
    out = _read(sn.KIND, {"date": DS})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["data"]["scheduled"] == 0 and sn.NOTE_NOBODY.format(date=DS) in out["notes"]
    assert out["data"]["moves_state"] is None
    _hold_day({"status": "no_day", "weekend": False, "date": TOMORROW, "today": DS, "default": False,
               "range": {"from": "2026-11-09", "to": "2026-11-27"}}, key=TOMORROW, ttl=es.FRESH_OTHER_S)
    out = _read(sn.KIND, {"date": TOMORROW})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["data"]["no_day"] is True and out["data"]["day_kind"] == "future" and out["stale"] is False
    assert out["notes"] == [sn.NOTE_NO_DAY.format(date=TOMORROW)] and out["data"]["scheduled"] == 0
    # the bare read on a weekend: the service's "next day" answer is the weekend day itself
    _hold_day({"status": "no_day", "weekend": True, "date": "2026-11-21", "today": "2026-11-21", "default": True,
               "range": {"from": "2026-11-16", "to": "2026-12-04"}}, key=es.NEXT_KEY, ttl=es.FRESH_OTHER_S)
    out = _read(sn.KIND, {})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["notes"] == [sn.NOTE_WEEKEND.format(date="2026-11-21"), sn.NOTE_DEFAULT]


def test_season_no_date_reads_the_services_next_day_answer_and_says_so():
    coming = {"bmo": [_e("AAA", mc_b=5.0)], "amc": [_e("BBB", mc_b=9.0)], "tbd": []}
    _hold_day(_day_answer(ds=TOMORROW, today=DS, day=coming, moves=None, moves_state=None, default=True), key=es.NEXT_KEY, ttl=es.FRESH_OTHER_S)
    out = _read(sn.KIND, {})
    _conforms(out, sn.KIND)
    d = out["data"]
    assert out["status"] == "ok" and (d["date"], d["day_kind"], d["default"]) == (TOMORROW, "future", True)
    assert sn.NOTE_DEFAULT in out["notes"] and sn.NOTE_MOVE_TODAY not in out["notes"] and sn.NOTE_MOVE_PAST not in out["notes"]
    assert d["moves_state"] is None                                    # a coming day: nothing to measure yet, and that is not a gap
    assert all(r["move"] is None for s in sn.SESSIONS for r in d["sessions"][s])


def test_season_a_past_day_is_historical_and_missing_moves_or_priced_moves_make_it_partial():
    _hold_day(_day_answer(ds=YESTERDAY, today=DS, moves=None, moves_state="not_held"), key=YESTERDAY, ttl=es.FRESH_OTHER_S)
    out = _read(sn.KIND, {"date": YESTERDAY})
    _conforms(out, sn.KIND)
    assert out["status"] == "partial" and out["freshness"] == "historical" and out["data"]["day_kind"] == "past"
    assert sn.NOTE_MOVES_NOT_HELD.format(date=YESTERDAY) in out["notes"] and sn.NOTE_MOVE_PAST in out["notes"]
    rows = [r for s in sn.SESSIONS for r in out["data"]["sessions"][s]]
    assert all(r["move"] is None for r in rows)                        # null, never 0
    assert {r["move_state"] for r in rows if r["reported"]} == {"not_held"} and out["coverage"]["not_computable"] == 3
    _hold_day(_day_answer(moves=None, moves_state="failed"))
    out = _read(sn.KIND, {"date": DS})
    assert out["status"] == "partial" and sn.NOTE_MOVES_FAILED in out["notes"]
    _hold_day(_day_answer(priced=None))                               # the store could not be read when it was built
    out = _read(sn.KIND, {"date": DS})
    _conforms(out, sn.KIND)
    assert out["status"] == "partial" and out["data"]["priced_state"] == "failed" and sn.NOTE_PRICED_FAILED in out["notes"]
    assert all(r["priced"] is None for s in sn.SESSIONS for r in out["data"]["sessions"][s])
    _hold_day(_day_answer(ds=YESTERDAY, today=DS, moves={"BIG": 3.2, "MID": -4.5, "EVE": 0.0}, moves_state="held"), key=YESTERDAY, ttl=es.FRESH_OTHER_S)
    out = _read(sn.KIND, {"date": YESTERDAY})                          # a held past day: an unchanged close is 0.0, a real number
    eve = out["data"]["sessions"]["amc"][0]
    assert out["status"] == "ok" and (eve["move"], eve["move_state"]) == (0.0, "settled")


def test_season_the_last_good_answer_is_stale_and_no_build_replaces_it(monkeypatch, work):
    clock = Clock()
    monkeypatch.setattr(es, "time", clock)
    monkeypatch.setattr(es, "build_day", lambda ds: (_ for _ in ()).throw(AssertionError("a build was started inside a turn")))
    _hold_day()
    clock.now += es.FRESH_TODAY_S + 1
    out = _read(sn.KIND, {"date": DS})
    _conforms(out, sn.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["held"] == "last_good"
    assert sn.NOTE_LAST_GOOD.format(date=DS, minutes=5) in out["notes"]
    assert es._inflight == {} and work == {"provider": 0, "threads": []}
    held = _day_answer()
    held.pop("built_at")
    _hold_day(held, key=TOMORROW)                                      # no build time: unknown is never claimed fresh
    out = _read(sn.KIND, {"date": TOMORROW})
    _conforms(out, sn.KIND)
    assert out["stale"] is True and out["data"]["built_at"] is None and sn.NOTE_NO_TIME in out["notes"]


def test_season_nothing_held_is_unavailable_and_no_build_is_started(monkeypatch, work):
    """Through the REAL service state with nothing held: the member route starts its build here; this read must not.
    The build is COUNTED: the route's own reader is shown to start it in the same state, so the count can fail."""
    built = []
    monkeypatch.setattr(es, "build_day", lambda ds: built.append(ds) or _day_answer())
    for params, named in (({"date": DS}, DS), ({}, sn.NEXT_DAY_WORDS)):
        out = _read(sn.KIND, params)
        _conforms(out, sn.KIND)
        assert out["status"] == "unavailable" and out["data"] is None
        assert out["notes"] == [sn.NOTE_NOT_HELD.format(date=named, minutes=5, extra=15)]
    assert built == [] and es._inflight == {} and work == {"provider": 0, "threads": []}
    assert es.get_day(DS)["status"] == "ok" and built == [DS] and _builds(work) == ["earnings-season-build"]     # the route does


def test_season_out_of_reach_an_unread_calendar_and_a_failing_service_are_each_said(monkeypatch):
    out = _read(sn.KIND, {"date": "2026-12-15"})
    _conforms(out, sn.KIND)
    first, last = es.week_window(TODAY)
    assert out["status"] == "unavailable" and out["notes"] == [sn.NOTE_OUT_OF_RANGE.format(date="2026-12-15", first=first.isoformat(), last=last.isoformat())]
    _hold_day({"status": "unavailable", "reason": "calendar", "date": DS, "today": DS, "default": False, "range": {}}, ttl=es.FAILED_S)
    out = _read(sn.KIND, {"date": DS})
    assert out["status"] == "unavailable" and out["notes"] == [sn.NOTE_CALENDAR.format(date=DS)]
    for bad in ({"status": "ok", "date": DS, "sessions": None}, {"status": "weird", "date": DS}, "not an answer",
                {"status": "ok", "date": "not a day", "sessions": {}}):
        monkeypatch.setattr(sn, "held_answer", lambda ds, b=bad: (b, "fresh"))
        out = _read(sn.KIND, {"date": DS})
        _conforms(out, sn.KIND)
        assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [sn.NOTE_FAILED.format(date=DS)], bad

    def boom(ds):
        raise RuntimeError("held store unreadable at /data/internal")
    monkeypatch.setattr(sn, "held_answer", boom)
    out = _read(sn.KIND, {})
    assert out["notes"] == [sn.NOTE_FAILED.format(date=sn.NEXT_DAY_WORDS)] and "internal" not in json.dumps(out)


def test_season_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(sn, "held_answer", lambda ds: ran.append(ds) or (None, "not_held"))
    for bad in ({"date": "tomorrow"}, {"date": "2026-02-30"}, {"date": "2026-11-21"}, {"date": 20261117}, {"session": "tbd"},
                {"session": "AMC"}, {"limit": 0}, {"limit": sn.MAX_LIMIT + 1}, {"limit": True}, {"limit": "5"}):
        assert _read(sn.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── earnings.callThemes ──────────────────────────────────────────────────────────────────────────────────────────────
def _phrase(phrase, calls, pct, base_pct, **over):
    return {"phrase": phrase, "words": phrase.count(" ") + 1, "calls": calls, "pct": pct, "companies": calls - 2,
            "base_calls": int(base_pct * 4), "base_pct": base_pct, "base_raw_pct": base_pct + 0.3, "rise": round(pct - base_pct, 1),
            "ratio": round(pct / base_pct, 1) if base_pct >= 0.05 else None, "related": [], "examples": ["AAA", "BBB", "CCC"], **over}


NEW = [_phrase("agentic commerce", 40, 13.3, 0.0, related=["agentic checkout"]), _phrase("sovereign compute", 31, 10.3, 0.4),
       _phrase("tariff refund", 22, 7.3, 0.2)]
RISING = [_phrase("pricing power", 90, 30.0, 18.5), _phrase("backlog", 70, 23.3, 11.0)]


def _themes_payload(*, built=None, months=("2026-11", "2026-10"), calls=520, lists=None, qualified=None):
    built = built or datetime.now(timezone.utc)
    one = lambda m: {"month": m, "calls": 300, "companies": 290,                         # noqa: E731
                     "baseline": {"months": ["2026-08", "2026-09", "2026-10"], "calls": 410, "matched_pct": 87.5},
                     "floor": {"calls": 8, "companies": 6}, "new": list(NEW), "rising": list(RISING),
                     "qualified": qualified or {"new": 44, "rising": 2}, **(lists or {})}
    return {"version": call_themes.METHOD_VERSION, "built_at": built.strftime("%Y-%m-%dT%H:%M:%SZ"), "built_day": "2026-11-17",
            "seconds": 1.0, "rules": dict(call_themes.RULES),
            "corpus": {"calls": calls, "oldest": "2026-08-20", "newest": "2026-11-16", "months": [{"month": "2026-11", "calls": 300}]},
            "months": list(months), "lists": {m: one(m) for m in months}}


def _hold_themes(**kw):
    """Hold the lists where the service's own build leaves them: its stored file, read back by the service itself."""
    payload = _themes_payload(**kw)
    call_themes._save(payload)
    call_themes._reset_for_tests()                                    # "a deploy": the module holds nothing but the file
    return payload


def _count_theme_builds(monkeypatch):
    made = []
    monkeypatch.setattr(call_themes, "build", lambda: made.append(threading.current_thread().name) or _themes_payload())
    return made


def _wait_themes():
    done = call_themes._inflight
    if done is not None:
        assert done.wait(10)


def test_the_lists_limits_fields_and_month_rule_are_the_services_and_the_ceos_panels_own():
    js = (PANELS / "callThemesModel.js").read_text(encoding="utf-8")
    block = js[js.index("export const CALL_THEME_LISTS = Object.freeze({"):js.index("export const DEFAULT_CALL_THEMES_LIST")]
    assert tuple(re.findall(r"^  (\w+): \{", block, flags=re.M)) == ct.LISTS
    assert int(re.search(r"^export const BOTH_ROWS = (\d+)$", js, flags=re.M).group(1)) == ct.DEFAULT_LIMIT
    assert ct.MAX_LIMIT == call_themes.LIST_CAP and ct.LIST_NAMES == ("new", "rising")
    route = (REPO / "api/routers/earnings_intel.py").read_text(encoding="utf-8")
    assert f'pattern=r"{ct._MONTH.pattern}"' in route                 # the member route's own month rule
    # a row is the service's own: `rank_month`'s fields, then the spelling and the example tickers `build` adds
    ranked = call_themes.rank_month([("pricing power", 60, 40, 30, 30.0)], 300, 400)["rising"][0]
    assert set(ct.ROW_FIELDS) == (set(ranked) - {"key"}) | {"phrase", "examples"}
    assert call_themes.MAX_WORDS == 3 and call_themes.EXAMPLES == 3 and call_themes.STALE_REBUILD_S == 36 * 3600


def test_held_themes_is_get_themes_own_answer_and_never_starts_the_builds_get_themes_starts(monkeypatch, work):
    """⚠️ the accessor, railed against the route's reader, cold and stale."""
    made = _count_theme_builds(monkeypatch)
    assert call_themes.held_themes() is None and made == [] and call_themes._inflight is None and _builds(work) == []
    assert call_themes.get_themes() == {"status": "computing"}        # the route: a cold server starts the one build
    _wait_themes()
    assert made == ["call-themes-build"] and _builds(work) == ["call-themes-build"]
    for month in (None, "2026-10", "2026-09"):                        # ok, another month, a month with no list
        assert call_themes.held_themes(month) == call_themes.get_themes(month)
    assert call_themes.held_themes("2026-09")["status"] == "no_month" and made == ["call-themes-build"]
    _hold_themes(built=datetime.now(timezone.utc) - timedelta(hours=40))        # older than the service's refresh bound
    held = call_themes.held_themes()
    assert held["status"] == "ok" and held["refreshing"] is False and made == ["call-themes-build"] and call_themes._inflight is None
    assert call_themes.get_themes()["refreshing"] is True             # the route: starts the stale rebuild
    _wait_themes()
    assert made == ["call-themes-build"] * 2 and work["provider"] == 0
    for months, calls, status in (((), 40, "thin"), ((), 0, "empty")):
        _hold_themes(months=months, calls=calls)
        assert call_themes.held_themes()["status"] == status == call_themes.get_themes()["status"]


def test_themes_reads_the_held_lists_with_every_number_the_services_own(monkeypatch, work):
    made = _count_theme_builds(monkeypatch)
    payload = _hold_themes()
    out = _read(ct.KIND, {})
    _conforms(out, ct.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-16T05:00:00Z"                     # the newest call's date, as the start of that Eastern day
    d = out["data"]
    held = payload["lists"]["2026-11"]
    assert (d["month"], d["months"], d["list"], d["calls"], d["companies"]) == ("2026-11", ["2026-11", "2026-10"], "both", 300, 290)
    assert _plain(d["new"]) == held["new"] and _plain(d["rising"]) == held["rising"]           # nothing re-counted or re-ranked
    assert set(d["new"][0]) - {"isolated"} == set(ct.ROW_FIELDS)      # the documented fields only
    assert d["new"][0]["ratio"] is None and d["new"][0]["base_pct"] == 0.0        # nothing earlier: no ratio, never 0 times
    assert _plain(d["qualified"]) == {"new": 44, "rising": 2} and _plain(d["shown"]) == {"new": 3, "rising": 2}
    assert _plain(d["baseline"]) == held["baseline"] and _plain(d["floor"]) == held["floor"]
    assert d["built_at"] == payload["built_at"] and d["refreshing"] is False
    assert _plain(d["corpus"]) == {"calls": 520, "oldest": "2026-08-20", "newest": "2026-11-16"}
    assert _plain(d["rules"]) == {k: float(v) for k, v in call_themes.RULES.items()}
    for note in (ct.NOTE_WHAT.format(month="2026-11"), ct.NOTE_BASE.format(calls=410, months="2026-08, 2026-09, 2026-10", matched="87.5"),
                 ct.NOTE_NO_TEXT.format(words=3, examples=3), ct.NOTE_AS_OF.format(at=payload["built_at"]),
                 ct.NOTE_CUT.format(n=3, total=44, name="new")):
        assert note in out["notes"], note
    assert not any(n.startswith("showing the first 2 of") for n in out["notes"])      # the rising list is whole
    assert out["coverage"] == {"evaluated": 46, "answered": 5, "dropped": 41, "not_computable": 0}
    assert made == [] and call_themes._inflight is None and work == {"provider": 0, "threads": []}


def test_themes_one_list_a_month_and_a_limit_are_applied_and_the_cut_is_stated():
    _hold_themes()
    out = _read(ct.KIND, {"list": "new", "limit": 2, "month": "2026-10"})
    _conforms(out, ct.KIND)
    d = out["data"]
    assert (d["month"], d["list"]) == ("2026-10", "new") and [r["phrase"] for r in d["new"]] == ["agentic commerce", "sovereign compute"]
    assert d["rising"] == [] and _plain(d["shown"]) == {"new": 2, "rising": 0} and _plain(d["qualified"]) == {"new": 44, "rising": 2}
    assert ct.NOTE_CUT.format(n=2, total=44, name="new") in out["notes"]
    assert not any("rising list" in n for n in out["notes"])          # a list that was not asked for is not called cut
    assert out["coverage"] == {"evaluated": 44, "answered": 2, "dropped": 42, "not_computable": 0}
    out = _read(ct.KIND, {"list": "rising", "limit": 1})
    assert [r["phrase"] for r in out["data"]["rising"]] == ["pricing power"] and ct.NOTE_CUT.format(n=1, total=2, name="rising") in out["notes"]


def test_themes_no_phrase_passing_is_a_finding_and_a_plain_comparison_is_said():
    plain = {"baseline": {"months": ["2026-10"], "calls": 120, "matched_pct": 0.0}}
    _hold_themes(lists={"new": [], "rising": [], **plain}, qualified={"new": 0, "rising": 0})
    out = _read(ct.KIND, {})
    _conforms(out, ct.KIND)
    assert out["status"] == "ok" and out["data"]["new"] == [] and out["data"]["rising"] == []
    assert ct.NOTE_NONE.format(month="2026-11") in out["notes"]
    assert ct.NOTE_BASE_PLAIN.format(calls=120, months="2026-10") in out["notes"]
    assert not any(n.startswith("compared with 120 earlier calls (2026-10), weighted") for n in out["notes"])


def test_themes_old_lists_are_stale_and_no_rebuild_is_started(monkeypatch, work):
    made = _count_theme_builds(monkeypatch)
    _hold_themes(built=datetime.now(timezone.utc) - timedelta(hours=40))
    out = _read(ct.KIND, {})
    _conforms(out, ct.KIND)
    assert out["status"] == "ok" and out["stale"] is True and ct.NOTE_STALE.format(hours=36) in out["notes"]
    assert made == [] and call_themes._inflight is None and work == {"provider": 0, "threads": []}
    payload = _themes_payload()
    payload["built_at"] = "last Tuesday"                              # no usable build time: unknown is never claimed fresh
    payload["corpus"]["newest"] = None
    call_themes._save(payload)
    call_themes._reset_for_tests()
    out = _read(ct.KIND, {})
    _conforms(out, ct.KIND)
    assert out["stale"] is True and out["as_of"] is None and out["data"]["built_at"] is None
    assert ct.NOTE_NO_BUILD_TIME in out["notes"] and ct.NOTE_NO_AS_OF in out["notes"]


def test_themes_nothing_held_is_unavailable_and_no_build_is_started(monkeypatch, work):
    """Through the REAL service state with nothing held: the member route starts the scan here; this read must not."""
    made = _count_theme_builds(monkeypatch)
    out = _read(ct.KIND, {})
    _conforms(out, ct.KIND)
    assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [ct.NOTE_NOT_HELD]
    assert made == [] and call_themes._inflight is None and work == {"provider": 0, "threads": []}
    assert call_themes.get_themes() == {"status": "computing"}        # the route does
    _wait_themes()
    assert made == ["call-themes-build"] and _builds(work) == ["call-themes-build"]


def test_themes_an_empty_index_a_thin_one_and_a_month_with_no_list_are_never_no_phrase_rising(monkeypatch):
    _hold_themes(months=(), calls=0)
    assert _read(ct.KIND, {})["notes"] == [ct.NOTE_EMPTY_INDEX]
    _hold_themes(months=(), calls=40)
    assert _read(ct.KIND, {})["notes"] == [ct.NOTE_THIN.format(calls=40)]
    _hold_themes()
    out = _read(ct.KIND, {"month": "2026-09"})
    _conforms(out, ct.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [ct.NOTE_NO_MONTH.format(month="2026-09", months="2026-11, 2026-10")]
    monkeypatch.setattr(ct, "held_answer", lambda month: {"status": "no_month", "month": "2026-09", "months": [], "corpus": {}})
    assert _read(ct.KIND, {"month": "2026-09"})["notes"] == [ct.NOTE_NO_MONTHS.format(month="2026-09")]
    for bad in ({"status": "ok", "month": "2026-11", "new": None, "rising": []}, {"status": "error"}, "not an answer",
                {"status": "ok", "month": "November", "new": [], "rising": []}):
        monkeypatch.setattr(ct, "held_answer", lambda month, b=bad: b)
        out = _read(ct.KIND, {})
        _conforms(out, ct.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [ct.NOTE_FAILED], bad

    def boom(month):
        raise RuntimeError("stored answer unreadable at /data/call_themes.json")
    monkeypatch.setattr(ct, "held_answer", boom)
    out = _read(ct.KIND, {})
    assert out["notes"] == [ct.NOTE_FAILED] and "/data" not in json.dumps(out)


def test_themes_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(ct, "held_answer", lambda month: ran.append(month))
    for bad in ({"month": "2026-13"}, {"month": "2026-9"}, {"month": "November"}, {"month": 202611}, {"list": "all"}, {"list": "NEW"},
                {"limit": 0}, {"limit": ct.MAX_LIMIT + 1}, {"limit": True}, {"limit": 2.5}):
        assert _read(ct.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── group.drill ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _stock(sym, pct, sector, industry):
    return {"sym": sym, "period_change": pct, "net_change": pct, "start_close": 100.0, "end_close": round(100.0 + pct, 2),
            "price": 101.0, "volume": 5, "industry": industry, "sector": sector}


STOCKS = [_stock("AAA", 30.0, "Technology", "Semiconductors"), _stock("BBB", 20.0, "Technology", "Software"),
          _stock("CCC", -5.0, "Energy", "Oil & Gas"), _stock("DDD", 10.0, "Technology", "Semiconductors"),
          _stock("EEE", 0.0, "Technology", "Software"), _stock("BRK-B", 4.0, "Financial Services", "Insurance")]
SMAP = {r["sym"]: {"sector": r["sector"], "industry": r["industry"]} for r in STOCKS}
THEMES = {"themes": [
    {"name": "AI / GPU Chips", "holdings": [{"sym": "AAA", "source": "owner"}, {"sym": "DDD", "source": "owner"},
                                            {"sym": "CCC", "source": "engine"}, {"sym": "ZZZ", "source": "owner"}]},
    {"name": "Engine Only", "holdings": [{"sym": "BBB", "source": "engine"}]},
    {"name": "Insurers", "holdings": [{"sym": "BRK.B", "source": "owner"}]},
]}
RANKS = [{"ticker": "AAA", "rs_rank": 97, "rs_score": 1.0, "returns": {}}, {"ticker": "BBB", "rs_rank": 55, "rs_score": 0.5, "returns": {}},
         {"ticker": "EEE", "rs_rank": 12, "rs_score": 0.1, "returns": {}}, {"ticker": "CCC", "rs_rank": 40, "rs_score": 0.3, "returns": {}}]
BOARD = {"ok": True, "window": "30 trading days", "days": 30, "counts": {}, "band_meta": {}, "warnings": None,
         "rows": [{"sym": "AAA", "dir": "BULL", "status": "BUILDING", "dpn": 5e8}, {"sym": "DDD", "dir": "BEAR", "status": "STEADY"},
                  {"sym": "CCC", "dir": "BULL", "status": "ESTABLISHED"}, {"sym": "BAD", "dir": "?", "status": "STEADY"}]}


def _ranking(**over):
    return {"status": "ok", "results": [dict(r) for r in STOCKS], "count": len(STOCKS), "start": 20251231, "end": 20261116,
            "as_of": "2026-11-17T10:30:00-05:00", "partial": False, "coverage": {"evaluated": 6, "answered": 6}, **over}


@pytest.fixture
def stores(monkeypatch):
    """The stored lists the service's grouping reads (the sector and industry map, the theme list), stood in for."""
    from api.services import theme_db
    monkeypatch.setattr(sp, "_sector_industry_map", lambda: SMAP)
    monkeypatch.setattr(theme_db, "get_all_themes", lambda: THEMES)


def _hold_ranking(name="ytd", answer=None, ttl=None):
    """Hold a ranking where the service's own build leaves it (`_period_remember`), under the key its warmer builds."""
    answer = _ranking() if answer is None else answer
    sp._period_remember(gd.range_key(name), answer, sp._TTL if ttl is None else ttl)
    return answer


def _hold_rs(rows=None):
    rs_ranking._rs_cache.set(rs_ranking._CACHE_KEY, RANKS if rows is None else rows, ttl=600)


def _hold_board(monkeypatch, board=None):
    """Fill the board's cache through the service's own writer (the compute stubbed), then make every compute raise."""
    monkeypatch.setattr(confluence_screen, "compute_board", lambda days: BOARD if board is None else board)
    confluence_screen._compute_and_cache(confluence_screen.DAYS)
    monkeypatch.setattr(confluence_screen, "compute_board", lambda days: (_ for _ in ()).throw(AssertionError("a board build was started")))


def test_the_ranges_kinds_sorts_and_words_are_the_services_and_the_grp_panels_own():
    assert tuple(sp.preset_ranges(TODAY)) == gd.RANGES
    js = (PANELS / "periodChangeModel.js").read_text(encoding="utf-8")
    block = js[js.index("export const PERIOD_RANGES = Object.freeze({"):js.index("export const DEFAULT_PERIOD_RANGE")]
    assert dict(re.findall(r"^  (\w+): Object\.freeze\(\{[^}]*words: '([^']+)'", block, flags=re.M)) == gd.RANGE_WORDS
    assert tuple(gd.RANGE_WORDS) == gd.RANGES
    assert re.search(r"^export const DEFAULT_PERIOD_RANGE = '(\w+)'$", js, flags=re.M).group(1) == gd.DEFAULT_RANGE
    grp = (PANELS / "groupDrillModel.js").read_text(encoding="utf-8")
    assert f"export const GROUP_KIND_ORDER = Object.freeze({list(gd.GROUP_KINDS)!r})" in grp
    kinds = grp[grp.index("export const GROUP_KINDS = Object.freeze({"):grp.index("export const GROUP_KIND_ORDER")]
    assert dict(re.findall(r"^  (\w+): Object\.freeze\(\{[^}]*one: '([^']+)'", kinds, flags=re.M)) == gd.KIND_WORDS
    sorts = grp[grp.index("export const GROUP_SORTS = Object.freeze({"):grp.index("export const DEFAULT_GROUP_SORT")]
    words = {(k, d): w for k, body in re.findall(r"^  (\w+): Object\.freeze\(\{([^}]*)\}\)", sorts, flags=re.M)
             for d, w in re.findall(r"(desc|asc): '([^']+)'", body)}
    assert words == gd.SORT_WORDS and tuple(dict.fromkeys(k for k, _ in words)) == gd.SORTS
    assert "export const DEFAULT_GROUP_SORT = Object.freeze({ key: 'pct', dir: 'desc' })" in grp
    assert int(sp._TTL) == 300 and int(sp._PERIOD_STALE_S) == 900 and confluence_screen.DAYS == 30


def test_the_ranking_is_read_under_the_very_keys_the_warmer_builds(monkeypatch):
    """⚠️ the coupling, railed: the seven keys this kind reads are the seven the service's own warmer builds today."""
    built = []
    monkeypatch.setattr(sp, "_period_build_bg", lambda ck, s, e, done: built.append(ck) or done.set())
    sp.warm_presets(TODAY)
    assert built == [gd.range_key(name) for name in gd.RANGES] and len(set(built)) == 7
    assert gd.range_key("ytd") == "scan_period_20251231_20261117"
    held = _hold_ranking("m3")
    assert gd.held_ranking("m3") == (held, "fresh") and gd.held_ranking("m6") == (None, "not_held")
    assert sp._period_answer(gd.range_key("m3")) is held             # the service's own reader finds what this kind reads


def test_period_groups_of_is_the_routes_own_grouping(monkeypatch, stores):
    """`get_period_change_groups` IS `period_groups_of` over `get_period_change`: one grouping, never a second."""
    for base in (_ranking(), {"status": "computing", "results": [], "count": 0, "as_of": None},
                 {"status": "unavailable", "results": [], "count": 0, "error": "too far back", "as_of": None}):
        monkeypatch.setattr(sp, "get_period_change", lambda a, b, base=base: base)
        for group in gd.GROUP_KINDS + ("country",):
            assert sp.get_period_change_groups(20251231, 20261117, group) == sp.period_groups_of(base, group)
    themes = {g["name"]: g["members"] for g in sp.period_groups_of(_ranking(), "theme")["results"]}
    # an engine-suggested holding is left out, a theme with none ranked is not sent, and a dot-form symbol joins
    assert themes == {"AI / GPU Chips": ["AAA", "DDD"], "Insurers": ["BRK-B"]}


def test_drill_lists_the_ranked_groups_a_name_is_resolved_against(stores, work):
    _hold_ranking()
    out = _read(gd.KIND, {})
    _conforms(out, gd.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert (d["mode"], d["range"], d["kind"], d["held"], d["start_day"], d["end_day"]) == ("groups", "ytd", None, "fresh", "2025-12-31", "2026-11-16")
    assert d["built_at"] == "2026-11-17T15:30:00Z" and gd.NOTE_TIME.format(at=d["built_at"]) in out["notes"]
    for kind in gd.GROUP_KINDS:                                        # the route's own groups: name, change, ranked stocks
        route = sp.period_groups_of(_ranking(), kind)["results"]
        assert _plain(d["lists"][kind]) == [{"name": g["name"], "pct": g["period_change"], "count": g["count"]} for g in route], kind
        assert set(d["lists"][kind][0]) - {"isolated"} == set(gd.GROUP_FIELDS)
    assert [g["name"] for g in d["lists"]["theme"]] == ["AI / GPU Chips", "Insurers"] and "Engine Only" not in json.dumps(out)
    assert _plain(d["counts"]) == {"sector": 3, "industry": 4, "theme": 2} and "members" not in json.dumps(out)
    assert gd.NOTE_LISTS.format(range="this year", start="2025-12-31", end="2026-11-16") in out["notes"]
    out = _read(gd.KIND, {"kind": "industry", "range": "ytd"})
    assert list(_plain(out["data"]["lists"])) == ["industry"] and out["data"]["kind"] == "industry"
    assert work == {"provider": 0, "threads": []}


def test_drill_joins_the_held_ranking_the_rs_ranks_and_the_board(monkeypatch, stores, work):
    _hold_ranking()
    _hold_rs()
    _hold_board(monkeypatch)
    out = _read(gd.KIND, {"kind": "sector", "group": " Technology "})
    _conforms(out, gd.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert (d["mode"], d["kind"], d["name"], d["found"], d["sort"], d["dir"]) == ("group", "sector", "Technology", True, "pct", "desc")
    tech = next(g for g in sp.period_groups_of(_ranking(), "sector")["results"] if g["name"] == "Technology")
    assert d["group_pct"] == tech["period_change"] and d["count"] == tech["count"] == 4
    assert [r["sym"] for r in d["rows"]] == ["AAA", "BBB", "DDD", "EEE"] and sorted(tech["members"]) == sorted(r["sym"] for r in d["rows"])
    assert set(d["rows"][0]) - {"isolated"} == set(gd.ROW_FIELDS)     # the documented fields only
    assert _plain(d["rows"][0]) == {"sym": "AAA", "pct": 30.0, "start_close": 100.0, "end_close": 130.0, "industry": "Semiconductors",
                                    "sector": "Technology", "rs": 97.0, "flow": {"dir": "BULL", "status": "BUILDING"}}
    ddd, eee = d["rows"][2], d["rows"][3]
    # a number that does not exist is null, never 0: DDD has no RS rank, EEE is not on the board; EEE's 0.0% is a real change
    assert ddd["rs"] is None and _plain(ddd["flow"]) == {"dir": "BEAR", "status": "STEADY"}
    assert (eee["pct"], eee["rs"], eee["flow"]) == (0.0, 12.0, None)
    assert (d["known"], d["ranked"], d["on_board"], d["shown"]) == (4, 3, 2, 4) and (d["rs_state"], d["flow_state"]) == ("held", "held")
    for note in (gd.NOTE_WHAT.format(kind="sector", name="Technology", range="this year", start="2025-12-31", end="2026-11-16"),
                 gd.NOTE_GROUP_PCT, gd.NOTE_RS, gd.NOTE_FLOW, gd.NOTE_TIME.format(at="2026-11-17T15:30:00Z")):
        assert note in out["notes"], note
    assert out["coverage"] == {"evaluated": 4, "answered": 4, "dropped": 0, "not_computable": 0}
    assert "dpn" not in json.dumps(out) and "volume" not in json.dumps(out) and "BAD" not in json.dumps(out)
    assert work == {"provider": 0, "threads": []}


def test_drill_a_themes_stocks_are_the_routes_own_with_engine_holdings_left_out(monkeypatch, stores):
    _hold_ranking()
    _hold_rs()
    _hold_board(monkeypatch)
    out = _read(gd.KIND, {"kind": "theme", "group": "AI / GPU Chips"})
    _conforms(out, gd.KIND)
    assert [r["sym"] for r in out["data"]["rows"]] == ["AAA", "DDD"]  # CCC is an engine suggestion, ZZZ is not ranked
    assert gd.NOTE_WHAT.format(kind="UCT theme", name="AI / GPU Chips", range="this year", start="2025-12-31", end="2026-11-16") in out["notes"]
    out = _read(gd.KIND, {"kind": "theme", "group": "Engine Only"})   # a theme with no curated ranked stock is not a group
    _conforms(out, gd.KIND)
    assert out["status"] == "ok" and out["data"]["found"] is False and out["data"]["rows"] == []
    assert gd.NOTE_NO_GROUP.format(kind="UCT theme", name="Engine Only", n=2) in out["notes"]
    out = _read(gd.KIND, {"kind": "sector", "group": "technology"})   # a name is given exactly as the ranking lists it
    assert out["data"]["found"] is False and out["data"]["group_pct"] is None and out["data"]["rs_state"] is None


def test_drill_orders_by_change_or_rs_with_a_missing_value_last_and_states_the_cut(monkeypatch, stores):
    _hold_ranking()
    _hold_rs()
    _hold_board(monkeypatch)
    syms = lambda **p: [r["sym"] for r in _read(gd.KIND, {"kind": "sector", "group": "Technology", **p})["data"]["rows"]]     # noqa: E731
    assert syms() == ["AAA", "BBB", "DDD", "EEE"]
    assert syms(dir="asc") == ["EEE", "DDD", "BBB", "AAA"]
    assert syms(sort="rs") == ["AAA", "BBB", "EEE", "DDD"]            # no RS rank: last, never ranked 0
    assert syms(sort="rs", dir="asc") == ["EEE", "BBB", "AAA", "DDD"]  # ... and last under the other direction too
    out = _read(gd.KIND, {"kind": "sector", "group": "Technology", "limit": 2, "sort": "rs"})
    _conforms(out, gd.KIND)
    assert [r["sym"] for r in out["data"]["rows"]] == ["AAA", "BBB"] and (out["data"]["count"], out["data"]["shown"]) == (4, 2)
    assert gd.NOTE_CUT.format(n=2, total=4, order="highest RS rank first") in out["notes"]
    assert out["coverage"] == {"evaluated": 4, "answered": 2, "dropped": 2, "not_computable": 0}
    assert (out["data"]["ranked"], out["data"]["on_board"]) == (3, 2)  # counted over every stock of the group, not the rows shown


def test_drill_rs_or_the_board_not_held_is_partial_and_neither_is_ever_rebuilt(monkeypatch, stores, work):
    _hold_ranking()
    started = []
    monkeypatch.setattr(rs_ranking, "kick_background_warm", lambda: started.append("rs") or True)
    monkeypatch.setattr(rs_ranking, "compute_rs_scores", lambda force=False: started.append("rs-compute") or [])
    monkeypatch.setattr(confluence_screen, "_build_background", lambda days: started.append("board"))
    monkeypatch.setattr(confluence_screen, "compute_board", lambda days: started.append("board-compute") or BOARD)
    out = _read(gd.KIND)
    _conforms(out, gd.KIND)
    d = out["data"]
    assert out["status"] == "partial" and (d["rs_state"], d["flow_state"], d["flow_built_at"]) == ("not_held", "not_held", None)
    assert all(r["rs"] is None and r["flow"] is None for r in d["rows"]) and (d["ranked"], d["on_board"]) == (0, 0)     # null, never 0
    assert gd.NOTE_RS_NOT_HELD in out["notes"] and gd.NOTE_FLOW_NOT_HELD in out["notes"]
    assert [r["sym"] for r in d["rows"]] == ["AAA", "BBB", "DDD", "EEE"]          # the group itself was read
    assert started == [] and work == {"provider": 0, "threads": []}
    # the member routes DO start that work in the same state (so the counts above can fail)
    assert confluence_screen.get_board()["ok"] is False and started == ["board"]
    rs_ranking._write_snapshot(RANKS)                                 # the last ranking on disk, by the service's own writer
    out = _read(gd.KIND)
    _conforms(out, gd.KIND)
    assert out["status"] == "partial" and out["stale"] is True and out["data"]["rs_state"] == "last_stored"
    assert gd.NOTE_RS_LAST_STORED in out["notes"] and [r["rs"] for r in out["data"]["rows"]] == [97.0, 55.0, None, 12.0]
    assert started == ["board"]
    _hold_rs()
    _hold_board(monkeypatch)
    confluence_screen._CACHES[confluence_screen.DAYS]["at"] = time.time() - confluence_screen._TTL - 5      # older than its refresh
    started.clear()
    monkeypatch.setattr(confluence_screen, "_build_background", lambda days: started.append("board"))
    out = _read(gd.KIND)
    _conforms(out, gd.KIND)
    assert out["status"] == "ok" and out["stale"] is True and gd.NOTE_FLOW_OLD.format(minutes=30) in out["notes"]
    assert out["data"]["rows"][0]["flow"] is not None and started == []
    assert confluence_screen.get_board()["ok"] is True and started == ["board"]    # the route refreshes an old board


def test_drill_a_ranking_not_held_is_unavailable_and_no_build_is_started(monkeypatch, stores, work):
    """Through the REAL service state with nothing held: the member route starts the whole-market build here; this read
    must not. The build is COUNTED, and the route's own reader is shown to start it in the same state."""
    built = []
    monkeypatch.setattr(sp, "_build_period_change", lambda ck, s, e: built.append(ck) or sp._period_remember(ck, _ranking(), sp._TTL))
    for params in ({}, {"kind": "sector", "group": "Technology"}, {"range": "m3"}):
        out = _read(gd.KIND, params)
        _conforms(out, gd.KIND)
        words = gd.RANGE_WORDS[params.get("range", "ytd")]
        assert out["status"] == "unavailable" and out["data"] is None
        assert out["notes"] == [gd.NOTE_NOT_HELD.format(range=words, minutes=5, extra=15)]
    assert built == [] and sp._period_inflight == {} and work == {"provider": 0, "threads": []}
    start, end = (int(p) for p in gd.range_key("ytd").split("_")[2:])
    assert sp.get_period_change(start, end)["status"] == "ok"         # the route does
    assert built == [gd.range_key("ytd")] and _builds(work) == ["period-build"]


def test_drill_a_ranking_that_is_not_a_list_is_unavailable_and_the_last_good_one_is_stale(monkeypatch, stores, work):
    for held in ({"status": "computing", "results": [], "count": 0, "as_of": None},
                 {"status": "error", "results": [], "count": 0, "error": "Couldn't load data for this period.", "as_of": None},
                 {"status": "ok", "results": None}):
        _forget_everything()
        _hold_ranking(answer=held, ttl=15)
        out = _read(gd.KIND)
        _conforms(out, gd.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [gd.NOTE_NOT_READY.format(range="this year")], held
    _forget_everything()
    clock = Clock()
    monkeypatch.setattr(sp, "_time", clock)
    _hold_ranking()
    cache.delete_prefix("scan_period_")                               # the shared cache lost it; the module's own copy is read
    assert _read(gd.KIND, {})["data"]["held"] == "fresh"
    clock.now += sp._TTL + 1                                          # past its freshness: the last good ranking
    cache.delete_prefix("scan_period_")
    out = _read(gd.KIND)
    _conforms(out, gd.KIND)
    assert out["status"] == "partial" and out["stale"] is True and out["data"]["held"] == "last_good"
    assert gd.NOTE_LAST_GOOD.format(minutes=5) in out["notes"] and "refreshing" not in json.dumps(out)
    assert sp._period_inflight == {} and work == {"provider": 0, "threads": []}
    _forget_everything()
    _hold_ranking(answer=_ranking(as_of=None, partial=True))          # no build time: unknown is never claimed fresh
    out = _read(gd.KIND, {})
    _conforms(out, gd.KIND)
    assert out["stale"] is True and gd.NOTE_NO_TIME in out["notes"] and gd.NOTE_PARTIAL_HISTORY in out["notes"]
    assert out["data"]["partial_history"] is True


def test_drill_a_stored_list_that_reads_empty_is_said_and_a_failing_service_is_unavailable(monkeypatch, stores):
    from api.services import theme_db
    _hold_ranking()
    monkeypatch.setattr(theme_db, "get_all_themes", lambda: (_ for _ in ()).throw(RuntimeError("theme store down")))
    out = _read(gd.KIND, {})
    _conforms(out, gd.KIND)
    assert out["status"] == "ok" and out["data"]["lists"]["theme"] == [] and gd.NOTE_NO_GROUPS.format(kind="UCT theme") in out["notes"]
    monkeypatch.setattr(sp, "period_groups_of", lambda base, kind: {"status": "error", "results": [], "error": "bad group"})
    assert _read(gd.KIND, {})["notes"] == [gd.NOTE_FAILED]

    def boom(name):
        raise RuntimeError("cache backend down at redis://internal")
    monkeypatch.setattr(gd, "held_ranking", boom)
    out = _read(gd.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [gd.NOTE_FAILED] and "redis" not in json.dumps(out)


def test_drill_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(gd, "held_ranking", lambda name: ran.append(name) or (None, "not_held"))
    for bad in ({"range": "5y"}, {"range": "YTD"}, {"kind": "country"}, {"group": "Technology"}, {"kind": "sector", "group": ""},
                {"kind": "sector", "group": "x" * (gd.MAX_NAME + 1)}, {"kind": "sector", "group": 7}, {"sort": "flow"},
                {"dir": "up"}, {"limit": 0}, {"limit": gd.MAX_LIMIT + 1}, {"limit": True}, {"limit": "5"}):
        assert _read(gd.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── the two datasets of the wave that get no kind ────────────────────────────────────────────────────────────────────
UNVOL = json.loads((REPO / "tests/fixtures/terminal_unvol_scan_requests.json").read_text(encoding="utf-8"))["requests"]
#: the one thing of the panel's scan the Agent's scan kind does not take: a raw snapshot column outside the catalog
UNVOL_PANEL_ONLY_COLUMN = "bars_asof"


def _agent_scan(body):
    """The UNVOL panel's body as the Agent's scan kind takes it: the same filters and order, without the raw column."""
    return {**body, "columns": [c for c in body["columns"] if c != UNVOL_PANEL_ONLY_COLUMN]}


def test_unusual_volume_needs_no_kind_the_screeners_scan_kind_already_takes_the_panels_scan():
    assert len(UNVOL) >= 6 and {r["mode"] for r in UNVOL} == {"now", "last"}
    for req in UNVOL:
        body = req["body"]
        checked = scan_spec.validate(_agent_scan(body))               # the Agent's own validator: accepted, nothing rewritten
        assert checked["filters"] == body["filters"] and checked["sort"] == body["sort"], req["name"]
        assert scan_sources.precheck({"spec": _agent_scan(body)}) is None, req["name"]
        # the panel's own column list is refused for exactly one reason, and it is said
        assert scan_sources.precheck({"spec": body}) == f"the Screener has no column {UNVOL_PANEL_ONLY_COLUMN!r}", req["name"]
    names = gw.registry().names()
    assert "screen.run" in names and gw.registry().get("screen.run").category == "scan"
    assert not [n for n in names if "volume" in n.lower() or "unvol" in n.lower()]      # no second authority for the reading
    doc = DOC.read_text(encoding="utf-8")
    assert "`screen.run`" in doc[doc.index("**Not kinds of this wave**"):doc.index("## 8. Changing this contract")]


def test_unusual_volume_runs_through_screen_run_from_the_screeners_own_store(tmp_path, monkeypatch, work):
    from api.services.screener import snapshot_db
    from tests.test_terminal_unusual_volume_scan import _NIGHTLY
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "unvol.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    monkeypatch.setenv(gw.KINDS_ENV, "screen.run")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    gw._reset_for_test(None)
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_NIGHTLY)
    body = next(r["body"] for r in UNVOL if r["name"] == "last_base")
    out = gw.read("screen.run", {"spec": _agent_scan(body)}, user_id=1, turn_id="w4-unvol", purpose="answer")
    assert env.validate_envelope(out) == [] and out["status"] in ("ok", "partial") and out["provider_calls"] == 0
    assert [r["symbol"] for r in out["data"]["rows"]] == ["HEAVY", "BUSY"]        # the floors keep the fund, the cheap and the thin out
    assert [r["vol_ratio"] for r in out["data"]["rows"]] == [6.2, 3.4] and out["as_of"] is not None
    assert work["provider"] == 0


def test_no_kind_reads_the_members_own_journal():
    """MYH is the member's private record: it is not a market-data kind, and no adapter of this wave reads it."""
    names = gw.registry().names()
    assert not [n for n in names if n.split(".")[0] in ("journal", "trades", "positions", "notebook", "member")]
    for m in MODULES:
        src = Path(m.__file__).read_text(encoding="utf-8")
        assert "journal" not in src.lower() and "j2_" not in src and "user_id" not in src.replace("ctx: dict", ""), m.KIND
    doc = DOC.read_text(encoding="utf-8")
    assert "MYH" in doc[doc.index("**Not kinds of this wave**"):doc.index("## 8. Changing this contract")]


# ── the budget rule, across the wave ─────────────────────────────────────────────────────────────────────────────────
def test_no_read_of_this_wave_touches_a_provider_client_or_starts_a_thread_held_or_not(monkeypatch, stores, work):
    reads = [(sn.KIND, {"date": DS}), (sn.KIND, {}), (sn.KIND, {"date": YESTERDAY, "session": "amc"}), (ct.KIND, {}),
             (ct.KIND, {"month": "2026-10", "list": "rising"}), (gd.KIND, {}), (gd.KIND, {"kind": "theme", "group": "AI / GPU Chips"}),
             (gd.KIND, {"range": "m1", "kind": "industry", "group": "Software", "sort": "rs"})]
    for kind, params in reads:                                        # nothing held anywhere
        out = _read(kind, params)
        _conforms(out, kind)
        assert out["status"] == "unavailable", (kind, params)
    assert work == {"provider": 0, "threads": []}
    _hold_day()
    _hold_day(_day_answer(ds=YESTERDAY, today=DS, moves=None, moves_state="not_held"), key=YESTERDAY)
    _hold_day(_day_answer(ds=TOMORROW, today=DS, moves=None, moves_state=None, default=True), key=es.NEXT_KEY)
    _hold_themes()
    for name in ("ytd", "m1"):
        _hold_ranking(name)
    for kind, params in reads:                                        # everything held, the RS ranking and the board still cold
        out = _read(kind, params)
        _conforms(out, kind)
        assert out["status"] in ("ok", "partial"), (kind, params, out["notes"])
    assert work == {"provider": 0, "threads": []} and es._inflight == {} and call_themes._inflight is None and sp._period_inflight == {}


# ── the contract (MD-1 v1.10 §4.13) ──────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_13_and_every_note_the_adapters_emit():
    """MD-1 §4.13 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = "### 4.13 Terminal data wave 4: `earnings.season`, `earnings.callThemes`, `group.drill` (v1.10, terminal-data)"
    assert head in doc                                    # the section, not the file's title: later bumps add
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section and f"- `{m.KIND}`: " in section, m.KIND      # its table row, and why it is isolated
    # default OFF, the isolation switch and the never-builds rule are stated where the kinds are documented
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or spends a provider call.**", "`earnings_season.held_day`",
              "`call_themes.held_themes`", "`scan_period.period_groups_of`", "**Not kinds of this wave**",
              # the transcript reasoning is the call search's own, said again where the new kind is documented
              "whose AI-processing right is unresolved", "`earnings.callSearch`"):
        assert s in section, s
    # wave 3's section still ends where this one begins
    assert doc.index("### 4.12 Terminal data wave 3") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 10
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.10 addition (2026-11-18, terminal-data, data wave 4):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.13 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.9 amendment (2026-11-17, terminal-data, Schwab retired):**")
    # the Status line carries the newest version, which later waves bump (v1.11 is data wave 5): v1.9's and v1.10's
    # notices are still said to be owed by a person and not acknowledged
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and "v1.9" in owed.group(1) and "v1.10" in owed.group(1)
    assert "- **`flow.summary`:** only through the existing flow proxy" in doc       # still deferred: no tape kind was added
