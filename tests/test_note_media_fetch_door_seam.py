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


def test_the_door_delegates_to_the_shared_fetch_with_its_own_seams(app, client, web, monkeypatch):
    """M-4: behavioural, not a source-text check. The door calls `fetch_and_store` with ITS
    client factory, deadline and semaphore, read at call time."""
    from api.routers import journal_two as router
    _login_as(app, "u1")
    note_id = _imported(client, "notion:page-1")
    calls = []
    real = hotlink_fetch.fetch_and_store

    async def spy(user_id, n_id, url, **kwargs):
        calls.append((user_id, n_id, url, kwargs))
        return await real(user_id, n_id, url, **kwargs)

    monkeypatch.setattr(hotlink_fetch, "fetch_and_store", spy)
    monkeypatch.setattr(router, "MEDIA_FETCH_DEADLINE_S", 7.5)
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    r = _fetch(client)
    assert r.status_code == 200, r.text
    assert len(calls) == 1
    user_id, n_id, url, kwargs = calls[0]
    assert (user_id, n_id, url) == ("u1", note_id, _HOT)
    assert kwargs["client_factory"] is router._media_fetch_client
    assert kwargs["deadline_s"] == 7.5
    assert kwargs["semaphore"] is router._MEDIA_FETCH_SEM
    assert callable(kwargs["after_download"])

