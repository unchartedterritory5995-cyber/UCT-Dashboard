"""/r/buzz data endpoint: token gate and payload shape."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "secret-token")
    from api.services import buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    from api.main import app
    return TestClient(app), buzz_store


def test_requires_the_render_token(client):
    c, _ = client
    assert c.get("/api/r/buzz").status_code in (401, 403)
    assert c.get("/api/r/buzz", params={"token": "wrong"}).status_code in (401, 403)


def test_returns_rows_and_coverage(client):
    c, store = client
    import time
    ts = int(time.time()) - 60
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(4)])
    r = c.get("/api/r/buzz", params={"token": "secret-token", "window": "today"})
    assert r.status_code == 200
    body = r.json()
    assert body["rows"][0]["ticker"] == "NVDA"
    assert body["rows"][0]["people"] == 4
    assert isinstance(body["rows"][0]["spark"], list)
    assert "coverage" in body and "label" in body


def test_empty_store_returns_an_empty_list_not_an_error(client):
    c, _ = client
    r = c.get("/api/r/buzz", params={"token": "secret-token"})
    assert r.status_code == 200 and r.json()["rows"] == []


# ── The privacy contract. Until now it was a COMMENT in the handler's
# docstring, and the assertions above name three fields they expect to find --
# a test that lists what should be present cannot notice what should not be.
#
# The risk is concrete, not theoretical: `buzz_boards.ticker_detail`, in the
# module this endpoint already imports, returns a `link` built from
# channel_id + message_id. This endpoint's render token ships inside the
# frontend JS bundle, so anything here is effectively public, and a jump link
# identifies WHO said something and WHERE. This repo's own idiom for exactly
# this shape is `test_the_live_payload_never_carries_drill_lists`: pin the KEY
# SET so nobody can quietly inline them.
_FORBIDDEN = {"author_id", "authorId", "message_id", "messageId",
              "channel_id", "channelId", "link", "url", "jump", "jump_url"}


def _all_keys(node):
    """Every mapping key anywhere in the payload, at any depth."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from _all_keys(v)


def test_the_payload_never_carries_member_identity_or_jump_links(client):
    c, store = client
    import time
    ts = int(time.time()) - 60
    store.record_mentions([(str(2000 + i), "CH1", f"u{i}", "NVDA", ts, "exact")
                           for i in range(6)])
    store.record_mentions([(str(3000 + i), "CH1", f"v{i}", "AMD", ts, "exact")
                           for i in range(2)])
    body = c.get("/api/r/buzz", params={"token": "secret-token",
                                        "window": "today"}).json()

    # The whole tree, not just the top level: rows, tail, heat and singles are
    # where a per-message field would actually land.
    leaked = _FORBIDDEN & set(_all_keys(body))
    assert leaked == set(), f"identity fields in a public payload: {sorted(leaked)}"

    # And the shape is pinned, so a NEW key has to be a deliberate edit here.
    assert set(body) == {"window", "label", "rows", "tail", "singles",
                         "heat", "totals", "coverage", "asOf"}
    assert set(body["rows"][0]) == {"ticker", "mentions", "people", "spark", "hot"}


def test_an_unknown_window_is_normalized_rather_than_mislabelled(client):
    """window_bounds refuses a name it cannot compute. The boundary that takes
    outside input coerces to the default FIRST, so the bounds and the label can
    never describe different questions -- the failure this replaces served
    today's numbers under the caller's own made-up label."""
    c, _ = client
    r = c.get("/api/r/buzz", params={"token": "secret-token", "window": "yesterday"})
    assert r.status_code == 200
    body = r.json()
    assert body["window"] == "open"
    assert body["label"] == "since the open"


def test_member_traffic_cannot_rate_limit_the_newsletters_renders():
    """⛔ /r/* shared ONE 60/min sliding window, sized for the once-a-day
    newsletter (~5 requests). /r/buzz is driven by MEMBERS -- one
    chart-renderer fetch per ticker-less /buzz -- so sixty invocations in a
    minute on announcement day would have 429'd the Morning Wire's
    /r/catalysts, /r/calendar and /r/movers along with it. Separate buckets
    mean member traffic can only ever starve itself."""
    import pytest as _pytest
    from fastapi import HTTPException
    from api.routers import render_panels as rp

    rp._RL_BUCKETS.clear()
    rp._RL.clear()
    for _ in range(rp._RL_BUZZ_MAX_PER_MIN):
        rp._rate_limit("buzz", rp._RL_BUZZ_MAX_PER_MIN)
    with _pytest.raises(HTTPException):
        rp._rate_limit("buzz", rp._RL_BUZZ_MAX_PER_MIN)

    # The newsletter's bucket is untouched by all of that.
    rp._rate_limit()
    assert len(rp._RL) == 1
    rp._RL_BUCKETS.clear()
    rp._RL.clear()


def test_the_image_marks_no_more_rows_hot_than_the_text_reply_names(client, monkeypatch):
    """⛔ DAY-ONE FINDING (2026-09-02, 11:30 ET). The render asked heat_board for
    12 while build_board_text asked for 4, so the picture and the words
    disagreed about what "heating up" meant -- and the picture was the noisy
    one: ELEVEN of fourteen head rows carried a pill, leaving the board almost
    entirely green and making the few NORMAL rows look like the anomaly.

    The room's total volume that day was 1.06x its weekday average, so this was
    not a busy day -- it is the ratio itself. Attention rotates, so whichever
    names lead today are by construction the ones above their own 30-session
    mean. Only the extreme tail deserves a mark.

    Both surfaces now read one constant, so they cannot drift apart again.
    """
    from api.services import buzz_boards, buzz_reply
    import inspect
    c, store = client
    import time
    ts = int(time.time()) - 60
    mid = 40000
    # Twelve names, all with today-only history: every one of them would be
    # "hot" against an empty baseline if nothing capped the marks.
    for i in range(12):
        for k in range(6):
            store.record_mentions([(str(mid), "CH1", f"u{k}", f"SYM{i:02d}", ts, "exact")])
            mid += 1
    body = c.get("/api/r/buzz", params={"token": "secret-token", "window": "today"}).json()
    marked = [r for r in body["rows"] if r.get("hot") is not None]
    assert len(marked) <= buzz_boards.HEAT_MARKS, (
        f"{len(marked)} rows marked hot, ceiling is {buzz_boards.HEAT_MARKS}")
    assert len(body["heat"]) <= buzz_boards.HEAT_MARKS

    # ⛔ The two surfaces must ask for the SAME size. A hard-coded number in
    # either one is how they drifted apart the first time.
    panel_src = inspect.getsource(
        __import__("api.routers.render_panels", fromlist=["x"]).buzz_panel)
    assert "HEAT_MARKS" in panel_src
    assert "HEAT_MARKS" in inspect.getsource(buzz_reply.build_board_text)
