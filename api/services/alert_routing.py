# api/services/alert_routing.py — TERM-011 / RM-N09, step 2: the resolver, with no caller.
"""Route an alert by its CLASS. Severity is demoted to within-class priority.

Spec: ``docs/terminal-research/07-technical-architecture/term-011-ops-vs-business-events.md``
(branch ``terminal-research``, never merged — not on master). §5.1 is this module's
contract; §6 step 2 is why it lands with **no caller**.

THE PROBLEM, in one sentence
────────────────────────────
One Discord channel (``DISCORD_WEBHOOK_URL``) carries member signups, Stripe
events, desk announcements AND every ops alarm, and *severity* decides whether a
thing posts at all — so severity is doing two jobs, and an ops alarm and a member
event emitted in the same run land in the same place. The acceptance test is a
DESTINATION, not a field (spec §3): *"an ops-class alarm and a business-class
event, emitted in the same run, land in different channels."*

⛔⛔ THIS COMMIT HAS NO CONSUMER AND CHANGES NO BEHAVIOUR. Nothing imports
``resolve_channel``. No emit call site moved. ``api/services/alerts.py``,
``chart_health_alerts.py`` and ``bars_reconciliation.py`` are untouched. The three
destination variables named below are absent from every Railway service and from
the whole repo apart from this module, its test, and the admin diagnostic that
reports whether they are set. **Deleting this file would change nothing a member
or an operator can observe** — which is exactly what makes it safe to land first.

THE RESOLVER IS PURE, AND THAT IS A LOAD-BEARING PROPERTY
─────────────────────────────────────────────────────────
``resolve_channel`` reads no environment, opens no socket, touches no disk. It
answers *"which variable NAME should carry this?"* and nothing else. Two reasons:

  1. **A pure resolver cannot be wrong about a flag state.** It returns the same
     answer whether the variables are set, blank or absent, so a misroute can
     only come from the class the producer declared — one place to look.
  2. **It never sees a webhook value**, so it cannot leak one into a log, a
     stamp or an exception message. It deals only in NAMES.

⛔ The gate reader ``routing_enabled()`` is the ONE function here that reads the
environment, and it reads it **at call time**. ``api/services/discord_notify.py:11``
is the defect not to repeat — ``DISCORD_ADMIN_WEBHOOK = os.environ.get(...)`` as a
module constant, so blanking the variable reaches nothing until the process
restarts, and the operator reads it back as empty while the running process keeps
posting. ``alerts.py:63-86`` documents that exact failure and fixed it the same
way this does.

TWO NAMES IN THIS ESTATE ARE ALREADY CLOSE ENOUGH TO MISREAD
────────────────────────────────────────────────────────────
⛔ **DO NOT RENAME ``resolve_channel`` TO ``resolve_channels``.**
``api/services/alert_taxonomy/regime_change.py:308`` already owns that name and
returns a fixed ``("in_app",)`` — a different thing (which in-app channels one S7
trigger type delivers on), deliberately ignoring its argument. Two functions one
letter apart, one of which ignores its input, is a misread waiting to happen.

⛔ **``alert_routing_prefs`` IS NOT THIS MODULE AND DOES NOT EXIST.** It is the
per-user, per-trigger-type channel-override TABLE from
``specs/alerts-monitoring-spec.md``, named in ``alert_taxonomy/db.py:14`` and
``alert_taxonomy/delivery.py:7``, which records it as *"explicitly NOT implemented
this pass"*. This module's name is a PREFIX of it, so a text search for
``alert_routing`` returns that unbuilt design too — measured: the first version of
this landing's own "no consumer" rail was a grep and was red on arrival, naming
two files that mention a table nobody built. That spec's CHANNEL_REGISTRY design
is what would CALL this resolver; it is not this resolver, and building it is out
of scope (spec §9).

WHAT THIS DELIBERATELY DOES NOT DO
──────────────────────────────────
  • No transport. Spec §9: *"Reuse the routing, not a second copy of the poster."*
  • No ``BOTH`` class. A dual-audience producer calls the resolver TWICE, once per
    class, and its transport fans out. A third enum member is the one-channel
    non-solution wearing a class field (spec §5.1).
  • No claim about which Discord channel any variable points at. Every variable
    below is NAMED, UNREAD.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from typing import Optional

# ⭐ ONE AUTHORITY FOR BOTH VOCABULARIES, imported rather than restated.
# The delivery-outcome word is `alerts.py:107-109`'s and the spec forbids adding to
# them (§5.1: "⛔ No new outcome vocabulary"); the severity words are
# `alerts.py:89-91`'s. A retyped copy here would be a second authority over a value
# written into a database column and read back by a UI.
from api.services.alerts import (
    CHANNEL_SKIPPED,
    SEVERITY_CRITICAL,
    SEVERITY_INFO,
    SEVERITY_WARNING,
)

log = logging.getLogger(__name__)

# ── THE CLASS. REQUIRED, NO DEFAULT ─────────────────────────────────────────
#
# ⛔⛔ A DEFAULT HERE WOULD SILENTLY ROUTE AN OPS ALARM INTO THE MEMBER CHANNEL.
# `backlog.md:585-586` is explicit: *"The resolver has no default: an unclassified
# emitter fails the rail by name."* An unknown class RAISES — see `UnroutableAlert`.
CLASS_OPS = "ops"
CLASS_BUSINESS = "business"
#: The whole vocabulary. Anything else refuses, INCLUDING "both" (see the header).
ALERT_CLASSES = (CLASS_OPS, CLASS_BUSINESS)

# ── THE DESTINATIONS. ⚠️ EVERY ONE IS NAMED, UNREAD ─────────────────────────
#
# Verified absent from the whole repo before this module existed
# (`git grep -l <name>` → 0 files for each of the three new ones).
#
# ⛔ `feedback_kill_switch_never_a_delete`: each of these is switched off by
# BLANKING it, never by removing it. `tools/audit_sandbox_env.py:57-58` states the
# rule for `DISCORD_WEBHOOK_URL` itself: *"⛔ BLANK, never popped — a blank webhook
# posts nothing; removing the var lets a default re-appear."*
OPS_WEBHOOK_ENV = "DISCORD_OPS_WEBHOOK_URL"
BUSINESS_WEBHOOK_ENV = "DISCORD_BUSINESS_WEBHOOK_URL"
#: ✅ IN SOURCE — 30 reader files under `api/`, 14 of which name no other webhook.
#: It stays the compatibility floor for BOTH classes while the new two are unset,
#: which is what makes the split a no-op migration on the day it lands.
ADMIN_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"
#: The SECOND transport, and ⛔⛔ it must NOT be `ADMIN_EMAILS`: `api/routers/auth.py`
#: promotes an address in `ADMIN_EMAILS` to `role='admin'` on signup and on login,
#: so adding an address there to receive a page would GRANT IT PRODUCTION ADMIN.
#: Delivery-only address variables already exist and are the right shape
#: (`CATALYST_ALERT_EMAILS`, `COMPASS_HEALTH_EMAIL_TO`,
#: `DESK_DAILY_SESSION_ALERT_EMAILS`); this is one more of those.
OPS_EMAIL_ENV = "OPS_ALERT_EMAIL_TO"

# ── THE GATE ────────────────────────────────────────────────────────────────
#
# ⛔ KILL-SWITCH POLARITY: unset means ON, i.e. "nothing has been killed".
# An observability change whose default is off is `project_feature_flag_ledger`'s
# indistinguishable case — OFF-and-unset reads the same as off-on-purpose.
# Default-on with an explicit "0" escape keeps the rollback a VARIABLE, not a
# revert, and that only holds if the switch is read at CALL time.
ROUTING_FLAG_ENV = "ALERT_ROUTING_ENABLED"
#: ⭐ THE ONE AUTHORITY over this default. `docs/feature_flags.json`'s `default`
#: field for this gate is pinned against this constant by
#: `tests/test_alert_routing.py::test_the_ledger_default_matches_the_readers_literal_default`.
#: ⚠️ `feature_flag_index._default_of` reads only a literal second argument, so the
#: AST index sees this gate's default as None and `needs_declaration` returns True —
#: which is the documented, deliberate path ("their sense lives in a comparison this
#: scan does not read, so a human says which it is once, in the ledger").
ROUTING_FLAG_DEFAULT = "1"
#: The off spellings, matching `HUB_PREVIEW_ENABLED`'s (`api/routers/auth.py`) so an
#: operator does not have to remember two conventions.
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

# ── THE ROUTING TABLE ───────────────────────────────────────────────────────
#
# One row per class. The FAILURE DIRECTION of each destination is stated because it
# is not the same one twice (spec §5.2).
#
#   OPS      → `DISCORD_OPS_WEBHOOK_URL`, falling back to `DISCORD_WEBHOOK_URL`
#              and STAMPED `route=fallback:admin`. Failure direction: NOISE,
#              VISIBLY LABELLED. An ops alarm that vanishes because a new variable
#              was not set is the worst outcome available here —
#              `chart_health_alerts.py:11-13` records what that already cost:
#              *"the in-memory deque was admin-pull-only, so a bars-store problem
#              paged no one — the gap that let the 2026-08-11 daily freeze run for
#              a week."* Ops must never fail silent, and the stamp is what keeps
#              the fallback from reading as success.
#
#   BUSINESS → `DISCORD_BUSINESS_WEBHOOK_URL`, falling back to
#              `DISCORD_WEBHOOK_URL`. Failure direction: NOISE — and specifically
#              TODAY'S BEHAVIOUR EXACTLY. Business events are already in that
#              channel, so an unset variable is a no-op migration.
PRIMARY_ENV_BY_CLASS = {
    CLASS_OPS: OPS_WEBHOOK_ENV,
    CLASS_BUSINESS: BUSINESS_WEBHOOK_ENV,
}
FALLBACK_ENV_BY_CLASS = {
    CLASS_OPS: ADMIN_WEBHOOK_ENV,
    CLASS_BUSINESS: ADMIN_WEBHOOK_ENV,
}
#: ⭐ The stamp a transport appends when it ACTUALLY fell back. The resolver cannot
#: know that (it would have to read the variable), so the literal lives here once
#: instead of being retyped by each of the 25 modules that own a Discord POST.
FALLBACK_ROUTE_STAMP = "fallback:admin"

# ── SEVERITY: WITHIN-CLASS PRIORITY, NEVER A ROUTER ─────────────────────────
#
# ⛔ `warn` IS IN THIS TABLE, AND THE SPEC'S REASON FOR IT IS ALREADY STALE —
# MEASURED, AND THE CODE WINS.
#
# The spec (§1.3, §2, contradictions 2 and 8, read at `origin/master be9ca78b6`)
# says `bars_reconciliation.py:358` passes `"warn"` as an emit SEVERITY, that it
# therefore pages nobody under `chart_health_alerts.py:37`'s `severity != "critical"`,
# and that `test_reconcile_detect_only_daily.py:61` pins the typo. ⚰️ At this
# branch's HEAD that is FIXED: `bars_reconciliation.py:385` passes `"warning"`, and
# re-deriving the spec's own D13/D14 pattern over all 22 emit sites yields TWO
# distinct literals (`critical` ×15, `warning` ×6, 1 computed), not three. It was
# fixed by `6b6deabe1` — the first commit on this very branch.
#
# ⭐ THE ENTRY STAYS ANYWAY, for reasons that survive the fix:
#   • `emit` still takes severity as a FREE STRING and validates nothing, so the
#     literal can return the moment somebody types it again;
#   • `warn` is a live word in a DIFFERENT scale — `audit.py`'s per-bar diff
#     vocabulary is `ok`/`warn`/`fail`, and `test_reconcile_detect_only_daily.py:15-17`
#     records that the two scales meeting in one file is what caused the confusion.
#     A router keyed on a free-text severity must not assume they stay apart;
#   • the spec's R1 names it in the union vocabulary the rail must sweep.
# Mapping it to the SAME rank as `warning` is the only reading that is right under
# both scales. ⚠️ Whether `warn` should PAGE is a ruling the spec explicitly does
# not make (§9) and neither does this module: the rank is the same, the DESTINATION
# is unaffected either way, and that is the whole point of demoting severity.
SEVERITY_WARN_TYPO = "warn"
SEVERITY_PRIORITY = {
    SEVERITY_CRITICAL: 3,
    SEVERITY_WARNING: 2,
    SEVERITY_WARN_TYPO: 2,
    SEVERITY_INFO: 1,
}
#: ⛔ An unrecognised severity is RANKED LOWEST, never refused, and never changes a
#: destination. `chart_health_alerts.emit` takes severity as a free string and
#: validates nothing, so refusing an unknown one would drop an alarm whose CLASS was
#: perfectly well declared — trading a known problem for a silent one.
UNKNOWN_SEVERITY_PRIORITY = 0

#: The second transport is OPS-only and CRITICAL-only (spec §6 step 4). ⭐ Derived
#: from the table above rather than restating which word means "critical".
SECOND_TRANSPORT_ENV_BY_CLASS = {CLASS_OPS: OPS_EMAIL_ENV}
SECOND_TRANSPORT_MIN_PRIORITY = SEVERITY_PRIORITY[SEVERITY_CRITICAL]


class UnroutableAlert(ValueError):
    """An alert whose class the resolver refuses to guess at.

    ⛔ REFUSING IS THE FEATURE. The alternative to raising is a default, and a
    default here routes an ops alarm into the channel members' signups land in —
    silently, because every other check would stay green.
    """


@dataclass(frozen=True)
class ChannelDecision:
    """What a transport should ATTEMPT. Names only — never a webhook value.

    ⚠️ CONTRADICTION WITH THE SPEC, NAMED RATHER THAN PAPERED OVER (§5.1 asks the
    return value to report in `CHANNEL_OK` / `CHANNEL_FAILED` / `CHANNEL_SKIPPED`):
    a PURE function cannot report `ok` or `failed`, because both are outcomes of a
    delivery attempt, and it cannot report "skipped because the variable is unset"
    either, because that is an environment read the same section forbids. So the
    resolver reports the ONE outcome it can honestly own — `CHANNEL_SKIPPED` for a
    leg IT declined, with the reason — and leaves the other two, and "skipped
    because unset", to the transport. No word is added to the vocabulary; `None`
    means "the resolver has no outcome to report here", which is an absence rather
    than a fourth state.
    """

    #: Normalised, always one of `ALERT_CLASSES`.
    alert_class: str
    #: Normalised severity as given (lower-cased, stripped). May be `""`.
    severity: str
    #: False when `severity` is outside `SEVERITY_PRIORITY`. Reported so a
    #: roll-up can count unknown severities instead of them looking like `info`.
    severity_known: bool
    #: Within-class priority. ⛔ Never consulted to pick `primary_env`.
    priority: int
    #: The variable NAME the transport reads FIRST.
    primary_env: str
    #: The compatibility floor to try when `primary_env` is blank/unset, or None
    #: once spec §6 step 8 removes it on a measured `fallback=0`.
    fallback_env: Optional[str]
    #: `OPS_ALERT_EMAIL_TO` for an OPS critical; None otherwise.
    second_transport_env: Optional[str]
    #: `CHANNEL_SKIPPED` when the RESOLVER declined the second leg; None when it
    #: named one and the outcome is the transport's to report.
    second_transport_status: Optional[str]
    #: Why it was declined. Present exactly when `second_transport_status` is.
    second_transport_skip_reason: Optional[str]
    #: The stamp for the post: class, severity and the resolved variable NAME.
    route: str


def _normalised_class(alert_class: object) -> Optional[str]:
    """`alert_class` folded to a member of `ALERT_CLASSES`, or None."""
    if not isinstance(alert_class, str):
        return None
    candidate = alert_class.strip().lower()
    return candidate if candidate in ALERT_CLASSES else None


def _producer_of(explicit: Optional[str]) -> str:
    """The module that called `resolve_channel`, for the refusal message.

    ⭐ Called ONLY on the refusal path, so the success path stays referentially
    pure: `resolve_channel`'s return value never depends on who called it.
    `sys._getframe` reads interpreter state, which is neither an environment read
    nor I/O — and a caller that would rather be explicit passes `producer=`.
    """
    if explicit:
        return str(explicit)
    try:                                            # pragma: no cover - defensive
        return str(sys._getframe(2).f_globals.get("__name__") or "<producer not named>")
    except Exception:                               # pragma: no cover - defensive
        return "<producer not named>"


def resolve_channel(alert_class: object, severity: object = "",
                    *, producer: Optional[str] = None) -> ChannelDecision:
    """Which destination NAMES should carry this alert.

    ⛔ PURE. No environment read, no network, no disk, no clock. Given the same
    two arguments it returns an equal `ChannelDecision` forever.

    :param alert_class: REQUIRED — `CLASS_OPS` or `CLASS_BUSINESS`, case- and
        whitespace-insensitive. Anything else (including ``None``, ``""`` and
        ``"both"``) raises `UnroutableAlert`.
    :param severity: within-class priority only. Free text, never a router;
        an unknown value ranks lowest and changes no destination.
    :param producer: the emitting module's path, for the refusal message. Derived
        from the caller's frame when omitted.
    :raises UnroutableAlert: on any class outside `ALERT_CLASSES`.
    """
    resolved = _normalised_class(alert_class)
    if resolved is None:
        raise UnroutableAlert(
            f"alert_class is required and must be one of {list(ALERT_CLASSES)}; "
            f"got {alert_class!r} from {_producer_of(producer)}. "
            "There is NO default: defaulting here would route an ops alarm into "
            "the channel member signups land in, and nothing would report it. "
            "A dual-audience producer calls resolve_channel() once per class."
        )

    sev = severity.strip().lower() if isinstance(severity, str) else ""
    known = sev in SEVERITY_PRIORITY
    priority = SEVERITY_PRIORITY.get(sev, UNKNOWN_SEVERITY_PRIORITY)

    primary = PRIMARY_ENV_BY_CLASS[resolved]
    fallback = FALLBACK_ENV_BY_CLASS.get(resolved)

    second = SECOND_TRANSPORT_ENV_BY_CLASS.get(resolved)
    status: Optional[str] = None
    reason: Optional[str] = None
    if second is None:
        status, reason = CHANNEL_SKIPPED, (
            f"the second transport carries {CLASS_OPS!r} only; this is {resolved!r}")
    elif priority < SECOND_TRANSPORT_MIN_PRIORITY:
        status, reason = CHANNEL_SKIPPED, (
            f"the second transport carries {SEVERITY_CRITICAL!r} only; "
            f"this is {sev or '<blank>'!r}")
        second = None

    return ChannelDecision(
        alert_class=resolved,
        severity=sev,
        severity_known=known,
        priority=priority,
        primary_env=primary,
        fallback_env=fallback,
        second_transport_env=second,
        second_transport_status=status,
        second_transport_skip_reason=reason,
        route=f"class={resolved} severity={sev or '<blank>'} primary={primary}",
    )


def route_stamp(decision: ChannelDecision, *, used_fallback: bool = False) -> str:
    """The line a transport appends to the post. ⛔ Pure, and NEVER a value.

    `terminal_next_monitor_main.py:30-31` already requires the analogue for its own
    posts: *"EVERY POST CARRIES THE RUNNING COMMIT AND THE TIMESTAMP, because a
    reading without the build it came from cannot be compared to the next one."*
    Here the reading is the ROUTE: a post stamped `fallback:admin` is a misroute
    visible in the message itself, with no Railway access required.

    :param used_fallback: True when the transport actually fell back to
        `decision.fallback_env`. The resolver cannot know this — establishing it
        means reading the primary variable — so the caller states it and the
        literal stays in one place.
    """
    if used_fallback:
        return f"{decision.route} route={FALLBACK_ROUTE_STAMP}"
    return decision.route


def routing_enabled() -> bool:
    """`ALERT_ROUTING_ENABLED` as it stands RIGHT NOW. ⛔ Never cached.

    THE ONLY environment read in this module, and the one function here that is not
    pure. Read at CALL time, deliberately:

      • `railway variables --set` has been measured NOT to restart some services,
        so "set it and it takes effect" is not reliably true;
      • against an import-time capture the operator reads the variable back
        changed, sees `--kv` agree, and the running process keeps behaving as
        before — the defect `api/services/discord_notify.py:11` still has and
        `alerts.py:63-86` was written about.

    ⛔ Kill switch: UNSET IS ON. Off spellings are `0`, `false`, `no`, `off`,
    case- and whitespace-insensitive; everything else, including unset, is on.
    """
    raw = os.environ.get(ROUTING_FLAG_ENV, ROUTING_FLAG_DEFAULT)
    return (raw or "").strip().lower() not in _OFF_VALUES


def routing_enabled_for(alert_class: object) -> bool:
    """May this producer use class routing at all? ⛔ KILL SWITCH FIRST.

    THE SHAPE IS COPIED DELIBERATELY from
    `api/services/wisdom/publish/adapters/askai.py:47 enabled_for(user_id)` —
    kill switch, then the second consideration, then a bare-except fail-closed —
    and **the ORDER is the load-bearing part**. A false flag beats every other
    consideration, so with the flag off this function consults nothing else: the
    rollback is "flip one variable and the whole class-routing decision stops
    happening", which is only true if nothing downstream of the flag runs.

    ⛔ FAIL-CLOSED HERE MEANS "keep today's behaviour", not "drop the alert".
    False tells a producer to take the pre-split path it takes today
    (`DISCORD_WEBHOOK_URL`), which is exactly what `ALERT_ROUTING_ENABLED=0` is
    specified to restore. Nothing is silenced by returning False.

    ⚠️ This is NOT a softer `resolve_channel`. A producer that asks this and gets
    True, then hands `resolve_channel` a class it does not recognise, still gets
    `UnroutableAlert` — an unclassified emitter must fail BY NAME, and swallowing
    that here would be the default the spec forbids wearing a predicate's clothes.
    """
    if not routing_enabled():                       # ⛔ the kill switch, FIRST
        return False
    try:
        return _normalised_class(alert_class) is not None
    except Exception:                               # pragma: no cover - defensive
        log.exception("[alert_routing] class check failed; class routing stays off "
                      "for this emit and the pre-split path is used")
        return False
