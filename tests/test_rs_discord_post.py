"""The nightly UCT Relative Strength leaders post to Discord (unit 2b-07).

A dedicated poster on the `discord_index_close` shape, dark behind
`RS_DISCORD_POST_ENABLED`, with its own webhook row (`DISCORD_RS_WEBHOOK_URL`)
and a draft template the owner reviews in docs/alerts/RS-DISCORD-POST.md.

The channel is member-facing and the job is unattended, so most of what is
tested here is what the poster REFUSES to do. The real webhook is never
called: `send` is an injected callable throughout.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re

import pytest

from api.services import rs_discord_post as rp
from api.services.alert_taxonomy import channels

REPO = pathlib.Path(__file__).resolve().parents[1]
MODULE = REPO / "api" / "services" / "rs_discord_post.py"
TEMPLATE = REPO / "docs" / "alerts" / "RS-DISCORD-POST.md"
LEDGER = REPO / "docs" / "feature_flags.json"

SESSION = "2026-11-05"          # a Thursday
HOOK = "https://discord.test/rs"


def _row(ticker, rating, sector=None, *, nh=True, bp=False, red=True, above=True):
    return {"ticker": ticker, "sector": sector, "rating": rating, "new_high": nh,
            "before_price": bp, "red_day": red, "rs_line_above": above}


#: THE FIXTURE THE TEMPLATE FILE IS RENDERED FROM. Nine RS new highs on a red
#: day (one over the cap of eight), three of them before price, eight names
#: rated 90 and above, one name below 90, one name with no new high.
FIXTURE = [
    _row("NVDA", 97, "Technology", bp=True),
    _row("PLTR", 96, "Technology"),
    _row("ANET", 95, "Technology", bp=True),
    _row("AVGO", 94, "Technology"),
    _row("CRWD", 93, "Technology", bp=True),
    _row("APP", 92, "Technology"),
    _row("VRT", 91, "Industrials"),
    _row("GEV", 90, "Industrials"),
    _row("LLY", 88, "Healthcare"),
    _row("COST", 84, "Consumer Defensive", nh=False),
]


class _Marker:
    """An injected dedup: `posted()` answers what it was told, `mark()` records."""

    def __init__(self, posted=False):
        self.seen = posted
        self.marked = []

    def posted(self, session):
        return self.seen

    def mark(self, session):
        self.marked.append(session)


def _sender(statuses):
    """A `send(url, body)` that answers the given statuses in order (the last one
    repeats) and records every call; an Exception in the list is raised."""
    calls = []

    def send(url, body):
        calls.append((url, body))
        s = statuses[min(len(calls) - 1, len(statuses) - 1)]
        if isinstance(s, Exception):
            raise s
        return s

    send.calls = calls
    return send


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(rp.FLAG, raising=False)
    monkeypatch.delenv(rp.WEBHOOK_ENV, raising=False)


def _armed(monkeypatch):
    monkeypatch.setenv(rp.FLAG, "1")
    monkeypatch.setenv(rp.WEBHOOK_ENV, HOOK)


# ── the message ───────────────────────────────────────────────────────────────

def _template_sample(name: str = "sample") -> str:
    text = TEMPLATE.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.search(rf"<!-- {name}:start -->\n```text\n(.*?)\n```\n<!-- {name}:end -->", text, re.S)
    assert m, f"docs/alerts/RS-DISCORD-POST.md carries the rendered sample between the {name} markers"
    return m.group(1)


def test_the_calm_session_sample_is_exactly_what_the_code_renders():
    """The doc's second sample (decision P1): the same names on a session that
    was not a red day, SPY up 0.4%, as the real reader's mapping carries it."""
    calm = [dict(r, red_day=False) for r in FIXTURE]
    post = rp.build_post({"leaders": calm, "spy_change_pct": 0.4}, session=SESSION)
    assert post["content"] == _template_sample("sample-calm")
    assert rp.validate_post(post) == []
    assert f"\n{len(rp.build_post(FIXTURE, session=SESSION)['content'])} characters; Discord allows 2000." in \
        TEMPLATE.read_text(encoding="utf-8").replace("\r\n", "\n"), "the doc states the red-day sample's length"


def test_the_sample_post_is_exactly_the_template_the_owner_reviews():
    """The text in the template file IS the text a member would read: rendered
    from FIXTURE above, byte for byte, so the doc cannot drift from the code."""
    post = rp.build_post(FIXTURE, session=SESSION)
    assert post["content"] == _template_sample()
    assert rp.validate_post(post) == []
    assert set(post) == {"username", "content", "allowed_mentions"}, "the discord_index_close shape"
    assert post["username"] == "UCT Intelligence" and post["allowed_mentions"] == {"parse": []}
    assert post["content"].startswith("UCT RS leaders for Thursday, November 5.\n")
    # Decision P9 (2026-11-07): the sign-off was "Not a recommendation. UCT
    # Intelligence."; the webhook username already says who is posting.
    assert post["content"].endswith(".\nNot a recommendation.")
    assert "UCT Intelligence" not in post["content"], "the identity lives in the username only"
    assert len(post["content"]) < 1200, "well inside Discord's 2000 on a busy red day"


def test_the_delegated_decisions_are_what_the_module_carries():
    """P3 caps 8 / 8 / 10, P4 sectors on the rating list only, P5 no Mansfield
    word, P6 the identity, P8 the floor of three, P9 the sign-off, P10 the
    honesty sentence as written (docs/research/relative-strength/reviews/
    2026-11-07-delegated-decisions.md)."""
    assert {k: rp.LIMITS[k] for k in ("before_price", "red_day", "rating", "rating_min", "floor")} == \
        {"before_price": 8, "red_day": 8, "rating": 10, "rating_min": 90, "floor": 3}
    assert rp.USERNAME == "UCT Intelligence" and rp.SIGN_OFF == "Not a recommendation."
    assert rp.HONESTY_LINE.startswith("Evidence: no published hit rate exists for these signals")
    content = rp.build_post(FIXTURE, session=SESSION)["content"]
    head = content.split("Rating 90 and above")[0]
    assert "Technology" not in head and "Industrials" not in head, "no sector on the two new-high lists"
    assert "NVDA (97) Technology\n" in content, "the rating list carries the sector"
    assert "mansfield" not in content.lower() and "above average" not in content, \
        "the rows carry rs_line_above; the post never prints a Mansfield or average word"


def test_the_red_day_threshold_is_the_one_the_screener_flag_uses():
    from api.services import relative_strength as rs
    assert rp.RED_DAY_PCT == rs.DEFAULT_RED_DAY_PCT
    assert "SPY closing down 0.5% or more" in rp.RULE_LINE


def test_a_session_that_was_not_a_red_day_says_so_with_spys_change():
    """Decision P1: every session posts, and on a session that was not a red
    day the red-day line states SPY's change instead of "none"."""
    calm = [dict(r, red_day=False) for r in FIXTURE]
    line = lambda post: post["content"].split(rp.RED_DAY_LABEL)[1].split("\n")[0]   # noqa: E731
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=0.4)) == "SPY was not a red day (+0.4%)"
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=-0.31)) == "SPY was not a red day (-0.3%)"
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=-0.04)) == "SPY was not a red day (0.0%)", \
        "never a signed zero"
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=1.257)) == "SPY was not a red day (+1.3%)"
    # one decimal would round a calm session onto the threshold the rule calls red
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=-0.46)) == "SPY was not a red day (-0.46%)"
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct=-0.49)) == "SPY was not a red day (-0.49%)"
    # a red day with no name, or an unknown change, is still "none"
    for spy in (-0.5, -1.8, None, float("nan"), True, "x"):
        assert line(rp.build_post(calm, session=SESSION, spy_change_pct=spy)) == "none", spy
    # a numeric string from a reader is a number
    assert line(rp.build_post(calm, session=SESSION, spy_change_pct="0.4")) == "SPY was not a red day (+0.4%)"
    # names flagged red are listed whatever the change says: the post never drops a name
    assert line(rp.build_post(FIXTURE, session=SESSION, spy_change_pct=0.4)).startswith("NVDA (97), PLTR (96)")
    post = rp.build_post(calm, session=SESSION, spy_change_pct=0.4)
    assert rp.validate_post(post) == [], "the sign and the brackets pass the house guard"


def test_the_seam_carries_spys_change_in_its_mapping_form(monkeypatch):
    calm = [dict(r, red_day=False) for r in FIXTURE]
    seam = {"leaders": calm, "spy_change_pct": 0.4}
    assert rp.split_leaders(seam) == (calm, 0.4)
    assert rp.split_leaders(calm) == (calm, None), "the bare list still works and carries no change"
    for junk in (None, "rows", 5, {"leaders": "x"}, {}):
        assert rp.split_leaders(junk)[0] == []
    assert rp.normalise_leaders(seam) == rp.normalise_leaders(calm)
    assert rp.build_post(seam, session=SESSION) == rp.build_post(calm, session=SESSION, spy_change_pct=0.4)
    assert "(+0.7%)" in rp.build_post(seam, session=SESSION, spy_change_pct=0.7)["content"], \
        "an explicit change wins over the carried one"
    _armed(monkeypatch)
    send = _sender([204])
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: seam, send=send, dedup=_Marker())
    assert r["posted"] is True and r["spy_change_pct"] == 0.4 and r["leaders"] == 10
    assert "RS new highs on a red day: SPY was not a red day (+0.4%)\n" in send.calls[0][1]["content"]
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: {"leaders": FIXTURE[:2], "spy_change_pct": 0.4},
                           send=send, dedup=_Marker())
    assert r["reason"] == "below the floor: 2 names, floor is 3", "SPY is not a name; the floor counts rows"


def test_each_list_is_capped_between_names_and_says_how_many_were_cut():
    content = rp.build_post(FIXTURE, session=SESSION)["content"]
    red = content.split("RS new highs on a red day: ")[1].split("\n")[0]
    assert red.endswith("GEV (90), and 1 more") and "LLY" not in red, "nine names, cap eight"
    assert "RS new highs before price: NVDA (97), ANET (95), CRWD (93)\n" in content
    small = rp.build_post(FIXTURE, session=SESSION, limits={"red_day": 2, "rating": 3})["content"]
    assert "RS new highs on a red day: NVDA (97), PLTR (96), and 7 more\n" in small
    assert "ANET (95) Technology\nand 5 more\n" in small
    assert "AVGO" not in small.split("with sector:")[1].split("\n\nRule:")[0]


def test_nothing_is_invented_an_empty_list_says_none_and_an_unrated_name_says_so():
    rows = [
        _row("ZZZ", None, bp=True, red=False),            # unrated, before price
        _row("AAA", 95, "Energy", bp=True, red=False),
        _row("aaa", 1, "Dup", bp=True, red=False),          # a repeated ticker keeps its first row
        {"name": "no ticker"}, "junk", None,                  # dropped
        _row("BBB", 150, red=False), _row("CCC", float("nan"), red=False),   # out of range / NaN
        _row("DDD", "91", "Health Care", red=False),          # a numeric string is a number
        _row("EEE", True, red=False),                         # a bool is not a rating
    ]
    rows_norm = rp.normalise_leaders(rows)
    assert [r["ticker"] for r in rows_norm] == ["AAA", "DDD", "BBB", "CCC", "EEE", "ZZZ"], \
        "rating descending, unrated last, then ticker"
    assert rows_norm[0]["sector"] == "Energy" and rows_norm[1]["rating"] == 91
    assert all(rows_norm[i]["rating"] is None for i in (2, 3, 4, 5))
    content = rp.build_post(rows, session=SESSION)["content"]
    assert "RS new highs before price: AAA (95), ZZZ (unrated)\n" in content
    assert "RS new highs on a red day: none\n" in content
    assert "Rating 90 and above, with sector:\nAAA (95) Energy\nDDD (91) Health Care\n\nRule:" in content
    empty = rp.build_post([], session=SESSION)["content"]
    assert empty.count(": none") == 2 and "with sector:\nnone\n" in empty
    assert rp.validate_post(rp.build_post(rows, session=SESSION)) == []
    # a session that will not parse is printed as given, never silently today
    assert rp.session_line("not-a-date") == "not-a-date"
    assert rp.session_line("2026-11-05") == "Thursday, November 5"


def test_the_evidence_line_carries_a_measured_number_or_the_honesty_sentence():
    assert rp.evidence_line(None) == rp.HONESTY_LINE
    assert rp.evidence_line({}) == rp.HONESTY_LINE
    assert rp.evidence_line({"n": 1284}) == rp.HONESTY_LINE, "incomplete numbers are no evidence"
    assert rp.evidence_line({"n": 0, "hit_rate_pct": 58.3, "horizon_bars": 20,
                             "start": "2025-11-05", "end": "2026-11-04"}) == rp.HONESTY_LINE
    assert rp.evidence_line({"n": 10, "hit_rate_pct": float("nan"), "horizon_bars": 20,
                             "start": "2025-11-05", "end": "2026-11-04"}) == rp.HONESTY_LINE
    ev = {"signal": "RS new highs before price", "n": 1284, "hit_rate_pct": 58.3, "horizon_bars": 20,
          "start": "2025-11-05", "end": "2026-11-04", "survivorship_corrected": False}
    line = rp.evidence_line(ev)
    assert line == ("Evidence: 1,284 RS new highs before price from 2025-11-05 to 2026-11-04; "
                    "58.3% closed higher 20 bars later. Universe as held, survivorship not yet corrected.")
    assert rp.evidence_line([ev, {"n": "x"}]) == line, "a list renders the complete entries only"
    # 2026-11-07: the likely range and the unchecked-split note are the card's own pieces
    # (`rs_evidence_pull`), each printed only when the dict carries it
    from api.services import rs_evidence_pull as ep
    full = {**ev, "hit_rate_low_pct": 55.62, "hit_rate_high_pct": 60.94, "split_unchecked": 3}
    assert rp.evidence_line(full) == (
        "Evidence: 1,284 RS new highs before price from 2025-11-05 to 2026-11-04; 58.3% (likely between "
        "55.6% and 60.9%) closed higher 20 bars later. Stock splits not yet checked for 3 names. Universe "
        "as held, survivorship not yet corrected.")
    assert ep.likely_range_phrase(55.62, 60.94) in rp.evidence_line(full)
    assert ep.split_unchecked_phrase(3) in rp.evidence_line(full)
    assert rp.evidence_line({**full, "split_unchecked": 0, "hit_rate_low_pct": None}) == line, (
        "no range without both bounds, no split note without a count")
    post = rp.build_post(FIXTURE, session=SESSION, evidence=ev)
    assert line in post["content"] and rp.HONESTY_LINE not in post["content"]
    assert rp.validate_post(post) == []
    assert "Evidence:" in rp.build_post(FIXTURE, session=SESSION)["content"], "the line is never absent"


# ── the validator ─────────────────────────────────────────────────────────────

def _ok():
    return rp.build_post(FIXTURE, session=SESSION)


@pytest.mark.parametrize("mutate,fragment", [
    (lambda p: p.update(content="x" * 2001), "content is 2001 chars; Discord allows 2000"),
    (lambda p: p.update(content=p["content"] + " \U0001F680"), "content: emoji"),
    (lambda p: p.update(content=p["content"] + " ⭐"), "content: emoji"),
    (lambda p: p.update(content=p["content"] + " :rocket:"), "content: emoji"),
    (lambda p: p.update(content="@everyone " + p["content"]), "content: mass mention @everyone"),
    (lambda p: p.update(content="@here " + p["content"]), "content: mass mention @here"),
    (lambda p: p.update(content=p["content"] + " <@&123456>"), "content: user, role or channel mention"),
    (lambda p: p.update(content=p["content"] + " <@123456>"), "content: user, role or channel mention"),
    (lambda p: p.update(content=p["content"] + " x@y"), "content: contains @"),
    (lambda p: p.update(content="**bold** " + p["content"]), "content: markdown"),
    (lambda p: p.update(content=p["content"] + " `code`"), "content: markdown"),
    (lambda p: p.update(content="- a list\n" + p["content"]), "content: markdown list, quote or heading"),
    (lambda p: p.update(content="# heading\n" + p["content"]), "content: markdown list, quote or heading"),
    (lambda p: p.update(content=p["content"] + " <b>x</b>"), "content: markup"),
    (lambda p: p.update(content=p["content"] + " Leaders lead!"), "content: exclamation mark"),
    (lambda p: p.update(content=p["content"].replace("Rule:", "Rule —")), "content: em or en dash"),
    (lambda p: p.update(content=p["content"] + " Elite names."), "content: banned word 'elite'"),
    (lambda p: p.update(content=p["content"] + " Time to buy."), "content: banned word 'buy'"),
    (lambda p: p.update(content=p["content"] + " A leading indicator."), "content: banned word 'leading indicator'"),
    (lambda p: p.update(allowed_mentions={"parse": ["everyone"]}), "allowed_mentions must be"),
    (lambda p: p.pop("allowed_mentions"), "allowed_mentions must be"),
    (lambda p: p.update(username=""), "username missing"),
    (lambda p: p.update(username="x" * 81), "username is 81 chars; Discord allows 80"),
    (lambda p: p.update(embeds=[{"title": "t", "fields": [{"name": "n", "value": "v"}] * 26}]),
     "embed 0 has 26 fields; Discord allows 25"),
    (lambda p: p.update(embeds=[{"title": "t" * 257}]), "embed 0 title is 257 chars; Discord allows 256"),
    (lambda p: p.update(embeds=[{"fields": [{"name": "n", "value": "v" * 1025}]}]),
     "embed 0 field 0 value is 1025 chars; Discord allows 1024"),
    (lambda p: p.update(embeds=[{}] * 11), "11 embeds; Discord allows 10"),
    (lambda p: p.update(embeds=[{"description": "d" * 4000}, {"description": "d" * 2001}]),
     "embeds total 6001 chars; Discord allows 6000"),
    (lambda p: p.update(embeds=[{"title": "@everyone"}]), "embed 0 title: mass mention @everyone"),
    (lambda p: p.update(content=""), "empty post"),
])
def test_the_validator_refuses_precisely(mutate, fragment):
    post = _ok()
    assert rp.validate_post(post) == [], "the control passes before the mutation"
    mutate(post)
    reasons = rp.validate_post(post)
    assert any(fragment in r for r in reasons), reasons


def test_the_validator_passes_digits_and_the_houses_own_punctuation():
    """Unlike the close note, this post MUST carry numbers; the voice rules are
    the only thing it refuses in plain prose."""
    post = _ok()
    post["content"] += " 1,284 names; 58.3% over 20 bars (2025-11-05 to 2026-11-04). IBD-style."
    assert rp.validate_post(post) == []
    assert rp.validate_post("not a dict") == ["post is not a dict"]
    assert rp.validate_post({"content": 5, "username": "u", "allowed_mentions": {"parse": []}})[0] == \
        "content is not a string"


# ── what the poster refuses to do ─────────────────────────────────────────────

def test_the_flag_is_read_per_call_and_only_the_literal_1_arms_it(monkeypatch):
    monkeypatch.setenv(rp.WEBHOOK_ENV, HOOK)
    send = _sender([204])
    for value in (None, "0", "true", "yes", "on", " 1"):
        if value is None:
            monkeypatch.delenv(rp.FLAG, raising=False)
        else:
            monkeypatch.setenv(rp.FLAG, value)
        assert rp.enabled() is False
        r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker())
        assert (r["posted"], r["reason"], r["session"], r["chars"], r["leaders"]) == \
            (False, "not enabled", SESSION, 0, 0)
    assert send.calls == [], "nothing reached the channel"
    monkeypatch.setenv(rp.FLAG, "1")          # no reimport between these: read per call
    assert rp.enabled() is True
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker())["posted"] is True
    assert len(send.calls) == 1


def test_a_missing_webhook_is_a_reason_never_a_fallback(monkeypatch):
    monkeypatch.setenv(rp.FLAG, "1")
    # the rooms the estate's other posters fall back to must NOT be used
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/general")
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "https://discord.test/alerts")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.test/ops")
    send = _sender([204])
    for url in (None, "", "   "):
        r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, webhook_url=url, send=send, dedup=_Marker())
        assert r["reason"] == "no webhook configured" and r["posted"] is False
    assert send.calls == []
    monkeypatch.setenv(rp.WEBHOOK_ENV, "  " + HOOK + " ")
    assert rp.configured_webhook() == HOOK
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker())
    assert r["posted"] is True and send.calls[0][0] == HOOK


def test_no_leaders_posts_nothing_and_says_why(monkeypatch):
    _armed(monkeypatch)
    send = _sender([204])
    for empty in ([], None, (), [{"name": "no ticker"}, "junk"]):
        r = rp.post_rs_summary(SESSION, leaders_fn=lambda s, e=empty: e, send=send, dedup=_Marker())
        assert r["reason"] == "no leaders for this session" and r["leaders"] == 0 and r["posted"] is False

    def boom(session):
        raise RuntimeError("db locked")

    r = rp.post_rs_summary(SESSION, leaders_fn=boom, send=send, dedup=_Marker())
    assert r["reason"] == "leaders_fn failed: RuntimeError" and r["posted"] is False
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE[:2], send=send, dedup=_Marker())
    assert r["reason"] == "below the floor: 2 names, floor is 3" and r["leaders"] == 2
    assert send.calls == []
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE[:3], send=send, dedup=_Marker())
    assert r["posted"] is True and r["leaders"] == 3, "the floor is inclusive"
    r = rp.post_rs_summary("", leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker())
    assert r["reason"] == "no session" and len(send.calls) == 1


def test_a_session_already_posted_is_not_posted_again(monkeypatch):
    _armed(monkeypatch)
    send = _sender([204])
    seen = _Marker(posted=True)
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=seen)
    assert r["reason"] == "already posted for this session" and r["posted"] is False
    assert send.calls == [] and seen.marked == []
    fresh = _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=fresh)
    assert r["posted"] is True and r["marked"] is True and fresh.marked == [SESSION]


def test_the_default_marker_lives_on_the_data_volume_and_is_written_atomically(monkeypatch, tmp_path):
    """The discord_index_close dedup: one JSON marker per poster in DATA_DIR,
    written temp-then-replace AFTER a 2xx; unreadable reads as "not posted"."""
    _armed(monkeypatch)
    send = _sender([204])
    assert rp.last_posted() == ""
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send)["posted"] is True
    marker = tmp_path / rp.MARKER_FILE
    assert json.loads(marker.read_text(encoding="utf-8"))["last_posted"] == SESSION
    assert rp.last_posted() == SESSION and rp.FileMarker().posted(SESSION) is True
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".rspost")], "no temp file left behind"
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send)
    assert r["reason"] == "already posted for this session" and len(send.calls) == 1
    assert rp.post_rs_summary("2026-11-06", leaders_fn=lambda s: FIXTURE, send=send)["posted"] is True
    assert len(send.calls) == 2 and rp.last_posted() == "2026-11-06"
    marker.write_text("{not json", encoding="utf-8")
    assert rp.last_posted() == "" and rp.FileMarker().posted(SESSION) is False
    # a failed post never marks the session
    marker.unlink()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=_sender([400]))
    assert r["reason"] == "http 400" and r["posted"] is False and not marker.exists()


def test_a_429_is_reported_as_rate_limited_and_never_retried(monkeypatch):
    _armed(monkeypatch)
    send = _sender([429, 204])
    slept = []
    m = _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=m, sleep=slept.append)
    assert r["reason"] == "rate-limited" and r["posted"] is False and r["attempts"] == 1
    assert len(send.calls) == 1 and slept == [] and m.marked == []


def test_a_5xx_is_retried_exactly_once_after_the_injected_sleep(monkeypatch):
    _armed(monkeypatch)
    slept = []
    send, m = _sender([503, 204]), _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=m, sleep=slept.append)
    assert r["posted"] is True and r["attempts"] == 2 and len(send.calls) == 2
    assert slept == [rp.RETRY_PAUSE_S] and m.marked == [SESSION]
    # still failing after the one retry: two sends, one sleep, reported, not marked
    slept.clear()
    send, m = _sender([502, 500]), _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=m, sleep=slept.append)
    assert r["reason"] == "http 500 after one retry" and r["posted"] is False
    assert len(send.calls) == 2 and slept == [rp.RETRY_PAUSE_S] and m.marked == []
    # a 5xx then a 429 is rate-limited, still two sends
    send = _sender([500, 429])
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(), sleep=lambda s: None)
    assert r["reason"] == "rate-limited" and len(send.calls) == 2
    # a 4xx is never retried
    slept.clear()
    send = _sender([404, 204])
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(), sleep=slept.append)
    assert r["reason"] == "http 404" and len(send.calls) == 1 and slept == []


def test_success_receipt_and_what_the_webhook_receives(monkeypatch):
    _armed(monkeypatch)
    send, m = _sender([204]), _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=m)
    expected = rp.build_post(FIXTURE, session=SESSION)
    # `spy_change_pct` joined the receipt with decision P1 (2026-11-07): a bare
    # list carries no SPY change, so it reads None here.
    assert r == {"posted": True, "reason": "posted", "session": SESSION, "chars": len(expected["content"]),
                 "leaders": 10, "spy_change_pct": None, "attempts": 1, "marked": True, "dry_run": False}
    url, body = send.calls[0]
    assert url == HOOK and body == expected
    json.dumps(body)                                    # the JSON body is serialisable as sent
    assert m.marked == [SESSION]
    # the evidence seam feeds the post; a failing evidence_fn prints the honesty line
    ev = {"n": 50, "hit_rate_pct": 60.0, "horizon_bars": 10, "start": "2026-01-02", "end": "2026-11-04"}
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(),
                           evidence_fn=lambda s: ev)
    assert "Evidence: 50 RS new highs from 2026-01-02 to 2026-11-04; 60.0% closed higher 10 bars later." \
        in send.calls[-1][1]["content"]

    def bad_evidence(session):
        raise RuntimeError("no table")

    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(),
                           evidence_fn=bad_evidence)
    assert r["posted"] is True and rp.HONESTY_LINE in send.calls[-1][1]["content"]


def test_a_transport_error_is_a_reason_and_is_not_retried(monkeypatch):
    """A timeout may mean Discord accepted the post; a second send would double-post."""
    _armed(monkeypatch)
    slept = []
    send, m = _sender([TimeoutError("slow"), 204]), _Marker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=m, sleep=slept.append)
    assert r["reason"] == "send failed: TimeoutError" and r["posted"] is False
    assert len(send.calls) == 1 and slept == [] and m.marked == []

    class _Resp:
        status_code = 200

    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=lambda u, b: _Resp(),
                              dedup=_Marker())["posted"] is True, "a response object is read"
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=lambda u, b: True,
                              dedup=_Marker())["posted"] is True, "a bare True is a 2xx"
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=lambda u, b: False,
                              dedup=_Marker())["reason"] == "http 0"


def test_the_poster_never_raises_and_a_landed_post_is_never_hidden(monkeypatch):
    _armed(monkeypatch)

    class _Broken:
        def posted(self, session):
            raise RuntimeError("disk")

        def mark(self, session):
            raise RuntimeError("disk")

    send = _sender([204])
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Broken())
    assert r == {**r, "posted": False, "reason": "failed: RuntimeError"} and send.calls == []

    class _MarkFails(_Marker):
        def mark(self, session):
            raise RuntimeError("disk full")

    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_MarkFails())
    # 2026-11-07 (review #32, unit U9): the reason now carries the marker failure;
    # it was "posted". `posted` stays True, so the retry pass still skips it.
    assert r["posted"] is True and r["marked"] is False, \
        "the post went out; a marker that could not be written must not read as silence"
    assert r["reason"] == "posted; the session marker was not recorded: RuntimeError"


def test_a_run_in_flight_is_reported_not_doubled(monkeypatch):
    _armed(monkeypatch)
    assert rp._RUN_LOCK.acquire(blocking=False)
    try:
        r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=_sender([204]), dedup=_Marker())
        assert r["reason"] == "a run is already in flight" and r["posted"] is False
    finally:
        rp._RUN_LOCK.release()
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=_sender([204]),
                              dedup=_Marker())["posted"] is True, "the lock is released on every path"


def test_dry_run_builds_and_validates_and_posts_nothing(monkeypatch):
    send = _sender([204])
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send,
                           dedup=_Marker(posted=True), dry_run=True, force=True)
    assert r["reason"] == "dry run" and r["posted"] is False and r["dry_run"] is True
    assert r["content"] == rp.build_post(FIXTURE, session=SESSION)["content"]
    assert r["chars"] == len(r["content"]) and r["leaders"] == 10 and send.calls == []
    # a dry run needs no webhook, but still needs the flag unless forced
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(), dry_run=True)
    assert r["reason"] == "not enabled"
    monkeypatch.setenv(rp.FLAG, "1")
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(), dry_run=True)
    assert r["reason"] == "dry run" and send.calls == []


def test_force_ignores_the_judgement_gates_but_never_the_webhook_or_the_validator(monkeypatch):
    send, m = _sender([204]), _Marker(posted=True)
    # flag off, session marked, below the floor: all overridden by the owner's one-off
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE[:2], webhook_url=HOOK, send=send,
                           dedup=m, force=True)
    assert r["posted"] is True and m.marked == [SESSION] and len(send.calls) == 1
    # ...but not the destination: force is "post anyway", never "find somewhere to post"
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: FIXTURE, send=send, dedup=_Marker(), force=True)
    assert r["reason"] == "no webhook configured" and len(send.calls) == 1
    # ...and not the validator: a sector carrying a mention is refused even when forced
    bad = [dict(FIXTURE[0], sector="Technology @everyone")] + FIXTURE[1:]
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: bad, webhook_url=HOOK, send=send,
                           dedup=_Marker(), force=True)
    assert r["reason"].startswith("refused by the validator: content: mass mention @everyone")
    assert r["posted"] is False and len(send.calls) == 1 and r["chars"] > 0


# ── the rails ─────────────────────────────────────────────────────────────────

def _imports(tree: ast.AST) -> set[str]:
    names = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            names |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            mod = n.module or ""
            names.add(mod)
            names |= {f"{mod}.{a.name}" for a in n.names}
    return names


_MEMBER_LANE = ("api.services.alert_routing", "api.services.screen_alerts", "api.services.alerts",
                "api.services.alert_destination", "api.services.watchlist_alert_service")


def _lane_hits(names: set[str]) -> set[str]:
    return {n for n in names if n in _MEMBER_LANE or any(n.startswith(b + ".") for b in _MEMBER_LANE)}


def test_the_poster_never_imports_the_member_alert_lane():
    """The map's code read: screen_alerts/alert_routing is the per-member in-app
    plus email lane, a private alert never reaches Discord, and alert_routing has
    exactly one permitted importer. The poster stays off that graph, at any depth."""
    names = _imports(ast.parse(MODULE.read_text(encoding="utf-8")))
    assert {"os", "json", "threading"} <= names, "the probe sees imports at all"
    assert _lane_hits(names) == set()
    # control: every banned form is visible to the probe
    probe = ast.parse("def f():\n    from api.services import alert_routing\n"
                      "import api.services.screen_alerts as s\n"
                      "from api.services.alerts import add_alert\n")
    assert _lane_hits(_imports(probe)) == {"api.services.alert_routing", "api.services.screen_alerts",
                                           "api.services.alerts", "api.services.alerts.add_alert"}


def test_the_webhook_row_satisfies_the_census(monkeypatch):
    """The census rail in tests/test_alert_channel_registry.py fails on any
    `"DISCORD_*WEBHOOK*"` literal under api/ without a LEGACY_WEBHOOKS row."""
    literal = re.compile(r"[\"'](DISCORD_[A-Z0-9_]*WEBHOOK[A-Z0-9_]*)[\"']")      # the census regex
    found = set(literal.findall(MODULE.read_text(encoding="utf-8")))
    assert found == {"DISCORD_RS_WEBHOOK_URL"} == {rp.WEBHOOK_ENV}, "one variable, no fallback room"
    assert found <= set(channels.LEGACY_WEBHOOKS)
    purpose, owner = channels.LEGACY_WEBHOOKS[rp.WEBHOOK_ENV]
    assert purpose == rp.WEBHOOK_PURPOSE == "rs_leaders"
    assert "rs_discord_post" in owner and "RS_DISCORD_POST_ENABLED" in owner, "the row says it is dark"
    assert channels.webhook_name("rs_leaders") == rp.WEBHOOK_ENV
    purposes = [p for p, _ in channels.LEGACY_WEBHOOKS.values()]
    assert len(purposes) == len(set(purposes)), "purposes stay unique"
    monkeypatch.setenv(rp.WEBHOOK_ENV, HOOK)
    assert channels.resolve_webhook("rs_leaders") == HOOK == rp.configured_webhook()
    monkeypatch.setenv(rp.WEBHOOK_ENV, "")
    assert channels.resolve_webhook("rs_leaders") == "" == rp.configured_webhook()


def test_the_ledger_carries_the_flag_dark_with_a_reason_and_stays_pure_crlf():
    raw = LEDGER.read_bytes()
    assert raw.count(b"\n") == raw.count(b"\r\n"), \
        "docs/feature_flags.json is a CRLF file; a bare LF means it was re-dumped"
    entry = json.loads(raw.decode("utf-8"))["flags"]["RS_DISCORD_POST_ENABLED"]
    assert entry["status"] == "dark" and entry["where"] == ["web"]
    note = entry["note"]
    for must in ("docs/alerts/RS-DISCORD-POST.md", "DISCORD_RS_WEBHOOK_URL", "2b-07", "2b-08",
                 "rs_discord_post", "RS_DISCORD_POST_ENABLED=1", "Rollback", "rs_discord_post.json"):
        assert must in note, must
    text = raw.decode("utf-8")
    assert text.index('"RS_DISCORD_POST_ENABLED"') < text.index('"RS_HISTORY_ENABLED"'), \
        "inserted textually beside its sibling"


def test_the_flag_index_sees_the_gate_as_off_by_default(tmp_path):
    """So tests/test_feature_flag_ledger.py demands (and finds) the entry."""
    from api.services import feature_flag_index as ffi
    (tmp_path / "m.py").write_text(MODULE.read_text(encoding="utf-8"), encoding="utf-8")
    found = ffi.gates([tmp_path], tmp_path)
    assert found["RS_DISCORD_POST_ENABLED"]["default"] == "0"
    assert ffi.needs_declaration("RS_DISCORD_POST_ENABLED", "0") is True
    assert "DISCORD_RS_WEBHOOK_URL" not in found, "a destination is not a gate"


def test_the_template_file_documents_the_seam_and_keeps_the_voice():
    text = TEMPLATE.read_text(encoding="utf-8")
    for key in rp.ROW_KEYS:
        assert f"`{key}`" in text, f"the seam contract names `{key}`"
    for must in ("leaders_fn", "evidence_fn", "DISCORD_RS_WEBHOOK_URL", "RS_DISCORD_POST_ENABLED",
                 "rs_discord_post.json", "2000", "rate-limited", "Owner review", "spy_change_pct",
                 "#uncharted-scanners", "DISCORD_RS_TEST_WEBHOOK_URL", "decided 2026-11-07"):
        assert must in text, must
    # Section 8 records the delegated decisions, not open choices (2026-11-07).
    section8 = text.split("## 8.")[1].split("## 9.")[0]
    for row in ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"):
        assert f"{row}," in section8, row
    assert "none is decided here" not in text and "## 8. Owner review - the choices" not in text
    prose = re.sub(r"<!-- [a-z-]+:(?:start|end) -->", "", text)
    assert not rp._EMOJI_RE.search(prose) and "—" not in prose and "!" not in prose, \
        "operator voice: no emoji, no em dashes, no exclamation marks (the sample markers are machinery)"
