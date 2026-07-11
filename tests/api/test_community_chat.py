# tests/api/test_community_chat.py
"""Live-chat store + card-redaction tests (The Floor v2)."""
import json

import pytest


_DOC = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"%s"}]}]}'


def _doc(text="hello"):
    return _DOC % text


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    # tighten limits so the burst test is fast/deterministic
    monkeypatch.setenv("CHAT_BURST_MAX", "3")
    monkeypatch.setenv("CHAT_BURST_WINDOW_SECS", "10")
    import importlib
    from api.services import community_store
    importlib.reload(community_store)   # pick up the env-tuned limits
    community_store._init_db()
    return community_store


def test_chat_tables_created(store):
    with store.get_connection() as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"messages", "message_reactions", "mentions",
            "chat_read_state", "chat_reports"} <= names


def test_channel_validation(store):
    assert store.is_valid_channel("trading-floor")
    assert store.is_valid_channel("board:trade-ideas")
    assert not store.is_valid_channel("board:nonsense")
    assert not store.is_valid_channel("typo")
    with pytest.raises(ValueError):
        store.create_message("typo", "u1", _doc())


def test_message_roundtrip_and_reactions(store):
    m1 = store.create_message("trading-floor", "u1", _doc("first"), ticker_tags=["NVDA"])
    store.create_message("trading-floor", "u2", _doc("second"),
                         reply_to_message_id=m1)
    store.toggle_message_reaction(m1, "u2", "fire")
    store.toggle_message_reaction(m1, "u3", "fire")
    msgs = store.list_messages("trading-floor")
    assert [m["id"] for m in msgs] == sorted(m["id"] for m in msgs)   # ascending
    assert msgs[0]["reactions"] == {"fire": 2}
    assert msgs[1]["reply_preview"]["id"] == m1
    # toggle off
    assert store.toggle_message_reaction(m1, "u2", "fire") is False
    assert store.list_messages("trading-floor")[0]["reactions"] == {"fire": 1}


def test_bad_reaction_kind(store):
    m = store.create_message("trading-floor", "u1", _doc())
    with pytest.raises(ValueError):
        store.toggle_message_reaction(m, "u2", "notakind")


def test_delete_blanks_body_and_card(store):
    mid = store.create_message("trading-floor", "u1", _doc("secret trade"),
                               card_json=json.dumps({"kind": "trade", "rMultiple": 2}))
    store.soft_delete_message(mid)
    m = store.get_message(mid)
    assert m["body"] == "" and m["card_json"] is None
    # deleted rows are still returned (tombstone) but blanked
    ms = store.list_messages("trading-floor")
    assert ms and ms[0]["deleted"] == 1 and ms[0]["body"] == ""


def test_edit_author_only(store):
    mid = store.create_message("trading-floor", "u1", _doc("v1"))
    with pytest.raises(ValueError):     # not the author
        store.edit_message(mid, "u2", _doc("hacked"))
    store.edit_message(mid, "u1", _doc("v2"))
    assert store.message_plaintext(store.get_message(mid)["body"]) == "v2"
    assert store.get_message(mid)["edited_at"] is not None


def test_rate_limit_burst(store):
    for _ in range(3):
        store.create_message("trading-floor", "flooder", _doc())
    with pytest.raises(store.ChatRateLimited):
        store.create_message("trading-floor", "flooder", _doc())
    # a mentor / system send bypasses the limit
    store.create_message("trading-floor", "flooder", _doc(), bypass_rate_limit=True)


def test_unread_caught_up_on_join(store):
    store.create_message("trading-floor", "u1", _doc())
    store.create_message("trading-floor", "u1", _doc())
    # never-opened channel reads 0 (not "everything unread")
    assert store.unread_by_channel("newbie")["trading-floor"] == 0
    store.ensure_caught_up("newbie", "trading-floor")
    assert store.unread_by_channel("newbie")["trading-floor"] == 0
    # new message after catching up counts; own messages excluded
    store.create_message("trading-floor", "u1", _doc())
    store.create_message("trading-floor", "newbie", _doc())  # own → excluded
    assert store.unread_by_channel("newbie")["trading-floor"] == 1


def test_mark_read_monotonic(store):
    m1 = store.create_message("trading-floor", "u1", _doc())
    m2 = store.create_message("trading-floor", "u1", _doc())
    store.mark_channel_read("reader", "trading-floor", m2)
    store.mark_channel_read("reader", "trading-floor", m1)   # stale — must not regress
    assert store.unread_by_channel("reader")["trading-floor"] == 0


def test_mentions_parsed_and_capped(store):
    body = ('{"type":"doc","content":[{"type":"paragraph","content":['
            '{"type":"userMention","attrs":{"userId":"u2"}},'
            '{"type":"userMention","attrs":{"userId":"u2"}},'
            '{"type":"userMention","attrs":{"userId":"u3"}}]}]}')
    parsed = store.parse_mentions_from_doc(body)
    assert parsed == ["u2", "u3"]   # deduped, order-preserved
    store.create_message("trading-floor", "u1", body, mention_user_ids=parsed)
    assert store.count_unseen_mentions("u2") == 1
    assert store.count_unseen_mentions("u3") == 1
    # self-mention is not delivered
    store.create_message("trading-floor", "u2", body, mention_user_ids=["u2"])
    assert store.count_unseen_mentions("u2") == 1
    store.mark_mentions_seen("u2")
    assert store.count_unseen_mentions("u2") == 0


def test_mentions_hidden_when_message_deleted(store):
    body = ('{"type":"doc","content":[{"type":"paragraph","content":['
            '{"type":"userMention","attrs":{"userId":"u2"}}]}]}')
    mid = store.create_message("trading-floor", "u1", body, mention_user_ids=["u2"])
    assert store.count_unseen_mentions("u2") == 1
    store.soft_delete_message(mid)
    assert store.count_unseen_mentions("u2") == 0        # moderated content doesn't resurface
    assert store.list_mentions("u2") == []


def test_report_snapshots_preview(store):
    mid = store.create_message("trading-floor", "abuser", _doc("original abusive text"))
    store.create_chat_report("reporter", mid, "spam")
    # abuser edits to sanitize — the report preview must keep the ORIGINAL
    store.edit_message(mid, "abuser", _doc("innocent now"))
    reports = store.list_chat_reports("open")
    assert reports[0]["preview"] == "original abusive text"
    store.set_chat_report_status(reports[0]["id"], "dismissed")
    assert store.list_chat_reports("open") == []


def test_reply_to_other_channel_dropped(store):
    other = store.create_message("board:trade-ideas", "u1", _doc())
    mid = store.create_message("trading-floor", "u2", _doc(), reply_to_message_id=other)
    assert store.get_message(mid)["reply_to_message_id"] is None   # cross-channel referent dropped


# ── Card redaction (server-authoritative) ────────────────────────────────────

def _fake_trade(uid, tid):
    return {"id": tid, "symbol": "nvda", "side": "Long", "result": "Win", "setup": "HTF",
            "rMultiple": 2.3, "pnlPercent": 0.12, "entryPrice": 100.5, "exitPrice": 112.1,
            "shares": 500, "pnlDollar": 5800, "pnlDollarNet": 5750, "originalShares": 500,
            "entryDate": "2026-07-01", "exitDate": "2026-07-02", "holdDays": 1, "tradeRef": "r1"}


def test_trade_card_never_leaks_size():
    from api.services import community_cards
    card = community_cards.build_card("trade", {"kind": "trade", "tradeId": "t1"},
                                      user_id="u1", load_trade=_fake_trade)
    blob = json.dumps(card)
    for leak in ("shares", "pnlDollar", "pnlDollarNet", "originalShares", "5800", "500"):
        assert leak not in blob, f"leaked {leak}"
    assert card["symbol"] == "NVDA" and card["rMultiple"] == 2.3


def test_chart_card_rejects_offorigin_url():
    from api.services import community_cards
    with pytest.raises(ValueError):
        community_cards.build_card("chart", {"kind": "chart", "ticker": "AAPL",
                                             "stateUrl": "https://evil.example/x"},
                                   user_id="u1", load_trade=_fake_trade)
    with pytest.raises(ValueError):   # bad snapshot path
        community_cards.build_card("chart", {"kind": "chart", "ticker": "AAPL",
                                             "snapshotUrl": "/etc/passwd"},
                                   user_id="u1", load_trade=_fake_trade)


def test_unknown_card_kind():
    from api.services import community_cards
    with pytest.raises(ValueError):
        community_cards.build_card("evil", {}, user_id="u1", load_trade=_fake_trade)
