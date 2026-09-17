r"""R29 / OI-13 step 6 — which render-token SLOT did a sender present?

⚰️ WHY THIS EXISTS. `CHART_RENDER_TOKEN_PREVIOUS` is set on `web` and holds a DIFFERENT value
from `CHART_RENDER_TOKEN` (measured 2026-09-15 by salted hash, in-process, never printed), so
production runs TWO live render credentials from a rotation nobody finished. Clearing the leftover
is one env change; the risk is a sender still holding it getting a silent 403 at `/r/*`. R29 says
do not clear until a DURABLE counter reads zero `previous` matches across a full weekday.

⛔ The counter must be DURABLE because `web` restarts ~20x/day — an in-memory count would mean
"zero since the last deploy", and a missed poll would be indistinguishable from a real zero.
⛔ SLOT NAMES ONLY. Never a token, a length, or a hash of the live value (C-13).
"""
from __future__ import annotations

import json

import pytest

from api.services.discord_render import token_slots


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    """⛔ Pin the path or this writes into the shared root — on this box, the owner's C:\\data."""
    monkeypatch.setenv("RENDER_TOKEN_SLOT_COUNTER_PATH", str(tmp_path / "token-slots.json"))
    token_slots._reset_for_tests()
    yield
    token_slots._reset_for_tests()


def test_a_previous_match_increments_only_previous():
    """⛔ THE LOAD-BEARING ONE. If both slots move together the counter cannot answer R29."""
    token_slots.note_match(token_slots.SLOT_PREVIOUS)
    slots = token_slots.snapshot()["slots"]
    assert slots["previous"]["count"] == 1
    assert slots["current"]["count"] == 0, "a previous match moved the current counter"


def test_a_current_match_increments_only_current():
    token_slots.note_match(token_slots.SLOT_CURRENT)
    slots = token_slots.snapshot()["slots"]
    assert slots["current"]["count"] == 1
    assert slots["previous"]["count"] == 0


def test_counts_survive_a_process_restart(tmp_path):
    """⛔⛔ THE WHOLE POINT. ~20 restarts/day; in-memory counts answer the wrong question."""
    token_slots.note_match(token_slots.SLOT_PREVIOUS)
    token_slots.note_match(token_slots.SLOT_CURRENT)
    token_slots._reset_for_tests()                         # the "restart"
    slots = token_slots.snapshot()["slots"]
    assert slots["previous"]["count"] == 1, "the counter did not survive the restart"
    assert slots["current"]["count"] == 1


def test_an_unknown_slot_is_refused():
    """⛔ NON-VACUITY: without this, a typo'd slot name would silently count as nothing and
    'zero previous matches' would be true for the wrong reason."""
    assert token_slots.note_match("nonsense") is False
    assert token_slots.snapshot()["slots"]["previous"]["count"] == 0


# ── C-13: nothing about either VALUE ever reaches disk ──────────────────────

def test_no_token_value_is_ever_written(tmp_path, monkeypatch):
    """⛔ C-13. The chart-renderer logged the render token in plaintext for two weeks."""
    secret = "s3cr3t-live-render-token-value"
    monkeypatch.setenv("CHART_RENDER_TOKEN", secret)
    token_slots.note_match(token_slots.SLOT_CURRENT, commit="abcdef123456")
    text = (tmp_path / "token-slots.json").read_text(encoding="utf-8")
    assert secret not in text, "the token VALUE reached the counter file"
    assert str(len(secret)) not in json.dumps(json.loads(text).get("slots", {})), \
        "the token LENGTH leaked into the slot record"
    for bad in ("token=", "Bearer ", "/webhooks/"):
        assert bad not in text


def test_the_snapshot_carries_slot_names_and_counts_only(tmp_path):
    token_slots.note_match(token_slots.SLOT_CURRENT)
    snap = token_slots.snapshot()
    assert set(snap["slots"]) == {"current", "previous"}
    for entry in snap["slots"].values():
        assert set(entry) <= {"count", "first_seen", "last_seen"}


# ── R29's own rule, as a pure function over the snapshot ────────────────────

def test_r29_refuses_while_a_previous_match_exists():
    token_slots.note_match(token_slots.SLOT_PREVIOUS)
    v = token_slots.r29_satisfied()
    assert v["ok"] is False and "previous-slot match" in v["reason"]


def test_r29_refuses_before_a_full_weekday_has_elapsed():
    token_slots.note_match(token_slots.SLOT_CURRENT)
    v = token_slots.r29_satisfied()
    assert v["ok"] is False and "of 24 h" in v["reason"], \
        "a counter minutes old must not satisfy a full-weekday condition"


def test_r29_is_satisfied_by_zero_previous_over_a_full_span(monkeypatch):
    """The positive case — without it every refusal above passes for the wrong reason."""
    token_slots.note_match(token_slots.SLOT_CURRENT)
    real = token_slots.snapshot

    def aged():
        s = real()
        s["since"] = "2026-01-01T00:00:00Z"        # long ago
        return s

    monkeypatch.setattr(token_slots, "snapshot", aged)
    v = token_slots.r29_satisfied()
    assert v["ok"] is True and "zero previous matches" in v["reason"]


def test_an_unreadable_counter_is_not_a_zero(tmp_path):
    """⛔ UNREADABLE IS NOT ZERO. R29's condition is 'zero previous matches'; a corrupt file
    must refuse, not satisfy. This is the absence-is-not-evidence rule applied to a credential."""
    (tmp_path / "token-slots.json").write_text("{ this is not json", encoding="utf-8")
    snap = token_slots.snapshot()
    assert snap.get("unreadable") is True
    v = token_slots.r29_satisfied()
    assert v["ok"] is False and "unreadable" in v["reason"]


# ── the accept decision must be untouched ───────────────────────────────────

def test_the_accept_decision_is_unchanged_when_the_volume_is_unwritable(monkeypatch, tmp_path):
    """⛔ Accounting must never change who gets served. An unwritable volume must not 403."""
    import hmac as _hmac

    from api.routers import render_panels
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("RENDER_TOKEN_SLOT_COUNTER_PATH", str(blocker / "sub" / "c.json"))
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tok-current")
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    render_panels._check_token("tok-current", bucket="test-unwritable")   # must not raise
    assert _hmac.compare_digest("tok-current", "tok-current")


def test_a_previous_slot_token_is_still_accepted_and_recorded(monkeypatch):
    """Dual acceptance is what makes a rotation safe — the counter observes it, never gates it."""
    from api.routers import render_panels
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tok-current")
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", "tok-previous")
    render_panels._check_token("tok-previous", bucket="test-prev")        # accepted
    assert token_slots.snapshot()["slots"]["previous"]["count"] == 1


def test_a_wrong_token_is_refused_and_counts_nothing(monkeypatch):
    """⛔ NON-VACUITY on the whole wiring: if everything counted, the counter means nothing."""
    from fastapi import HTTPException

    from api.routers import render_panels
    monkeypatch.setenv("CHART_RENDER_TOKEN", "tok-current")
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    with pytest.raises(HTTPException):
        render_panels._check_token("not-the-token", bucket="test-wrong")
    slots = token_slots.snapshot()["slots"]
    assert slots["current"]["count"] == 0 and slots["previous"]["count"] == 0


def test_a_lone_previous_still_fails_closed(monkeypatch):
    """⛔ The pre-existing invariant, re-asserted because this change touched the gate:
    'a lone PREVIOUS must never hold the gate open' when CURRENT is unset."""
    from fastapi import HTTPException

    from api.routers import render_panels
    monkeypatch.delenv("CHART_RENDER_TOKEN", raising=False)
    monkeypatch.setenv("CHART_RENDER_TOKEN_PREVIOUS", "tok-previous")
    with pytest.raises(HTTPException):
        render_panels._check_token("tok-previous", bucket="test-lone-prev")
