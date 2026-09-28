# api/services/alert_destination.py — TERM-011 / RM-N09, step 3: the ONE reader that
#                                     turns the pure resolver's NAMES into a value.
"""Which webhook a producer of a given alert CLASS should post to, read at CALL time.

Spec: ``docs/terminal-research/07-technical-architecture/term-011-ops-vs-business-events.md``
— §5.1 is the resolver's contract, §5.2 the variables and the failure direction of
each, §6 step 3 is this commit.

WHY THIS IS A SECOND MODULE AND NOT PART OF ``alert_routing``
─────────────────────────────────────────────────────────────
``alert_routing.resolve_channel`` answers in variable NAMES and is PURE. That is a
load-bearing property rather than a style: it never sees a webhook value, so it
cannot leak one into a log, a stamp or an exception message, and
``tests/test_alert_routing.py::test_the_ONLY_environment_read_in_the_module_is_the_gate_reader``
pins that module's only environment read to the gate reader, by AST, with a control
proving the derivation can see a read. Somebody still has to READ those variables.

This module is that somebody, and there is exactly ONE of it:
``tests/test_alert_destination.py`` pins that ``alert_routing`` has exactly one
importer under ``api/`` — this file — so a producer cannot retype the resolution
order and drift from it. That is spec §9's rule applied to the routing rather than
to the poster: *"Reuse the routing, not a second copy of the poster."*

⛔ IT IS NOT A TRANSPORT. It opens no socket, composes no payload and imports no
HTTP client. Every converted producer keeps its own POST, its own throttle, its own
User-Agent and its own message text, byte for byte.

⛔⛔ THE INVARIANT THAT OUTRANKS THE FEATURE
────────────────────────────────────────────
With ``DISCORD_OPS_WEBHOOK_URL`` unset OR blank — how it ships, and what production
holds today — ``ops_webhook()`` returns exactly what
``os.environ.get("DISCORD_WEBHOOK_URL")`` returned before this module existed. Same
destination, and every converted producer sends the same bytes to it. That is not a
hope, it is the deliverable: ``tests/test_alert_destination.py`` proves it AT THE
WIRE for each converted producer — the URL POSTed to and the exact body — and a
mutation that redirects the blank path reds it.

⛔ AN OPS ALERT THAT SILENTLY GOES NOWHERE IS WORSE THAN ONE IN THE WRONG ROOM:
this channel carries the pager. ``chart_health_alerts.py``'s own header records what
silence already cost — *"the in-memory deque was admin-pull-only, so a bars-store
problem paged no one — the gap that let the 2026-08-11 daily freeze run for a
week."* So the OPS row falls back to the compatibility floor deliberately; spec
§5.2's failure direction for it is NOISE, never silence.

⚠️ THE POST IS NOT STAMPED — A NAMED CONTRADICTION WITH THE SPEC, NOT AN OMISSION
─────────────────────────────────────────────────────────────────────────────────
Spec §5.2 asks an OPS post that fell back to be *stamped* ``route=fallback:admin``
so a misroute is visible in the message itself. Appending anything to a post is a
PAYLOAD change, and step 3's invariant is that a blank variable changes the payload
by zero bytes. Both cannot hold in this commit, so the invariant wins and the
contradiction is written down rather than papered over.

``alert_routing.route_stamp`` is therefore left exactly where it is, unused and
already railed. The stamp belongs to the first commit that SETS
``DISCORD_OPS_WEBHOOK_URL`` — the moment a fallback stops being today's ordinary
behaviour and starts being a misroute worth labelling. Spec §5.3's ``fallback=<n>``
roll-up is unbuilt here for the same reason: today every OPS post falls back, so a
counter would report the migration's starting state as a defect rate of 100%.
``Destination`` below carries ``env_name`` / ``used_fallback`` so that step is a
read rather than a re-derivation.

⚠️ NO STEP-3 PRODUCER PASSES A SEVERITY, DELIBERATELY. Severity changes no
destination (railed:
``test_alert_routing.py::test_severity_never_changes_the_destination``); the only
thing it would change is whether spec §6 **step 4**'s second transport fires, which
is step 4's decision to take per producer, with the owner. Several of the converted
producers have no severity field at all, so passing one would be an invention.
``destination_for`` accepts one for the step that needs it.

⭐ STEP 4 — THE SECOND TRANSPORT'S ADDRESSES, AND STILL NO TRANSPORT HERE
────────────────────────────────────────────────────────────────────────
``second_transport_for`` / ``ops_email_recipients`` turn the resolver's
``second_transport_env`` NAME into the addresses behind it, exactly as
``ops_webhook`` turns ``primary_env`` into a URL. They send nothing: the send stays
in the producer, which is spec §6 step 4's instruction — *"`catalyst/health.py:90-108`
posts to Discord **and** emails … Reuse that shape with a delivery-only variable per
§5.2"* — and it is why ``test_this_module_imports_no_transport`` is still true.

⛔⛔ THE DECISION IS THE RESOLVER'S, AND THIS MODULE DOES NOT RE-DERIVE IT. Whether
an alert reaches the second leg is *(OPS, critical) only*, and that rule lives once,
in ``alert_routing.SECOND_TRANSPORT_ENV_BY_CLASS`` / ``SECOND_TRANSPORT_MIN_PRIORITY``
(step 2). Nothing here compares a class or a severity: an empty recipient tuple IS
the resolver's "no", carried with its reason.

⛔ ``OPS_ALERT_EMAIL_TO`` HAS NO ``ADMIN_EMAILS`` FALLBACK, and that is the one place
this deliberately does NOT copy the shipped shape — see ``_addresses_of``.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from typing import Optional

# ⭐ NAMES AND THE DECISION COME FROM THE RESOLVER, never retyped here. A second
# copy of "OPS means DISCORD_OPS_WEBHOOK_URL falling back to DISCORD_WEBHOOK_URL"
# would be a second authority over one value, which is the defect this repo keeps
# paying for — and it would be the authority the producers actually run on.
from api.services.alert_routing import (
    ADMIN_WEBHOOK_ENV,
    CHANNEL_SKIPPED,
    CLASS_OPS,
    ROUTING_FLAG_ENV,
    ChannelDecision,
    resolve_channel,
    routing_enabled,
)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Destination:
    """Where a producer should POST, and which variable said so.

    ⛔⛔ ``url`` IS A CREDENTIAL. A Discord webhook URL contains its own bearer
    token, so it is the one field here that must never reach a log line, a post or
    an exception message. Everything reportable is derived from ``env_name``
    instead, and a rail plants a secret-shaped value and asserts it cannot appear
    in this object's ``repr`` or in the decision it carries.
    """

    #: The value to POST to. ``""`` when nothing is configured — every converted
    #: call site consults this by truthiness, exactly as it consulted
    #: ``os.environ.get("DISCORD_WEBHOOK_URL")`` before (which returned ``None``).
    url: str
    #: Which variable supplied ``url``; ``""`` when none did. NAMES are safe to log.
    env_name: str
    #: True iff ``url`` came from the compatibility floor rather than the class's
    #: own variable. Today that is the normal case, which is why nothing alerts on
    #: it — see the module header on the stamp.
    used_fallback: bool
    #: False when the kill switch took the pre-split path, so no class was consulted.
    routed: bool
    #: The resolver's answer, or ``None`` on the pre-split path.
    decision: Optional[ChannelDecision]


def _producer_of(explicit: Optional[str]) -> str:
    """The module that asked, for ``resolve_channel``'s refusal message.

    ⛔ THIS EXISTS BECAUSE THE REFUSAL WOULD OTHERWISE NAME THIS FILE.
    ``alert_routing._producer_of`` reads ``sys._getframe(2)``, which from inside
    ``resolve_channel`` is whoever called it — i.e. this module, on every refusal,
    for every producer. *"An unclassified emitter fails the rail by name"* is the
    whole point of the resolver's R2 rail, and a refusal naming the resolver's own
    plumbing names nobody. So each public function here derives its OWN caller and
    passes it down explicitly.

    Frame depth: 0 is this function, 1 is the public function that called it, 2 is
    the producer. A rail asserts the refusal names the CALLING TEST MODULE, which
    is what makes that arithmetic checkable rather than asserted.
    """
    if explicit:
        return str(explicit)
    try:
        return str(sys._getframe(2).f_globals.get("__name__") or "<producer not named>")
    except Exception:                               # pragma: no cover - defensive
        return "<producer not named>"


def destination_for(alert_class: object, severity: object = "", *,
                    producer: Optional[str] = None) -> Destination:
    """Resolve ``alert_class`` to a destination, reading the environment NOW.

    ⛔ READ AT CALL TIME, NEVER CAPTURED. ``api/services/discord_notify.py:11`` is
    the defect not to repeat — ``DISCORD_ADMIN_WEBHOOK = os.environ.get(...)`` as a
    module constant, so blanking the variable reaches nothing until the process
    restarts while the operator reads it back as empty and ``--kv`` agrees.
    ⚠️ A producer that captures THIS function's answer at import re-creates that
    defect one level up; two of the converted producers capture it once per
    process START, which is what they did with the literal read too and is
    therefore unchanged behaviour rather than a new one.

    ⛔ THE KILL SWITCH IS READ FIRST AND ALONE — ``routing_enabled()``, not
    ``routing_enabled_for()``. The second folds in a class check, and folding it in
    HERE would make an unrecognised class take the pre-split path silently: the
    default spec §5.1 forbids, wearing a predicate's clothes. With the switch ON an
    unknown class RAISES, as the resolver's R2 requires; with it OFF nothing routes
    by class at all, so there is no class to be wrong about.

    ⭐ THE ORDER IS THE RESOLVER'S, NOT THIS MODULE'S: primary then fallback, both
    taken from the ``ChannelDecision``. Nothing here names a variable except
    ``ADMIN_WEBHOOK_ENV`` on the pre-split path, where by definition no class was
    resolved and the compatibility floor is the only answer.
    """
    asked_by = _producer_of(producer)

    if not routing_enabled():                       # ⛔ the kill switch, FIRST
        url = os.environ.get(ADMIN_WEBHOOK_ENV) or ""
        return Destination(url=url, env_name=ADMIN_WEBHOOK_ENV if url else "",
                           used_fallback=False, routed=False, decision=None)

    decision = resolve_channel(alert_class, severity, producer=asked_by)
    candidates = [(decision.primary_env, False)]
    if decision.fallback_env:
        candidates.append((decision.fallback_env, True))
    for env_name, is_fallback in candidates:
        url = os.environ.get(env_name) or ""
        if url:
            return Destination(url=url, env_name=env_name, used_fallback=is_fallback,
                               routed=True, decision=decision)
    return Destination(url="", env_name="", used_fallback=False, routed=True,
                       decision=decision)


def ops_webhook(severity: object = "", *, producer: Optional[str] = None) -> str:
    """The OPS destination's URL, read NOW. ``""`` when nothing is configured.

    ⭐ THE ONE CALL EVERY STEP-3 PRODUCER MAKES, and it is a drop-in for the literal
    ``os.environ.get("DISCORD_WEBHOOK_URL")`` it replaces: with the new variables
    unset or blank it returns that variable's value, and ``""`` where the literal
    read returned ``None`` — every converted call site consults the result by
    truthiness, which is asserted per producer at the wire in
    ``tests/test_alert_destination.py``.

    ⛔ TOTAL FOR THIS CLASS, AND THAT MATTERS. ``CLASS_OPS`` is a member of
    ``ALERT_CLASSES``, so ``resolve_channel`` cannot refuse it and this cannot
    raise. Two of its callers are pagers — ``chart_health_alerts.emit`` and the
    event-loop watchdog — and an exception raised while looking up a destination
    would silence the alarm it was looking the destination up for.
    """
    return destination_for(CLASS_OPS, severity,
                           producer=_producer_of(producer)).url


# ══════════════════════════════════════════════════════════════════════════════
#  SPEC §6 STEP 4 — THE SECOND TRANSPORT. (OPS, critical) ONLY.
# ══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class SecondTransport:
    """WHO the second transport should reach, and why it declined when it did not.

    ⭐ ADDRESSES, NOT A CREDENTIAL — the one way this differs from ``Destination``.
    A Discord webhook URL carries its own bearer token; an email address does not,
    so ``recipients`` is safe to report. The skip ``reason`` still names only the
    VARIABLE, never a value, because that is the sentence an operator has to act on.
    """

    #: The addresses to send to, in the order the variable listed them. ``()`` means
    #: the leg does not fire — and ``reason`` says which of the three whys it was.
    recipients: tuple
    #: The variable that was (or would have been) read; ``""`` when no class named one.
    env_name: str
    #: ``CHANNEL_SKIPPED`` when this leg declined, ``None`` when it named recipients
    #: and the outcome is the producer's to report. ⛔ No new outcome word (spec §5.1).
    status: Optional[str]
    #: Why it declined. Present exactly when ``status`` is — spec §5.2 for this
    #: variable: *"SILENCE on the second leg only, and it must say so."*
    reason: Optional[str]
    #: False when the kill switch took the pre-split path, so no class was consulted.
    routed: bool
    #: The resolver's answer, or ``None`` on the pre-split path.
    decision: Optional[ChannelDecision]


def _addresses_of(raw: object) -> tuple:
    """Parse a comma-separated delivery-address variable.

    ⭐ THE SHIPPED SHAPE, NOT A NEW ONE: ``api/services/catalyst/health.py:104-107``
    is ``[e.strip() for e in recips.split(",") if e.strip()]`` and this is that,
    typed once. Blank, whitespace and a trailing comma all collapse to "no
    recipients", which is the same answer as unset — deliberately, because
    ``feedback_kill_switch_never_a_delete`` makes BLANKING the off switch and a
    blank that behaved differently from unset would make that lever a coin flip.

    ⛔⛔ AND THE ONE PLACE THIS DOES **NOT** COPY THE SHIPPED SHAPE: there is no
    ``or os.environ.get("ADMIN_EMAILS")`` tail. ``catalyst/health.py`` has one;
    spec §5.2 forbids it here in the strongest terms it uses, because
    ``api/routers/auth.py`` promotes an address in ``ADMIN_EMAILS`` to
    ``role='admin'`` on signup and on login — so a chain ending there would make
    "who gets paged" a function of an AUTHORIZATION variable in both directions:
    an operator adding a pager address would grant it production admin, and an
    operator adding an admin would silently subscribe a person to the pager.
    ⚠️ It is also what keeps this step inert on the day it lands: ``ADMIN_EMAILS``
    IS set on production and ``OPS_ALERT_EMAIL_TO`` is not, so a fallback would
    start emailing three real people on the first OPS critical.
    """
    if not isinstance(raw, str):
        return ()
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def second_transport_for(alert_class: object, severity: object = "", *,
                         producer: Optional[str] = None) -> SecondTransport:
    """Resolve the SECOND transport for ``alert_class`` at ``severity``, reading NOW.

    ⛔⛔ THE ACCEPTANCE CRITERION THIS EXISTS FOR (spec §6 step 4, ``backlog.md:586-587``):
    *"With the primary channel's variable blanked, a CRITICAL still reaches the second
    channel."* So this function consults the primary channel's variables **not at all**
    — no ``DISCORD_OPS_WEBHOOK_URL`` read, no ``DISCORD_WEBHOOK_URL`` read, no
    ``Destination``. A second leg that a first-leg read could suppress would be a
    second copy of the first channel, and the one property a single channel cannot
    have is the one this step is for.

    ⛔ THE KILL SWITCH IS READ FIRST AND ALONE, as in ``destination_for``. With
    ``ALERT_ROUTING_ENABLED=0`` the pre-split path is in force and the pre-split path
    has no second leg, so this declines and SAYS SO — *"restores pre-split behaviour
    verbatim"* has to include not sending mail nobody used to get.

    ⛔ IT DOES NOT DECIDE (OPS, critical). ``resolve_channel`` does, once, and an
    unnamed ``second_transport_env`` is carried back with the RESOLVER'S OWN reason
    rather than a locally-worded one — two wordings of one rule drift.

    :raises UnroutableAlert: on any class outside ``ALERT_CLASSES`` while the switch
        is on. R2 must not soften across a hop (spec §7).
    """
    asked_by = _producer_of(producer)

    if not routing_enabled():                       # ⛔ the kill switch, FIRST
        return SecondTransport(
            recipients=(), env_name="", status=CHANNEL_SKIPPED,
            reason=(f"class routing is off ({ROUTING_FLAG_ENV}), so the pre-split "
                    "path is in force and it has no second leg"),
            routed=False, decision=None)

    decision = resolve_channel(alert_class, severity, producer=asked_by)
    env_name = decision.second_transport_env
    if not env_name:
        # The resolver declined — not this class, or not critical. Its words, not ours.
        return SecondTransport(recipients=(), env_name="",
                               status=decision.second_transport_status,
                               reason=decision.second_transport_skip_reason,
                               routed=True, decision=decision)

    recipients = _addresses_of(os.environ.get(env_name))
    if not recipients:
        # ⭐ THE PRECEDENT, verbatim in shape — `compass_health.py:155-157` returns
        # "no recipients (set COMPASS_HEALTH_EMAIL_TO or ADMIN_EMAILS)" rather than
        # skipping quietly. The NAME is the resolver's; nothing here types it.
        return SecondTransport(recipients=(), env_name=env_name, status=CHANNEL_SKIPPED,
                               reason=f"no recipients (set {env_name})",
                               routed=True, decision=decision)

    return SecondTransport(recipients=recipients, env_name=env_name, status=None,
                           reason=None, routed=True, decision=decision)


def ops_email_recipients(severity: object = "", *,
                         producer: Optional[str] = None) -> tuple:
    """The OPS second transport's addresses for ``severity``. ``()`` when it declines.

    ⭐ THE ONE CALL THE PAGER MAKES, and it is the mirror of ``ops_webhook``: a
    producer asks "who, for this severity?" and gets addresses or nothing. The
    *(OPS, critical) only* rule is therefore never retyped at a call site — an empty
    tuple is the resolver's "no", and a producer that consults it by truthiness
    cannot disagree with the resolver about which severities page.

    ⛔ TOTAL FOR THIS CLASS. ``CLASS_OPS`` is a member of ``ALERT_CLASSES``, so
    ``resolve_channel`` cannot refuse it and this cannot raise. Its caller is the
    pager itself, and an exception raised while looking up WHO to page would silence
    the alarm it was looking them up for.
    """
    return second_transport_for(CLASS_OPS, severity,
                                producer=_producer_of(producer)).recipients
