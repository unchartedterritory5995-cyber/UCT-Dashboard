"""RS screens unit U11: one service behind the five screens for every assistant.

`api/services/rs_screens_service.py` answers "who are the RS leaders today?" and "is
NVDA an RS leader?" for Compass. The property this suite exists for: THE ANSWER IS THE
SCREEN'S. So nothing here compares the service with a list typed in a test. The
application is built once, exactly as `tests/test_rs_screens_u6_e2e.py` builds it (real
nightly build, real rating pass, synthetic market), and each list is compared with what
`POST /api/screener/scan` answers the PAGE'S OWN captured request for the same screen
(`tests/fixtures/rs_screens_scan_requests.json`, written by the mounted Focus page).

What it has to be able to say red for:
  * a list whose tickers, order or total differ from the scan route's;
  * a quick-control choice laid over the spec differently from the page;
  * a word naming a choice that resolves to another choice, or to a guess;
  * a failure that raises instead of answering, or an answer while the screens are off;
  * a stock called "on" a screen whose list does not hold it (every ticker of the
    market, every screen), or the wrong first rule for UCT RS Leaders;
  * a filter, a starter id or a web framework typed into the service.
"""
from __future__ import annotations

import ast
import json
from contextlib import closing
from pathlib import Path

import pytest

from api.services import rs_screens_service as svc
from api.services.screener import query, rs_screens, rs_words, snapshot_db
from tests import rs_screens_e2e_universe as market
from tests import test_rs_screens_u6_e2e as e2e

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "api" / "services" / "rs_screens_service.py"
USER = {"id": "u1", "role": "member", "plan": "pro"}
#: The screen each starter id is asked for by. Typed here ON PURPOSE (the service reads
#: the id off the screen's definition; this is the independent statement it is held to).
SCREEN_OF = {"starter_rs_leaders": "leaders", "starter_rs_new_high": "new_highs",
             "starter_rs_nh_before_price": "before_price", "starter_rs_top_rating": "top_rating",
             "starter_rs_exit_warning_5": "exit_warnings"}
ROW_KEYS = {"ticker", "company", "rs_rank", "place", "setup", "tag", "group", "caption"}


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    """The application with the screens on, built once: the e2e suite's own build."""
    mp = pytest.MonkeyPatch()
    try:
        built = e2e._build(mp, tmp_path_factory.mktemp("rs_u11"), screens_on=True)
        client = e2e._client(mp)
        with closing(snapshot_db.connect()) as conn:
            table = {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM screener_rows")}
        starters = {s["id"]: s for s in client.get("/api/screener/saved-screens").json()["starters"]}
        yield {**built, "client": client, "table": table, "starters": starters, "mp": mp}
    finally:
        mp.undo()
        e2e._forget_caches()


@pytest.fixture(autouse=True)
def no_themes(monkeypatch):
    """A row's theme is read from the member database (the Watchlist's own read). This
    suite has none, so the read is stubbed empty: the group is the row's industry."""
    from api.services import theme_db
    monkeypatch.setattr(theme_db, "get_themes_for_ticker", lambda sym: [])


def _route(app, body, page_size=svc.MAX_LIMIT):
    r = app["client"].post("/api/screener/scan", json={**body, "page_size": page_size})
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _opening(starter_id):
    return next(r["body"] for r in e2e._requests() if r["starter"] == starter_id and not r["choices"])


def _canon(filters):
    return sorted(json.dumps(f, sort_keys=True) for f in filters)


# ───────────────────────── the list is the screen's ─────────────────────────

def test_the_five_names_stand_for_the_five_starters_by_their_own_definitions():
    assert {svc.starter_id(s): s for s in svc.SCREENS} == SCREEN_OF
    assert set(SCREEN_OF) == {s["id"] for s in rs_screens.screens()}
    assert svc.starter_id("not_a_screen") is None


@pytest.mark.parametrize("req", e2e._requests(), ids=e2e._req_id)
def test_each_request_the_page_makes_is_the_list_the_service_gives(app, req):
    """Every screen as it opens and with each quick-control option chosen: the same
    tickers in the same order as the scan route answers the page, the same total, and
    the same working spec the page built."""
    screen = SCREEN_OF[req["starter"]]
    body = req["body"]
    want = _route(app, body)
    out = svc.list_screen(screen, user=USER, limit=svc.MAX_LIMIT, option_ids=req["choices"])
    assert out["ok"] is True, out
    assert [r["ticker"] for r in out["rows"]] == [r["ticker"] for r in want["rows"]]
    assert out["total"] == want["total"]
    assert out["name"] == app["starters"][req["starter"]]["name"]
    # the working spec is the page's, clause for clause
    spec = svc.spec_with_choices(app["starters"][req["starter"]], req["choices"])
    assert _canon(spec["filters"]) == _canon(body["filters"])
    assert spec.get("rank") == body.get("rank") and spec["view"] == body["view"]
    if not body.get("rank"):
        # (a ranked screen is ordered by its rank: the page sends its editor's resting
        # sort beside it and the scan never reads it)
        assert spec.get("sort") == body.get("sort")
    for control, option in req["choices"].items():
        assert out["chosen"][control] == option


def test_every_screen_lists_something_and_says_when_its_ratings_are_from(app):
    for screen in svc.SCREENS:
        out = svc.list_screen(screen, user=USER)
        assert out["ok"] and len(out["rows"]) >= 3, (screen, out)
        assert out["asof"] == market.SESSION, screen
        assert out["note"].startswith(f"{rs_words.ratings_as_of(market.SESSION)}."), out["note"]
        assert out["note"].endswith(svc.WATCHLIST_NOTE)
        assert "watchlist" in out["note"] and "not advice" in out["note"]
        for r in out["rows"]:
            assert set(r) == ROW_KEYS, r
            assert r["rs_rank"] is None or type(r["rs_rank"]) is int


def test_a_row_is_worded_as_the_page_words_the_row_the_route_served(app):
    """The words are `rs_words`' (held equal to the page's by the cross-lane fixture),
    run on the very row the route serves the page."""
    for sid, screen in SCREEN_OF.items():
        starter = app["starters"][sid]
        cfg = rs_words.row_config(starter)
        served = _route(app, _opening(sid))["rows"]
        out = svc.list_screen(screen, user=USER, limit=svc.MAX_LIMIT)
        assert len(out["rows"]) == len(served) >= 3
        for i, (mine, row) in enumerate(zip(out["rows"], served)):
            shown = rs_words.row_display(row, cfg, index=i)
            assert (mine["place"], mine["caption"], mine["tag"]) == (
                shown["place"], shown["caption"], shown["tag"]), (sid, row["ticker"])
            assert mine["setup"] == rs_words.setup_words(row) and mine["rs_rank"] == row["rs_rank"]
            assert mine["group"] == row["industry"] and mine["company"] == row["company"]
    # and three rows read by a person, off the synthetic market
    leaders = svc.list_screen("leaders", user=USER, limit=3)["rows"]
    assert [(r["ticker"], r["place"], r["rs_rank"]) for r in leaders] == [
        ("RISE5", 1, 99), ("RISE4", 2, 96), ("RUN1", 3, 93)]
    assert leaders[2]["caption"] == "Extended · Drug makers" and leaders[2]["setup"] == "Extended"
    one_month = svc.list_screen("top_rating", user=USER, limit=svc.MAX_LIMIT, option_ids="1M")["rows"]
    baby = next(r for r in one_month if r["ticker"] == "BABY")
    assert baby["rs_rank"] is None and type(baby["place"]) is int and baby["tag"] == "New issue"
    places = [r["place"] for r in one_month]
    assert places == sorted(places), "the 1-month board is numbered by its own place column"


def test_the_group_is_the_theme_the_page_reads_else_the_industry(app, monkeypatch):
    """The page asks the Watchlist's theme read for each listed stock and prints the
    first theme it names (`POST /api/watchlists/themes-batch`); the service asks the
    same function. A stock with no theme, or a failed read, keeps its industry."""
    from api.services import theme_db

    def themes(sym):
        if sym == "RISE4":
            raise RuntimeError("member database is busy")
        return [{"theme_name": "AI chips"}, {"theme_name": "Second"}] if sym == "RISE5" else []

    monkeypatch.setattr(theme_db, "get_themes_for_ticker", themes)
    rows = {r["ticker"]: r for r in svc.list_screen("leaders", user=USER, limit=3)["rows"]}
    assert rows["RISE5"]["group"] == "AI chips" and rows["RISE5"]["caption"].endswith(" · AI chips")
    assert rows["RISE4"]["group"] == "Banks" and rows["RISE4"]["caption"].endswith(" · Banks")
    assert rows["RUN1"]["group"] == "Drug makers"
    # the route's own answer for the same stocks, through its handler
    from api.routers import watchlists
    served = watchlists.themes_batch(watchlists.ThemesBatchRequest(tickers=["RISE5", "RISE4", "RUN1"]), user=USER)
    assert served["results"] == {"RISE5": "AI chips", "RISE4": None, "RUN1": None}
    assert {t: svc._theme_of(t) for t in served["results"]} == served["results"]


def test_the_kept_list_says_how_many_it_holds_and_how_it_is_kept(app):
    """UCT RS Leaders keeps its own members (unit U12): the answer is the list the screen
    shows (no rank receipt), and the note says the rule in the screen's own two numbers."""
    out = svc.list_screen("leaders", user=USER, limit=2)
    route = _route(app, _opening("starter_rs_leaders"))
    assert route["rank"] is None and "qualify" not in out and "top_n" not in out
    assert out["total"] == route["total"] > 2
    assert len(out["rows"]) == 2 and f"Showing the first 2 of {out['total']}." in out["note"]
    assert (f"A stock joins in the top {rs_screens.LEADERS_TOP_N} of those that pass the rules and stays "
            f"until it falls past {rs_screens.LEADERS_HOLD_RANK}th.") in out["note"]
    other = svc.list_screen("new_highs", user=USER)
    assert "qualify" not in other and "A stock joins" not in other["note"]


def test_a_ranked_screen_says_its_top_n_and_how_many_qualify(app, monkeypatch):
    """None of the five ranks any more, and the service still answers a screen that does
    (the Leaders rules, ranked and cut to 2, stand in for one)."""
    _ranked_leaders(monkeypatch, top_n=2)
    out = svc.list_screen("leaders", user=USER, limit=1)
    assert (out["qualify"], out["top_n"]) == (len(_qualifiers(app)), 2)
    assert len(out["rows"]) == 1 and "A stock joins" not in out["note"]
    assert f"Showing the first 1 of the 2 listed; {out['qualify']} stocks pass the rules." in out["note"]


def test_the_limit_is_bounded_and_keeps_the_head_of_the_list(app):
    full = svc.list_screen("top_rating", user=USER, limit=svc.MAX_LIMIT)
    assert full["total"] > svc.DEFAULT_LIMIT, "the market must outgrow the default"
    tickers = [r["ticker"] for r in full["rows"]]
    assert len(svc.list_screen("top_rating", user=USER)["rows"]) == svc.DEFAULT_LIMIT
    for limit, n in ((3, 3), (0, 1), (-5, 1), (9999, min(svc.MAX_LIMIT, full["total"])),
                     ("7", 7), ("many", svc.DEFAULT_LIMIT), (None, svc.DEFAULT_LIMIT)):
        out = svc.list_screen("top_rating", user=USER, limit=limit)
        assert [r["ticker"] for r in out["rows"]] == tickers[:n], limit
        assert out["total"] == full["total"]
    three = svc.list_screen("top_rating", user=USER, limit=3)
    assert f"Showing the first 3 of {full['total']}" in three["note"]


def test_a_screen_is_named_by_its_own_names(app):
    for said, screen in (("leaders", "leaders"), ("UCT RS Leaders", "leaders"), ("starter_rs_leaders", "leaders"),
                         ("RSNHBP", "before_price"), ("blue dot", "before_price"),
                         ("rs new high before price", "before_price"), ("RS New Highs", "new_highs"),
                         ("new-highs", "new_highs"), ("Top RS Rating", "top_rating"),
                         ("RS exit warnings", "exit_warnings")):
        assert svc.list_screen(said, user=USER, limit=1)["screen"] == screen, said
    out = svc.list_screen("the good ones", user=USER)
    assert out["ok"] is False and "not one of the RS screens" in out["reason"]
    assert [s["screen"] for s in out["screens"]] == list(svc.SCREENS)
    assert [s["name"] for s in out["screens"]] == [app["starters"][svc.starter_id(k)]["name"] for k in svc.SCREENS]
    for blank in ("", None, "   "):
        assert svc.list_screen(blank, user=USER)["ok"] is False


# ───────────────────────── a choice named in words ─────────────────────────

def _body_for(starter_id, choices):
    return next(r["body"] for r in e2e._requests() if r["starter"] == starter_id and r["choices"] == choices)


@pytest.mark.parametrize("screen,said,choice", [
    ("new_highs", "today", {"when": "today"}),
    ("new_highs", "This month", {"when": "month"}),
    ("new_highs", "when=month", {"when": "month"}),
    ("new_highs", "When = Today", {"when": "today"}),
    ("new_highs", "90", {"min": "r90"}),
    ("new_highs", ["Down days only"], {"down": "down"}),
    ("new_highs", {"min": "r80"}, {"min": "r80"}),
    ("new_highs", {"Min RS Rating": "80"}, {"min": "r80"}),
    ("leaders", "near a buy point", {"show": "near"}),
    ("leaders", "Hide extended", {"show": "noext"}),
    ("leaders", "95", {"min": "r95"}),
    ("before_price", "10%", {"below": "p10"}),
    ("before_price", "this_month", {"when": "month"}),
    ("top_rating", "Rising fastest", {"rank_by": "rising"}),
    ("top_rating", "new to 90+", {"show": "new90"}),
    ("top_rating", "6M", {"rank_by": "m6"}),
    ("exit_warnings", "quicksand", {"type": "quicksand"}),
])
def test_a_choice_named_in_words_is_the_starter_s_own_option(app, screen, said, choice):
    sid = svc.starter_id(screen)
    out = svc.list_screen(screen, user=USER, limit=svc.MAX_LIMIT, option_ids=said)
    assert out["ok"] is True, out
    for control, option in choice.items():
        assert out["chosen"][control] == option
    want = _route(app, _body_for(sid, choice))
    assert [r["ticker"] for r in out["rows"]] == [r["ticker"] for r in want["rows"]]
    assert out["total"] == want["total"]


def test_two_choices_at_once_are_both_applied(app):
    out = svc.list_screen("new_highs", user=USER, limit=svc.MAX_LIMIT, option_ids="today, 90")
    assert out["chosen"] == {"when": "today", "min": "r90", "down": "all"}
    starter = app["starters"]["starter_rs_new_high"]
    spec = svc.spec_with_choices(starter, {"when": "today", "min": "r90"})
    want = _route(app, {**_opening("starter_rs_new_high"), "filters": spec["filters"]})
    assert [r["ticker"] for r in out["rows"]] == [r["ticker"] for r in want["rows"]] and out["rows"]
    week = svc.list_screen("new_highs", user=USER, limit=svc.MAX_LIMIT)
    assert set(r["ticker"] for r in out["rows"]) < set(r["ticker"] for r in week["rows"])
    # the starter served to the next caller is untouched
    assert app["starters"]["starter_rs_new_high"] == starter
    assert svc.list_screen("new_highs", user=USER, limit=svc.MAX_LIMIT) == week


def test_every_option_of_every_screen_is_reachable_by_its_label_and_by_its_id(app):
    for sid, screen in SCREEN_OF.items():
        starter = app["starters"][sid]
        for control in starter["controls"]:
            for option in control["options"]:
                for said in (option["id"], option["label"], f"{control['id']}={option['id']}",
                             f"{control['label']}={option['label']}"):
                    chosen, problems = svc.resolve_options(starter, said)
                    assert (chosen, problems) == ({control["id"]: option["id"]}, []), (sid, said)


def test_a_word_that_names_no_choice_is_refused_and_nothing_is_scanned(app, monkeypatch):
    ran = []
    real = query.run_scan
    monkeypatch.setattr(query, "run_scan", lambda *a, **k: ran.append(a) or real(*a, **k))
    for said in ("tomorrow", "when=tomorrow", "colour=today", ["today", "nope"]):
        out = svc.list_screen("new_highs", user=USER, option_ids=said)
        assert out["ok"] is False and "not a choice this screen offers" in out["reason"], said
        assert out["screen"] == "new_highs" and "rows" not in out
        assert [c["control"] for c in out["controls"]] == ["when", "min", "down"]
    assert ran == [], "a list was scanned for a choice that named nothing"
    assert svc.list_screen("new_highs", user=USER, option_ids="")["ok"] is True
    assert len(ran) == 1


def test_a_word_two_controls_share_must_name_its_control():
    starter = {"spec": {"filters": []}, "controls": [
        {"id": "a", "label": "First", "keys": ["x"], "options": [{"id": "all", "label": "All", "default": True},
                                                                 {"id": "hi", "label": "High"}]},
        {"id": "b", "label": "Second", "keys": ["y"], "options": [{"id": "all", "label": "All", "default": True},
                                                                  {"id": "lo", "label": "Low"}]}]}
    chosen, problems = svc.resolve_options(starter, "all")
    assert chosen == {} and len(problems) == 1 and "control=choice" in problems[0]
    assert svc.resolve_options(starter, "b=all") == ({"b": "all"}, [])
    assert svc.resolve_options(starter, "Second = ALL") == ({"b": "all"}, [])
    assert svc.resolve_options(starter, "high; low") == ({"a": "hi", "b": "lo"}, [])
    assert svc.resolve_options(starter, None) == ({}, [])


def test_an_option_replaces_every_clause_on_its_control_s_keys():
    """The contract's control semantics, on a starter small enough to read."""
    starter = {"spec": {"filters": [{"key": "p", "op": "gte", "min": 1}, {"key": "x", "op": "gte", "min": 5},
                                    {"key": "y", "op": "eq", "value": 1}],
                        "sort": {"key": "p", "dir": "asc"}, "view": "v"},
               "controls": [{"id": "c", "label": "C", "keys": ["x", "y"], "options": [
                   {"id": "d", "label": "D", "default": True,
                    "filters": [{"key": "x", "op": "gte", "min": 5}, {"key": "y", "op": "eq", "value": 1}]},
                   {"id": "none", "label": "None", "filters": []},
                   {"id": "one", "label": "One", "filters": [{"key": "y", "op": "eq", "value": 0}],
                    "sort": {"key": "y", "dir": "desc", "then": {"key": "p", "dir": "asc"}}}]}]}
    assert svc.spec_with_choices(starter, {})["filters"] == starter["spec"]["filters"]
    assert svc.spec_with_choices(starter, {"c": "none"})["filters"] == [{"key": "p", "op": "gte", "min": 1}]
    one = svc.spec_with_choices(starter, {"c": "one"})
    assert one["filters"] == [{"key": "p", "op": "gte", "min": 1}, {"key": "y", "op": "eq", "value": 0}]
    assert one["sort"] == {"key": "y", "dir": "desc", "then": {"key": "p", "dir": "asc"}}
    assert svc.spec_with_choices(starter, {"c": "none"})["sort"] == {"key": "p", "dir": "asc"}
    assert svc.spec_with_choices(starter, {"c": "gone"}) == svc.spec_with_choices(starter, {})
    one["filters"][0]["min"] = 99
    one["sort"]["then"]["dir"] = "desc"
    assert starter["spec"]["filters"][0]["min"] == 1, "the starter is never mutated"
    assert starter["controls"][0]["options"][2]["sort"]["then"]["dir"] == "asc"


# ───────────────────────── never raises, and off is off ─────────────────────────

def test_a_failure_answers_and_never_raises(app, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("database is locked")

    def refuse(*a, **k):
        raise ValueError("That field is not ready yet.")

    from api.services.screener import saved_screens
    with monkeypatch.context() as m:
        m.setattr(query, "run_scan", boom)
        assert svc.list_screen("leaders", user=USER) == {"ok": False, "reason": svc.COULD_NOT_READ}
        m.setattr(query, "run_scan", refuse)
        assert svc.list_screen("leaders", user=USER) == {"ok": False, "reason": "That field is not ready yet."}
        m.setattr(query, "rows_for", boom)
        assert svc.check_ticker("RISE5", user=USER) == {"ok": False, "reason": svc.COULD_NOT_READ}
        m.setattr(query, "rows_for", refuse)
        assert svc.check_ticker("RISE5", user=USER) == {"ok": False, "reason": "That field is not ready yet."}
        m.setattr(saved_screens, "starters", boom)
        assert svc.list_screen("leaders", user=USER) == {"ok": False, "reason": svc.COULD_NOT_READ}
        assert svc.check_ticker("RISE5", user=USER) == {"ok": False, "reason": svc.COULD_NOT_READ}
    # control: the same calls answer once the failures are lifted, with or without a user
    for user in (USER, None, {}, {"id": None}):
        assert svc.list_screen("leaders", user=user, limit=1)["ok"] is True, user
        assert svc.check_ticker("RISE5", user=user)["ok"] is True, user


def test_while_the_screens_are_off_both_answers_are_not_available_and_nothing_is_read(app, monkeypatch):
    read = []
    from api.services.screener import saved_screens
    for mod, fn in ((query, "run_scan"), (query, "rows_for"), (saved_screens, "starters")):
        monkeypatch.setattr(mod, fn, lambda *a, _fn=fn, **k: read.append(_fn))
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    off = {"ok": False, "reason": "not available"}
    assert svc.list_screen("leaders", user=USER) == off
    assert svc.check_ticker("RISE5", user=USER) == off
    monkeypatch.setenv("RS_SCREENS_ENABLED", "0")
    assert svc.list_screen("leaders", user=USER, option_ids="nope") == off
    assert read == [], "the screens are off and something was read"
    assert svc.NOT_AVAILABLE == "not available"


def test_the_gate_is_one_function_asked_with_the_user(app, monkeypatch):
    """Unit U10 turns the gate per user (`rs_post_pass.surfaces_on(user)`). The service
    asks ONE function, with the user, so that swap is one line."""
    asked = []
    monkeypatch.setattr(svc, "_screens_on", lambda user: asked.append(user) or False)
    assert svc.list_screen("leaders", user=USER)["reason"] == "not available"
    assert svc.check_ticker("RISE5", user=USER)["reason"] == "not available"
    assert asked == [USER, USER]
    src = SERVICE.read_text(encoding="utf-8")
    # swapped at integration (2026-11-14): the member-facing reader, in one place, and the
    # data reader nowhere (a member under the owner-only value must get "not available")
    assert src.count("rs_post_pass.surfaces_on(user)") == 1, "the gate is read in one place"
    assert "rs_post_pass.enabled()" not in src


def test_under_the_owner_only_value_a_member_is_told_not_available_and_an_admin_is_served(app, monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "admin")
    member = dict(USER, role="member")
    admin = dict(USER, role="admin")
    assert svc.list_screen("leaders", user=member) == {"ok": False, "reason": "not available"}
    assert svc.check_ticker("RISE5", user=member) == {"ok": False, "reason": "not available"}
    assert svc.available(member) is False and svc.available(None) is False
    assert svc.available(admin) is True
    assert svc.list_screen("leaders", user=admin)["ok"] is True


def test_a_pod_whose_rs_columns_are_dark_is_not_available(app, monkeypatch):
    """RS_SCREENS_ENABLED on, RS_V2 off: the starters are not served, so there is no
    screen to list."""
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    assert svc.list_screen("leaders", user=USER) == {"ok": False, "reason": "not available"}
    assert svc.check_ticker("RISE5", user=USER) == {"ok": False, "reason": "not available"}


# ───────────────────────── one stock against the five ─────────────────────────

def _full_lists(app) -> dict:
    """Every ticker each screen lists as it opens, asked of the scan route."""
    out = {}
    for sid, screen in SCREEN_OF.items():
        rows = _route(app, _opening(sid), page_size=500)["rows"]
        out[screen] = [r["ticker"] for r in rows]
    return out


def test_a_stock_is_on_exactly_the_screens_whose_lists_hold_it(app):
    """Every ticker of the market against every screen: `on` is the scan's own answer.
    This is what holds `clause_passes` to `query.build_where`."""
    lists = _full_lists(app)
    assert all(len(v) >= 3 for v in lists.values())
    seen_on = 0
    for ticker in sorted(app["table"]):
        out = svc.check_ticker(ticker, user=USER)
        assert out["ok"] is True, (ticker, out)
        assert [s["screen"] for s in out["screens"]] == list(svc.SCREENS)
        for s in out["screens"]:
            assert s["on"] is (ticker in lists[s["screen"]]), (ticker, s)
            seen_on += s["on"]
        names = [app["starters"][svc.starter_id(k)]["name"] for k in svc.SCREENS if ticker in lists[k]]
        assert out["on"] == names, ticker
    assert seen_on == sum(len(v) for v in lists.values())


def _qualifiers(app) -> list:
    """The stocks that pass UCT RS Leaders' rules (its filters without the membership
    clause), strongest first: asked of the scan route, never of the service."""
    spec = app["starters"]["starter_rs_leaders"]["spec"]
    rules = [f for f in spec["filters"] if f["key"] != rs_screens.LEADERS_MEMBER_KEY]
    rows = _route(app, {"filters": rules, "sort": spec["sort"], "columns": ["ticker"]}, page_size=500)["rows"]
    return [r["ticker"] for r in rows]


def _ranked_leaders(monkeypatch, top_n):
    """Serve UCT RS Leaders as a RANKED screen cut to ``top_n`` (what it was before unit
    U12): its rules without the membership clause, no kept list."""
    from api.services.screener import saved_screens
    real = saved_screens.starters

    def ranked(user=None):
        out = []
        for s in real(user):
            if s["id"] == "starter_rs_leaders":
                spec = {k: v for k, v in s["spec"].items() if k != "sort"}
                spec["filters"] = [f for f in spec["filters"] if f["key"] != rs_screens.LEADERS_MEMBER_KEY]
                spec["rank"] = {"criteria": [{"key": rs_screens.LEADERS_ORDER_KEY, "weight": 1}], "top_n": top_n}
                s = {**s, "spec": spec, "row": {k: v for k, v in s["row"].items() if k != "steady"}}
            out.append(s)
        return out

    monkeypatch.setattr(saved_screens, "starters", ranked)


def test_a_leader_is_placed_where_the_list_shows_it(app):
    leaders = _full_lists(app)["leaders"]
    assert len(leaders) >= 3
    for i, ticker in enumerate(leaders):
        item = svc.check_ticker(ticker, user=USER)["screens"][0]
        assert (item["screen"], item["on"], item["place"], item["of"]) == ("leaders", True, i + 1, len(leaders))
        assert "misses" not in item and "why" not in item and "rank" not in item
    out = svc.check_ticker(" $rise5 ", user=USER)
    assert (out["ticker"], out["company"], out["rs_rank"], out["asof"]) == ("RISE5", "RISE5 Corp", 99, market.SESSION)
    assert out["on"] == ["UCT RS Leaders", "RS New Highs", "Top RS Rating"] and out["stale"] is False
    assert out["note"] == f"Ratings as of {rs_words.short_day(market.SESSION)}. {svc.WATCHLIST_NOTE}"


def test_the_first_rule_a_stock_misses_for_rs_leaders_is_named(app):
    """For every stock not on UCT RS Leaders: the rule named is the FIRST of the
    starter's own clauses the independent oracle (written from the contract, in the
    e2e suite) says it misses, with the value the row holds."""
    # the membership clause is the list's answer, never a rule a stock misses (unit U12)
    filters_ = [f for f in app["starters"]["starter_rs_leaders"]["spec"]["filters"]
                if f["key"] != rs_screens.LEADERS_MEMBER_KEY]
    leaders = _full_lists(app)["leaders"]
    missed_keys = set()
    for ticker, row in sorted(app["table"].items()):
        if ticker in leaders:
            continue
        item = svc.check_ticker(ticker, user=USER)["screens"][0]
        first = next((f for f in filters_ if not e2e._passes(row, f)), None)
        assert first is not None, f"{ticker} passes every rule and is not listed"
        assert item["misses"]["key"] != rs_screens.LEADERS_MEMBER_KEY
        assert item["on"] is False and item["misses"]["key"] == first["key"], (ticker, item)
        assert item["misses"]["label"] == rs_words.rule_label(first["key"])
        assert item["misses"]["text"].startswith(f"{item['misses']['label']}: "), item
        missed_keys.add(first["key"])
    assert len(missed_keys) >= 4, f"the market misses too few different rules: {missed_keys}"
    # read by a person
    says = {t: svc.check_ticker(t, user=USER)["screens"][0]["misses"]["text"] for t in ("DEAL", "FUND", "THIN", "BABY")}
    assert says == {"DEAL": "RS Rank: needs at least 80, has 68",
                    "FUND": "Type: must not be ETF, has ETF",
                    "THIN": "Dollar Volume (30d): needs at least 20,000,000, has 135,100",
                    "BABY": "RS Rank: needs at least 80, has no value"}
    # only UCT RS Leaders names a rule
    for t in ("DEAL", "BABY"):
        assert ["misses" in s for s in svc.check_ticker(t, user=USER)["screens"]] == [True, False, False, False, False]


def test_a_rule_is_said_in_plain_words():
    row = {"adr_pct": 2.125, "sma200_rising": 0, "rs_flag": "buyout_pending", "rs_setup": "extended",
           "pct_vs_sma200": -3.5, "market_cap": 250_000_000.0, "rs_nh_bars_ago": 9}
    say = lambda clause: svc.rule_words(clause, row)["text"]          # noqa: E731
    assert say({"key": "adr_pct", "op": "gte", "min": 3}) == "Avg daily range: needs at least 3, has 2.12"
    assert say({"key": "sma200_rising", "op": "eq", "value": 1}) == "SMA200 Rising: needs yes, has no"
    assert say({"key": "rs_flag", "op": "not_in", "values": ["buyout_pending"]}) == (
        "Setup flag: must not be Buyout pending, has Buyout pending")
    assert say({"key": "rs_setup", "op": "not_in", "values": ["extended", "below_50"]}) == (
        "Setup: must not be Extended, Below its 50-day line, has Extended")
    assert say({"key": "pct_vs_sma200", "op": "gt", "min": 0}) == "vs 200-day avg: needs more than 0, has -3.5"
    assert say({"key": "market_cap", "op": "gte", "min": 300_000_000}) == (
        "Market Cap: needs at least 300,000,000, has 250,000,000")
    assert say({"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 4}).endswith(
        "needs between 0 and 4, has 9")
    for text in map(say, ({"key": "adr_pct", "op": "gte", "min": 3}, {"key": "sma200_rising", "op": "eq", "value": 1})):
        assert "ADR" not in text and "buy" not in text.lower() and "sell" not in text.lower()


def test_a_rule_is_judged_the_way_the_scan_judges_it():
    """Blank fails a comparison and passes an exclude list (`query.build_where`); what one
    row cannot settle is None, never a pass."""
    ok = svc.clause_passes
    assert ok({"key": "rs_rank", "op": "gte", "min": 80}, {"rs_rank": 80}) is True
    assert ok({"key": "rs_rank", "op": "gte", "min": 80}, {"rs_rank": 79}) is False
    assert ok({"key": "rs_rank", "op": "gte", "min": 80}, {"rs_rank": None}) is False
    assert ok({"key": "pct_vs_sma200", "op": "gt", "min": 0}, {"pct_vs_sma200": 0}) is False
    assert ok({"key": "rs_rating_prev20", "op": "lt", "max": 90}, {"rs_rating_prev20": 89}) is True
    assert ok({"key": "rs_rating_prev20", "op": "lt", "max": 90}, {"rs_rating_prev20": 90}) is False
    assert ok({"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 4}, {"rs_nh_bars_ago": 4}) is True
    assert ok({"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 4}, {"rs_nh_bars_ago": 5}) is False
    assert ok({"key": "rs_nh_bars_ago", "op": "between", "min": 0, "max": 4}, {}) is False
    assert ok({"key": "sma200_rising", "op": "eq", "value": 1}, {"sma200_rising": 1}) is True
    assert ok({"key": "sma200_rising", "op": "eq", "value": 1}, {"sma200_rising": 0}) is False
    assert ok({"key": "sma200_rising", "op": "eq", "value": 1}, {"sma200_rising": None}) is False
    assert ok({"key": "rs_flag", "op": "not_in", "values": ["buyout_pending"]}, {"rs_flag": None}) is True
    assert ok({"key": "rs_flag", "op": "not_in", "values": ["buyout_pending"]}, {"rs_flag": "new_issue"}) is True
    assert ok({"key": "rs_flag", "op": "not_in", "values": ["buyout_pending"]}, {"rs_flag": "buyout_pending"}) is False
    assert ok({"key": "rs_exit_last", "op": "eq", "value": "Quicksand"}, {"rs_exit_last": "Quicksand"}) is True
    # what one row cannot settle
    assert ok({"key": "universe", "op": "in", "values": ["uct"]}, {}) is None
    assert ok({"key": "not_a_key", "op": "gte", "min": 1}, {"not_a_key": 5}) is None
    assert ok({"key": "rs_rank", "op": "gte"}, {"rs_rank": 99}) is None
    assert ok({"key": "rs_rank", "op": "gt_col", "other": "rs_rating_ibd"}, {"rs_rank": 99}) is None
    assert ok({"key": "rs_flag", "op": "not_in", "values": []}, {"rs_flag": None}) is None


def test_every_rule_of_the_five_is_one_the_check_can_judge(app):
    """So `on` is never "cannot say" for the five: a new operator or a pooled rule added
    to a screen turns this red before it turns an answer into a shrug."""
    row = app["table"]["RISE5"]
    for sid in SCREEN_OF:
        starter = app["starters"][sid]
        clauses = list(starter["spec"]["filters"]) + [f for c in starter["controls"] for o in c["options"]
                                                      for f in o["filters"]]
        for f in clauses:
            assert svc.clause_passes(f, row) in (True, False), (sid, f)
        assert not starter["spec"].get("logic")


def test_a_stock_the_screener_does_not_hold_and_a_word_that_is_no_ticker(app, monkeypatch):
    from api.routers import screener as route
    assert svc.NO_SUCH_STOCK == route.NO_SUCH_STOCK
    assert svc.check_ticker("ZZZZ", user=USER) == {"ok": False, "reason": svc.NO_SUCH_STOCK, "ticker": "ZZZZ"}
    asked = []
    real = query.rows_for
    monkeypatch.setattr(query, "rows_for", lambda *a, **k: asked.append(a) or real(*a, **k))
    for bad in ("", None, "NV DA", "RISE5,RUN1", "!!", "waytoolongtobeaticker"):
        assert svc.check_ticker(bad, user=USER) == {"ok": False, "reason": svc.NOT_A_TICKER}, bad
    assert asked == []


def test_a_stock_whose_bars_stopped_is_on_no_screen_and_the_answer_says_so(app, monkeypatch):
    real = query.rows_for

    def stale(tickers, columns, user=None):
        return {t: {**hit, "stale": True} for t, hit in real(tickers, columns, user=user).items()}

    assert svc.check_ticker("RISE5", user=USER)["on"]
    monkeypatch.setattr(query, "rows_for", stale)
    out = svc.check_ticker("RISE5", user=USER)
    assert out["ok"] and out["stale"] is True and out["on"] == []
    assert [s["on"] for s in out["screens"]] == [False] * 5
    assert svc.STALE_NOTE in out["note"] and out["note"].endswith(svc.WATCHLIST_NOTE)


def _off_the_list(ticker):
    """Take one stock off the kept list in the table, as a pass that did not list it
    leaves the row (member 0, no day count)."""
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute("UPDATE screener_rows SET rs_leaders_member = 0, rs_leaders_days = NULL WHERE ticker = ?",
                     (ticker,))
        conn.commit()


def test_a_stock_that_passes_every_rule_and_is_not_on_the_kept_list_is_told_its_rank(app):
    """UCT RS Leaders keeps its own members (unit U12). A stock that passes every rule and
    is not a member is not on the list, misses NO rule, and hears its rank among the
    stocks that pass, with the page's own sentence."""
    qualifiers = _qualifiers(app)
    leaders = _full_lists(app)["leaders"]
    assert leaders == qualifiers, "in this small market every qualifier is listed"
    name = leaders[2]
    with closing(snapshot_db.connect()) as conn:
        before = dict(conn.execute("SELECT rs_leaders_member, rs_leaders_days FROM screener_rows WHERE ticker = ?",
                                   (name,)).fetchone())
    try:
        _off_the_list(name)
        out = svc.check_ticker(name, user=USER)
        item = out["screens"][0]
        assert item["on"] is False and "misses" not in item and item["place"] is None
        assert (item["rank"], item["of"]) == (3, len(qualifiers))
        assert item["why"] == ("Passes every rule; ranked 3rd, the list holds the top 50 "
                               "(a listed stock stays until it falls past 65th).")
        assert "UCT RS Leaders" not in out["on"]
        # the others close ranks on the list the screen shows
        assert svc.check_ticker(leaders[3], user=USER)["screens"][0]["place"] == 3
        assert svc.check_ticker(leaders[3], user=USER)["screens"][0]["of"] == len(leaders) - 1
    finally:
        with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
            conn.execute("UPDATE screener_rows SET rs_leaders_member = ?, rs_leaders_days = ? WHERE ticker = ?",
                         (before["rs_leaders_member"], before["rs_leaders_days"], name))
            conn.commit()
    assert svc.check_ticker(name, user=USER)["screens"][0]["on"] is True


def test_the_kept_list_sentence_is_the_page_s():
    """`whyNot.whyNotHeadline` in the page says the same words; the numbers are the starter's."""
    steady = {"key": "k", "by": "b", "enter": 50, "hold": 65}
    assert svc.steady_words(steady, 58) == (
        "Passes every rule; ranked 58th, the list holds the top 50 (a listed stock stays until it falls past 65th).")
    assert svc.steady_words(steady, None) == (
        "Passes every rule and is not on the list today: the list holds the top 50 "
        "(a listed stock stays until it falls past 65th).")
    assert [svc._ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 63, 101, 111, 1002)] == [
        "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "63rd", "101st", "111th", "1,002nd"]
    page = (ROOT / "app" / "src" / "pages" / "screener" / "focus" / "whyNot.js").read_text(encoding="utf-8")
    for words in ("Passes every rule; ranked ${ordinal(position)}, ${kept}.",
                  "the list holds the top ${steady.enter.toLocaleString('en-US')} (a listed stock stays until it "
                  "falls past ${ordinal(steady.hold)})"):
        assert words in page, words


def test_a_qualifier_outside_the_top_n_is_not_on_the_list_and_is_told_why(app, monkeypatch):
    """A RANKED screen lists its top N (none of the five does since unit U12; the Leaders
    rules ranked and cut to 2 stand in for one). The third qualifier passes every rule
    and is not on the list."""
    _ranked_leaders(monkeypatch, top_n=2)
    listed = [r["ticker"] for r in svc.list_screen("leaders", user=USER)["rows"]]
    assert listed == ["RISE5", "RISE4"]
    third = svc.check_ticker("RUN1", user=USER)["screens"][0]
    assert third["on"] is False and third["place"] is None and "misses" not in third
    assert third["why"] == "Passes every rule, but the list shows the top 2 by RS Rating."
    assert svc.check_ticker("RISE4", user=USER)["screens"][0]["place"] == 2


# ───────────────────────── what the module may not contain ─────────────────────────

def test_the_service_types_no_rule_no_starter_id_and_no_web_framework():
    src = SERVICE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
    banned = [m for m in imported if m.split(".")[0] in ("fastapi", "starlette", "pydantic", "flask")
              or m.startswith("api.routers")]
    assert banned == [], banned
    literals = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "rs_rank" in literals, "control: the walk reads this module's string literals"
    assert not [x for x in literals if x.startswith("starter_")], "a starter id is typed in the service"
    # a typed rule would be a dict literal carrying an operator
    typed = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, ast.Dict)
             and any(isinstance(k, ast.Constant) and k.value == "op" for k in n.keys)]
    assert typed == [], typed
    names = {s["name"] for s in rs_screens.screens()}
    assert not (literals & names), "a screen's name is typed in the service"
    for label in ("Near a buy point", "Hide extended", "This week", "Down days only"):
        assert label not in src


def test_the_service_never_says_a_trade_word():
    """Member-facing copy rules (BRIEF-COMMON): no trade words that read as advice."""
    for text in (svc.WATCHLIST_NOTE, svc.STALE_NOTE, svc.NOT_A_TICKER, svc.COULD_NOT_READ, svc.NO_SUCH_STOCK):
        low = f" {text.lower()} "
        assert not [w for w in (" buy ", " sell ", "buyable", " rsi ", "—") if w in low], text
