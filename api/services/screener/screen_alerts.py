"""Tell a member when a name ENTERS or LEAVES one of their screens.

WHY THIS MODULE EXISTS
======================
Benchmark Tier-1 loss #2 and metrics 462/463/465/466: *"Nobody can be told when
a name enters their screen — six rivals can."* thinkorswim alerts on BOTH entry
and exit at four cadences over four channels; Finviz ships unlimited screener
notifications; ChartMill re-evaluates any saved screen; Barchart auto-runs and
emails four times a day; Stock Rover does email and SMS with published caps.

Every piece already existed here and nothing joined them: the 05:00 ET sweep
stores tonight's hit set per definition in `scan_hits`, `scan_coverage` stores
the receipt, and `watchlist_alert_service.deliver_alert_payload` already
delivers in-app + email + Discord. What was missing was the SET DIFFERENCE.

⚠️ SAY WHAT THIS IS, NOT WHAT IT RESEMBLES. The diff is NIGHTLY BY
CONSTRUCTION — every declared scalar is `cadence: nightly` out of a 03:00
snapshot, so there is no intraday answer to give. thinkorswim's every-change
alert is a better product on this axis and the copy below says "overnight"
rather than implying a parity we do not have. ⛔ Do not soften that wording
into something that reads live.

THE TRAP THIS MODULE IS BUILT AROUND
====================================
🔴 THE PREVIOUS SESSION MUST COME FROM `scan_coverage`, NEVER FROM `scan_hits`.
A swept session that matched nothing writes a coverage row and ZERO hits rows.
Diffing against "the previous session that has hits" would therefore skip every
quiet night and compare tonight against some older, busier one — reporting every
name that has been in the screen the whole time as newly ENTERED. The member
would be alerted to a move that never happened, on a night when nothing moved.
`scan_store.recent_covered_as_ofs` is the one place that answers "which sessions
were swept".

⛔ A FIRST-EVER SWEEP IS NOT A HUNDRED ENTRIES. With one covered session there
is no previous set, so there is nothing to diff and this says NOTHING. A
"welcome to your new screen, here are all 87 matches" alert is not an alert.
"""
from __future__ import annotations

import logging
import time

from . import scan_store, snapshot_db

log = logging.getLogger(__name__)

#: Symbols named in one alert before it is truncated with a count. A message
#: that lists ninety tickers is not read by anyone; the screen itself is where
#: the full list lives.
MAX_NAMED = 12

#: Alerts one member can be sent in one nightly run, across all their screens.
#: ⛔ A CAP, NOT A PREFERENCE. A member who subscribes twenty screens on a day
#: the market rotates would otherwise get twenty notifications at 05:00, and the
#: reliable outcome of that is a muted channel — which costs them the alerts
#: that mattered, not just the ones that did not.
MAX_PER_USER = 6

_SCHEMA = """
CREATE TABLE IF NOT EXISTS screen_alert_subs (
  user_id    TEXT    NOT NULL,
  def_hash   TEXT    NOT NULL,
  def_id     TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  mode       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, def_hash)
);
CREATE INDEX IF NOT EXISTS idx_screen_alert_subs_hash
  ON screen_alert_subs(def_hash);
-- ⛔ THE DEDUP KEY IS (user, definition, SESSION). Without `as_of` a re-run
-- after a failed night would never alert again; without `user_id` one member's
-- delivery would silence everyone else's. Both are the shape
-- `catalyst_alerts_fired` already uses in this codebase.
CREATE TABLE IF NOT EXISTS screen_alerts_fired (
  user_id  TEXT    NOT NULL,
  def_hash TEXT    NOT NULL,
  as_of    INTEGER NOT NULL,
  fired_at INTEGER NOT NULL,
  entered  INTEGER NOT NULL,
  exited   INTEGER NOT NULL,
  PRIMARY KEY (user_id, def_hash, as_of)
);
"""

MODES = ("entry", "exit", "both")
_done = set()


def _ensure() -> None:
    path = snapshot_db.get_db_path()
    if path in _done:
        return
    scan_store.init_db()
    with snapshot_db.connect() as conn:
        conn.executescript(_SCHEMA)
    _done.add(path)


# ── subscriptions ────────────────────────────────────────────────────────────

def subscribe(user_id, def_hash, def_id, name, mode="both") -> dict:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    if not str(user_id or "").strip() or not str(def_hash or "").strip():
        raise ValueError("a subscription needs a member and a definition")
    _ensure()
    with snapshot_db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO screen_alert_subs "
            "(user_id, def_hash, def_id, name, mode, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (str(user_id), str(def_hash), str(def_id or ""),
             str(name or "Untitled screen"), mode, int(time.time())))
    return {"def_hash": str(def_hash), "mode": mode}


def unsubscribe(user_id, def_hash) -> bool:
    _ensure()
    with snapshot_db.connect() as conn:
        cur = conn.execute(
            "DELETE FROM screen_alert_subs WHERE user_id=? AND def_hash=?",
            (str(user_id), str(def_hash)))
        return cur.rowcount > 0


def list_subs(user_id) -> list:
    _ensure()
    with snapshot_db.connect() as conn:
        conn.row_factory = None
        rows = conn.execute(
            "SELECT def_hash, def_id, name, mode, created_at FROM "
            "screen_alert_subs WHERE user_id=? ORDER BY created_at",
            (str(user_id),)).fetchall()
    return [{"def_hash": r[0], "def_id": r[1], "name": r[2], "mode": r[3],
             "created_at": r[4]} for r in rows]


# ── the diff ─────────────────────────────────────────────────────────────────

def diff_for(def_hash, tf=None):
    """`(as_of, entered, exited)` for one definition's newest swept session.

    `(None, [], [])` when there is nothing to compare — one covered session, or
    none. That is the honest answer and NOT an empty alert.
    """
    tf = tf or scan_store.SCAN_JOIN_TF
    sessions = scan_store.recent_covered_as_ofs(def_hash, tf, limit=2)
    if len(sessions) < 2:
        return None, [], []
    now_as_of, prev_as_of = sessions[0], sessions[1]
    now = set(scan_store.hits(def_hash, tf, now_as_of))
    prev = set(scan_store.hits(def_hash, tf, prev_as_of))
    return now_as_of, sorted(now - prev), sorted(prev - now)


def _phrase(names, verb, screen):
    shown = names[:MAX_NAMED]
    more = len(names) - len(shown)
    tail = f" +{more} more" if more > 0 else ""
    return f"{', '.join(shown)}{tail} {verb} {screen}"


def _already_fired(conn, user_id, def_hash, as_of) -> bool:
    return conn.execute(
        "SELECT 1 FROM screen_alerts_fired WHERE user_id=? AND def_hash=? "
        "AND as_of=?", (str(user_id), str(def_hash), int(as_of))).fetchone() \
        is not None


def run_nightly(deliver=None, tf=None) -> dict:
    """Diff every subscribed definition and deliver. Returns a receipt.

    ⛔ EVERY MEMBER IS ISOLATED. One member's dead mailbox must not cost the
    others their alerts, so delivery is per-user and wrapped — the same rule
    every other fan-out in this codebase follows.
    """
    _ensure()
    tf = tf or scan_store.SCAN_JOIN_TF
    if deliver is None:                       # lazy: keeps the import graph flat
        from api.services.watchlist_alert_service import deliver_alert_payload
        deliver = deliver_alert_payload

    with snapshot_db.connect() as conn:
        conn.row_factory = None
        subs = conn.execute(
            "SELECT user_id, def_hash, name, mode FROM screen_alert_subs"
        ).fetchall()

    by_hash = {}
    for user_id, def_hash, name, mode in subs:
        by_hash.setdefault(def_hash, []).append((user_id, name, mode))

    receipt = {"definitions": len(by_hash), "compared": 0, "no_previous": 0,
               "sent": 0, "skipped_dedup": 0, "skipped_quota": 0,
               "skipped_quiet": 0, "errors": 0}
    per_user = {}

    for def_hash, watchers in by_hash.items():
        try:
            as_of, entered, exited = diff_for(def_hash, tf)
        except Exception:  # noqa: BLE001 — one bad definition never stops the run
            receipt["errors"] += 1
            log.warning("[screen-alerts] diff failed for %s", def_hash,
                        exc_info=True)
            continue
        if as_of is None:
            receipt["no_previous"] += 1
            continue
        receipt["compared"] += 1

        for user_id, name, mode in watchers:
            want_in = entered if mode in ("entry", "both") else []
            want_out = exited if mode in ("exit", "both") else []
            if not want_in and not want_out:
                # ⛔ SILENCE IS A RESULT. A nightly "nothing changed" message
                # trains the member to ignore the channel, which costs them the
                # night something does change.
                receipt["skipped_quiet"] += 1
                continue
            if per_user.get(user_id, 0) >= MAX_PER_USER:
                receipt["skipped_quota"] += 1
                continue
            try:
                with snapshot_db.connect() as conn:
                    if _already_fired(conn, user_id, def_hash, as_of):
                        receipt["skipped_dedup"] += 1
                        continue
                parts = []
                if want_in:
                    parts.append(_phrase(want_in, "entered", name))
                if want_out:
                    parts.append(_phrase(want_out, "left", name))
                # ⚠️ "Overnight" is the honest word and is load-bearing — the
                # sweep is nightly, so a member must not read this as live.
                message = ("Overnight change in your screen — "
                           + "; ".join(parts) + ".")
                deliver(
                    user_id=str(user_id),
                    sym=(want_in or want_out)[0],
                    title=f"{name}: {len(want_in)} in, {len(want_out)} out",
                    message=message,
                    source="screen_alert",
                    extra_data={"def_hash": def_hash, "as_of": as_of,
                                "entered": want_in, "exited": want_out},
                )
                with snapshot_db.connect() as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO screen_alerts_fired "
                        "(user_id, def_hash, as_of, fired_at, entered, exited) "
                        "VALUES (?,?,?,?,?,?)",
                        (str(user_id), str(def_hash), int(as_of),
                         int(time.time()), len(want_in), len(want_out)))
                per_user[user_id] = per_user.get(user_id, 0) + 1
                receipt["sent"] += 1
            except Exception:  # noqa: BLE001
                receipt["errors"] += 1
                log.warning("[screen-alerts] delivery failed for %s / %s",
                            user_id, def_hash, exc_info=True)
    log.info("[screen-alerts] %s", receipt)
    return receipt
