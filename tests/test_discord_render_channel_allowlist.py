"""OI-34 — the chart/flow channel gate is an ALLOWLIST, and the nudge still names the member's channel.

⚰️ WHY THIS EXISTS. Until 2026-09-14 `cmd_channel_ok` compared the interaction's channel against a
single id. That is correct for members and fatal for testing: the ONLY way to run `/chart` anywhere
else was to repoint `CHART_FLOW_CHANNEL_ID`, which does not ADD a channel — it MOVES the command,
taking `/chart`, `/charts` and `/flow` away from all ~1,558 members of the guild for the duration.
So the private smoke channel could not be exercised, and the "admin-only canary" the flip packet
assumes had nowhere to exist. It also explains, entirely, why the /chart shadow saw no traffic: a
member can only run it in one channel.

⛔ THE LOAD-BEARING TEST IN THIS FILE IS `test_the_nudge_names_the_member_facing_channel_never_a_later_one`.
Everything else here is about letting MORE channels through; that one is about not breaking the
member-facing half while doing it. A nudge pointing at a private admin channel renders for a member
as a link to a channel that does not exist for them.
"""
from __future__ import annotations

import pytest

from api.services import discord_interactions as di

MEMBER_CHANNEL = "1546563720702853280"   # #chart-flow-requests, the real one
SMOKE_CHANNEL = "1549129739048853544"    # #render-smoke, private, admins + bot only


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("CHART_FLOW_CHANNEL_ID", "FLOW_CMD_CHANNEL_ID"):
        monkeypatch.delenv(k, raising=False)
    yield


def _interaction(channel: str) -> dict:
    return {"channel_id": channel}


# --- the behaviour that must not change -------------------------------------------------

def test_one_id_behaves_exactly_as_before(monkeypatch):
    """The single-id deployment is the one running in production. It must be untouched."""
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", MEMBER_CHANNEL)
    assert di.cmd_channel_ok(_interaction(MEMBER_CHANNEL)) is True
    assert di.cmd_channel_ok(_interaction(SMOKE_CHANNEL)) is False
    assert di.cmd_channel_id() == MEMBER_CHANNEL


def test_unset_means_no_restriction(monkeypatch):
    assert di.cmd_channel_ids() == ()
    assert di.cmd_channel_ok(_interaction("anything")) is True
    assert di.cmd_channel_id() == ""


def test_flow_cmd_channel_id_is_still_the_fallback(monkeypatch):
    monkeypatch.setenv("FLOW_CMD_CHANNEL_ID", MEMBER_CHANNEL)
    assert di.cmd_channel_ok(_interaction(MEMBER_CHANNEL)) is True
    assert di.cmd_channel_ok(_interaction("999")) is False


def test_chart_flow_channel_id_wins_over_the_fallback(monkeypatch):
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", MEMBER_CHANNEL)
    monkeypatch.setenv("FLOW_CMD_CHANNEL_ID", "999")
    assert di.cmd_channel_ok(_interaction(MEMBER_CHANNEL)) is True
    assert di.cmd_channel_ok(_interaction("999")) is False


# --- the new behaviour ------------------------------------------------------------------

def test_two_ids_both_run(monkeypatch):
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f"{MEMBER_CHANNEL},{SMOKE_CHANNEL}")
    assert di.cmd_channel_ok(_interaction(MEMBER_CHANNEL)) is True
    assert di.cmd_channel_ok(_interaction(SMOKE_CHANNEL)) is True


def test_a_channel_not_on_the_list_is_still_refused(monkeypatch):
    """⛔ The discriminator. A gate that let everything through would pass every row above."""
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f"{MEMBER_CHANNEL},{SMOKE_CHANNEL}")
    assert di.cmd_channel_ok(_interaction("404404404404404404")) is False


def test_whitespace_and_trailing_commas_are_tolerated(monkeypatch):
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f" {MEMBER_CHANNEL} , {SMOKE_CHANNEL} ,, ")
    assert di.cmd_channel_ids() == (MEMBER_CHANNEL, SMOKE_CHANNEL)
    assert di.cmd_channel_ok(_interaction(SMOKE_CHANNEL)) is True


def test_a_list_of_only_separators_is_no_restriction_not_a_dead_gate(monkeypatch):
    """⛔ ",," must not parse to a one-element tuple of "" — that would compare against the
    empty string and refuse EVERY channel, taking the command away from everyone. Empty
    means unrestricted, exactly as an unset variable does."""
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", " , , ")
    assert di.cmd_channel_ids() == ()
    assert di.cmd_channel_ok(_interaction(MEMBER_CHANNEL)) is True


# --- the member-facing half -------------------------------------------------------------

def test_the_nudge_names_the_member_facing_channel_never_a_later_one(monkeypatch):
    """⛔⛔ THE ONE THAT MATTERS. `cmd_channel_id` feeds `_channel_nudge`, which renders
    "Please use <#id>" to a member who ran /chart in the wrong place. If it returned the
    LAST id, or any private entry, every such member would be pointed at a channel they
    cannot see — a member-visible regression caused purely by adding a test channel."""
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f"{MEMBER_CHANNEL},{SMOKE_CHANNEL}")
    assert di.cmd_channel_id() == MEMBER_CHANNEL
    assert di.cmd_channel_id() != SMOKE_CHANNEL


def test_the_nudge_still_has_something_to_name_when_a_single_id_is_set(monkeypatch):
    """Non-vacuity for the row above: it must be able to return a NON-empty id, or the
    assertion `!= SMOKE_CHANNEL` would pass for the uninteresting reason."""
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", SMOKE_CHANNEL)
    assert di.cmd_channel_id() == SMOKE_CHANNEL


def test_the_backcompat_aliases_still_point_at_the_same_functions():
    """/flow's handler reached these names first; they are still exported."""
    assert di.flow_channel_ok is di.cmd_channel_ok
    assert di.flow_channel_id is di.cmd_channel_id
