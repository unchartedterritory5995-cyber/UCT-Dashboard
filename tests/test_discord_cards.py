"""Every text answer the bot gives in Discord comes in ONE card style.

Owner ask 2026-11-14: "consistent on the cards throughout all of them". /news had a
branded card; /lesson answered in plain text and /buzz with a code block over an image.
These pin that all three now come from api/services/discord_cards.py, and read the real
builders and the real wire rather than a copy of the expected look.
"""
from __future__ import annotations

import datetime as dt
import json

import httpx
import pytest

from api.services import discord_cards

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 13, 15, 0, tzinfo=UTC)


def _frame(embed: dict) -> tuple:
    """What every card must share: everything but its own words."""
    return (embed["author"]["name"].split(" · ")[0], embed["author"]["icon_url"], embed["color"],
            embed["footer"]["icon_url"], embed["footer"]["text"].rsplit(" · ", 1)[-1])


# ── the frame ────────────────────────────────────────────────────────────────

def test_a_card_has_the_brand_the_title_the_body_and_the_footer():
    e = discord_cards.card("lessons", title="T", description="D", footer=["3 lessons", "", "x"], now=NOW)
    assert e["author"] == {"name": "UCT INTELLIGENCE · LESSONS", "icon_url": discord_cards.MARK_URL}
    assert (e["title"], e["description"], e["color"]) == ("T", "D", 0xDCBB5E)
    assert e["footer"]["text"] == "3 lessons · x · uctintelligence.com", "empty facts are left out"
    assert e["timestamp"] == NOW.isoformat() and "image" not in e
    shown = discord_cards.card("buzz", title="T", description="D", footer=[], image="buzz.png", now=NOW)
    assert shown["image"] == {"url": "attachment://buzz.png"}
    assert "image" not in discord_cards.without_image(shown) and "image" in shown, "a copy, not an edit"


def test_discord_limits_are_respected():
    e = discord_cards.card("news", title="t" * 400, description="d" * 5000, footer=["f" * 3000], now=NOW)
    assert len(e["title"]) <= 256 and len(e["description"]) <= 4096 and len(e["footer"]["text"]) <= 2048


@pytest.fixture()
def buzz(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_reply, buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    et = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=et).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=et).timestamp())
    buzz_store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(6)]
                               + [("1544451055910129726", "CH1", "a", "AMD", ts, "exact")])
    return buzz_reply, now


def test_every_command_answers_in_the_same_frame(buzz, monkeypatch, tmp_path):
    """⛔ THE ONE THAT MATTERS. The three cards are built by three modules; this reads each
    one's REAL output and asserts they share the frame, so a fourth author line, colour or
    footer cannot come back through one command."""
    from api.services import discord_tx_news as news
    from api.services import tsdr_lessons as tl
    reply, now = buzz
    cards = {
        "news": news.build_embed("NVDA", "3d", [(NOW, "NVDA - beat and raise")], NOW),
        "news-empty": news.build_embed("NVDA", "today", [], NOW),
        "lessons": tl.search_card("stops", [{"title": "Stops", "url": "https://d/1", "level": "beginner",
                                             "section": "Trade Management", "day": "Mar 1, 2026",
                                             "at": "5:14", "watch": "https://youtu.be/X?t=314", "quote": "q"}]),
        "lessons-empty": tl.search_card("zebra", []),
        "buzz-board": reply.as_card(reply.build_board_text(now, "open"), "open"),
        "buzz-board-image": reply.as_card(reply.build_board_text(now, "open"), "open", image="buzz.png"),
        "buzz-ticker": reply.as_card(reply.build_ticker_text("NVDA", "open", now), "open"),
        "buzz-ticker-empty": reply.as_card(reply.build_ticker_text("ZZZZ", "open", now), "open"),
    }
    frames = {name: _frame(e) for name, e in cards.items()}
    assert len(set(frames.values())) == 1, frames
    assert frames["news"] == ("UCT INTELLIGENCE", discord_cards.MARK_URL, 0xDCBB5E, discord_cards.MARK_URL,
                              "uctintelligence.com")
    assert {cards[k]["author"]["name"] for k in cards} == {
        "UCT INTELLIGENCE · NEWS", "UCT INTELLIGENCE · LESSONS", "UCT INTELLIGENCE · BUZZ"}
    assert all(e["title"] for e in cards.values())
    assert all(e.get("description") for k, e in cards.items() if k != "buzz-board-image"), "no card is blank"


# ── /buzz ────────────────────────────────────────────────────────────────────

def test_the_board_card_is_read_from_the_boards_own_text(buzz):
    reply, now = buzz
    text = reply.build_board_text(now, "open")
    e = reply.as_card(text, "open")
    assert e["title"] == "Most talked about — since the open"
    assert "```" in e["description"] and "NVDA" in e["description"] and "AMD" in e["description"]
    assert e["footer"]["text"].startswith("counted through ") and "_" not in e["footer"]["text"]
    assert "counted through" not in e["description"], "the coverage line moved to the footer"


def test_with_the_image_the_card_shows_the_picture_instead_of_the_table(buzz):
    """The picture IS the table. Both at once was the clutter the card replaced."""
    reply, now = buzz
    e = reply.as_card(reply.build_board_text(now, "open"), "open", image="buzz.png")
    assert e["image"] == {"url": "attachment://buzz.png"}
    assert "description" not in e, "no heat line: no body, not a blank line under the title"
    board = "\n".join(["**Most talked about — since the open**", "```", "NVDA  ███  6", "```",
                       "🔥 **Heating up today** — NVDA 3.1x", "_counted through 1:12p_"])
    hot = reply.as_card(board, "open", image="buzz.png")
    assert hot["description"] == "🔥 **Heating up today** — NVDA 3.1x" and "```" not in hot["description"]


def test_a_ticker_card_names_the_stock_the_window_and_the_count(buzz):
    reply, now = buzz
    e = reply.as_card(reply.build_ticker_text("NVDA", "open", now), "open")
    assert e["title"] == "$NVDA · Buzz · Since the open"
    assert e["description"].startswith("6 mentions from 6 members"), "the card says it properly"
    one = reply.as_card("\n".join(["**AMD** — 1 mention(s) from 1 member(s)", "`▁`",
                                   "_counted through 1:12p_"]), "open")
    assert one["description"].startswith("1 mention from 1 member")
    assert e["footer"]["text"].startswith("counted through ")
    empty = reply.as_card(reply.build_ticker_text("ZZZZ", "open", now), "open")
    assert empty["title"] == "$ZZZZ · Buzz · Since the open"
    assert empty["description"] == "No mentions in that window."
    assert empty["footer"]["text"].startswith("counted through ")


def test_an_empty_board_card_says_so(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_reply, buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    e = buzz_reply.as_card(buzz_reply.build_board_text(1_800_000_000, "week"), "week")
    assert e["title"] == "Most talked about — this week" and e["description"] == "No mentions counted yet."


def test_the_board_job_sends_the_card_with_the_image_inside_it(buzz):
    from api.routers import discord_interactions as rt
    reply, now = buzz
    text = reply.build_board_text(now, "open")
    calls = []
    rt.run_buzz_image_job("A", "T", text, "open", render_fn=lambda w, **k: b"\x89PNGdata",
                          edit_fn=lambda *a, **kw: calls.append(kw), as_card=True)
    (sent,) = calls
    assert sent["content"] == "" and sent["png"] == b"\x89PNGdata" and sent["filename"] == "buzz.png"
    assert sent["embeds"][0]["image"] == {"url": "attachment://buzz.png"}
    calls.clear()
    rt.run_buzz_image_job("A", "T", text, "open", render_fn=lambda w, **k: None,
                          edit_fn=lambda *a, **kw: calls.append(kw), as_card=True)
    (sent,) = calls
    assert "png" not in sent and "image" not in sent["embeds"][0] and "```" in sent["embeds"][0]["description"], \
        "no picture: the card carries the table"


# ── /lesson ──────────────────────────────────────────────────────────────────

def test_the_lesson_card_lists_each_lesson_with_its_moment():
    from api.services import tsdr_lessons as tl
    hits = [{"title": "Where to put the stop", "url": "https://discord.com/channels/1/2/3", "level": "beginner",
             "section": "Trade Management", "day": "Mar 1, 2026", "at": "5:14",
             "watch": "https://youtu.be/X?t=314", "quote": "…the stop goes under the low…"},
            {"title": "NVDA earnings setup", "url": "", "level": "", "section": "Setups & Entries",
             "day": "Mar 2, 2026", "at": "0:17", "watch": "", "quote": "one stop mention"}]
    e = tl.search_card("stop   loss", hits)
    assert e["title"] == "Lessons on “stop loss”" and e["author"]["name"] == "UCT INTELLIGENCE · LESSONS"
    first, second = e["description"].split("\n\n")
    assert first.split("\n") == [
        "**1. [Where to put the stop](https://discord.com/channels/1/2/3)**",
        "Beginner · Trade Management · Mar 1, 2026",
        "[▶ Watch from 5:14](https://youtu.be/X?t=314) — “…the stop goes under the low…”"]
    assert second.split("\n") == ["**2. NVDA earnings setup**", "Setups & Entries · Mar 2, 2026",
                                  "At 0:17 — “one stop mention”"]
    assert e["footer"]["text"] == "2 lessons · TSDR & Bracco video lessons · uctintelligence.com"
    one = tl.search_card("x", hits[:1])
    assert one["footer"]["text"].startswith("1 lesson · ")


# ── the wire ─────────────────────────────────────────────────────────────────

def _payload(request: httpx.Request) -> dict:
    if request.headers["content-type"].startswith("multipart/form-data"):
        body = request.content
        start = body.index(b'name="payload_json"')
        start = body.index(b"\r\n\r\n", start) + 4
        return json.loads(body[start:body.index(b"\r\n--", start)])
    return json.loads(request.content)


def test_the_card_reaches_discord_in_every_shape_edit_original_sends():
    """A card and no file, a card showing its file, and the text fallback after Discord
    refuses the file, which keeps the card and drops only its picture."""
    from api.services import discord_interactions as di
    e = discord_cards.card("buzz", title="T", description="D", footer=[], image="buzz.png", now=NOW)
    seen = []

    def client(respond=None):
        def handler(req):
            seen.append(req)
            return respond(req) if respond else httpx.Response(200, json={"id": "1"})
        return httpx.Client(transport=httpx.MockTransport(handler))

    di.edit_original("A", "T", content="", embeds=[discord_cards.without_image(e)], client=client())
    assert _payload(seen[-1])["embeds"] == [discord_cards.without_image(e)]
    di.edit_original("A", "T", content="", embeds=[e], png=b"\x89PNG" + b"x" * 64, filename="buzz.png",
                     client=client())
    sent = _payload(seen[-1])
    assert sent["embeds"] == [e] and sent["attachments"] == [{"id": 0, "filename": "buzz.png"}]

    def refuse(req):
        if req.headers["content-type"].startswith("multipart/form-data"):
            return httpx.Response(403, json={"message": "Missing Permissions", "code": 50013})
        return httpx.Response(200, json={"id": "1"})
    seen.clear()
    di.edit_original("A", "T", content="", embeds=[e], png=b"\x89PNG" + b"x" * 64, filename="buzz.png",
                     client=client(refuse))
    assert len(seen) == 2, "the fallback was never sent"
    fallback = _payload(seen[-1])
    assert fallback["embeds"] == [discord_cards.without_image(e)], "the card was lost with the picture"
    assert fallback["content"] and fallback["allowed_mentions"] == {"parse": []}


def test_a_reply_without_a_card_is_byte_for_byte_what_it_was():
    """/chart, /flow and /cot send no card; their payload must not grow an `embeds` key
    (an empty list there would CLEAR a card on an edit)."""
    from api.services import discord_interactions as di
    seen = []
    c = httpx.Client(transport=httpx.MockTransport(lambda r: (seen.append(r), httpx.Response(200, json={}))[1]))
    di.edit_original("A", "T", content="No bars for X (Daily).", client=c)
    assert _payload(seen[-1]) == {"content": "No bars for X (Daily).", "allowed_mentions": {"parse": []}}


def test_a_card_with_no_body_has_no_description_at_all():
    """A placeholder character drew an empty line under the title (seen on the /buzz board
    card in Discord, 2026-11-14)."""
    for empty in ("", "​", " \n"):
        assert "description" not in discord_cards.card("buzz", title="T", description=empty, footer=[], now=NOW)
    assert discord_cards.card("buzz", title="T", description="x", footer=[], now=NOW)["description"] == "x"
