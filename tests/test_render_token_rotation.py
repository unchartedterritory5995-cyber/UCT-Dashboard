"""Dual render-token acceptance on `web` — the rotation gate (step 1.1, OI-19).

The render token is checked in exactly two places, both on `web`:
  * `api/routers/render_panels.py::_check_token` — the `/api/r/*` payload gate (this file);
  * `app/src/lib/renderToken.js` — the 14 `/r/*` pages (railed in `app/src/lib/renderToken.test.js`).

chart-renderer is NOT in the path: it navigates to whatever URL it is handed and validates nothing.
A `CHART_RENDER_TOKEN_PREVIOUS` set on that service would be read by no code at all.

What must hold through a rotation: the new token works, the old token keeps working while
`CHART_RENDER_TOKEN_PREVIOUS` is set, everything else is refused, and clearing PREVIOUS ends it.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.routers import render_panels as rp

NEW, OLD, OTHER = "new-token-value", "old-token-value", "some-other-value"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("CHART_RENDER_TOKEN", raising=False)
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    rp._RL.clear()
    rp._RL_BUCKETS.clear()
    yield
    rp._RL.clear()
    rp._RL_BUCKETS.clear()


def _allows(token: str) -> bool:
    rp._RL.clear()
    rp._RL_BUCKETS.clear()
    try:
        rp._check_token(token)
        return True
    except HTTPException as e:
        assert e.status_code == 403
        return False


def test_before_a_rotation_only_the_current_token_works(monkeypatch):
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    assert _allows(NEW)
    assert not _allows(OLD)
    assert not _allows(OTHER)
    assert not _allows("")


def test_during_a_rotation_both_tokens_work(monkeypatch):
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", OLD)
    assert _allows(NEW), "the new token must work the moment it is set"
    assert _allows(OLD), "the old token must keep working until PREVIOUS is cleared"
    assert not _allows(OTHER)
    assert not _allows("")


def test_clearing_previous_ends_the_rotation(monkeypatch):
    """The whole point: after the retire step the old token is dead."""
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", OLD)
    assert _allows(OLD)
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS")
    assert not _allows(OLD), "the retired token still opens the gate"
    assert _allows(NEW)


def test_it_fails_closed_when_the_current_token_is_unset(monkeypatch):
    """⛔ A lone PREVIOUS must never hold the gate open — that is how a half-finished rotation
    becomes an open door."""
    assert not _allows(""), "unset CHART_RENDER_TOKEN must refuse everything"
    assert not _allows(NEW)
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", OLD)
    assert not _allows(OLD), "PREVIOUS alone opened the gate with no current token set"
    assert not _allows("")


def test_an_empty_previous_never_authorises_an_empty_token(monkeypatch):
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", "")
    assert not _allows("")
    assert _allows(NEW)


def test_accepted_tokens_lists_only_what_is_set(monkeypatch):
    assert rp._accepted_tokens() == []
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    assert rp._accepted_tokens() == [NEW]
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", OLD)
    assert rp._accepted_tokens() == [NEW, OLD]


def test_a_valid_token_still_spends_the_rate_limit(monkeypatch):
    """Dual acceptance must not have moved the gate ahead of the rate limiter."""
    monkeypatch.setenv("CHART_RENDER_TOKEN", NEW)
    rp._RL.clear()
    rp._RL_BUCKETS.clear()
    for _ in range(rp._RL_MAX_PER_MIN):
        rp._check_token(NEW)
    with pytest.raises(HTTPException) as e:
        rp._check_token(NEW)
    assert e.value.status_code == 429


def test_chart_renderer_is_not_in_the_token_path():
    """OI-19, kept as a rail so nobody adds a phantom CHART_RENDER_TOKEN to that service: the
    renderer's source must not read the token at all."""
    import pathlib
    app = pathlib.Path(__file__).resolve().parents[1] / "services" / "chart_renderer" / "app.py"
    src = app.read_text(encoding="utf-8")
    assert "CHART_RENDER_TOKEN" not in src, (
        "services/chart_renderer/app.py now reads CHART_RENDER_TOKEN. The renderer navigates to "
        "whatever URL it is handed; the token is validated on web (render_panels.py + "
        "app/src/lib/renderToken.js). A token variable on that service would be read by nothing.")
