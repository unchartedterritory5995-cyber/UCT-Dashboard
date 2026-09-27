"""TERM-011 / RM-N09 step 4 — the SECOND transport, and the one sentence it is for.

⛔⛔ THE DELIVERABLE IS §1's ACCEPTANCE SENTENCE, NOT THE PLUMBING. Spec §6 step 4
(`docs/terminal-research/07-technical-architecture/term-011-ops-vs-business-events.md`)
wires a second transport for `(OPS, critical)` only, and states exactly why here and
not later: it is *"the one acceptance criterion a single channel cannot satisfy —
**'With the primary channel's variable blanked, a CRITICAL still reaches the second
channel'** (`backlog.md:586-587`)"*. §1 below is that sentence, executed: both Discord
variables are BLANKED, an OPS critical is emitted through the real sink, and the email
arrives anyway.

⭐ WHY THE CONTROLS IN §2 ARE PART OF THE DELIVERABLE. §1 alone passes on a transport
that emails EVERYTHING — every severity, every class — and such a transport turns a
pager into a mailing list, which is the failure the severity split exists to prevent.
So §2 asserts the negative half at every other severity in the union vocabulary
(`info`, `warning`, and the `warn` typo two scales share), for the BUSINESS class, and
for an unclassified producer, which must still refuse BY NAME across the extra hop.

⛔ AND §3 IS STEP 3'S INVARIANT, WHICH OUTRANKS THIS FEATURE. `OPS_ALERT_EMAIL_TO` is
set on no service, so step 4 must be INERT: with it blank, `emit` sends no mail and
the Discord leg lands exactly where it landed before. A blank variable that behaved
differently from an unset one would make `feedback_kill_switch_never_a_delete`'s lever
a coin flip, so §3 asserts the two are the same answer.

⛔ NO REAL EMAIL AND NO REAL POST LEAVES THIS FILE, TWO WAYS. The transport is faked
at its seam (`email_service.send_email`) and every address here is in a special-use
domain `email_service.is_unroutable` rejects, so even a fake that failed to install
could not reach a mailbox — asserted in §6 rather than assumed. The Discord leg is
faked at `_page_discord` wherever a webhook is configured at all.

⛔ SCOPED RUN ONLY: `python -m pytest tests/test_ops_second_transport.py
tests/test_alert_destination.py tests/test_alert_routing.py
tests/test_chart_health_alerts.py tests/test_chart_health_discord.py
tests/test_chart_health_escalation.py tests/test_chart_health_severity_vocabulary.py -q`.
Never an unscoped pytest on this box — one reached 18 GB and was OOM-killed, and `-k`
does not help because collection is where the memory goes.

⛔ WHAT THESE RAILS CANNOT DO. They prove the second leg reaches a fake transport
under a real decision. They cannot prove Resend delivers, they cannot prove an
operator reads the mailbox, and they say nothing about spec §4's classification —
that the ops CLASS is the right one for these alerts is a judgement reviewed by a
person or not reviewed at all.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from api.services import alert_destination as ad
from api.services import alert_routing as ar
from api.services import chart_health_alerts as cha
from api.services import email_service

REPO = Path(__file__).resolve().parents[1]

#: Stands in for whatever `DISCORD_WEBHOOK_URL` holds in production, and is
#: webhook-SHAPED so §6's leak rail has something real to look for.
TODAY = "https://discord.com/api/webhooks/111/TODAYS-ADMIN-CHANNEL-TOKEN"

#: ⛔ EVERY ADDRESS HERE IS IN A SPECIAL-USE DOMAIN (RFC 2606/6761) — `.test` — so
#: `email_service.send_email` refuses it before any network call even when it is NOT
#: faked. Asserted in §6; it is the belt under the seam fake's braces.
FIRST = "ops-pager@uct-ops.test"
SECOND = "ops-backup@uct-ops.test"
RECIPIENTS = (FIRST, SECOND)

#: ⭐ DERIVED, never typed — the union severity vocabulary is the resolver's own
#: priority table. A hand-typed list here would drift in the flattering direction,
#: and the word most likely to be added is a fourth spelling of "urgent".
SEVERITY_UNION = tuple(sorted(ar.SEVERITY_PRIORITY))
BELOW_CRITICAL = tuple(s for s in SEVERITY_UNION if s != ar.SEVERITY_CRITICAL)


@pytest.fixture(autouse=True)
def production_env(monkeypatch):
    """⭐ REPRODUCE PRODUCTION: the three new variables and the gate are ABSENT.

    Step 2's own words are *"the three destination variables are absent from every
    Railway service"*. Removing them here means a value leaked by another test cannot
    make an inertness rail pass for the wrong reason, or an acceptance rail pass on a
    recipient nobody in this file set.
    """
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV,
                 ar.ADMIN_WEBHOOK_ENV, ar.ROUTING_FLAG_ENV):
        monkeypatch.delenv(name, raising=False)
    cha.clear()
    _ImmediateThread.started = []
    yield
    cha.clear()


def literal_env_reads_in(source: str, literal: str) -> list:
    """Line numbers where `source` READS the environment variable named `literal`.

    ⛔ AN AST WALK, NEVER A TEXT SEARCH — and the reason is the whole point of the
    rails that use it: these modules DISCUSS `OPS_ALERT_EMAIL_TO` and `ADMIN_EMAILS`
    at length in prose, because the hazard is worth explaining. A grep would be red
    on arrival for the comments that exist to prevent the defect
    (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`'s cousin). The
    shape is `tests/test_alert_destination.py::literal_reads_in`'s.
    """
    hits: list = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            func = node.func
            if not isinstance(func, ast.Attribute):
                continue
            root, attr = func.value, func.attr
            is_environ_get = (isinstance(root, ast.Attribute) and root.attr == "environ"
                              and attr == "get")
            is_getenv = (isinstance(root, ast.Name) and root.id == "os"
                         and attr == "getenv")
            if (is_environ_get or is_getenv) and node.args \
                    and isinstance(node.args[0], ast.Constant) \
                    and node.args[0].value == literal:
                hits.append(node.lineno)
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) \
                and node.value.attr == "environ" \
                and isinstance(node.slice, ast.Constant) and node.slice.value == literal:
            hits.append(node.lineno)
    return sorted(hits)


def test_the_env_read_detector_distinguishes_a_READ_from_a_MENTION():
    """⛔ NON-VACUITY IN BOTH DIRECTIONS, positive case first: a detector answering
    `[]` for everything would make both §5 rails below pass over anything."""
    real = ('import os\n'
            'a = os.environ.get("OPS_ALERT_EMAIL_TO")\n'
            'b = os.getenv("OPS_ALERT_EMAIL_TO", "")\n'
            'c = os.environ["OPS_ALERT_EMAIL_TO"]\n')
    assert literal_env_reads_in(real, "OPS_ALERT_EMAIL_TO") == [2, 3, 4]

    prose = ('"""OPS_ALERT_EMAIL_TO is the second transport."""\n'
             '# x = os.environ.get("OPS_ALERT_EMAIL_TO")\n'
             'NAME = "OPS_ALERT_EMAIL_TO"\n'
             'y = os.environ.get(NAME)\n'
             'z = os.environ.get("ADMIN_EMAILS")\n')
    assert literal_env_reads_in(prose, "OPS_ALERT_EMAIL_TO") == []
    assert literal_env_reads_in(prose, "ADMIN_EMAILS") == [5]


class _ImmediateThread:
    """`threading.Thread` that runs its target on `.start()`, and remembers how.

    ⛔ The two legs are fire-and-forget by design, so a test that did not collapse
    the thread would assert over an empty recorder and pass whatever the product did
    — the rail would be measuring a race, in the flattering direction.
    """

    started: list = []

    def __init__(self, target=None, daemon=None, name=None, **kwargs):
        self._target = target
        self.daemon = daemon
        self.name = name

    def start(self):
        type(self).started.append({"daemon": self.daemon, "name": self.name})
        if self._target is not None:
            self._target()


class _ThreadingShim:
    Thread = _ImmediateThread


@pytest.fixture
def sent(monkeypatch):
    """The seam fake: every `send_email` the second transport attempts, in order."""
    calls: list = []

    def _send_email(to, subject, html):
        calls.append({"to": to, "subject": subject, "html": html})
        return True

    monkeypatch.setattr(email_service, "send_email", _send_email)
    _ImmediateThread.started = []
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    return calls


@pytest.fixture
def paged(monkeypatch):
    """The Discord leg, faked at ITS seam so no test can post to a real channel."""
    calls: list = []
    monkeypatch.setattr(cha, "_page_discord",
                        lambda alert_key, message: calls.append((alert_key, message)))
    return calls


# ═══════════════════════════════════════════════════════════════════════════════
#  §1 — THE ACCEPTANCE SENTENCE. Primary blanked, a CRITICAL still arrives.
# ═══════════════════════════════════════════════════════════════════════════════

def test_ACCEPTANCE_with_the_PRIMARY_channel_BLANK_a_CRITICAL_still_reaches_the_SECOND_transport(
        monkeypatch, sent, paged):
    """⛔⛔ THE WHOLE REASON STEP 4 EXISTS, AS ONE TEST.

    `backlog.md:586-587`, quoted by spec §6 step 4: *"With the primary channel's
    variable blanked, a CRITICAL still reaches the second channel."* Both Discord
    variables are blanked with `setenv(..., "")` — ⛔ never `delenv`, per
    `tools/audit_sandbox_env.py:57-58`, because BLANK is the off switch an operator
    actually uses and unset is a different (and here, identical) fact.

    ⭐ THE NON-VACUITY HALF IS THE PRIMARY'S SILENCE. If the webhook were configured
    the Discord leg would fire and this test would pass without saying anything about
    a second channel — so it asserts the primary resolved to NOTHING and that nothing
    was paged, in the same run that proves the email went out.
    """
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, ", ".join(RECIPIENTS))

    # ← the non-vacuity half: the FIRST channel really has nowhere to go.
    assert ad.ops_webhook(ar.SEVERITY_CRITICAL) == ""

    assert cha.emit("acceptance_bars_store_unhealthy", ar.SEVERITY_CRITICAL,
                    "the bars store answered nothing for 3 cycles") is True

    assert paged == [], "the primary was blank and something still posted to it"
    assert [c["to"] for c in sent] == list(RECIPIENTS), (
        "with the primary channel blanked, the CRITICAL reached nobody on the second "
        "transport — which is the one property a single channel cannot have")
    # …and it arrived as a page a human can act on: the key, and the message.
    for call in sent:
        assert "acceptance_bars_store_unhealthy" in call["subject"]
        assert "answered nothing for 3 cycles" in call["html"]


def test_the_alert_still_QUEUES_and_THROTTLES_exactly_as_before(monkeypatch, sent, paged):
    """⛔ The second leg is additive. `emit`'s return value, the deque and the
    per-(key, severity) throttle are step 3's behaviour and step 4 does not touch
    them — a repeat inside the window emits nothing at all, on either leg."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)

    assert cha.emit("queue_key", ar.SEVERITY_CRITICAL, "first") is True
    assert cha.list_recent()[0]["alert_key"] == "queue_key"
    assert len(sent) == 1

    assert cha.emit("queue_key", ar.SEVERITY_CRITICAL, "second") is False
    assert len(sent) == 1, "the deque throttle admitted a second send"


# ═══════════════════════════════════════════════════════════════════════════════
#  §2 — THE CONTROLS. A pager, not a mailing list.
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("severity", BELOW_CRITICAL)
def test_the_CONTROL_every_severity_BELOW_critical_reaches_NOBODY(
        monkeypatch, sent, paged, severity):
    """⛔⛔ WITHOUT THIS, §1 PASSES ON A TRANSPORT THAT EMAILS EVERYTHING — and spec
    §6 step 4 is scoped to `critical` precisely because *a second transport on
    `warning` turns a pager into a mailing list*. The `warn` typo is in this sweep by
    construction: the list is the resolver's own priority table, and `warn` is a live
    word in the audit scale that has already been typed into this scale once.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, ", ".join(RECIPIENTS))

    assert cha.emit(f"control_{severity}", severity, "not a page") is True
    assert sent == [], f"severity {severity!r} reached the second transport"
    assert ad.ops_email_recipients(severity) == ()


def test_the_CONTROL_an_UNKNOWN_severity_reaches_NOBODY(monkeypatch, sent):
    """⚠️ `emit` takes severity as a FREE STRING and validates nothing, so the
    interesting case is a word nobody declared. It ranks lowest and names no second
    transport — an invented spelling of "urgent" must not page by accident."""
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    assert cha.emit("control_unknown", "URGENT!!", "invented word") is True
    assert sent == []


def test_the_CONTROL_the_second_transport_is_OPS_ONLY(monkeypatch):
    """⛔ BUSINESS at `critical` still reaches nobody, and the refusal is the
    RESOLVER'S OWN sentence rather than a second wording of one rule."""
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    leg = ad.second_transport_for(ar.CLASS_BUSINESS, ar.SEVERITY_CRITICAL)
    assert leg.recipients == ()
    assert leg.status == ar.CHANNEL_SKIPPED
    assert ar.CLASS_OPS in (leg.reason or ""), leg.reason
    # …and the control: the same call for OPS does name them, so the "no" above is
    # about the class and not about a reader that stopped reading.
    assert ad.second_transport_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL).recipients == (FIRST,)


@pytest.mark.parametrize("bad", [None, "", "both", "BOTH", "op", 7, ["ops"], object()])
def test_the_CONTROL_an_unclassified_producer_still_REFUSES_on_this_leg(monkeypatch, bad):
    """⛔ R2 MUST NOT SOFTEN ON THE NEW HOP (spec §7). A default here would route an
    ops alarm's second leg by guesswork, and the guess nobody sees is the one that
    ships."""
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    with pytest.raises(ar.UnroutableAlert):
        ad.second_transport_for(bad, ar.SEVERITY_CRITICAL)


def test_the_refusal_on_this_leg_names_THE_PRODUCER_not_the_plumbing(monkeypatch):
    """⛔ The frame arithmetic is per public function, so it is asserted per public
    function. The plumbing's FULL DOTTED NAME is the discriminator: this module is
    `tests.test_ops_second_transport`, and a bare-suffix check could not tell
    "named the plumbing" from "named the producer"."""
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    with pytest.raises(ar.UnroutableAlert) as raised:
        ad.second_transport_for("both", ar.SEVERITY_CRITICAL)
    text = str(raised.value)
    assert __name__ in text, f"the refusal did not name this module: {text}"
    assert ad.__name__ not in text, f"the refusal named the reader, not the producer: {text}"


# ═══════════════════════════════════════════════════════════════════════════════
#  §3 — INERT TODAY. Step 3's invariant survives step 4.
# ═══════════════════════════════════════════════════════════════════════════════

def test_the_INVARIANT_with_the_delivery_variable_BLANK_nothing_is_sent_and_the_PAGE_is_unchanged(
        monkeypatch, sent, paged):
    """⛔⛔ HOW THIS SHIPS, AND WHAT PRODUCTION HOLDS: `OPS_ALERT_EMAIL_TO` blank.

    The whole second leg must then be invisible — no mail, and the Discord page still
    lands on today's channel with today's bytes. ⭐ The page firing is the
    non-vacuity half: an `emit` that did nothing at all would also send no mail.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "")

    assert cha.emit("inert_key", ar.SEVERITY_CRITICAL, "still pages") is True
    assert paged == [("inert_key", "still pages")]
    assert sent == [], "a blank OPS_ALERT_EMAIL_TO sent mail to somebody"
    assert _ImmediateThread.started == [], "the second transport started a thread anyway"


def test_a_BLANK_delivery_variable_SAYS_WHY_rather_than_skipping_quietly(monkeypatch):
    """⭐ SPEC §5.2 FOR THIS VARIABLE: *"unset ⇒ the email leg reports
    `CHANNEL_SKIPPED` with the reason, and the post still goes to Discord …
    SILENCE on the second leg only, and it must say so."* The precedent it names is
    `compass_health.py:155-157`'s *"no recipients (set …)"*.

    ⛔ THE REASON MUST NAME THE VARIABLE, because that is the only sentence an
    operator can act on — and the NAME comes from the resolver, so this also proves
    the reader is not carrying a literal of its own.
    """
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "   ,  , ")
    leg = ad.second_transport_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    assert leg.recipients == ()
    assert leg.status == ar.CHANNEL_SKIPPED
    assert ar.OPS_EMAIL_ENV in (leg.reason or ""), leg.reason
    assert leg.env_name == ar.OPS_EMAIL_ENV     # ← it knew who to ask, and asked
    assert leg.routed is True


def test_an_UNSET_and_a_BLANK_delivery_variable_are_the_SAME_answer(monkeypatch):
    """⛔ `feedback_kill_switch_never_a_delete`: BLANKING is the off switch. If blank
    and unset differed, that lever would be a coin flip depending on how the last
    operator turned it off."""
    unset = ad.second_transport_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "")
    blank = ad.second_transport_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    assert (unset.recipients, unset.status, unset.reason) == \
           (blank.recipients, blank.status, blank.reason)


def test_the_kill_switch_sends_NOTHING_even_with_recipients_set(monkeypatch, sent, paged):
    """⭐ `ALERT_ROUTING_ENABLED=0` is specified to *"restore pre-split behaviour
    verbatim"*, and the pre-split path has no second leg — so it must not send mail
    nobody used to get. ⛔ The switch is consulted FIRST, before any class."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")

    assert cha.emit("killswitch_key", ar.SEVERITY_CRITICAL, "pre-split") is True
    assert paged == [("killswitch_key", "pre-split")], "the pre-split page stopped too"
    assert sent == []
    leg = ad.second_transport_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    assert leg.routed is False and leg.status == ar.CHANNEL_SKIPPED
    assert ar.ROUTING_FLAG_ENV in (leg.reason or ""), leg.reason


def test_the_CONTROL_the_kill_switch_really_is_what_stopped_it(monkeypatch, sent, paged):
    """⛔ Without this the test above passes on a leg that is wired to nothing, and
    "the rollback lever works" stays an untested claim on the day it matters."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert cha.emit("killswitch_control", ar.SEVERITY_CRITICAL, "routed") is True
    assert [c["to"] for c in sent] == [FIRST]


# ═══════════════════════════════════════════════════════════════════════════════
#  §4 — TWO LEGS, TWO BUDGETS.
# ═══════════════════════════════════════════════════════════════════════════════

def test_BOTH_legs_fire_when_BOTH_are_configured(monkeypatch, sent, paged):
    """⭐ The second transport is a SECOND leg, not a replacement: a configured
    Discord channel still gets the page in the same run the email goes out."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, ", ".join(RECIPIENTS))

    assert cha.emit("both_legs", ar.SEVERITY_CRITICAL, "both") is True
    assert paged == [("both_legs", "both")]
    assert [c["to"] for c in sent] == list(RECIPIENTS)


def test_neither_leg_SPENDS_the_others_cooldown(monkeypatch):
    """⛔⛔ THE LESSON THIS MODULE ALREADY PAID FOR, MIRRORED. `chart_health_alerts`'
    own header records a throttle keyed so that one statement swallowed another: *"a
    WARNING emitted at t=0 swallowed the CRITICAL page for the same condition for the
    next 10 minutes."* A page and an email are two statements about one condition, so
    they hold SEPARATE stores — and a shared store is exactly the mutation this
    catches.
    """
    key, now = "shared_budget", 1_000
    assert cha._should_page_discord(key, ar.SEVERITY_CRITICAL, now,
                                    webhook_present=True, enabled=True) is True
    assert cha._should_email_second_transport(key, now, recipients_present=True) is True, (
        "the Discord page spent the second transport's budget for this key")
    # …and the reverse, on a fresh key.
    assert cha._should_email_second_transport("shared_budget_2", now,
                                              recipients_present=True) is True
    assert cha._should_page_discord("shared_budget_2", ar.SEVERITY_CRITICAL, now,
                                    webhook_present=True, enabled=True) is True


def test_the_email_gate_cools_down_per_key_then_fires_again():
    """⛔ A persistent critical must not become a mail flood. Same bound as the page's,
    and per key, so two different conditions are never each other's silence."""
    assert cha._should_email_second_transport("cool", 1_000, recipients_present=True) is True
    assert cha._should_email_second_transport("cool", 1_900, recipients_present=True) is False
    assert cha._should_email_second_transport("cool", 2_900, recipients_present=True) is True
    assert cha._should_email_second_transport("cool_other", 1_000,
                                              recipients_present=True) is True


def test_no_recipients_is_the_gates_OWN_no():
    """⛔ And it must not advance the cooldown: a declined leg that consumed the
    window would silence the first real send after an operator sets the variable."""
    assert cha._should_email_second_transport("no_recips", 1_000,
                                              recipients_present=False) is False
    assert cha._should_email_second_transport("no_recips", 1_001,
                                              recipients_present=True) is True


def test_the_email_gate_CANNOT_be_gated_on_the_primary_channel(monkeypatch, sent):
    """⛔⛔ THE ACCEPTANCE PROPERTY, ASSERTED STRUCTURALLY AS WELL AS BEHAVIOURALLY.

    `_should_page_discord` takes `webhook_present` and returns False without it; if
    the second leg's gate ever grew the same parameter it would go silent in exactly
    the case step 4 was built for — and that regression is one keyword away. So the
    signature is pinned, with the page's own signature as the control proving this
    check can see such a parameter when there is one.
    """
    email_params = set(inspect.signature(cha._should_email_second_transport).parameters)
    page_params = set(inspect.signature(cha._should_page_discord).parameters)
    assert "webhook_present" in page_params                      # ← the control
    assert "webhook_present" not in email_params, sorted(email_params)
    assert "recipients_present" in email_params, sorted(email_params)

    # And the flag that turns the DISCORD page off does not reach this leg either:
    # a second transport the first channel's kill switch can silence is not one.
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    monkeypatch.setenv("CHART_HEALTH_DISCORD_ENABLED", "0")
    assert cha.emit("discord_flag_off", ar.SEVERITY_CRITICAL, "still mailed") is True
    assert [c["to"] for c in sent] == [FIRST]


# ═══════════════════════════════════════════════════════════════════════════════
#  §5 — ONE AUTHORITY. The name and the severity rule are never retyped.
# ═══════════════════════════════════════════════════════════════════════════════

def test_the_recipients_variable_NAME_comes_from_the_RESOLVER_not_a_literal():
    """⛔ NOTHING under `api/` READS `OPS_ALERT_EMAIL_TO` by literal. The name is
    declared once, in `alert_routing`, and travels as `decision.second_transport_env`
    — a literal read anywhere else is the second authority this ticket exists to
    remove, and it would be the one the producers actually run on.

    ⭐ THE NON-VACUITY HALF is the declaration: the literal IS assigned in
    `alert_routing`, so "nobody reads it by name" is a statement about reads.
    """
    declared = (REPO / "api" / "services" / "alert_routing.py").read_text(encoding="utf-8")
    assert f'"{ar.OPS_EMAIL_ENV}"' in declared                   # ← the control

    offenders = {}
    for path in sorted((REPO / "api").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        hits = literal_env_reads_in(path.read_text(encoding="utf-8"), ar.OPS_EMAIL_ENV)
        if hits:
            offenders[path.relative_to(REPO).as_posix()] = hits
    assert offenders == {}, (
        f"{ar.OPS_EMAIL_ENV} is read by literal somewhere under api/: {offenders}. It "
        f"must come from the resolver, through alert_destination.")

    names = set(ad.second_transport_for.__code__.co_names)
    assert "resolve_channel" in names
    assert "routing_enabled" in names


def test_the_CRITICAL_ONLY_rule_is_not_RE_TYPED_in_the_sink():
    """⛔ The sink's gate must not know the word `critical` for this leg. It asks
    whether recipients were RESOLVED, and the resolver is the one place that decides
    which severities have a second transport. ⭐ Control: `_should_page_discord` DOES
    carry the word, so this check can see one when it is there.
    """
    email_consts = {c for c in cha._should_email_second_transport.__code__.co_consts
                    if isinstance(c, str)}
    page_consts = {c for c in cha._should_page_discord.__code__.co_consts
                   if isinstance(c, str)}
    assert ar.SEVERITY_CRITICAL in page_consts                   # ← the control
    assert ar.SEVERITY_CRITICAL not in email_consts, sorted(email_consts)
    assert "severity" not in set(inspect.signature(
        cha._should_email_second_transport).parameters)


def test_the_delivery_variable_has_NO_ADMIN_EMAILS_FALLBACK(monkeypatch):
    """⛔⛔ A PRIVILEGE GRANT, NOT A CONVENIENCE. `api/routers/auth.py` promotes an
    address in `ADMIN_EMAILS` to `role='admin'` on signup and on login, so a chain
    ending there would make "who gets paged" a function of an AUTHORIZATION variable
    — in both directions. Spec §5.2 forbids it in the strongest terms it uses.

    ⚠️ It is also what keeps this step inert: `ADMIN_EMAILS` IS set in production and
    `OPS_ALERT_EMAIL_TO` is not, so a fallback would email real people on the first
    OPS critical after this lands.
    """
    monkeypatch.setenv("ADMIN_EMAILS", "a-real-person@example.test")
    monkeypatch.setenv("CATALYST_ALERT_EMAILS", "another@example.test")
    monkeypatch.setenv("DESK_DAILY_SESSION_ALERT_EMAILS", "third@example.test")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "")
    assert ad.ops_email_recipients(ar.SEVERITY_CRITICAL) == ()
    assert ad._addresses_of(None) == () and ad._addresses_of("") == ()

    # ⛔ And structurally: the reader and the sink READ no authorization variable.
    # The AST detector is what lets the prose above keep explaining the hazard.
    for rel in ("api/services/alert_destination.py",
                "api/services/chart_health_alerts.py"):
        source = (REPO / rel).read_text(encoding="utf-8")
        assert literal_env_reads_in(source, "ADMIN_EMAILS") == [], (
            f"{rel} reads ADMIN_EMAILS — an authorization variable")


# ═══════════════════════════════════════════════════════════════════════════════
#  §6 — IT CANNOT LEAK, IT CANNOT BLOCK, AND IT CANNOT SEND REAL MAIL.
# ═══════════════════════════════════════════════════════════════════════════════

def test_one_unroutable_address_does_not_SILENCE_the_rest(monkeypatch):
    """⛔ `compass_health.py:220-225`'s per-address try/except, and the reason it is
    there: a list is not an atomic recipient. One typo must cost one address."""
    delivered: list = []

    def _explode_for_the_first(to, subject, html):
        if to == FIRST:
            raise RuntimeError("Resend said no")
        delivered.append(to)
        return True

    monkeypatch.setattr(email_service, "send_email", _explode_for_the_first)
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, ", ".join(RECIPIENTS))

    assert cha.emit("partial_failure", ar.SEVERITY_CRITICAL, "msg") is True
    assert delivered == [SECOND]


def test_a_TOTAL_email_failure_never_reaches_the_caller(monkeypatch):
    """⛔ The alert path is the LAST thing that may raise. An exception escaping the
    second leg would take down whatever was reporting the outage."""
    def _explode(to, subject, html):
        raise RuntimeError("the whole mailer is down")

    monkeypatch.setattr(email_service, "send_email", _explode)
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    assert cha.emit("mailer_down", ar.SEVERITY_CRITICAL, "msg") is True


def test_the_second_transport_runs_on_a_DAEMON_thread(monkeypatch, sent):
    """⛔ `send_email` blocks on Resend behind a pool and a 10s timeout, and `emit` is
    called from watchdogs and request paths — so the send is off-thread, like the
    Discord page. A non-daemon thread would also hold up interpreter shutdown."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    assert cha.emit("daemon_key", ar.SEVERITY_CRITICAL, "msg") is True
    assert _ImmediateThread.started == [
        {"daemon": True, "name": "chart-health-ops-email"}], _ImmediateThread.started


def test_the_second_transport_never_carries_a_WEBHOOK_VALUE(monkeypatch, sent):
    """⛔⛔ A Discord webhook URL carries its own bearer token, and this leg sends to
    an outside mailbox. ⭐ The non-vacuity half is the alert key: the email really was
    composed, so the secret's absence is a property of the payload and not of an
    empty recorder."""
    secret = "https://discord.com/api/webhooks/999/SECRET-TOKEN-DO-NOT-LEAK"
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, secret)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, secret)
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, FIRST)
    monkeypatch.setattr(cha, "_page_discord", lambda *a: None)

    assert cha.emit("leak_key", ar.SEVERITY_CRITICAL, "a stale store") is True
    assert len(sent) == 1
    payload = sent[0]["subject"] + sent[0]["html"]
    assert "SECRET-TOKEN-DO-NOT-LEAK" not in payload
    assert "leak_key" in payload                                 # ← the non-vacuity half


def test_no_test_in_this_file_COULD_send_a_real_email():
    """⛔ *"Do not send a real email or a real Discord post from a test."* The seam
    fake is the guard; this is the belt under it. Every address here is in a
    special-use domain, so `email_service.send_email` refuses it before any network
    call even if the fake failed to install. ⭐ Control: a routable address is NOT
    refused, so this is a property of these addresses."""
    for address in RECIPIENTS:
        assert email_service.is_unroutable(address), address
    assert not email_service.is_unroutable("someone@uctintelligence.com")
