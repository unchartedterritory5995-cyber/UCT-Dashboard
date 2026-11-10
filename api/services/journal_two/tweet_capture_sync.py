"""Import a tweet: removing the words of saved posts that left X.

Two nightly jobs. `run_sweep` (03:10 ET) checks every saved post and marks the ones X no longer
returns. `run_confirm` (03:25 ET) re-checks the marked ones and removes the confirmed. The card
stays: the author, link, time, price and My take are the member's record; the post's words and
copied images are X's, and they go.

⛔ THE FAILURE THIS MODULE EXISTS TO AVOID IS A VENDOR GLITCH WIPING SAVED POSTS. The lookup says
"gone" by OMITTING an id, so a bad response looks exactly like a deletion. Hence:
  * Never on one miss: two checks at least `CONFIRM_AFTER` apart must both miss the post.
  * The bulk guard: a sweep that misses more than `BULK_MISS_SHARE_PCT` of what it checked, and at
    least `BULK_MISS_MIN`, marks nothing, clears every open mark, and alerts the owner.
  * The outage rule: a pass (sweep or confirm) where nothing resolved out of `OUTAGE_MIN_CHECKED`
    or more ids changes nothing but those marks, and alerts the owner. The confirm's own ids are
    the ones that already missed, so several real deletions look like an outage on their own: it
    also looks up up to `CONFIRM_CANARIES` unmarked posts, only ever as evidence that X is up.
    Before calling it an outage, a pass looks up `FEED_CANARIES` posts from the curated feed that
    it has not just asked about: one resolving says X is up, so the misses are real deletions.
  * Any `TwitterApiError` makes the pass a no-op; the next night tries again.
  * Each post is one transaction across every member holding it, committed before the next, so a
    crash leaves whole posts removed or untouched. Files are deleted after that commit; a file
    that will not delete is logged, and `attachment_gc` finds it once `media_json` is '[]'.

No write transaction is ever held across a vendor call, and both jobs return a dict instead of
raising.

THE MEANING-SEARCH INDEX NEEDS NOTHING: `j2_note_embeddings` is built from the note body, where a
`documentExcerpt` node reads as a bare marker (`note_citation_text`), so a post's words never
reach it.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from api.services import tweet_store, twitterapi_io
from api.services.auth_db import get_connection
from api.services.journal_two import media_policy, tweet_capture

logger = logging.getLogger(__name__)

#: Two misses must be at least this far apart.
CONFIRM_AFTER = timedelta(minutes=10)
#: A sweep missing more than this share of what it checked, and at least this many, is the vendor.
BULK_MISS_SHARE_PCT = 20
BULK_MISS_MIN = 20
#: A pass over at least this many ids in which NONE resolved is an outage, not a set of deletions.
OUTAGE_MIN_CHECKED = 2
#: How many unmarked posts the confirm looks up beside the marked ones.
CONFIRM_CANARIES = 5
#: How many curated-feed posts are looked up when nothing else resolved.
FEED_CANARIES = 5

ALERT_KEY = "notebook_tweet_bulk_miss"

_ACTIVE_IDS_SQL = "SELECT DISTINCT tweet_id FROM j2_note_tweet_captures WHERE removed_at IS NULL"
_DUE_IDS_SQL = (
    "SELECT DISTINCT tweet_id FROM j2_note_tweet_captures"
    " WHERE removed_at IS NULL AND gone_first_missed_at IS NOT NULL AND gone_first_missed_at <= ?")
#: Unmarked on every row of the post, newest saved first (the likeliest to still be on X).
_CANARY_IDS_SQL = (
    "SELECT tweet_id FROM j2_note_tweet_captures WHERE removed_at IS NULL"
    " GROUP BY tweet_id HAVING COUNT(gone_first_missed_at) = 0"
    " ORDER BY MAX(created_at) DESC, tweet_id LIMIT ?")
_IN_IDS = "tweet_id IN (SELECT value FROM json_each(?))"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(moment: datetime) -> str:
    """Fixed width, so stored marks compare correctly as text."""
    return moment.isoformat(timespec="microseconds")


def _read_ids(sql: str, params: tuple = ()) -> list[str]:
    """On its own connection, closed before the caller goes to the vendor."""
    conn = get_connection()
    try:
        return [row["tweet_id"] for row in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _lookup(ids: list[str]) -> Optional[set[str]]:
    """The ids X no longer returns, or None when the check could not run."""
    try:
        return set(twitterapi_io.find_deleted_tweet_ids(ids)) & set(ids)
    except twitterapi_io.TwitterApiError as e:
        logger.warning("[tweet_capture_sync] the lookup could not run: %s", type(e).__name__)
        return None


def _is_bulk(missed: int, checked: int) -> bool:
    return missed >= BULK_MISS_MIN and missed * 100 > checked * BULK_MISS_SHARE_PCT


def _feed_resolves(looked_up: list[str]) -> bool:
    """True when X returned a curated-feed post this pass has not already asked about. No such
    post, a failed read or a failed lookup is no evidence, and the outage rule stands."""
    try:
        canaries = tweet_store.oldest_tweet_ids(FEED_CANARIES, exclude=looked_up)
    except Exception:  # noqa: BLE001
        logger.exception("[tweet_capture_sync] could not read the feed canaries")
        return False
    if not canaries:
        return False
    gone = _lookup(canaries)
    return gone is not None and len(gone) < len(canaries)


def _is_outage(gone: set[str], looked_up: list[str]) -> bool:
    return (len(looked_up) >= OUTAGE_MIN_CHECKED and len(gone) >= len(looked_up)
            and not _feed_resolves(looked_up))


def _alert_owner(missed: int, checked: int, job: str = "sweep") -> None:
    """Counts only. A failure here must never reach the job."""
    message = (f"Notebook tweet {job}: X did not return {missed} of {checked} saved posts. "
               "Treated as a vendor problem: nothing was marked or removed.")
    logger.error("[tweet_capture_sync] %s", message)
    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(ALERT_KEY, "critical", message, {"missed": missed, "checked": checked})
    except Exception:  # noqa: BLE001
        logger.exception("[tweet_capture_sync] the owner alert failed")


def _clear_marks(conn, ids: Iterable[str]) -> int:
    return conn.execute(
        "UPDATE j2_note_tweet_captures SET gone_first_missed_at = NULL"
        f" WHERE removed_at IS NULL AND gone_first_missed_at IS NOT NULL AND {_IN_IDS}",
        (json.dumps(list(ids)),)).rowcount


def _write_marks(stamped: Iterable[str], at: str, cleared: Iterable[str]) -> int:
    """Set marks on `stamped` (a repeat miss keeps its first mark), clear them on `cleared`, in one
    short transaction. Returns the rows newly marked."""
    conn = get_connection()
    try:
        made = conn.execute(
            "UPDATE j2_note_tweet_captures SET gone_first_missed_at = ?"
            f" WHERE removed_at IS NULL AND gone_first_missed_at IS NULL AND {_IN_IDS}",
            (at, json.dumps(list(stamped)))).rowcount
        _clear_marks(conn, cleared)
        conn.commit()
        return made
    finally:
        conn.close()


def _media_urls(media_json: Optional[str]) -> list[str]:
    try:
        media = json.loads(media_json or "[]")
    except ValueError:
        return []
    return [u for u in media if isinstance(u, str)] if isinstance(media, list) else []


def _image_still_used(conn, user_id: str, note_id: str, url: str) -> bool:
    """A stored image is content-addressed, so the same file can back another card in this note,
    or an image the member placed in the note themselves (its body, hero or a restorable version).
    Read after the removal committed: this post's own rows already list nothing."""
    for row in conn.execute(
            "SELECT media_json FROM j2_note_tweet_captures"
            " WHERE user_id = ? AND note_id = ? AND removed_at IS NULL", (user_id, note_id)).fetchall():
        if url in _media_urls(row["media_json"]):
            return True
    name = url.rsplit("/", 1)[-1]
    return conn.execute(
        "SELECT 1 FROM j2_notes WHERE id = ? AND user_id = ?"
        " AND (instr(COALESCE(body_json, ''), ?) > 0 OR instr(COALESCE(hero_image_url, ''), ?) > 0)"
        " UNION ALL SELECT 1 FROM j2_note_versions WHERE note_id = ? AND user_id = ? AND instr(body_json, ?) > 0"
        " LIMIT 1",
        (note_id, user_id, name, name, note_id, user_id, name)).fetchone() is not None


def _delete_images(conn, row: sqlite3.Row) -> None:
    """After the commit. A file that cannot go is logged; the removal stands."""
    user_id, note_id = row["user_id"], row["note_id"]
    for url in _media_urls(row["media_json"]):
        try:
            if _image_still_used(conn, user_id, note_id, url):
                continue
            if not media_policy.delete_stored_media(user_id, note_id, url):
                logger.warning("[tweet_capture_sync] a stored image could not be deleted")
        except Exception:  # noqa: BLE001
            logger.exception("[tweet_capture_sync] a stored image could not be deleted")


def remove_post(conn, tweet_id: str) -> int:
    """Remove a post's words and copied images from every member holding it, in one transaction.
    Returns how many cards it removed. Raises on a database failure, with the post untouched.

    The one narrow path that rewrites an excerpt's source text. `annotation = annotation` is what
    fires `j2_note_excerpts_fts_au`, which rewrites the search row with only the member's words."""
    try:
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            "SELECT document_id, user_id, note_id, media_json FROM j2_note_tweet_captures"
            " WHERE tweet_id = ? AND removed_at IS NULL", (tweet_id,)).fetchall()
        removed_at = _stamp(_now())
        for row in rows:
            doc_id, user_id = row["document_id"], row["user_id"]
            conn.execute("DELETE FROM j2_note_document_pages WHERE document_id = ? AND user_id = ?",
                         (doc_id, user_id))
            conn.execute(
                "UPDATE j2_note_excerpts SET captured_text = '', quote_prefix = NULL, quote_suffix = NULL,"
                " annotation = annotation WHERE document_id = ? AND user_id = ?", (doc_id, user_id))
            conn.execute(
                "UPDATE j2_note_tweet_captures SET media_json = '[]', removed_at = ?"
                " WHERE document_id = ? AND user_id = ?", (removed_at, doc_id, user_id))
        conn.commit()
    except Exception:
        try:
            if conn.in_transaction:
                conn.rollback()
        except Exception:  # noqa: BLE001 -- a failed rollback must not mask the cause
            pass
        raise
    for row in rows:
        _delete_images(conn, row)
    return len(rows)


def run_sweep() -> dict[str, Any]:
    """Check every saved post once; mark the misses. Never raises."""
    out: dict[str, Any] = {"checked": 0, "missed": 0, "resolved": 0, "marked": 0,
                           "bulk_guard": False, "outage": False, "vendor_error": False}
    if not tweet_capture.enabled():
        return {**out, "skipped": "disabled"}
    try:
        ids = _read_ids(_ACTIVE_IDS_SQL)
        out["checked"] = len(ids)
        if not ids:
            return out
        gone = _lookup(ids)
        if gone is None:
            out["vendor_error"] = True
            return out
        out["missed"] = len(gone)
        outage = _is_outage(gone, ids)
        if outage or _is_bulk(len(gone), len(ids)):
            # Decided before any mark is written, so this pass made none. It also clears the
            # marks of earlier nights: nothing a pass this wrong says about a post can be trusted,
            # and a real deletion is only delayed to the next night.
            # The alert goes first: a database failure below must not silence it.
            out["outage" if outage else "bulk_guard"] = True
            _alert_owner(len(gone), len(ids))
            _write_marks([], _stamp(_now()), ids)
            return out
        resolved = [i for i in ids if i not in gone]
        out["resolved"] = len(resolved)
        out["marked"] = _write_marks(gone, _stamp(_now()), resolved)
        return out
    except Exception as e:  # noqa: BLE001 -- a failed pass must never break the scheduler
        logger.exception("[tweet_capture_sync] the sweep failed")
        return {**out, "error": type(e).__name__}


def run_confirm() -> dict[str, Any]:
    """Re-check marks at least `CONFIRM_AFTER` old, plus the canaries; remove what is still gone.
    Never raises."""
    out: dict[str, Any] = {"checked": 0, "canaries": 0, "resolved": 0, "removed": 0, "failed": 0,
                           "outage": False, "vendor_error": False}
    if not tweet_capture.enabled():
        return {**out, "skipped": "disabled"}
    try:
        ids = _read_ids(_DUE_IDS_SQL, (_stamp(_now() - CONFIRM_AFTER),))
        out["checked"] = len(ids)
        if not ids:
            return out
        canaries = _read_ids(_CANARY_IDS_SQL, (CONFIRM_CANARIES,))
        out["canaries"] = len(canaries)
        looked_up = ids + canaries
        gone = _lookup(looked_up)
        if gone is None:
            out["vendor_error"] = True
            return out
        if _is_outage(gone, looked_up):
            # This pass makes no marks, so there are none of its own to clear.
            out["outage"] = True
            _alert_owner(len(gone), len(looked_up), job="confirm")
            return out
        # From here only `ids` are acted on: a canary is never marked, cleared or removed.
        resolved = [i for i in ids if i not in gone]
        out["resolved"] = len(resolved)
        conn = get_connection()
        try:
            _clear_marks(conn, resolved)
            conn.commit()
            for tweet_id in ids:
                if tweet_id not in gone:
                    continue
                try:
                    out["removed"] += remove_post(conn, tweet_id)
                except Exception:  # noqa: BLE001 -- one bad post must not stop the rest
                    logger.exception("[tweet_capture_sync] could not remove a post")
                    out["failed"] += 1
        finally:
            conn.close()
        return out
    except Exception as e:  # noqa: BLE001 -- a failed pass must never break the scheduler
        logger.exception("[tweet_capture_sync] the confirm failed")
        return {**out, "error": type(e).__name__}
