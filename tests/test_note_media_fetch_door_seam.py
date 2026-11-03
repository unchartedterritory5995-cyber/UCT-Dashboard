"""Plan F Task 4 review (M-3, M-4): the member's media-fetch door goes through the ONE shared
`hotlink_fetch.fetch_and_store`, with its own seams, and gives back its in-flight slot when the
download ends, BEFORE the decode and store.

Fixtures and helpers are the door's own (`tests/test_note_media_fetch_route.py`), imported, not
copied; that file stays unchanged.
"""
from __future__ import annotations

import httpx

from api.services.journal_two import hotlink_fetch
from tests.test_note_media_fetch_route import (  # noqa: F401 -- pytest fixtures by name
    PNG, _HOT, _fetch, _fresh_inflight, _fresh_limiter, _imported, _login_as, app, attachment_root,
    client, db_path, web,
)


def test_the_door_releases_its_slot_before_decode_and_store(app, client, web, monkeypatch):
    """M-3: the slot is the DOWNLOAD's: decoding and storing never hold it."""
    from api.routers import journal_two as router
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    seen = []
    real_store = hotlink_fetch.store

    def spy(*args, **kwargs):
        seen.append(dict(router._media_fetch_inflight))
        return real_store(*args, **kwargs)

    monkeypatch.setattr(hotlink_fetch, "store", spy)
    r = _fetch(client)
    assert r.status_code == 200, r.text
    assert seen == [{}]  # the member's slot was already given back when the store ran


