"""Voice watchlist tools — single-step writes for flag/tag/list/alert."""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_watchlist_tools as vwt
from api.services import watchlist_service


def _user():
    init_db()
    return create_user(f"vwt_{uuid.uuid4()}@example.com", "p")["id"]


# ── Flag / unflag ──────────────────────────────────────────────────────────

def test_flag_ticker_adds_to_flagged_list():
    uid = _user()
    out = vwt.flag_ticker(symbol="NVDA", user_id=uid)
    assert out["ok"] is True
    assert "NVDA" in out["narration"]
    wl = watchlist_service.get_or_create_flagged_list(uid)
    syms = {i["sym"] for i in wl["items"]}
    assert "NVDA" in syms


def test_flag_ticker_idempotent():
    uid = _user()
    vwt.flag_ticker(symbol="AAPL", user_id=uid)
    out = vwt.flag_ticker(symbol="AAPL", user_id=uid)
    assert out["ok"] is True
    assert "already" in out["narration"].lower()
    wl = watchlist_service.get_or_create_flagged_list(uid)
    aapl_count = sum(1 for i in wl["items"] if i["sym"] == "AAPL")
    assert aapl_count == 1


def test_flag_ticker_rejects_empty_symbol():
    uid = _user()
    out = vwt.flag_ticker(symbol="", user_id=uid)
    assert out["ok"] is False


def test_unflag_removes_from_list():
    uid = _user()
    vwt.flag_ticker(symbol="TSLA", user_id=uid)
    out = vwt.unflag_ticker(symbol="TSLA", user_id=uid)
    assert out["ok"] is True
    wl = watchlist_service.get_or_create_flagged_list(uid)
    assert "TSLA" not in {i["sym"] for i in wl["items"]}


def test_unflag_when_not_flagged():
    uid = _user()
    out = vwt.unflag_ticker(symbol="NEVERFLAGGED", user_id=uid)
    assert out["ok"] is False


# ── Tag / untag ────────────────────────────────────────────────────────────

def test_tag_ticker_sets_color():
    uid = _user()
    out = vwt.tag_ticker(symbol="NVDA", color="gold", user_id=uid)
    assert out["ok"] is True
    assert out["color"] == "gold"


def test_tag_ticker_normalizes_alias():
    uid = _user()
    out = vwt.tag_ticker(symbol="NVDA", color="yellow", user_id=uid)
    assert out["ok"] is True
    assert out["color"] == "gold"


def test_tag_ticker_rejects_bad_color():
    uid = _user()
    out = vwt.tag_ticker(symbol="NVDA", color="rainbow", user_id=uid)
    assert out["ok"] is False
    assert "color" in out["narration"].lower() or "choose" in out["narration"].lower()


def test_untag_ticker_removes_tag():
    uid = _user()
    vwt.tag_ticker(symbol="MSFT", color="blue", user_id=uid)
    out = vwt.untag_ticker(symbol="MSFT", user_id=uid)
    assert out["ok"] is True


def test_list_my_tags_groups_by_color():
    uid = _user()
    vwt.tag_ticker(symbol="NVDA", color="gold", user_id=uid)
    vwt.tag_ticker(symbol="AMD", color="gold", user_id=uid)
    vwt.tag_ticker(symbol="MSFT", color="blue", user_id=uid)
    out = vwt.list_my_tags(user_id=uid)
    assert out["ok"] is True
    assert out["count"] == 3


# ── Watchlist add / remove / list ──────────────────────────────────────────

def test_add_to_watchlist_fuzzy_matches_name():
    uid = _user()
    wl = watchlist_service.create_watchlist(uid, name="My Tech Stocks")
    out = vwt.add_to_watchlist(symbol="NVDA", list_name="tech stocks", user_id=uid)
    assert out["ok"] is True
    refreshed = watchlist_service.get_watchlist(wl["id"], uid)
    syms = {i["sym"] for i in refreshed["items"]}
    assert "NVDA" in syms


def test_add_to_watchlist_unknown_list():
    uid = _user()
    out = vwt.add_to_watchlist(symbol="NVDA", list_name="Nonexistent", user_id=uid)
    assert out["ok"] is False
    assert "couldn't find" in out["narration"].lower() or "no" in out["narration"].lower()


def test_remove_from_watchlist():
    uid = _user()
    wl = watchlist_service.create_watchlist(uid, name="Energy")
    watchlist_service.add_item(uid, wl["id"], "XOM", "")
    out = vwt.remove_from_watchlist(symbol="XOM", list_name="Energy", user_id=uid)
    assert out["ok"] is True
    refreshed = watchlist_service.get_watchlist(wl["id"], uid)
    assert "XOM" not in {i["sym"] for i in refreshed["items"]}


def test_list_my_watchlists_empty():
    uid = _user()
    out = vwt.list_my_watchlists(user_id=uid)
    assert out["ok"] is True
    assert out["count"] == 0


def test_list_my_watchlists_reports_counts():
    uid = _user()
    wl_a = watchlist_service.create_watchlist(uid, name="A")
    wl_b = watchlist_service.create_watchlist(uid, name="B")
    watchlist_service.add_item(uid, wl_a["id"], "X", "")
    watchlist_service.add_item(uid, wl_a["id"], "Y", "")
    watchlist_service.add_item(uid, wl_b["id"], "Z", "")
    out = vwt.list_my_watchlists(user_id=uid)
    assert out["count"] == 2
    name_to_count = {s["name"]: s["count"] for s in out["lists"]}
    assert name_to_count["A"] == 2
    assert name_to_count["B"] == 1


# ── Price alerts ───────────────────────────────────────────────────────────

def test_set_price_alert_above():
    uid = _user()
    out = vwt.set_price_alert(
        symbol="NVDA", target_price=200, direction="above", user_id=uid,
    )
    assert out["ok"] is True
    assert out["direction"] == "above"
    assert out["target_price"] == 200


def test_set_price_alert_normalizes_direction_synonyms():
    uid = _user()
    out = vwt.set_price_alert(
        symbol="NVDA", target_price=200, direction="over", user_id=uid,
    )
    assert out["ok"] is True
    assert out["direction"] == "above"

    out2 = vwt.set_price_alert(
        symbol="NVDA", target_price=180, direction="under", user_id=uid,
    )
    assert out2["direction"] == "below"


def test_set_price_alert_rejects_bad_direction():
    uid = _user()
    out = vwt.set_price_alert(
        symbol="NVDA", target_price=200, direction="sideways", user_id=uid,
    )
    assert out["ok"] is False


def test_set_price_alert_rejects_nonpositive_price():
    uid = _user()
    out = vwt.set_price_alert(
        symbol="NVDA", target_price=-1, direction="above", user_id=uid,
    )
    assert out["ok"] is False


def test_list_my_alerts_empty():
    uid = _user()
    out = vwt.list_my_alerts(user_id=uid)
    assert out["ok"] is True
    assert out["count"] == 0


def test_cancel_alert_removes_most_recent():
    uid = _user()
    vwt.set_price_alert(symbol="NVDA", target_price=200, direction="above", user_id=uid)
    vwt.set_price_alert(symbol="NVDA", target_price=210, direction="above", user_id=uid)
    out = vwt.cancel_alert(symbol="NVDA", user_id=uid)
    assert out["ok"] is True
    remaining = vwt.list_my_alerts(user_id=uid)
    assert remaining["count"] == 1


def test_cancel_alert_no_match():
    uid = _user()
    out = vwt.cancel_alert(symbol="NVDA", user_id=uid)
    assert out["ok"] is False
