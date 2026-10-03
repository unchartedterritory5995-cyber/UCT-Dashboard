# api/services/alerts.py — Alert management service
"""
Stores alerts in memory (TTLCache) and optionally fires Discord webhooks.

⭐ THE BROADCAST ALERT TYPES, AND WHETHER EACH CAN REACH A MEMBER TODAY
──────────────────────────────────────────────────────────────────────
⚰️ This list named five types with no status column at all, so it read as five
shipping features. THREE OF THE FIVE CANNOT REACH A MEMBER. That is what was
wrong — not, in the end, the code: a reader who believes five types are live
spends planning on two emitters nothing calls and one type with no
implementation, and nothing in the repo contradicted them.

⛔ THE STATUS COLUMN IS A CONTRACT, NOT PROSE.
``tests/test_alerts_broadcast_type_reachability.py`` DERIVES each status from
this repo's own source — the emitters in this file, and their call sites outside
``tests/`` — and fails BY NAME when a row and the code disagree. Wire one of
these up and the row must move, or the rail goes red.

    regime_change  [LIVE]            — market phase transition (e.g. Markup → Distribution)
    stop_hit       [NOT WIRED]       — UCT20 position hit -6% hard stop
    scanner_match  [NOT WIRED]       — new high-conviction scanner candidate (score >= 80)
    ep_resolved    [NOT IMPLEMENTED] — entry point candidate stopped or hit target
    exposure_shift [LIVE]            — exposure rating moved 20+ points

  LIVE            — an ``alert_*`` emitter at the bottom of this file, with at
                    least one caller outside ``tests/``. Both live ones are
                    called from ``api/routers/push.py`` on a wire push.
  NOT WIRED       — the emitter exists and works; NOTHING outside ``tests/``
                    calls it. Kept on purpose — see below — not deleted.
  NOT IMPLEMENTED — there is no emitter. What exists is a ``_TYPE_SEVERITY`` row
                    and a bell glyph in ``AlertBell.jsx``, and BOTH ARE INERT:
                    ``_TYPE_SEVERITY.get(type, SEVERITY_INFO)`` already returns
                    INFO for an unknown type, so that row changes no behaviour,
                    and the icon map is a per-row lookup
                    (``TYPE_ICONS[a.type] || 'bell'``) with no legend and no
                    filter list — nothing in the UI advertises this type to a
                    member, so nobody is being promised a feature.

⭐ WHY THE TWO NOT-WIRED EMITTERS STAY, AND THE PART WORTH KNOWING BEFORE YOU
DELETE EITHER: **the member is already told about both, in a different
vocabulary.** ``kind="stop_hit"`` and ``kind="scanner_match"`` are LIVE insight
kinds — ``awareness/rules.py`` fires the first at importance 10, and
``voice_proactive_service.py`` the second — rendered as "At Stop" and "Scanner"
in ``CompassTodayTile.jsx``. So each of those two words is simultaneously a dead
ALERT type here and a live INSIGHT kind two modules away. Deleting these
emitters would not remove ``stop_hit`` from the product: it would leave the word
live, leave the severity row and the bell glyph orphaned, and leave this list
unable to say anything true about either. They are a half-product missing only
its notification wire, not dead weight.

⚠️ ``alert_scanner_match`` additionally carries a privacy rail:
``tests/test_alerts_privacy.py::test_a_broadcast_alert_reaches_every_member``
uses it as the representative BROADCAST producer to prove the 2026-08-06 scoping
fix did not over-scope and silence the market-wide feed. Deleting the emitter
means editing that rail — a bad trade for four lines.

⚠️ AND THIS TABLE IS THE BROADCAST FAMILY, NOT "the alert types". ``add_alert``
accepts any string; the live private/system types live elsewhere —
``price_alert`` and ``document_arrival`` (``watchlist_alert_service``),
``wire_missed`` (the watchdog in ``api/main.py``), ``exposure_gate``,
``notebook_task_reminder``, plus whatever ``deliver_alert_payload``'s ``source``
argument carries at runtime. A status above is therefore about a LITERAL
producer, and the rail says so in its own docstring: a dynamic
``add_alert(source, …)`` is not something source-reading can settle.

⭐ TWO AUDIENCES, ONE FUNCTION — the scoping contract (2026-08-06)
──────────────────────────────────────────────────────────────────
Until 2026-08-06 every alert — system broadcast AND per-member — went into ONE
cache list under the key ``"alerts"``, and ``GET /api/alerts`` served it with no
auth. An unauthenticated request from the public internet returned HTTP 200 and
the feed. Both halves are fixed; **neither half is sufficient alone** — on one
global list, requiring auth just means every logged-in member reads every other
member's alerts.

``user_id`` is what distinguishes the two audiences, and it is OPTIONAL on
purpose:

  • ``user_id=None`` → **BROADCAST**. Visible to every logged-in member. This is
    the honest shape for the callers that genuinely have no user: every type in
    the table above, plus the wire watchdog in ``api/main.py``. Forcing a user id
    on them would either break them or silently attribute a market-wide event to
    one arbitrary account.
    ⛔ The five names are deliberately NOT re-listed here. They were, and that
    made this paragraph a SECOND authority over the same value — the copy that
    goes stale first, because nothing fails when it does. One table, one rail.

  • ``user_id="…"`` → **PRIVATE**. Visible only to that member. Every caller on
    the member delivery path already HAS the id — ``watchlist_alert_service``
    takes ``user_id`` as its first parameter and every one of its callers
    (indicator alerts, catalyst alerts + must-know, calendar alerts, awareness
    engine, price alerts) passes a real one.

Read state follows the same split: a private alert carries its own ``read``
flag, while a broadcast row is SHARED, so its read mark is recorded per member
in a separate set. Flipping ``read`` on the shared dict is what let the first
member to open the bell mark it read for everyone.

⚠️ DURABILITY — ``cache`` is an in-process TTLCache on a single uvicorn pod. It
resets on every redeploy and expires at 24 h, and its LRU is capped at 1000
keys total (shared with bars/news/snapshot). Per-member alerts therefore do NOT
survive a deploy, and at a few hundred active members the per-user keys start
competing with the hot data keys. This is acceptable for a 24 h notification
bell and is NOT durable storage: if per-member alerts must survive a redeploy
they belong in ``auth.db`` (the web-local SQLite on the Railway volume), as a
``user_alerts`` table alongside ``watchlist_alerts`` / ``indicator_alerts``,
which is where the rest of the per-member alert state already lives.
"""

import os
import time
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from api.services.cache import cache

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Discord webhook (optional — only fires if env var is set)
#
# ⚰️ THIS WAS A MODULE CONSTANT, CAPTURED AT IMPORT:
#
#     _DISCORD_WEBHOOK = os.environ.get("DISCORD_ALERT_WEBHOOK", "")
#
# ⛔ SO SETTING OR CLEARING THE VARIABLE REACHED NOTHING UNTIL THE PROCESS
# RESTARTED, AND THE DANGEROUS DIRECTION IS THE CLEAR. Blanking the webhook is
# how this estate turns an alert channel OFF (the standing rule is that a kill
# switch is a variable, never a delete) — and against an import-time capture the
# operator reads the variable back as empty, sees `--kv` agree, and the running
# process keeps posting. `railway variables --set` has been measured NOT to
# restart on some services, so "set it and it takes effect" was not reliably
# true either.
#
# ⭐ Read at CALL time. Same defect class as F-S7-5, where a mirror answered
# from a module constant while production ran a different value and the harness
# manufactured the disagreement it existed to detect.
DISCORD_WEBHOOK_ENV = "DISCORD_ALERT_WEBHOOK"


def discord_webhook() -> str:
    """The alert webhook as it stands RIGHT NOW. Never cached.

    AC-2 (dark, ALERT_CHANNEL_REGISTRY_ENABLED): armed, it is resolved through
    the one channel registry by PURPOSE ("alert" -> this same variable), so the
    value is identical; dark, the variable is read directly as before."""
    try:
        from api.services.alert_taxonomy import channels as _channels
        if _channels.is_enabled():
            return _channels.resolve_webhook("alert")
    except Exception:  # noqa: BLE001 -- the registry can never cost the channel
        pass
    return os.environ.get(DISCORD_WEBHOOK_ENV, "") or ""

# Alert severity levels
SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"


# ── THE PER-CHANNEL DELIVERY VOCABULARY ─────────────────────────────────────
#
# ⭐ THREE STATES, AND THE THIRD IS NOT DECORATION. "we tried and it did not
# land" and "we never tried" are different facts about a member's alert, and
# collapsing them is the same lie one size up as collapsing success and failure:
# an unset ``DISCORD_ALERT_WEBHOOK`` reported as ``failed`` would send somebody
# hunting a provider outage that does not exist, and reported as ``ok`` would
# claim a channel nobody is listening on.
#
#   ok      — the channel accepted it.
#   failed  — we tried and it did not land. THE MEMBER MISSED THIS CHANNEL.
#   skipped — we did not try: not configured, no address, or below the
#             severity this channel fires on.
CHANNEL_OK = "ok"
CHANNEL_FAILED = "failed"
CHANNEL_SKIPPED = "skipped"

# The channel names, as constants, because they are written into a database
# column (`indicator_alert_fires.delivery_channels`) and read back by a UI.
# A retyped `"in-app"` on one side of that seam is a channel nobody can find.
CHANNEL_IN_APP = "in_app"
CHANNEL_DISCORD = "discord"
CHANNEL_EMAIL = "email"

# Type → default severity
_TYPE_SEVERITY = {
    "regime_change": SEVERITY_CRITICAL,
    "stop_hit": SEVERITY_WARNING,
    "scanner_match": SEVERITY_INFO,
    "ep_resolved": SEVERITY_INFO,
    "exposure_shift": SEVERITY_WARNING,
}

# TERM-011 rows 1/3 (docs/terminal-research/07-technical-architecture/
# term-011-routing-decisions.md, ruling (a) BOTH — resolve twice): these two
# BROADCAST types' Discord copy moves from the admin webhook to the OPS
# destination. The member bell entry above is completely untouched — this set
# decides a URL, never whether the alert is stored or who it is stored for.
# ⛔ `stop_hit`/`scanner_match`/`ep_resolved` are deliberately absent: the
# packet's own §0 scan (and this file's header table) shows they reach nobody,
# so classing them would be guessing at a destination for an alert that never
# fires. Class one the day it is wired, same as `resolve_channel` forces for
# any other producer.
_OPS_ROUTED_TYPES = frozenset({"regime_change", "exposure_shift"})


def _now_et() -> str:
    return datetime.now(_ET).isoformat()


# ── the store's three key shapes ────────────────────────────────────────────
# Kept as functions, not f-strings at each call site, so the scoping is one
# place a reviewer can read and one place a mutation can be aimed at.
_BROADCAST_KEY = "alerts"          # audience: everyone
_TTL = 86400                       # 24 h
_MAX_PER_LIST = 100
_MAX_READ_MARKS = 500              # bounds the per-member broadcast read set


def _user_key(user_id: str) -> str:
    """The private feed of ONE member."""
    return f"alerts:u:{user_id}"


def _read_key(user_id: str) -> str:
    """One member's read marks on the SHARED broadcast rows."""
    return f"alerts:read:{user_id}"


# ── S7 durable in-app notification bridge (owner authorization) ────────────
#
# This ephemeral store (see module docstring) is fine for a 24h notification
# bell but not for "watch this company for weeks and tell me when it files
# something" -- a fire that survives to `alert_taxonomy.alert_fires` (already
# durable) must still be visible after the TTLCache is gone (redeploy,
# eviction, restart). These three helpers pull that durable source into the
# SAME feed additively, scoped to S7's own trigger types -- legacy alert
# types (indicator/catalyst/calendar/awareness/price) are completely
# untouched and remain ephemeral-only for this slice.
_S7_FIRE_PREFIX = "s7fire_"


def _s7_durable_alerts(user_id: str, limit: int) -> list[dict]:
    """The caller's own durable S7 fires, reconstructed into this module's
    alert shape. Never raises -- a taxonomy-module import/query failure
    degrades to "no durable rows this call", not a broken feed."""
    try:
        from api.services.alert_taxonomy import receipts as _at_receipts
        from api.services.alert_taxonomy import document_arrival as _at_doc_arrival
    except Exception:
        return []
    try:
        fires = _at_receipts.list_fires_for_feed(user_id, limit=limit)
    except Exception:
        return []
    out = []
    for f in fires:
        # Dispatch by trigger_type -- document-arrival is S7's only live
        # trigger today; add a branch here when a second type ships rather
        # than generalizing a reconstruction contract nothing else needs yet.
        if f.get("trigger_type") == _at_doc_arrival.TYPE_ID:
            try:
                out.append(_at_doc_arrival.alert_shape_for_fire(f))
            except Exception:
                continue
        elif f.get("trigger_type") == "rating-change":
            # FT-034 (dark): the second S7 type that delivers, so the second
            # branch -- without it its fires would silently miss the feed.
            try:
                from api.services.alert_taxonomy import rating_change as _at_rc
                out.append(_at_rc.alert_shape_for_fire(f))
            except Exception:
                continue
    return out


def _dual_write_s7_read_if_applicable(alert: dict, user_id: str) -> None:
    """Read-state parity fix (owner authorization). While an S7 fire's
    ephemeral copy still exists, `get_alerts()`'s dedup (by accession)
    means that's the ONLY copy the member ever sees/marks read -- the
    durable reconstruction is filtered out until the ephemeral copy is
    gone. Without this, marking the ephemeral copy read updates only
    process memory: if the process dies before that copy's 24h TTL
    naturally expires, the durable reconstruction can reappear as unread
    once it becomes the only copy left. Scoped to document-arrival only
    (the only S7 trigger type that reaches this store today) -- never
    raises, matching this module's existing "a taxonomy failure degrades,
    never breaks the feed" posture.
    """
    data = alert.get("data")
    if isinstance(data, dict) and data.get("source") == "rating_change" and data.get("s7_fire_key"):
        # FT-034: the same read-parity, keyed on the fire's own key.
        try:
            from api.services.alert_taxonomy import receipts as _at_receipts
            _at_receipts.mark_fire_read_by_fire_key(data["s7_fire_key"], user_id)
        except Exception:
            pass
        return
    if not isinstance(data, dict) or data.get("source") != "document_arrival":
        return
    accession = data.get("accession")
    if not accession:
        return
    try:
        from api.services.alert_taxonomy import receipts as _at_receipts
        _at_receipts.mark_fire_read_by_fire_key(f"occ:{accession}", user_id)
    except Exception:
        pass


def _mark_s7_fire_read(alert_id: str, user_id: str) -> bool:
    try:
        fire_id = int(alert_id[len(_S7_FIRE_PREFIX):])
    except ValueError:
        return False
    try:
        from api.services.alert_taxonomy import receipts as _at_receipts
    except Exception:
        return False
    return _at_receipts.mark_fire_read(fire_id, user_id)


def get_alerts(limit: int = 50, user_id: str | None = None) -> list:
    """Return the alerts this caller is entitled to, newest first.

    ``user_id=None`` returns BROADCAST ONLY. That is the safe default and the
    reason it is the default: a caller that forgot to say who it is gets the
    market-wide feed, never somebody's private one.

    A member gets broadcast + their own, merged newest-first, with the
    broadcast rows' ``read`` resolved against THEIR OWN read marks. Copies are
    returned so a caller can never mutate the cached rows other members share.
    """
    broadcast = cache.get(_BROADCAST_KEY) or []
    if not user_id:
        return [dict(a) for a in broadcast][:limit]

    read_ids = set(cache.get(_read_key(user_id)) or ())
    mine = cache.get(_user_key(user_id)) or []
    merged = [dict(a, read=(a["id"] in read_ids)) for a in broadcast]
    merged += [dict(a) for a in mine]

    # S7 durable merge: a fire freshly delivered within the ephemeral TTL
    # exists in BOTH stores. Skip a durable row whose accession an ephemeral
    # copy already carries, so the SAME fire never renders twice while both
    # stores briefly hold it -- once the ephemeral copy expires/evicts, the
    # durable reconstruction is the only copy left and takes over seamlessly.
    # FT-034: a rating-change fire's cross-store key is its own fire key
    # (`s7_fire_key`), carried on both copies -- the same dedup, another key.
    seen_accessions = {
        a["data"]["accession"] for a in mine
        if isinstance(a.get("data"), dict) and a["data"].get("accession")
    }
    seen_fire_keys = {
        a["data"]["s7_fire_key"] for a in mine
        if isinstance(a.get("data"), dict) and a["data"].get("s7_fire_key")
    }
    durable = _s7_durable_alerts(user_id, limit)
    merged += [
        d for d in durable
        if not (isinstance(d.get("data"), dict)
                and (d["data"].get("accession") in seen_accessions
                     or (d["data"].get("s7_fire_key") and d["data"]["s7_fire_key"] in seen_fire_keys)))
    ]

    # Legacy (non-S7) durable merge (Alert Durability V1, 2026-09-06). Unlike
    # the S7 bridge above, this store shares the EXACT SAME id scheme as the
    # ephemeral copy it backs up (both are written by this module's own
    # `add_alert`), so dedup is a plain id-membership check -- no
    # accession-style cross-store key needed.
    mine_ids = {a["id"] for a in mine}
    try:
        from api.services import alert_durability as _durable
        legacy_durable = _durable.list_durable_alerts(user_id, limit)
    except Exception:  # noqa: BLE001
        legacy_durable = []
    merged += [d for d in legacy_durable if d["id"] not in mine_ids]

    merged.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
    return merged[:limit]


def add_alert(
    alert_type: str,
    title: str,
    message: str,
    severity: str | None = None,
    data: dict | None = None,
    user_id: str | None = None,
    channels: dict | None = None,
) -> dict:
    """Add an alert and optionally fire the Discord webhook.

    ``user_id=None`` → broadcast to every member (the system subsystems).
    ``user_id="…"``  → private to that member (the delivery path).

    ⭐ THIS FUNCTION IS THE SINGLE OWNER OF THE ALERT DISCORD WEBHOOK. Callers
    must NOT call ``_fire_discord`` themselves after calling this — that was
    the double-fire that put every delivered alert into the admin channel
    twice (`watchlist_alert_service`, fixed 2026-08-06).

    ⭐ ``channels`` IS AN OUT-DICT, AND IT EXISTS *BECAUSE* OF THE LINE ABOVE.
    This function owns TWO channels — the in-app feed and the Discord webhook —
    and the caller owns neither, so the caller cannot observe either one. It used
    to report both by returning normally, which is how a 403 from a rotated
    webhook became byte-identical to a delivered alert. Handed a dict, this fills
    in ``in_app`` and ``discord`` with the vocabulary above as it goes; handed
    nothing (every system caller) it behaves exactly as before.

    ⛔ AN OUT-DICT RATHER THAN A RICHER RETURN VALUE, deliberately. The returned
    alert dict is the row that goes into the member's feed and out of
    `GET /api/alerts`; a delivery-status key on it would be published to the
    browser as part of the notification itself. This is the same shape as
    `breadth_monitor.compute_metrics`' `members` out-dict, for the same reason:
    the answer belongs to the caller, not to the artifact.

    ⚠️ PARTIALLY FILLED IS MEANINGFUL. If this raises before writing a key, that
    channel was NOT attempted — the caller reads an absent key as such, and must
    not assume the whole call failed just because it did not finish.
    """
    alert = {
        "id": f"{alert_type}_{int(time.time() * 1000)}",
        "type": alert_type,
        "severity": severity or _TYPE_SEVERITY.get(alert_type, SEVERITY_INFO),
        "title": title,
        "message": message,
        "timestamp": _now_et(),
        "read": False,
        "user_id": user_id,          # None = broadcast; the audience, recorded
        "data": data or {},
    }

    # Prepend to the owning list (newest first), cap at 100
    key = _BROADCAST_KEY if user_id is None else _user_key(user_id)
    alerts = cache.get(key) or []
    alerts.insert(0, alert)
    cache.set(key, alerts[:_MAX_PER_LIST], ttl=_TTL)
    if channels is not None:
        channels[CHANNEL_IN_APP] = CHANNEL_OK

    # Seam: Alert Durability V1 (2026-09-06) -- a private, non-S7 alert also
    # gets a durable copy so it survives the redeploy this ephemeral cache
    # does not (see api/services/alert_durability.py's own module docstring
    # for the exact scope and why S7 fires are excluded here).
    try:
        from api.services import alert_durability as _durable
        if _durable.should_persist(alert):
            _durable.record_alert(alert)
    except Exception:  # noqa: BLE001
        pass

    # Fire Discord webhook for warning/critical -- BROADCAST alerts only.
    #
    # TERM-011 step 7 (the packet's rows 4/5): a private alert's Discord leg is
    # retired outright, whatever its severity. The member's own bell (:392
    # above) and email already carry it; this room is for something an
    # operator or the WHOLE audience should see, not one member's brief. Before
    # this, `severity="warning"` on a per-member delivery (11 of 13
    # `deliver_alert_payload` call sites; the two "info" AI-search briefings are
    # a later, separate commit -- landing them first would have flooded this
    # room while it was still door A, and landing this gate first is what makes
    # that later commit safe) put every triggered price alert, indicator fire
    # and briefing into the SAME admin channel as a market-wide regime change.
    # `severity` keeps ranking, colouring and glyphing the in-app row; it no
    # longer decides Discord for a private alert.
    fires_discord = alert["severity"] in (SEVERITY_WARNING, SEVERITY_CRITICAL)
    if user_id is not None:
        if channels is not None:
            channels[CHANNEL_DISCORD] = CHANNEL_SKIPPED
    elif fires_discord and _discord_destination(alert):
        landed = _fire_discord(alert)
        if channels is not None:
            channels[CHANNEL_DISCORD] = CHANNEL_OK if landed else CHANNEL_FAILED
    elif channels is not None:
        # Not configured, or an INFO alert this webhook deliberately does not
        # carry. Neither is a failure and neither reached anybody.
        channels[CHANNEL_DISCORD] = CHANNEL_SKIPPED

    return alert


def _discord_destination(alert: dict) -> str:
    """Which webhook URL ``alert``'s Discord copy goes to, read NOW. ``""``
    when nothing is configured for it.

    TERM-011 rows 1/3: a type in ``_OPS_ROUTED_TYPES`` (currently
    ``regime_change``/``exposure_shift``) resolves through the OPS
    destination instead of the admin webhook. Every other broadcast type is
    completely unaffected — this only ever narrows which two types take the
    new branch, never widens what the admin webhook itself does.

    ⛔ LOCAL IMPORT, DELIBERATELY. ``alert_routing.py`` imports severity/channel
    constants FROM THIS MODULE at ITS OWN module level (the chain is
    ``alert_destination -> alert_routing -> alerts``), so a module-level
    ``from api.services.alert_destination import ...`` here would close
    ``alerts -> alert_destination -> alert_routing -> alerts`` into a cycle.
    Deferred to call time, both modules are already fully initialized —
    the same reason `add_alert` already imports `alert_durability` locally
    a few lines above rather than at the top of this file.

    ⚠️ ``ops_webhook`` is TOTAL for ``CLASS_OPS`` (it is a member of
    ``ALERT_CLASSES``, so `resolve_channel` cannot refuse it) and never raises
    by its own docstring — the ``try`` is for the IMPORT, not the call, kept
    defensive anyway because a raised exception here must never cost the
    alert its fallback destination.
    """
    if alert["type"] in _OPS_ROUTED_TYPES:
        try:
            from api.services.alert_destination import ops_webhook
            return ops_webhook(alert["severity"], producer=alert["type"])
        except Exception:  # noqa: BLE001
            pass  # fall through to the admin webhook rather than losing the post
    return discord_webhook()


def mark_read(alert_id: str, user_id: str) -> bool:
    """Mark ONE alert read FOR THIS MEMBER. False if it isn't theirs to mark.

    Only two places are searched: the member's own private list, and the
    broadcast list. An id belonging to another member is in neither, so it
    simply is not found — there is no path from here to another member's row.
    """
    if not user_id:
        return False

    if alert_id.startswith(_S7_FIRE_PREFIX):
        return _mark_s7_fire_read(alert_id, user_id)

    mine = cache.get(_user_key(user_id)) or []
    for a in mine:
        if a["id"] == alert_id:
            if not a["read"]:
                a["read"] = True
                cache.set(_user_key(user_id), mine, ttl=_TTL)
            _dual_write_s7_read_if_applicable(a, user_id)
            # Alert Durability V1: the ephemeral copy is the ONLY copy a
            # member sees/marks while both stores hold it (same reasoning as
            # the S7 dual-write above) -- mirror the mark into the durable
            # row so it does not reappear unread once the cache is gone.
            try:
                from api.services import alert_durability as _durable
                _durable.mark_read(alert_id, user_id)
            except Exception:  # noqa: BLE001
                pass
            return True

    # A broadcast row is SHARED — record the read mark against the member, not
    # against the row (flipping the row marked it read for everyone).
    if any(a["id"] == alert_id for a in (cache.get(_BROADCAST_KEY) or [])):
        marks = list(cache.get(_read_key(user_id)) or [])
        if alert_id not in marks:
            marks.append(alert_id)
            cache.set(_read_key(user_id), marks[-_MAX_READ_MARKS:], ttl=_TTL)
        return True

    # The ephemeral copy is gone (redeploy/TTL/eviction) but a durable
    # legacy row may still exist -- ownership-scoped inside alert_durability
    # itself (a different member's id returns False, never touches the row).
    try:
        from api.services import alert_durability as _durable
        if _durable.mark_read(alert_id, user_id):
            return True
    except Exception:  # noqa: BLE001
        pass

    return False


def mark_all_read(user_id: str) -> int:
    """Mark this member's whole feed read. Returns count newly marked."""
    if not user_id:
        return 0

    count = 0
    mine = cache.get(_user_key(user_id)) or []
    for a in mine:
        if not a["read"]:
            a["read"] = True
            count += 1
    if mine:
        cache.set(_user_key(user_id), mine, ttl=_TTL)

    marks = list(cache.get(_read_key(user_id)) or [])
    seen = set(marks)
    for a in cache.get(_BROADCAST_KEY) or []:
        if a["id"] not in seen:
            marks.append(a["id"])
            seen.add(a["id"])
            count += 1
    cache.set(_read_key(user_id), marks[-_MAX_READ_MARKS:], ttl=_TTL)

    try:
        from api.services.alert_taxonomy import receipts as _at_receipts
        count += _at_receipts.mark_all_fires_read(user_id)
    except Exception:
        pass

    # Alert Durability V1: mirror `mine`'s mark into the durable legacy table
    # (same reasoning as mark_read's dual-write) AND mark any durable row
    # whose ephemeral copy is already gone (redeploy/TTL/eviction).
    try:
        from api.services import alert_durability as _durable
        for a in mine:
            _durable.mark_read(a["id"], user_id)
        count += _durable.mark_all_read(user_id)
    except Exception:  # noqa: BLE001
        pass

    return count


def clear_alerts(user_id: str | None = None) -> int:
    """Remove alerts. ``user_id=None`` clears the BROADCAST feed only."""
    key = _BROADCAST_KEY if user_id is None else _user_key(user_id)
    count = len(cache.get(key) or [])
    cache.set(key, [], ttl=_TTL)
    if user_id is not None:
        cache.invalidate(_read_key(user_id))
        try:
            from api.services import alert_durability as _durable
            _durable.clear_alerts(user_id)
        except Exception:  # noqa: BLE001
            pass
    return count


def _fire_discord(alert: dict) -> bool:
    """Send alert to Discord webhook. Non-fatal. **True iff Discord took it.**

    ⭐ THE RETURN VALUE IS THE FIX. This returned ``None`` and swallowed BOTH
    halves of a failure: the exception, and — worse, because it is the common
    one — the HTTP STATUS. A 403 from a rotated webhook and a 429 from a
    rate-limited one both left through the success path, so "Discord delivered"
    meant only "a POST was attempted".

    ⛔ STILL NON-FATAL, AND THAT IS NOT IN TENSION WITH REPORTING. Raising here
    would abort the caller's remaining channels, which is the one thing a
    delivery path may never do — an email must not be lost because Discord is
    down. It reports; the caller decides.

    ⚠️ A TRANSPORT THAT REPORTS NO USABLE STATUS IS NOT A REFUSAL. `int(code)`
    on a mock/stubbed response raises, and reading that as a failure would make
    every test double a "Discord outage" — a guard that fires on the harness
    instead of on the product.

    ⚠️ SIGNATURE KEPT AT ONE ARGUMENT ON PURPOSE. TERM-011 rows 1/3 route
    ``_OPS_ROUTED_TYPES`` through a different URL (`_discord_destination`,
    also what `add_alert`'s own gate consults to decide whether to call this
    at all) — that resolution lives THERE, re-read here, rather than as a
    second parameter on this function. A dozen tests replace this whole
    function with a bare ``lambda payload: None``; a second parameter would
    raise ``TypeError`` through every one of them the day a caller passed it.
    """
    try:
        import requests

        color = 0xE74C3C if alert["severity"] == SEVERITY_CRITICAL else 0xF0AD4E
        embed = {
            "title": f"{'🚨' if alert['severity'] == SEVERITY_CRITICAL else '⚠️'} {alert['title']}",
            "description": alert["message"],
            "color": color,
            "footer": {"text": f"UCT Alert · {alert['type']} · {alert['timestamp'][:16]}"},
        }
        resp = requests.post(
            _discord_destination(alert),
            json={"embeds": [embed]},
            timeout=5,
        )
    except Exception as e:
        _logger.warning("Discord alert webhook failed: %s", e)
        return False
    try:
        refused = int(getattr(resp, "status_code", None)) >= 400
    except (TypeError, ValueError):
        return True
    if refused:
        _logger.warning("Discord alert webhook REFUSED the post: HTTP %s",
                        getattr(resp, "status_code", None))
        return False
    return True


# ── Convenience functions for common alert patterns ───────────────────────

def alert_regime_change(old_phase: str, new_phase: str, exposure: int | None = None) -> dict:
    # `exposure` here is the brain's intraday view, not the wire's published rating.
    msg = f"Market regime shifted from **{old_phase}** to **{new_phase}**"
    if exposure is not None:
        msg += f". AI exposure view: {exposure}%"
    return add_alert("regime_change", f"Regime: {new_phase}", msg,
                     data={"old_phase": old_phase, "new_phase": new_phase, "exposure": exposure})


def alert_stop_hit(symbol: str, entry_price: float, stop_price: float) -> dict:
    return add_alert("stop_hit", f"Stop Hit: {symbol}",
                     f"{symbol} hit -6% hard stop at ${stop_price:.2f} (entry ${entry_price:.2f})",
                     data={"symbol": symbol, "entry_price": entry_price, "stop_price": stop_price})


def alert_scanner_match(symbol: str, score: int, setup: str) -> dict:
    return add_alert("scanner_match", f"Scanner: {symbol} ({score}pts)",
                     f"{symbol} scored {score}/110 — {setup}",
                     data={"symbol": symbol, "score": score, "setup": setup})


def alert_exposure_shift(old_exp: int, new_exp: int, direction: str) -> dict:
    # Compares the brain's intraday reads to each other — say so. The
    # published UCT Exposure is set by the Morning Wire and is not this.
    return add_alert("exposure_shift", f"AI regime read {direction}: {new_exp}%",
                     f"The brain's exposure view moved from {old_exp}% to {new_exp}%. "
                     f"The published UCT Exposure (Morning Wire) is unchanged.",
                     data={"old_exposure": old_exp, "new_exposure": new_exp})
