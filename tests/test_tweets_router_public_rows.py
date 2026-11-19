"""The tweet read routes send every column a screen reads and never the provider's stored payload;
and stored posts expire whether or not the poller is on.

1. `api/routers/tweets.py`: `/ticker/{sym}`, `/tape` (its `sample_tweet`) and `/feed` returned whole
   store rows, payload included. No screen reads that column. The store still keeps it for the
   server's own use (the image links in `media` are read out of it), so it is dropped at the route.
2. `api/main.py`: the daily expiry job and the two Notebook post checks were registered inside the
   poller's `if`, so switching the poller off also switched off the expiry.
"""
import ast
from pathlib import Path

import pytest

from api.routers import tweets as tw

ROW = {"id": "1", "author_handle": "h", "author_name": "n", "text": "t", "created_at": 1, "url": "u",
       "reply_count": 0, "like_count": 2, "retweet_count": 3, "is_retweet": 0,
       "raw_json": '{"big": "payload"}', "ingested_at": 5, "tickers": ["NVDA"], "media": ["https://x/img.jpg"]}
SEEN_BY_SCREENS = set(ROW) - {"raw_json"}


def test_public_drops_only_the_stored_payload():
    out = tw._public(ROW)
    assert set(out) == SEEN_BY_SCREENS
    assert out["media"] == ROW["media"] and out["tickers"] == ["NVDA"]
    assert ROW["raw_json"]                      # the caller's row is not mutated
    assert tw._public(None) is None             # a ticker with no sample post


def test_the_ticker_route_sends_no_payload(monkeypatch):
    monkeypatch.setattr(tw.tweet_store, "tweets_for_ticker", lambda sym, hours=24: [dict(ROW), dict(ROW, id="2")])
    out = tw.tweets_for_ticker(sym="NVDA", hours=24, user={"id": "u"})
    assert [r["id"] for r in out] == ["1", "2"]
    assert all("raw_json" not in r for r in out)


def test_the_tape_route_sends_no_payload_in_its_sample(monkeypatch):
    rows = [{"ticker": "NVDA", "latest_at": 9, "n_tweets": 2, "sample_tweet": dict(ROW)},
            {"ticker": "ZZZ", "latest_at": 8, "n_tweets": 1, "sample_tweet": None}]
    monkeypatch.setattr(tw.tweet_store, "tape", lambda hours=12, limit=15: rows)
    monkeypatch.setattr(tw, "_current_mover_symbols", lambda: set())
    out = tw.tape(hours=12, limit=15, user={"id": "u"})
    assert [r["ticker"] for r in out] == ["NVDA", "ZZZ"]
    assert "raw_json" not in out[0]["sample_tweet"] and out[0]["sample_tweet"]["text"] == "t"
    assert out[1]["sample_tweet"] is None
    assert rows[0]["sample_tweet"]["raw_json"]  # the store's own row is untouched


@pytest.mark.parametrize("official", [False, True])
def test_the_feed_route_sends_no_payload(monkeypatch, official):
    asked = {}

    def feed(hours=12, limit=50, official_only=False):
        asked["official_only"] = official_only
        return [dict(ROW)]

    monkeypatch.setattr(tw.tweet_store, "feed", feed)
    out = tw.feed(hours=12, limit=50, official=official, user={"id": "u"})
    assert asked["official_only"] is official
    assert set(out[0]) == SEEN_BY_SCREENS


def _main_src():
    return (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")


def _if_block_lines(src):
    """(first line, last line) of the poller's `if` statement, by AST."""
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.If) and "TWITTERAPI_IO_ENABLED" in ast.unparse(node.test):
            return node.lineno, node.end_lineno
    raise AssertionError("the poller's `if` was not found")


@pytest.mark.parametrize("job_id", ["tweet_cleanup_daily", "notebook_tweet_capture_sweep", "notebook_tweet_capture_confirm"])
def test_the_expiry_jobs_are_registered_outside_the_pollers_if(job_id):
    src = _main_src()
    first, last = _if_block_lines(src)
    lines = [i for i, line in enumerate(src.splitlines(), 1) if f'id="{job_id}"' in line]
    assert len(lines) == 1, job_id
    assert not (first <= lines[0] <= last), f"{job_id} is registered only while the poller is on"


def test_the_poll_jobs_are_still_registered_only_with_the_poller():
    src = _main_src()
    first, last = _if_block_lines(src)
    polls = [i for i, line in enumerate(src.splitlines(), 1) if 'id="tweet_poll_' in line]
    assert len(polls) >= 4
    assert all(first <= i <= last for i in polls)
