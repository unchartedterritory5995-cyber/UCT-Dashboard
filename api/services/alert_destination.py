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
    CLASS_OPS,
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
