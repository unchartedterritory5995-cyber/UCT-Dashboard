"""Task 9: wave-1 notebook widgets end to end, through the real services.

A temp auth DB is seeded with the product's own write functions (manual trade, broker trade,
open position, watchlists). Only the market-data seams are patched: live prices, the reporting
window, implied move, bars, the regime read. No network, and nothing under the live data dir.

The route is driven through a TestClient, each payload is wrapped as a `widgetEmbed` and run
through the public reducer in share mode.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_widgets as nwr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as public

URL = "/api/j2/notebook-widgets/"
WAVE1 = ("myWatchlistToday", "myNamesReporting", "tickerCard", "myPnlStats", "myPositionsRisk")
WAVE2 = ("myRulesCheck", "myMistakes")
ACCOUNT = ("myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes")
QUERY = {"tickerCard": "?symbol=NVDA", "myPnlStats": "?from=2020-01-01&to=2099-12-31"}
NEUTRAL_ACCOUNT = public.ACCOUNT_NEUTRAL_LINE
NEUTRAL_MARKET = public.NEUTRAL_LINE


@pytest.fixture(autouse=True)
def _fresh_limiter():
    """The route's per-member limit (60/minute) is in-process limiter state: start each test clean."""
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


def _user(uid):
    return {"id": uid, "email": f"{uid}@example.test", "role": "member", "plan": "pro"}


def _client(uid):
    app = FastAPI()
    app.include_router(nwr.router)
    app.dependency_overrides[get_current_user] = lambda: _user(uid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: _user(uid)
    return TestClient(app)


@pytest.fixture
def env(monkeypatch, tmp_path):
    """A temp auth DB (also DATA_DIR, which member_interest reads) and every market seam patched."""
    from api.services import auth_db
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W2_ENABLED", "1")
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()

    import api.routers.live_prices as lp
    import api.services.bars_sqlite as bars
    import api.services.earnings_enrichment as ee
    import api.services.journal_two.earnings_prep as ep
    import api.services.journal_two.regime as regime

    def fake_prices(tickers=""):
        return {s: {"price": 120.0, "change_pct": 1.25} for s in tickers.split(",") if s}

    monkeypatch.setattr(lp, "get_live_prices", fake_prices)
    monkeypatch.setattr(bars, "get_bars", lambda sym, tf, n: [(i, 0, 0, 0, 100.0 + i, 0) for i in range(n)])
    monkeypatch.setattr(ee, "get_implied_move", lambda sym, d=None, t=None: {"pct": 6.5})
    monkeypatch.setattr(regime, "get_current_regime", lambda *a, **k: {"regime": "uptrend"})
    soon = {"items": [{"symbol": "NVDA", "date": "2026-10-21", "daysAway": 1, "timing": "amc",
                       "sources": ["watchlist"]}], "partial": False}
    monkeypatch.setattr(ep, "reporting_soon", lambda user_id, today=None: soon)
    monkeypatch.setattr(ep, "_window", lambda today: ({"NVDA": "2026-10-21"}, {"NVDA": "amc"}, False, None))
    # the ticker card's history is cached per (member, symbol) at module level
    monkeypatch.setattr(nw, "_HISTORY_CACHE", type(nw._HISTORY_CACHE)(max_size=10))
    return auth_db


def _seed_member(uid):
    """One broker trade, one manual trade (both closed), an open position with a placeholder stop,
    two watchlist names. Returns the ids that must never reach a public page."""
    from api.services import auth_db, watchlist_service
    from api.services.journal_two import positions, settings as j2_settings, trades

    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                     (uid, f"{uid}@example.test", "x"))
        conn.commit()
    finally:
        conn.close()
    cfg = j2_settings.get_settings(uid)
    d1 = (date.today() - timedelta(days=4)).isoformat()
    d2 = (date.today() - timedelta(days=2)).isoformat()
    trades.bulk_insert_trades(uid, [{
        "symbol": "AMD", "side": "Long", "shares": 10, "entryPrice": 100.0, "entryDate": d1,
        "exitPrice": 110.0, "exitDate": d2, "originalStop": 95.0, "externalId": "ext-1",
    }], cfg, source="broker")
    manual = trades.create_trade_manual(uid, {
        "symbol": "MSFT", "side": "Long", "shares": 5, "entryPrice": 200.0, "entryDate": d1,
        "exitPrice": 190.0, "exitDate": d2, "originalStop": 195.0,
    }, cfg)
    pos = positions.create_position(uid, {
        "symbol": "NVDA", "side": "Long", "shares": 20, "entryPrice": 100.0, "stopPrice": 95.0,
        "entryDate": d2,
    }, {})
    # create_position refuses a stop at or above entry for a Long, but a broker import stores exactly
    # that placeholder (stop == entry), so the row is set the way the import leaves it.
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_positions SET stop_price = entry_price WHERE id = ?", (pos["id"],))
        conn.commit()
    finally:
        conn.close()
    wl = watchlist_service.create_watchlist(uid, "Mine")
    watchlist_service.add_item(uid, wl["id"], "AAPL")
    watchlist_service.add_item(uid, wl["id"], "TSLA")

    conn = auth_db.get_connection()
    try:
        trade_ids = [r[0] for r in conn.execute("SELECT id FROM j2_trades WHERE user_id = ?", (uid,)).fetchall()]
    finally:
        conn.close()
    assert len(trade_ids) == 2 and manual["id"] in trade_ids
    return {"position_id": pos["id"], "trade_ids": trade_ids}


def _embed(kind, payload, *, share=None):
    params = dict(payload)
    if share is not None:
        params["share"] = share
    return {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": kind, "params": params, "mode": "snapshot",
        "capturedAt": payload.get("asOf"), "embedId": "e1"}}]}


def _reduce(doc):
    return public.reduce(doc, mode="share", owner_id="u-e2e", note_id="n1",
                         attachment_base="/api/notebook/shares/x/attachments/")


def _paragraph_texts(doc):
    return [n["content"][0]["text"] for n in doc["content"] if n.get("type") == "paragraph" and n.get("content")]


def _embeds(doc):
    return [n for n in doc["content"] if n.get("type") == "widgetEmbed"]


def _get(client, kind):
    r = client.get(URL + kind + QUERY.get(kind, ""))
    assert r.status_code == 200, (kind, r.status_code, r.text)
    return r.json()


def test_each_wave1_kind_builds_and_reduces(env):
    ids = _seed_member("u-e2e")
    client = _client("u-e2e")
    payloads = {k: _get(client, k) for k in WAVE1}

    # the seeds really reached the account payloads (an accidentally empty member would pass the rest)
    assert payloads["myPnlStats"]["tradeCount"] == 2
    assert payloads["myPnlStats"]["source"] == "mixed"
    rows = payloads["myPositionsRisk"]["rows"]
    assert len(rows) == 1 and rows[0]["positionId"] == ids["position_id"]
    assert rows[0]["noStop"] is True and rows[0]["distToStopPct"] is None
    assert [r["symbol"] for r in payloads["myWatchlistToday"]["rows"]] == ["AAPL", "TSLA"]
    assert payloads["myPositionsRisk"]["accountSizeSource"] == "default"
    assert payloads["myPositionsRisk"]["accountSize"] == 100000.0

    for kind in WAVE1:
        payload = payloads[kind]
        assert payload["asOf"] and payload["source"] in {"broker", "manual", "mixed", "market"}
        want = NEUTRAL_ACCOUNT if kind in ACCOUNT else NEUTRAL_MARKET
        # neutral without the switch
        off = _reduce(_embed(kind, payload))
        assert _paragraph_texts(off) == [want], kind
        assert not _embeds(off)
        # a non-boolean switch is not the switch
        assert _paragraph_texts(_reduce(_embed(kind, payload, share="true"))) == [want]

        on = _reduce(_embed(kind, payload, share=True))
        if kind in ACCOUNT:
            assert len(_embeds(on)) == 1, kind
            shown = json.dumps(on)
            assert ids["position_id"] not in shown
            for tid in ids["trade_ids"]:
                assert tid not in shown
            assert "positionId" not in shown
        else:
            # market kinds are neutral even with the switch on
            assert _paragraph_texts(on) == [NEUTRAL_MARKET], kind
            assert not _embeds(on)

    # the shown account embeds carry their figures
    pnl = _embeds(_reduce(_embed("myPnlStats", payloads["myPnlStats"], share=True)))[0]["attrs"]["params"]
    assert pnl["tradeCount"] == 2 and pnl["netPnl"] == payloads["myPnlStats"]["netPnl"]
    risk = _embeds(_reduce(_embed("myPositionsRisk", payloads["myPositionsRisk"], share=True)))[0]["attrs"]["params"]
    assert risk["rows"][0]["symbol"] == "NVDA" and "positionId" not in risk["rows"][0]
    assert risk["accountSizeSource"] == "default"


def test_new_member_no_data(env):
    client = _client("u-fresh")
    for kind in WAVE1:
        payload = _get(client, kind)
        assert payload["asOf"], kind
        if kind == "myPnlStats":
            assert payload["netPnl"] is None and payload["winRate"] is None and payload["avgR"] is None
            assert payload["tradeCount"] == 0 and payload["empty"]
            assert payload["equity"] == []
        if kind == "myPositionsRisk":
            assert payload["rows"] == [] and payload["empty"] == "No open positions."
            assert payload["accountSizeSource"] == "default" and payload["accountSize"] == 100000.0
        if kind == "myWatchlistToday":
            assert payload["rows"] == []
        if kind == "tickerCard":
            assert payload["history"] is None
        # nowhere does a P&L figure read 0.0 for "no data"
        for key in ("netPnl", "winRate", "avgR", "openPnl"):
            assert payload.get(key) != 0.0, (kind, key)
        for row in payload.get("rows") or []:
            assert row.get("openPnl") != 0.0, kind


def _seed_tagged_member(uid):
    """A member whose one closed manual loss carries a mistake tag, and nothing else."""
    from api.services import auth_db
    from api.services.journal_two import settings as j2_settings, trades

    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                     (uid, f"{uid}@example.test", "x"))
        conn.commit()
    finally:
        conn.close()
    cfg = j2_settings.get_settings(uid)
    d1 = (date.today() - timedelta(days=4)).isoformat()
    d2 = (date.today() - timedelta(days=2)).isoformat()
    made = trades.create_trade_manual(uid, {
        "symbol": "MSFT", "side": "Long", "shares": 5, "entryPrice": 200.0, "entryDate": d1,
        "exitPrice": 190.0, "exitDate": d2, "originalStop": 195.0, "mistakeTags": ["early_exit"],
    }, cfg)
    return made["id"]


def test_wave2_kinds_build_and_reduce(env):
    trade_id = _seed_tagged_member("u-e2e2")
    client = _client("u-e2e2")
    payloads = {k: _get(client, k) for k in WAVE2}

    # the seed reached the mistakes payload (an accidentally empty member would pass the rest)
    rows = payloads["myMistakes"]["rows"]
    assert [r["mistake"] for r in rows] == ["early_exit"], payloads["myMistakes"]
    assert rows[0]["countNow"] == 1 and rows[0]["trend"] == "more"
    # a trade with no adherence record has nothing to count: null headline, never 0 of 0
    assert payloads["myRulesCheck"]["kept"] is None and payloads["myRulesCheck"]["total"] is None
    assert payloads["myRulesCheck"]["empty"]

    for kind in WAVE2:
        payload = payloads[kind]
        assert payload["asOf"] and payload["source"] in {"broker", "manual", "mixed", "market"}
        off = _reduce(_embed(kind, payload))
        assert _paragraph_texts(off) == [NEUTRAL_ACCOUNT], kind
        assert not _embeds(off)
        assert _paragraph_texts(_reduce(_embed(kind, payload, share="true"))) == [NEUTRAL_ACCOUNT]
        on = _reduce(_embed(kind, payload, share=True))
        assert len(_embeds(on)) == 1, kind
        assert trade_id not in json.dumps(on)
    shown = _embeds(_reduce(_embed("myMistakes", payloads["myMistakes"], share=True)))[0]["attrs"]["params"]
    assert shown["rows"][0]["mistake"] == "early_exit"


def test_wave2_kinds_new_member_no_data(env):
    client = _client("u-fresh2")
    rules = _get(client, "myRulesCheck")
    assert rules["kept"] is None and rules["total"] is None and rules["rules"] == [] and rules["empty"]
    mistakes = _get(client, "myMistakes")
    assert mistakes["rows"] == [] and mistakes["empty"]


def test_wave2_routes_are_dark_without_their_flag(env, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W2_ENABLED")
    client = _client("u-dark2")
    for kind in WAVE2:
        assert client.get(URL + kind).status_code == 404, kind
    # control: wave 1 is still on
    assert client.get(URL + "myPnlStats").status_code == 200


WAVE3 = ("marketOnMyNames", "tickerFlow")


@pytest.fixture
def wave3(env, monkeypatch):
    """Wave 3 on, with its two market seams patched: the taxonomy sector and the page flow read."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W3_ENABLED", "1")
    import api.services.discord_render.symbols as symbols
    import api.services.flow_card_from_page as page
    import api.services.groups as groups

    sectors = {"AAPL": "Technology", "NVDA": "Technology", "TSLA": "Consumer"}
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda sym: {"sector_name": sectors[sym]} if sym in sectors else None)
    monkeypatch.setattr(symbols, "flow_source", lambda sym: "stocks")
    flow = {"ok": True, "symbol": "NVDA", "window": {"days_requested": "1"},
            "net": {"bull": 2, "bear": 1, "dir": "BULL"}, "contract_count": 1,
            "contracts": [{"cp": "C", "strike": 200.0, "exp": "11/20/2026", "dte": 31,
                           "premium": 250000, "volume": 900, "direction": "Bull"}]}
    monkeypatch.setattr(page, "page_derived_payload", lambda *a, **k: flow)
    return env


def test_wave3_kinds_build_and_stay_neutral_publicly(wave3):
    _seed_member("u-e2e3")
    client = _client("u-e2e3")
    names = _get(client, "marketOnMyNames")
    flow = client.get(URL + "tickerFlow?symbol=NVDA")
    assert flow.status_code == 200, flow.text
    flow = flow.json()

    # the seeded names (two watchlist names and the open position) reached the payload
    by = {r["symbol"]: r for r in names["rows"]}
    assert set(by) == {"AAPL", "NVDA", "TSLA"}, names
    assert by["NVDA"]["ret5d"] is not None and by["NVDA"]["sector"] == "Technology"
    assert by["NVDA"]["sectorRet5d"] is not None and by["TSLA"]["sectorRet5d"] is None
    assert names["sectorBasis"] == "your names"
    assert flow["symbol"] == "NVDA" and flow["topPrints"][0]["premium"] == 250000
    assert flow["bullPremium"] == 2 and flow["bearPremium"] == 1 and flow["window"] == "Today"
    assert "callPremium" not in flow and "ratio" not in flow

    for kind, payload in (("marketOnMyNames", names), ("tickerFlow", flow)):
        assert payload["asOf"] and payload["source"] == "market"
        for share in (None, False, True):
            out = _reduce(_embed(kind, payload, share=share))
            assert _paragraph_texts(out) == [NEUTRAL_MARKET], (kind, share)
            assert not _embeds(out)


def test_wave3_routes_are_dark_without_their_flag(wave3, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W3_ENABLED")
    client = _client("u-dark3")
    assert client.get(URL + "marketOnMyNames").status_code == 404
    assert client.get(URL + "tickerFlow?symbol=NVDA").status_code == 404
    # control: wave 1 is still on
    assert client.get(URL + "myWatchlistToday").status_code == 200


# -- wave 6 (Task 20) --------------------------------------------------------------------------

WAVE6_ACCOUNT = ("tradeRecap", "myPnlCalendar", "mySetupEdge")
WAVE6_MARKET = ("myScreenToday", "roomBuzzOnMyNames", "myEarningsReactions")
SCREEN_ID = "u:screen-1"


@pytest.fixture
def wave6(env, monkeypatch):
    """Wave 6 on, with its market seams patched: the recap's local bars, the saved screen and its sweep store,
    the room-buzz board, and the earnings calendar walk and figures. The member's own data is the real services'."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W6_ENABLED", "1")
    monkeypatch.setenv("BUZZ_CHANNELS", "main-chat")
    import api.routers.scan_results as scan_results
    import api.services.bars_sqlite as bars
    import api.services.buzz_store as buzz_store
    import api.services.calendar_alerts as calendar_alerts
    import api.services.earnings_estimates as estimates
    import api.services.scan_definition as scan_definition
    import api.services.screener.scan_store as scan_store
    import api.services.user_definitions as user_definitions

    def bars_before(sym, tf, n, to_key):
        start = date.today() - timedelta(days=40)
        return [(int((start + timedelta(days=i)).strftime("%Y%m%d")), 100.0, 101.0, 99.0, 100.0 + i, 0)
                for i in range(40)]

    monkeypatch.setattr(bars, "get_bars_before", bars_before)
    screen = {"def_id": SCREEN_ID, "definition": {"meta": {"name": "Tight flags"}}}
    monkeypatch.setattr(user_definitions, "get",
                        lambda uid, def_id, version=None: screen if def_id == SCREEN_ID else None)
    monkeypatch.setattr(scan_definition, "def_hash", lambda d: "hash-1")
    monkeypatch.setattr(scan_store, "latest_covered_as_of", lambda h, tf: 20261019)
    monkeypatch.setattr(scan_store, "coverage", lambda h, tf, as_of: {
        "evaluated": 10, "answered": 9, "dropped": 0, "not_computable": 1, "withheld": 0})
    monkeypatch.setattr(scan_results, "_hit_tickers", lambda h, tf, as_of, cap: (["NVDA"], False))
    monkeypatch.setattr(buzz_store, "board", lambda start, end, chans, limit=10: [
        {"ticker": "NVDA", "mentions": 5, "people": 3}, {"ticker": "ZZZZ", "mentions": 9, "people": 9}])
    reported = (date.today() - timedelta(days=2)).isoformat()
    monkeypatch.setattr(calendar_alerts, "collect_earnings_window", lambda start, days: ({"NVDA": reported}, False))
    monkeypatch.setattr(estimates, "get_year_earnings", lambda sym, fy: [{
        "date": reported, "quarter": 3, "eps_actual": 1.1, "eps_estimate": 1.0,
        "revenue_actual": 3.5e10, "revenue_estimate": 3.4e10}])
    from api.services.cache import cache
    real_get = cache.get
    # no reporting window held over from another test: that one key always misses
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: None if str(key).startswith(
        "notebook_widgets_reported_window") else real_get(key, *a, **k))
    return env


def _wave6_member(uid):
    ids = _seed_member(uid)
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        manual_id, exit_date = conn.execute(
            "SELECT id, exit_date FROM j2_trades WHERE user_id = ? AND symbol = 'MSFT'", (uid,)).fetchone()
    finally:
        conn.close()
    ids.update(manual_id=manual_id, month=str(exit_date)[:7])
    return ids


def _wave6_request(kind, ids):
    """The request key a stored node carries for `kind` (the client merges it into params at insert)."""
    return {"tradeRecap": {"tradeId": ids["manual_id"]}, "myPnlCalendar": {"month": ids["month"]},
            "myScreenToday": {"definitionId": SCREEN_ID}}.get(kind, {})


def test_wave6_kinds_build_and_reduce(wave6):
    ids = _wave6_member("u-e2e6")
    client = _client("u-e2e6")
    payloads = {}
    for kind in WAVE6_ACCOUNT + WAVE6_MARKET:
        r = client.get(URL + kind, params=_wave6_request(kind, ids))
        assert r.status_code == 200, (kind, r.status_code, r.text)
        payloads[kind] = r.json()

    # the seeds reached the payloads (an accidentally empty member would pass the privacy checks below)
    recap = payloads["tradeRecap"]
    assert recap["symbol"] == "MSFT" and recap["source"] == "manual" and recap["bars"], recap
    assert "tradeId" not in recap
    assert any(d["pnl"] is not None for d in payloads["myPnlCalendar"]["days"]), payloads["myPnlCalendar"]
    screen = payloads["myScreenToday"]
    assert screen["name"] == "Tight flags" and [h["symbol"] for h in screen["hits"]] == ["NVDA"]
    assert screen["coverage"] == {"evaluated": 10, "answered": 9, "dropped": 0, "notComputable": 1, "withheld": 0}
    assert [r["symbol"] for r in payloads["roomBuzzOnMyNames"]["rows"]] == ["NVDA"]      # the member's names only
    reactions = payloads["myEarningsReactions"]["rows"]
    assert [r["symbol"] for r in reactions] == ["NVDA"] and reactions[0]["epsActual"] == 1.1

    for kind in WAVE6_ACCOUNT:
        params = {**payloads[kind], **_wave6_request(kind, ids)}
        assert params["asOf"] and params["source"] in {"broker", "manual", "mixed", "market"}
        # neutral without the switch, and a non-boolean switch is not the switch
        for share in (None, "true", False):
            out = _reduce(_embed(kind, params, share=share))
            assert _paragraph_texts(out) == [NEUTRAL_ACCOUNT], (kind, share)
            assert not _embeds(out)
        on = _reduce(_embed(kind, params, share=True))
        assert len(_embeds(on)) == 1, kind
        shown = json.dumps(on)
        # the request key names one of the member's trades: it never leaves, nor does any trade or position id
        assert "tradeId" not in shown, kind
        for tid in ids["trade_ids"]:
            assert tid not in shown, kind
        assert ids["position_id"] not in shown
    # the shown recap carries its figures
    shown_recap = _embeds(_reduce(_embed("tradeRecap", {**recap, "tradeId": ids["manual_id"]}, share=True)))[0]
    assert shown_recap["attrs"]["params"]["symbol"] == "MSFT"
    assert shown_recap["attrs"]["params"]["pnl"] == recap["pnl"]

    for kind in WAVE6_MARKET:
        params = {**payloads[kind], **_wave6_request(kind, ids)}
        assert params["asOf"] and params["source"] == "market"
        for share in (None, False, True):
            out = _reduce(_embed(kind, params, share=share))
            assert _paragraph_texts(out) == [NEUTRAL_MARKET], (kind, share)
            assert not _embeds(out)
            assert SCREEN_ID not in json.dumps(out)


def test_wave6_trade_recap_is_own_scoped(wave6):
    ids = _wave6_member("u-e2e6a")
    _wave6_member("u-e2e6b")
    other = _client("u-e2e6b")
    # one member's trade id is "Trade not found" to another, the same sentence as an id that does not exist
    for tid in ids["trade_ids"] + ["no-such-trade"]:
        r = other.get(URL + "tradeRecap", params={"tradeId": tid})
        assert r.status_code == 400 and r.json()["detail"] == nw.TRADE_NOT_FOUND, (tid, r.text)
    # control: the owner reads it
    assert _client("u-e2e6a").get(URL + "tradeRecap", params={"tradeId": ids["manual_id"]}).status_code == 200


def test_wave6_routes_are_dark_without_their_flag(wave6, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W6_ENABLED")
    client = _client("u-dark6")
    for kind in WAVE6_ACCOUNT + WAVE6_MARKET:
        assert client.get(URL + kind).status_code == 404, kind
    # control: wave 1 is still on
    assert client.get(URL + "myWatchlistToday").status_code == 200
