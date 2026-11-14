"""Tell a member what joined and what left an RS screen, once a day (RS screens unit U13).

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` section 6 ("alerts when a stock joins or
leaves a screen, as one daily digest with a per-session key so catch-up runs never
repeat"). A member turns on "Tell me what joins and leaves" for any of the five RS
screens and gets ONE message a day per screen, after the nightly rating run:
"UCT RS Leaders, at its standard settings: 3 joined (AAA, BBB, CCC), 2 left (DDD, EEE)."

NOT A SECOND ALERT SYSTEM. Everything that already existed is used as it is:
  * WHICH STOCKS ARE ON A SCREEN is `membership.py`'s nightly record (every starter is
    recorded after a complete build, and recorded again after the rating post-pass
    moved the ratings). `membership.recorded_change` reads its two newest sessions.
    No second snapshot store.
  * DELIVERY is `watchlist_alert_service.deliver_alert_payload` (in-app, plus the
    channels the member's alert settings allow), with the member's routing rule read
    the way `spec_alerts` reads it.
  * The 12-name cap is `screen_alerts.MAX_NAMED`.
What this module owns is two small tables: who asked (member, screen) and what was
already said (member, screen, session).

WHY NOT `screen_alerts` OR `spec_alerts` THEMSELVES. `screen_alerts` diffs a member's
DEFINITION scan from `scan_hits` and drops a subscription whose definition is gone; a
starter is not a definition. `spec_alerts` copies a member's spec into the subscription
and takes its own snapshot per subscription, keyed by the BUILD date: a starter's
subscription must follow the starter (its defaults can change), the record already
exists once for everyone, and the key has to be the SESSION (a weekend makes three
builds over one session, `membership.py` 2026-10-18).

THE RULES (each is a test in tests/test_rs_screens_u13_alerts.py)
  * ⛔ ONE MESSAGE PER MEMBER PER SCREEN PER SESSION, however many times the job runs
    (the 04:15 rating chain, the 04:40 lists job and every catch-up all come through
    here). The (member, screen, session) row is CLAIMED with INSERT OR IGNORE before
    anything is sent, so two runs at once cannot both send; a delivery that reached
    nobody gives the claim back so a later run can try again. A process killed between
    the claim and the send loses that one message: it is never sent twice.
  * ⛔ NOTHING WITH THE FLAG OFF. ``RS_SCREEN_ALERTS_ENABLED`` is read per call (only
    the literal ``1`` arms it). Off, `run_nightly` returns before it opens the
    database, the routes 404 and the saved-screens payload carries no ``rs_alerts``.
    The RS screens must be on for the member too (`screens_on`).
  * The message describes the screen AT ITS STANDARD SETTINGS, and says so: a member's
    quick-control choices are not part of the subscription in v1.
  * SILENCE IS A RESULT. Nothing changed, no earlier recorded session, a list too wide
    to store, or a record that is not of the rated session: nothing is sent.
  * MORE THAN 60% OF A LIST CHANGED: the names are not listed. One in-app note per
    member says the list changed too much to itemise today (`too_much`).
  * The words are plain and are never advice: "joined" and "left".

WHEN IT RUNS. `api.main._run_rs_post_pass`, straight after `membership.rerecord_all`,
and only for a pass that moved the ratings onto the settled session. No job of its own.
"""
from __future__ import annotations

import base64
import datetime
import json
import logging
import os
import time

from . import screen_alerts, snapshot_db

log = logging.getLogger(__name__)

FLAG = "RS_SCREEN_ALERTS_ENABLED"
#: The alert type the bell and the alert feed file these under.
SOURCE = "rs_screen_alert"
#: Names listed per side before "+N more" (the one cap every screen alert uses).
MAX_NAMED = screen_alerts.MAX_NAMED
#: Above this share of a list changing in one session the names are not listed. The
#: share is the larger of: today's names that are new, over today's list; and the
#: previous session's names that are gone, over the previous list.
TOO_MUCH_SHARE = 0.60
#: A short list is always itemised: two new names on a three-name list is an ordinary day
#: (RS New High Before Price often holds a handful), not the data event the share rule is
#: for. The rule applies only when today's or the previous list holds at least this many.
TOO_MUCH_MIN_NAMES = 10
#: What a (member, screen, session) row records was done.
KIND_MESSAGE, KIND_NOTE, KIND_SUSPENDED = "message", "note", "suspended"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS rs_screen_alert_subs (
  user_id    TEXT    NOT NULL,
  starter_id TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, starter_id)
);
-- ⛔ THE KEY IS (member, screen, SESSION). The session is the rated session the
-- message is about, never the build date or the clock: a weekend's three builds and
-- every catch-up run describe one session and may say it once.
CREATE TABLE IF NOT EXISTS rs_screen_alerts_fired (
  user_id    TEXT    NOT NULL,
  starter_id TEXT    NOT NULL,
  session    TEXT    NOT NULL,
  fired_at   INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  n_joined   INTEGER NOT NULL,
  n_left     INTEGER NOT NULL,
  PRIMARY KEY (user_id, starter_id, session)
);
"""

_done: set = set()


class UnknownScreen(LookupError):
    """Not one of the five RS screens (unknown, hidden or retired): a 404."""


def enabled() -> bool:
    """``RS_SCREEN_ALERTS_ENABLED``, read PER CALL (only the literal ``1`` arms it), so a
    flip needs no restart and a rollback is an unset. Ledger: docs/feature_flags.json.
    The name is spelled out here (not read from :data:`FLAG`) because the ledger's index
    of gates is derived from the literal (``feature_flag_index``)."""
    return os.environ.get("RS_SCREEN_ALERTS_ENABLED", "0") == "1"


def screens_on(user) -> bool:
    """Are the RS screens on FOR THIS MEMBER? A member who cannot open a screen is
    never offered, or sent, a message about it. ``user`` is the member's own record
    (the routes pass the signed-in user, the nightly job `_member`)."""
    from . import rs_post_pass                               # noqa: PLC0415 - lazy: no cycle
    # Unit U10: the member-facing reader. Under RS_SCREENS_ENABLED=admin only an admin is
    # shown the screens, so only an admin is offered, or sent, a message about them.
    return bool(user) and rs_post_pass.surfaces_on(user)


def _ensure() -> None:
    path = snapshot_db.get_db_path()
    if path in _done:
        return
    with snapshot_db.connect() as conn:
        conn.executescript(_SCHEMA)
    _done.add(path)


# --------------------------------------------------------------------------- #
# the five screens
# --------------------------------------------------------------------------- #

def screens() -> dict:
    """``{starter id: starter}`` for the five RS screens AS SERVED, in the picker's
    order. The served copy (`saved_screens.starters`) is the one `membership.record_all`
    records, so the spec read here is the spec the record is filed under. A screen that
    is not served, or is served hidden, is not here."""
    from . import rs_post_pass, rs_screens, saved_screens    # noqa: PLC0415 - lazy: no cycle
    if not rs_post_pass.enabled():
        # Off, three of the five ids belong to the earlier single-rule starters.
        return {}
    # The DATA gate, and the list as a shown user is served it (unit U10): under the
    # owner-only value the five are recorded nightly although a member is not served them,
    # and WHO is told is decided per member by `screens_on`.
    served = {s.get("id"): s for s in saved_screens.starters_with_the_rs_screens()
              if not s.get("hidden")}
    return {s["id"]: served[s["id"]] for s in rs_screens.screens() if s["id"] in served}


def available(user) -> bool:
    """May this member be offered the toggle? The flag, the screens for this member,
    the five being served, and the nightly record the message is read from (without
    it a subscription could never say anything, so it is not offered)."""
    if not enabled() or not screens_on(user):
        return False
    try:
        from . import membership                             # noqa: PLC0415 - lazy
        return membership.job_enabled() and bool(screens())
    except Exception:                                        # noqa: BLE001 - unreadable is off
        return False


def screen_link(starter: dict) -> str:
    """The path that opens this screen at its standard settings: ``/screener?s=`` and
    the spec in the page's own URL form (`app/src/pages/screener/shell/specUrl.js`
    ``encodeSpec``: base64url of ``{f: {key: clause}, sort, view, rank}``). The page
    names a spec that equals a starter's as that starter, so the link lands on the
    screen itself, quick controls included. A spec with two clauses on one key cannot
    be written in that form; it gets the bare page, never a different screen."""
    spec = (starter or {}).get("spec") or {}
    by_key = {}
    for clause in spec.get("filters") or []:
        key = clause.get("key")
        if not key or key in by_key:
            return "/screener"
        by_key[key] = {k: v for k, v in clause.items() if k != "key"}
    payload = {}
    if by_key:
        payload["f"] = by_key
    for src, dst in (("sort", "sort"), ("view", "view"), ("rank", "rank"), ("logic", "lg")):
        if spec.get(src):
            payload[dst] = spec[src]
    if not payload:
        return "/screener"
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "/screener?s=" + base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


# --------------------------------------------------------------------------- #
# subscriptions
# --------------------------------------------------------------------------- #

def _known(starter_id) -> str:
    sid = str(starter_id or "")
    if sid not in screens():
        raise UnknownScreen(sid)
    return sid


def subscribe(user_id, starter_id) -> dict:
    """Turn the daily message on for one screen. Asking twice is one subscription."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("a subscription needs a member")
    sid = _known(starter_id)
    _ensure()
    with snapshot_db.connect() as conn:
        conn.execute("INSERT OR IGNORE INTO rs_screen_alert_subs (user_id, starter_id, "
                     "created_at) VALUES (?,?,?)", (uid, sid, int(time.time())))
    return {"starter_id": sid, "subscribed": True}


def unsubscribe(user_id, starter_id) -> dict:
    """Turn it off. Off twice is off. What was already said stays recorded, so turning
    it back on the same day never repeats that day's message."""
    sid = _known(starter_id)
    _ensure()
    with snapshot_db.connect() as conn:
        conn.execute("DELETE FROM rs_screen_alert_subs WHERE user_id=? AND starter_id=?",
                     (str(user_id), sid))
    return {"starter_id": sid, "subscribed": False}


def subscribed(user_id) -> list:
    """The screens this member has the message on for, in the picker's order. A row
    for a screen that is no longer one of the five is not listed (and is never sent)."""
    _ensure()
    with snapshot_db.connect() as conn:
        have = {r[0] for r in conn.execute(
            "SELECT starter_id FROM rs_screen_alert_subs WHERE user_id=?", (str(user_id),))}
    return [sid for sid in screens() if sid in have]


def payload(user) -> dict | None:
    """What ``GET /api/screener/saved-screens`` carries as ``rs_alerts``, or None when
    the key must not exist (the flag is off, or the screens are off for this member).
    Never raises: that payload is the whole Screens menu, and a toggle is not worth it.
    A read that fails says "not available", so no toggle is drawn."""
    if not enabled():
        return None
    try:
        if not screens_on(user):
            return None
        ok = available(user)
        return {"available": ok, "subscribed": subscribed(user["id"]) if ok else []}
    except Exception as e:                                   # noqa: BLE001
        log.warning("[rs-screen-alerts] payload not read: %s: %s", type(e).__name__, e)
        return {"available": False, "subscribed": []}


# --------------------------------------------------------------------------- #
# pure: the 60% rule and the words
# --------------------------------------------------------------------------- #

def too_much(n_joined: int, n_left: int, n_now: int, n_before: int) -> bool:
    """Did more than :data:`TOO_MUCH_SHARE` of the list change? The larger of the share
    of today's list that is new and the share of the previous list that is gone. A list
    that was empty and is not (or the reverse) changed entirely."""
    if max(n_now, n_before) < TOO_MUCH_MIN_NAMES:
        return False
    new_share = (n_joined / n_now) if n_now else 0.0
    gone_share = (n_left / n_before) if n_before else 0.0
    return max(new_share, gone_share) > TOO_MUCH_SHARE


def _day(session) -> str:
    """``2026-11-13`` -> ``Nov 13``; anything else as it came."""
    try:
        d = datetime.date.fromisoformat(str(session)[:10])
        return f"{d.strftime('%b')} {d.day}"
    except (TypeError, ValueError):
        return str(session or "")


def _names(names) -> str:
    shown = list(names[:MAX_NAMED])
    more = len(names) - len(shown)
    return ", ".join(shown + ([f"+{more} more"] if more > 0 else []))


def _and(words) -> str:
    words = list(words)
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def _dates(session, prev_session=None) -> str:
    said = f"Ratings as of {_day(session)}"
    return f"{said}, compared with {_day(prev_session)}." if prev_session else f"{said}."


def compose(name, joined, left, session, prev_session=None, *, caution=False) -> tuple:
    """``(title, message)`` for one screen's change. The ONE place the words are built.
    "Joined" and "left" are what happened to a list; nothing here says what to do.
    ``caution``: the market caution state is on, so the message ends with its sentence
    (`rs_market_state.TEXT`), the joins still listed."""
    counts = [f"{len(n)} {verb}" for n, verb in ((joined, "joined"), (left, "left")) if n]
    parts = [f"{len(n)} {verb} ({_names(n)})"
             for n, verb in ((joined, "joined"), (left, "left")) if n]
    message = (f"{name}, at its standard settings: {', '.join(parts)}. "
               f"{_dates(session, prev_session)}")
    if caution:
        from . import rs_market_state                        # noqa: PLC0415 - lazy
        message = f"{message} {rs_market_state.TEXT[rs_market_state.CAUTION]}"
    return f"{name}: {', '.join(counts)}", message


def compose_note(names, session) -> tuple:
    """``(title, message)`` of the one note that stands in for every list that changed
    too much to itemise. It says only that; the cause is not guessed."""
    names = list(names)
    one = len(names) == 1
    title = (f"{names[0]}: the list changed too much to itemise today" if one
             else "RS screens: lists changed too much to itemise today")
    message = (f"{_and(names)}, at {'its' if one else 'their'} standard settings: "
               f"the {'list' if one else 'lists'} changed too much to itemise today. "
               f"Open the {'screen' if one else 'screens'} to see "
               f"{'it as it stands' if one else 'them as they stand'}. {_dates(session)}")
    return title, message


# --------------------------------------------------------------------------- #
# the dedup rows
# --------------------------------------------------------------------------- #

def _claim(user_id, starter_id, session, kind, n_joined=0, n_left=0) -> bool:
    """Take the (member, screen, session) row. True for exactly one caller, ever."""
    with snapshot_db.connect() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO rs_screen_alerts_fired (user_id, starter_id, session, "
            "fired_at, kind, n_joined, n_left) VALUES (?,?,?,?,?,?,?)",
            (str(user_id), str(starter_id), str(session), int(time.time()), kind,
             int(n_joined), int(n_left)))
        return cur.rowcount == 1


def _release(user_id, starter_ids, session) -> None:
    """Give claims back after a delivery that reached nobody, so a later run can send."""
    with snapshot_db.connect() as conn:
        conn.executemany(
            "DELETE FROM rs_screen_alerts_fired WHERE user_id=? AND starter_id=? AND session=?",
            [(str(user_id), str(s), str(session)) for s in starter_ids])


def _reached_nobody(report) -> bool:
    """`deliver_alert_payload` reports per channel. Nothing landed and something failed
    is the one outcome that is retried; a report this module cannot read is a delivery."""
    return (isinstance(report, dict) and report.get("channels_ok") == 0
            and bool(report.get("channels_failed")))


# --------------------------------------------------------------------------- #
# the nightly run
# --------------------------------------------------------------------------- #

def _member(user_id):
    """The member's own record for `screens_on`, or None (no such account, or the
    accounts store could not be read): unknown is never sent to."""
    try:
        from api.services import auth_service                # noqa: PLC0415 - lazy
        return auth_service.get_user_by_id(str(user_id))
    except Exception:                                        # noqa: BLE001
        return None


def _rated_session():
    """The session the newest post-pass moved the ratings onto, or None."""
    from . import rs_post_pass                               # noqa: PLC0415 - lazy
    last = rs_post_pass.last_run() or {}
    return last.get("rating_session") if last.get("rewritten") else None


def _change_for(spec, session, recorded_after) -> dict:
    """One screen's recorded change for ``session``, with the reasons it may not be
    said folded into ``state``: ``not_recorded`` when the newest record is not of this
    session, or was taken before the pass that moved the ratings."""
    from . import membership                                 # noqa: PLC0415 - lazy
    c = membership.recorded_change(spec)
    if c.get("state") in ("unsaved", "live_screen"):
        return {"state": "not_recorded"}
    if str(c.get("session") or "") != str(session):
        return {"state": "not_recorded"}
    if recorded_after is not None and float(c.get("recorded_at") or 0) < float(recorded_after):
        return {"state": "not_recorded"}
    if c["state"] == "no_history":
        return {"state": "no_previous"}
    if c["state"] != "ok":
        return {"state": c["state"]}
    if not c["entered"] and not c["exited"]:
        return {"state": "quiet"}
    if too_much(len(c["entered"]), len(c["exited"]), c["n"], c["prev_n"]):
        return {**c, "state": "too_much"}
    return c


def run_nightly(session=None, *, recorded_after=None, deliver=None, routing=None) -> dict:
    """Send each subscribed member what joined and left each of their screens for
    ``session``. Returns a receipt; never raises.

    ``session`` is the rated session the caller's post-pass just moved the ratings onto
    (default: the newest pass receipt's, when that pass moved them). ``recorded_after``
    is that pass's finish time: a membership record older than it was taken on the
    previous ratings and is not described. ``deliver`` and ``routing`` are injected by
    tests; the defaults are the real delivery and the member's routing rule.

    ⛔ EVERY MEMBER IS ISOLATED: one bad record or one dead mailbox never costs another
    member their message."""
    receipt = {"enabled": enabled(), "session": None, "reason": None, "subscriptions": 0,
               "members": 0, "sent": 0, "noted": 0, "quiet": 0, "no_previous": 0,
               "not_recorded": 0, "too_wide": 0, "skipped_dedup": 0, "screens_off": 0,
               "suspended_routing": 0, "errors": 0}
    if not receipt["enabled"]:
        receipt["reason"] = "disabled"
        return receipt
    try:
        _run(receipt, session, recorded_after, deliver, routing)
    except Exception as e:                                   # noqa: BLE001 - never costs the chain
        receipt["errors"] += 1
        receipt["reason"] = f"{type(e).__name__}: {e}"[:200]
        log.warning("[rs-screen-alerts] run failed", exc_info=True)
    log.info("[rs-screen-alerts] %s", receipt)
    return receipt


def _run(receipt, session, recorded_after, deliver, routing) -> None:
    from . import rs_post_pass                               # noqa: PLC0415 - lazy
    if not rs_post_pass.enabled():
        receipt["reason"] = "screens_off"
        return
    session = session or _rated_session()
    if not session:
        receipt["reason"] = "no_rated_session"
        return
    session = str(session)
    receipt["session"] = session
    five = screens()
    _ensure()
    with snapshot_db.connect() as conn:
        subs = [(r[0], r[1]) for r in conn.execute(
            "SELECT user_id, starter_id FROM rs_screen_alert_subs ORDER BY user_id, starter_id")]
    subs = [(u, s) for u, s in subs if s in five]
    receipt["subscriptions"] = len(subs)
    if not subs:
        return
    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload  # noqa: PLC0415
        deliver = deliver_alert_payload
    if routing is None:
        from api.services.alert_taxonomy import routing_rule  # noqa: PLC0415
        routing = routing_rule.effective

    changes = {}
    for sid in five:                                         # the picker's order
        if not any(s == sid for _u, s in subs):
            continue
        try:
            changes[sid] = _change_for(five[sid]["spec"], session, recorded_after)
        except Exception:                                    # noqa: BLE001 - one screen never stops the run
            changes[sid] = {"state": "errors"}
            log.warning("[rs-screen-alerts] change not read for %s", sid, exc_info=True)

    caution = _caution()
    by_member: dict = {}
    for uid, sid in subs:
        by_member.setdefault(uid, []).append(sid)
    receipt["members"] = len(by_member)
    for uid, wanted in by_member.items():
        try:
            _send_member(receipt, uid, [s for s in five if s in wanted], five, changes,
                         session, caution, deliver, routing)
        except Exception:                                    # noqa: BLE001 - one member never stops the run
            receipt["errors"] += 1
            log.warning("[rs-screen-alerts] member %s failed", uid, exc_info=True)


def _caution() -> bool:
    try:
        from . import rs_market_state                        # noqa: PLC0415 - lazy
        return (rs_market_state.served() or {}).get("state") == rs_market_state.CAUTION
    except Exception:                                        # noqa: BLE001
        return False


def _send(deliver, rule, uid, title, message, extra) -> bool:
    """One delivery through the member's channels. False when it reached nobody."""
    report = deliver(
        user_id=str(uid), sym="MARKET", title=title, message=message, source=SOURCE,
        # A daily note about a list, not a warning about a stock.
        severity="info", extra_data=extra,
        **({"channels_allowed": rule.channels_allowed()} if rule is not None else {}))
    return not _reached_nobody(report)


def _send_member(receipt, uid, wanted, five, changes, session, caution, deliver, routing) -> None:
    if not screens_on(_member(uid)):
        receipt["screens_off"] += len(wanted)
        return
    rule = routing(uid)
    suspended = rule is not None and getattr(rule, "suspended", False)
    too_many = []
    for sid in wanted:
        c = changes[sid]
        state = c["state"]
        if state == "too_much":
            too_many.append(sid)
            continue
        if state != "ok":
            receipt[state] += 1
            continue
        joined, left = c["entered"], c["exited"]
        if suspended:
            # The member paused every alert (FT-036): recorded as said, nothing sent,
            # so resuming later the same day does not send the morning's message.
            if _claim(uid, sid, session, KIND_SUSPENDED, len(joined), len(left)):
                receipt["suspended_routing"] += 1
            else:
                receipt["skipped_dedup"] += 1
            continue
        if not _claim(uid, sid, session, KIND_MESSAGE, len(joined), len(left)):
            receipt["skipped_dedup"] += 1
            continue
        try:
            title, message = compose(five[sid]["name"], joined, left, session,
                                     c.get("prev_session"), caution=caution)
            landed = _send(deliver, rule, uid, title, message, {
                "starter_id": sid, "session": session, "joined": joined, "left": left,
                # the bell's own click-through key: it opens the screen
                "research_url": screen_link(five[sid])})
        except Exception:
            _release(uid, [sid], session)
            raise
        if landed:
            receipt["sent"] += 1
        else:
            _release(uid, [sid], session)
            receipt["errors"] += 1
    if too_many:
        _note_member(receipt, uid, too_many, five, session, suspended, deliver)


def _note_member(receipt, uid, too_many, five, session, suspended, deliver) -> None:
    """ONE in-app note for every list of this member's that changed too much to
    itemise. In-app only (`channels_allowed` empty: no email, no push), whatever the
    member's channels are: it carries no names, so it is not worth a mailbox."""
    kind = KIND_SUSPENDED if suspended else KIND_NOTE
    mine = [sid for sid in too_many if _claim(uid, sid, session, kind)]
    receipt["skipped_dedup"] += len(too_many) - len(mine)
    if not mine:
        return
    if suspended:
        receipt["suspended_routing"] += len(mine)
        return
    try:
        title, message = compose_note([five[sid]["name"] for sid in mine], session)
        report = deliver(
            user_id=str(uid), sym="MARKET", title=title, message=message, source=SOURCE,
            severity="info", channels_allowed=frozenset(),
            extra_data={"starter_ids": mine, "session": session, "too_much": True,
                        "research_url": screen_link(five[mine[0]])})
    except Exception:
        _release(uid, mine, session)
        raise
    if _reached_nobody(report):
        _release(uid, mine, session)
        receipt["errors"] += 1
    else:
        receipt["noted"] += 1
