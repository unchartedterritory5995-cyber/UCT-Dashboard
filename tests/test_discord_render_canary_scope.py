"""A3 — with a canary allowlist set, a MEMBER channel takes the byte-for-byte pre-V2 path.

⛔⛔ THIS IS THE TEST THAT MAKES THE CANARY TRUSTWORTHY, AND IT IS A DIFFERENTIAL ONE.

OI-35 added `DISCORD_RENDER_V2_CHANNELS` so V2 can be narrowed to an admin-only channel. That
control is only worth anything if a member's interaction, arriving while V2 is switched ON, comes
back **identical** to what it would have been with V2 off. "V2 returned None and fell through" is a
claim about control flow; "the member got the same bytes" is a claim about the product, and only
the second one is what the owner is being asked to accept.

So every test here runs the REAL signed route twice and compares:

    A  V2 entirely off,                member channel  ->  reply_A
    B  V2 ON, allowlist = [canary],    member channel  ->  reply_B
    assert reply_A == reply_B, byte for byte

⛔ AND THE DISCRIMINATOR: with the interaction in the CANARY channel, V2 **is** consulted. Without
that row, a gate that refused everything — or a V2 branch that never ran at all — would pass every
assertion above and the canary would be a placebo.

⚠️ `json.dumps(..., sort_keys=True)` is the comparison, not `==` on dicts: two dicts can compare
equal while differing in a way a client sees (key order in a serialised body), and the thing Discord
receives is the serialisation.
"""
from __future__ import annotations

import json

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

from api.services import discord_interactions as di
from api.services.discord_render import commands

CANARY = "1549129739048853544"     # #render-smoke — private, admins + bot, members 0
MEMBER = "1546563720702853280"     # #chart-flow-requests — where the 1,558 members are


class _Runtime:
    """Records what V2 was asked to do. Offering anything at all is the failure this file hunts."""

    def __init__(self):
        self.offered, self.acks, self.refused = [], [], []
        self.per_user_max = 2
        self.store = type("S", (), {"get": staticmethod(lambda cid: None)})()

    def offer(self, job):
        self.offered.append(job)
        return ("queued", 1)

    def record_ack(self, cid, ms):
        self.acks.append((cid, ms))

    def record_refused(self, job, cls):
        self.refused.append((job.corr_id, cls))


class _EmptyStore:
    """The smallest store `health_payload` can use. The SLO half of the payload is not what these
    rows are about; the scope line is."""

    @staticmethod
    def recent(_seconds, limit=0):
        return []

    @staticmethod
    def stuck(*_a, **_k):
        # ⚠️ a COLLECTION, not a count — `observe` does `len(store.stuck(...))`. Returning 0 here
        # raises `TypeError: object of type 'int' has no len()`, which is a fake talking to itself.
        return []


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("DISCORD_RENDER_V2_ENABLED", "DISCORD_RENDER_V2_CHANNELS",
              "DISCORD_RENDER_V2_CHART_ENABLED", "DISCORD_RENDER_V2_FLOW_ENABLED",
              "CHART_FLOW_CHANNEL_ID", "FLOW_CMD_CHANNEL_ID", "DISCORD_CHART_ALLOWED_GUILDS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DISCORD_CHART_SELF_HEAL", "0")
    di.reset_rate_for_tests()
    yield
    di.reset_rate_for_tests()


def _slash(channel, name="chart", iid="1415926535897932384"):
    return {"type": 2, "id": iid, "application_id": "APP", "token": "TOK", "guild_id": UT_GUILD,
            "channel_id": channel, "member": {"user": {"id": "u1"}},
            "data": {"name": name, "options": [{"name": "ticker", "value": "NVDA"}]}}


def _run(monkeypatch, *, v2_on: bool, allowlist: str | None, channel: str, name="chart"):
    """One pass through the real signed route. Returns (serialised reply, pre-V2 ran?, v2 offers)."""
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    if v2_on:
        monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    else:
        monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)
    if allowlist is None:
        monkeypatch.delenv("DISCORD_RENDER_V2_CHANNELS", raising=False)
    else:
        monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", allowlist)

    tc, rt = _app_client()
    fake = _Runtime()
    monkeypatch.setattr(commands, "get_runtime", lambda: fake)
    pre_v2_ran: list = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pre_v2_ran.append(a))
    di.reset_rate_for_tests()

    r = _post(tc, sk, _slash(channel, name=name))
    assert r.status_code == 200, r.text
    return json.dumps(r.json(), sort_keys=True), bool(pre_v2_ran), list(fake.offered)


# ── the differential ─────────────────────────────────────────────────────────

def test_a_member_channel_is_byte_for_byte_pre_v2_while_the_canary_is_armed(monkeypatch):
    """⛔⛔ THE LOAD-BEARING ROW. Same route, same interaction, one with V2 off and one with V2 ON
    and narrowed to the canary. The member must not be able to tell."""
    reply_off, pre_off, off_offers = _run(
        monkeypatch, v2_on=False, allowlist=None, channel=MEMBER)
    reply_on, pre_on, on_offers = _run(
        monkeypatch, v2_on=True, allowlist=CANARY, channel=MEMBER)

    assert reply_off == reply_on, (
        "a member's reply CHANGED when V2 was armed for the canary:\n"
        f"  V2 off: {reply_off}\n  V2 on : {reply_on}")
    assert pre_off and pre_on, "the pre-V2 job must run in BOTH passes"
    assert off_offers == [] and on_offers == [], (
        "V2 was offered a job from a channel outside the canary")


def test_the_same_holds_for_flow(monkeypatch):
    """`/flow` shares the gate. A control that only covered /chart would leave the other
    member-visible command unprotected while reading as green."""
    reply_off, _, _ = _run(monkeypatch, v2_on=False, allowlist=None, channel=MEMBER, name="flow")
    reply_on, _, on_offers = _run(monkeypatch, v2_on=True, allowlist=CANARY,
                                  channel=MEMBER, name="flow")
    assert reply_off == reply_on
    assert on_offers == []


# ── the discriminator: without this, a dead V2 branch passes everything above ─

def test_the_canary_channel_DOES_reach_v2(monkeypatch):
    """⛔ NON-VACUITY. If V2 never ran at all, every row above would be green and the canary
    would be a placebo. This is the row that proves the allowlist ADMITS as well as refuses."""
    _, pre_ran, offers = _run(monkeypatch, v2_on=True, allowlist=CANARY, channel=CANARY)
    assert offers, "V2 was NOT consulted for the canary channel — the canary does nothing"
    assert not pre_ran, "the pre-V2 job ALSO ran for the canary channel — both paths fired"


def test_an_unset_allowlist_means_every_channel(monkeypatch):
    """The narrowing control is not a second kill switch: unset must still mean V2-everywhere,
    or a deployment that armed V2 and forgot this variable would render to nobody while every
    check reported it on."""
    _, _, offers = _run(monkeypatch, v2_on=True, allowlist=None, channel=MEMBER)
    assert offers, "with no allowlist set, V2 must answer in every channel"


def test_a_widened_allowlist_reaches_the_member_channel(monkeypatch):
    """The mutation this file is aimed at is 'somebody widens the allowlist'. Here it is as a
    behaviour: adding the member channel to the list DOES send members to V2 — which is the
    member flip, and is exactly why the canary-scope precondition compares the running list
    against the declared ids rather than merely checking that a list exists."""
    _, _, offers = _run(monkeypatch, v2_on=True, allowlist=f"{CANARY},{MEMBER}", channel=MEMBER)
    assert offers, "widening the allowlist did not actually widen V2's reach"


# ── the third proof: the running scope is READ BACK where an operator can see it ──

def test_renderhealth_prints_the_running_allowlist(monkeypatch):
    """⛔ A payload field nobody renders is not a read-back. `/renderhealth` runs INSIDE the
    process, so the list it prints is the list actually in force — which is the only read that can
    settle "is the canary still admin-only?". `--kv` shows what a service is CONFIGURED with, and
    this project has measured a pod returning None for a variable `--kv` reported as set."""
    from api.services.discord_render import observe

    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", CANARY)
    payload = observe.health_payload(None, _EmptyStore())
    assert payload["v2_channels"] == [CANARY]
    assert payload["v2_enabled"] is True
    text = observe.format_health_text(payload)
    assert f"<#{CANARY}>" in text, f"the canary id is not in the reply:\n{text}"
    assert "Scope: V2 ON" in text


def test_renderhealth_says_every_channel_rather_than_an_empty_list(monkeypatch):
    """⛔ UNSET MEANS EVERY CHANNEL. Rendering that as `[]` would read to an operator as
    'narrowed to nothing', which is the opposite of the truth and the safest-looking lie on
    the screen."""
    from api.services.discord_render import observe

    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    monkeypatch.delenv("DISCORD_RENDER_V2_CHANNELS", raising=False)
    payload = observe.health_payload(None, _EmptyStore())
    assert payload["v2_channels"] == "all"
    text = observe.format_health_text(payload)
    assert "every channel" in text
    assert "[]" not in text


def test_the_scope_line_can_tell_two_states_apart(monkeypatch):
    """⛔ NON-VACUITY for the two rows above: a line that printed the same thing regardless
    would satisfy a substring check. Assert the two states differ."""
    from api.services.discord_render import observe

    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", CANARY)
    narrowed = observe.format_health_text(observe.health_payload(None, _EmptyStore()))
    monkeypatch.delenv("DISCORD_RENDER_V2_CHANNELS", raising=False)
    wide = observe.format_health_text(observe.health_payload(None, _EmptyStore()))
    assert narrowed != wide, "the scope line reads identically narrowed and wide"


def test_a_literal_star_is_not_a_wildcard(monkeypatch):
    """⛔ `*` is a CHANNEL ID that does not exist, not a wildcard, and it must not accidentally
    behave like one. A reader who writes `DISCORD_RENDER_V2_CHANNELS=*` expecting 'everywhere'
    gets 'nowhere' — which is the safe direction, and is asserted rather than assumed."""
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", "*")
    assert commands.v2_channels() == ("*",)
    assert commands.channel_allowed({"channel_id": MEMBER}) is False
    assert commands.channel_allowed({"channel_id": CANARY}) is False
