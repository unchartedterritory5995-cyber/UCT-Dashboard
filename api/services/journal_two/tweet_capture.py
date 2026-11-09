"""Import a tweet: reading posts (recent, or a pasted X link), and saving them into a note.

SAVE (`save`, below) follows `transcript_capture.save_passage`: each post becomes an ordinary
cited excerpt (document `x:<tweet_id>`, one page, one excerpt covering the whole text, a
`documentExcerpt` node) plus a `j2_note_tweet_captures` sidecar written in the document's own
transaction. Each post has its own transaction. Vendor and price reads happen BEFORE a post's
transaction opens; images are copied after it commits. Nothing the client sends about a post is
stored: `save` takes ids and re-reads every post here.

Two reads, one shape. Both answer the same camelCase POST:

    {id, name, handle, avatarUrl, text, postedAt, url, tickers, media, kind}

  * `recent(symbol, scope, user_id)` -- posts already in `tweets.db` over the last 168 hours: for
    one ticker (`'ticker'`, `tweet_store.tweets_for_ticker`) or the whole curated feed (`'all'`,
    `tweet_store.feed(hours=168, limit=200)`). Each also carries `savedInNote`, for that member.
  * `resolve_link(url)` -- a pasted link becomes a post. The store is asked first (no vendor
    call, no spend); only a miss goes to the vendor.

THE RULES THIS MODULE KEEPS (each is a decision, and each has a test):
  * The server only ever fetches a tweet by its NUMERIC ID. `parse_status_id` takes the id out
    of the link and nothing else of the member's text goes anywhere: the URL is never requested,
    so a pasted link cannot make the server fetch an address of the member's choosing.
  * A post fetched from a link is NEVER written to `tweets.db`. That store is the curated
    accounts' feed; a member's pasted link must not add an account's post to everybody's feed.
  * `postedAt` is unix seconds (the store's own `created_at`), `avatarUrl` is the
    `pbs.twimg.com/profile_images/` URL found in the stored payload or None, and `kind` is the
    author's `content_kind` ('news' | 'commentary'), 'commentary' for an author UCT does not know.
  * `raw_json` never leaves this module.

⛔ DARK: `NOTEBOOK_TWEET_IMPORT_ENABLED` unset means every tweet route answers 404. Read per call
through the one Notebook flag parse (`notebook_flags.flag_on`).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
import uuid
from typing import Any, Optional
from urllib.parse import urlsplit

from api.services import tweet_store, twitterapi_io
from api.services.notebook_flags import flag_on
from api.services.ticker_resolver import route_symbol
from api.services.tweet_ticker_extract import extract_tickers

logger = logging.getLogger(__name__)

GATE = "NOTEBOOK_TWEET_IMPORT_ENABLED"

#: The recent window, both scopes.
RECENT_HOURS = 168
#: How many posts `scope='all'` (and, for symmetry, a ticker) returns at most.
RECENT_LIMIT = 200

NOT_FOUND_SENTENCE = "That post could not be found. It may be deleted or private."
VENDOR_DOWN_SENTENCE = "X is not answering right now. Try again in a moment."
NOT_A_LINK_SENTENCE = "That is not a link to a post on X."
NOTHING_PICKED_SENTENCE = "Pick at least one post to import."
BAD_POST_ID_SENTENCE = "That is not a post on X."
NO_WORDS_SENTENCE = "A post from @{handle} has no text to save."
SAVE_FAILED_SENTENCE = "A post could not be saved."
REMOVED_POST_SENTENCE = "That post is no longer on X, so it can't be saved again."

#: At most this many posts per import.
MAX_POSTS_PER_SAVE = 20
#: At most this many images are copied per post, only from this host.
MAX_IMAGES_PER_POST = 4
IMAGE_HOST = "pbs.twimg.com"
#: One image, and every image of one import together: a stalled CDN must not hold a threadpool
#: worker for minutes (the fetch's own deadline covers one download only).
IMAGE_DEADLINE_S = 15.0
IMPORT_IMAGES_BUDGET_S = 45.0
#: One import spends at most this long, in all, on the bars door: starting its tickers' refreshes
#: (5-10 s each, measured), waiting for them, and every read. Past it only stored bars answer.
PRICE_REFRESH_BUDGET_S = 12.0
IDENTITY_PREFIX = "x:"

_ID_RE = re.compile(r"\d{1,25}")
#: `tweet_store._extract_media` asks for a small display size; the copy we keep is the large one.
_SMALL_RENDITION_RE = re.compile(r"([?&]name=)small(?=&|$)")

#: The host is EXACTLY x.com or twitter.com, optionally behind www. or mobile. -- the path
#: separator (or end of string) must follow, so `x.com.evil.test` and `notx.com` never match.
_STATUS_RE = re.compile(
    r"^(?:https?://)?(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)/"
    r"(?:[A-Za-z0-9_]{1,15}/status(?:es)?|i/web/status)/(\d{1,25})(?:[/?#].*)?$",
    re.IGNORECASE,
)
_AVATAR_RE = re.compile(r'https://pbs\.twimg\.com/profile_images/[^"\\\s]+')


class TweetCaptureError(Exception):
    """A refusal with the HTTP status the router answers and the sentence a member reads."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse."""
    return flag_on(GATE, False)


def parse_status_id(url: Any) -> Optional[str]:
    """The numeric status id of an x.com / twitter.com post link, or None."""
    if not isinstance(url, str):
        return None
    m = _STATUS_RE.match(url.strip())
    return m.group(1) if m else None


def _kinds() -> dict[str, str]:
    out: dict[str, str] = {}
    for a in tweet_store.list_accounts():
        h = str(a.get("handle") or "").lower()
        if h:
            out[h] = a.get("content_kind") or "commentary"
    return out


def _avatar(raw_json: Optional[str]) -> Optional[str]:
    if not raw_json:
        return None
    m = _AVATAR_RE.search(raw_json.replace("\\/", "/"))
    return m.group(0) if m else None


def _post(row: dict, kinds: dict[str, str]) -> dict[str, Any]:
    handle = str(row.get("author_handle") or "")
    return {
        "id": str(row["id"]),
        "name": row.get("author_name") or handle,
        "handle": handle,
        "avatarUrl": _avatar(row.get("raw_json")),
        "text": row.get("text") or "",
        "postedAt": int(row.get("created_at") or 0),
        "url": row.get("url") or "",
        "tickers": list(row.get("tickers") or []),
        "media": list(row.get("media") or []),
        "kind": kinds.get(handle.lower(), "commentary"),
    }


def _saved_ids(user_id: str, ids: list[str]) -> set[str]:
    """Which of `ids` this member holds a capture of that has not been removed. One query."""
    if not ids:
        return set()
    from api.services.journal_two import notes as notes_service
    marks = ",".join("?" * len(ids))
    conn = notes_service.get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT tweet_id FROM j2_note_tweet_captures"
            f" WHERE user_id = ? AND removed_at IS NULL AND tweet_id IN ({marks})",
            (user_id, *ids)).fetchall()
    finally:
        conn.close()
    return {str(r["tweet_id"]) for r in rows}


def recent(symbol: Optional[str], scope: str, user_id: str) -> list[dict[str, Any]]:
    """Posts UCT holds from the last 168 hours, newest first. `savedInNote` is `user_id`'s own,
    so `user_id` is required: the answer is one member's and must never be shared."""
    if scope == "ticker":
        sym = route_symbol(symbol.strip().lstrip("$")) if isinstance(symbol, str) else None
        if not sym:
            raise TweetCaptureError("Pick a ticker to see its recent posts.")
        rows = tweet_store.with_links(
            tweet_store.tweets_for_ticker(sym, hours=RECENT_HOURS)[:RECENT_LIMIT])
    elif scope == "all":
        rows = tweet_store.feed(hours=RECENT_HOURS, limit=RECENT_LIMIT)
    else:
        raise TweetCaptureError("Scope must be 'ticker' or 'all'.")
    kinds = _kinds()
    posts = [_post(r, kinds) for r in rows]
    saved = _saved_ids(user_id, [p["id"] for p in posts])
    return [{**p, "savedInNote": p["id"] in saved} for p in posts]


def resolve_link(url: Any) -> dict[str, Any]:
    """A pasted X link as a post. Store first; a miss asks the vendor by id. Never persists."""
    tweet_id = parse_status_id(url)
    if tweet_id is None:
        raise TweetCaptureError(NOT_A_LINK_SENTENCE)
    kinds = _kinds()
    row = tweet_store.get_tweet(tweet_id)
    if row is not None:
        return _post(row, kinds)
    try:
        fetched = twitterapi_io.get_tweets_by_ids([tweet_id])
    except twitterapi_io.TwitterApiError as e:
        # The sentence is the member's; the cause (never the key) goes to the log.
        logger.warning("[tweet_capture] vendor lookup failed: %s", type(e).__name__)
        raise TweetCaptureError(VENDOR_DOWN_SENTENCE, status=503) from e
    match = next((t for t in fetched if str(t.get("id")) == tweet_id), None)
    if match is None:
        raise TweetCaptureError(NOT_FOUND_SENTENCE, status=404)
    return _vendor_post(match, kinds)


def _vendor_post(fetched: dict, kinds: dict[str, str]) -> dict[str, Any]:
    """A vendor row as a Post: its tickers and media derived the way the store derives them."""
    row = dict(fetched)
    row["tickers"] = sorted(extract_tickers(row.get("text") or ""))
    row["media"] = tweet_store._extract_media(row.get("raw_json"))
    return _post(row, kinds)


# ── the save ─────────────────────────────────────────────────────────────────

def _clean_ids(tweet_ids: Any) -> list[str]:
    """The requested numeric ids, each once, in first-seen order."""
    if not isinstance(tweet_ids, list) or not tweet_ids:
        raise TweetCaptureError(NOTHING_PICKED_SENTENCE)
    out: list[str] = []
    for raw in tweet_ids:
        if not isinstance(raw, str) or not _ID_RE.fullmatch(raw):
            raise TweetCaptureError(BAD_POST_ID_SENTENCE)
        if raw not in out:
            out.append(raw)
    if len(out) > MAX_POSTS_PER_SAVE:
        raise TweetCaptureError(f"Import at most {MAX_POSTS_PER_SAVE} posts at a time.")
    return out


def _read_posts(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Each id's post: from the store, then ONE vendor read for the ids the store lacks. A post
    read from the vendor is never written to `tweets.db`."""
    found: dict[str, dict[str, Any]] = {}
    for tweet_id in ids:
        row = tweet_store.get_tweet(tweet_id)
        if row is not None:
            found[tweet_id] = _post(row, {})
    missing = [i for i in ids if i not in found]
    if not missing:
        return found
    try:
        fetched = twitterapi_io.get_tweets_by_ids(missing)
    except twitterapi_io.TwitterApiError as e:
        logger.warning("[tweet_capture] vendor lookup failed: %s", type(e).__name__)
        raise TweetCaptureError(VENDOR_DOWN_SENTENCE, status=503) from e
    wanted = set(missing)
    for t in fetched:
        tweet_id = str(t.get("id"))
        if tweet_id in wanted:
            found[tweet_id] = _vendor_post(t, {})
    return found


def _permalink(post: dict[str, Any]) -> str:
    url = post.get("url") or ""
    if parse_status_id(url) == post["id"]:
        return url
    return f"https://x.com/{post.get('handle') or 'i'}/status/{post['id']}"


def _price(post: dict[str, Any], note_ticker: Optional[str], wait_until: Optional[float] = None):
    """The post's PricePoint, or None. Called BEFORE the write transaction: it can read bars."""
    from api.services.journal_two import tweet_price
    symbol = tweet_price.choose_symbol(note_ticker, post.get("tickers") or [], post.get("text") or "")
    if not symbol or not post.get("postedAt"):
        return None
    return tweet_price.price_at_post(symbol, int(post["postedAt"]), wait_until=wait_until)


def _start_price_refreshes(posts: dict[str, Any], note_ticker: Optional[str],
                           wait_until: Optional[float] = None) -> None:
    """Start every recent post's ticker refreshing at once, so one import's shared wait covers
    them all instead of each ticker starting only when the one before it has finished. Starting
    spends the same `wait_until` as the reads, and stops when it is spent."""
    from api.services.journal_two import tweet_price
    started: set[str] = set()
    for post in posts.values():
        if wait_until is not None and time.monotonic() >= wait_until:
            return
        symbol = tweet_price.choose_symbol(note_ticker, post.get("tickers") or [], post.get("text") or "")
        if (symbol and symbol not in started and post.get("postedAt")
                and tweet_price.awaits_refresh(int(post["postedAt"]))):
            started.add(symbol)
            tweet_price.start_refresh(symbol, wait_until)


def _with_progress(sentence: str, saved: int) -> str:
    tail ="1 post was saved before it." if saved == 1 else f"{saved} posts were saved before it."
    return f"{sentence} {tail}"


def _rollback(conn) -> None:
    try:
        if conn.in_transaction:
            conn.rollback()
    except Exception:  # noqa: BLE001 -- a failed rollback must not mask the cause
        pass


def _undo(conn, user_id: str, excerpt_id: str, doc_id: str, created_doc: bool, created_page: bool) -> None:
    """A refused placement leaves nothing behind: the excerpt this request made, and the page,
    document and sidecar too when this request made them and nothing else cites them. A failure
    here is logged and must not replace the cause the caller is about to raise."""
    from api.services.journal_two import note_excerpts
    try:
        note_excerpts.delete_excerpt(user_id, excerpt_id, conn=conn)
        left = conn.execute(
            "SELECT COUNT(*) FROM j2_note_excerpts WHERE user_id = ? AND document_id = ? AND page_number = 1",
            (user_id, doc_id)).fetchone()[0]
        if created_page and not left:
            conn.execute("DELETE FROM j2_note_document_pages WHERE document_id = ? AND user_id = ?"
                         " AND page_number = 1", (doc_id, user_id))
        if created_doc:
            conn.execute("DELETE FROM j2_note_tweet_captures WHERE document_id = ? AND user_id = ?",
                         (doc_id, user_id))
            pages = conn.execute("SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ?",
                                 (doc_id,)).fetchone()[0]
            if not pages:
                conn.execute("DELETE FROM j2_note_documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
        conn.commit()
    except Exception:  # noqa: BLE001
        logger.exception("[tweet_capture] undo failed for a refused placement")
        _rollback(conn)


def _save_post(conn, user_id: str, note_id: str, note_ticker: Optional[str],
               post: dict[str, Any], price_wait_until: Optional[float] = None) -> tuple[str, str, bool]:
    """One post, in its own transaction, into `note_id`. Returns (excerpt id, document id,
    whether this call created the document). Raises TweetCaptureError on every refusal."""
    from api.services.journal_two import note_excerpts, notes as notes_service
    from api.services.journal_two.web_capture import MAX_PASSAGE_CHARS, sanitize_text
    from api.services.journal_two.web_capture_store import TEXT_ORIGIN_WEB_PASSAGE

    handle = sanitize_text(post.get("handle"), limit=64)
    name = sanitize_text(post.get("name"), limit=200) or handle
    text = sanitize_text(post.get("text"), limit=MAX_PASSAGE_CHARS)
    if not text:
        raise TweetCaptureError(NO_WORDS_SENTENCE.format(handle=handle or "X"), status=422)
    tweet_id = post["id"]
    identity = f"{IDENTITY_PREFIX}{tweet_id}"
    permalink = _permalink(post)

    if notes_service.get_note(user_id, note_id, conn=conn) is None:
        raise TweetCaptureError("Note not found.", status=404)
    if conn.in_transaction:     # get_note may have opened one (its thumbnail write)
        conn.commit()
    # A post already saved here needs no price; the fetch below can read bars, so it is skipped
    # and it stays out of the write transaction either way.
    held = conn.execute(
        "SELECT 1 FROM j2_note_documents WHERE user_id = ? AND note_id = ? AND attachment_url = ?",
        (user_id, note_id, identity)).fetchone()
    price = None if held else _price(post, note_ticker, price_wait_until)

    created_doc = created_page = False
    doc_id = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        doc = conn.execute(
            "SELECT id FROM j2_note_documents WHERE user_id = ? AND note_id = ? AND attachment_url = ?",
            (user_id, note_id, identity)).fetchone()
        if doc is None:
            doc_id = uuid.uuid4().hex
            now = notes_service._now_iso()
            conn.execute(
                "INSERT INTO j2_note_documents"
                " (id, user_id, note_id, attachment_url, name, status, page_count,"
                "  extraction_version, created_at, processed_at, source_kind, source_url, capture_type)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (doc_id, user_id, note_id, identity, f"@{handle} on X" if handle else "A post on X",
                 "ready", 1, 1, now, now, "web", permalink, "web_passage"))
            # The sidecar, in the document's transaction, so a card can never be half a row.
            # `document_id` is its primary key: only the request that made the document writes it.
            conn.execute(
                "INSERT INTO j2_note_tweet_captures"
                " (document_id, user_id, note_id, tweet_id, author_handle, author_name, avatar_url,"
                "  permalink, posted_at, price_symbol, price_at_post, price_label, price_session_date,"
                "  created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (doc_id, user_id, note_id, tweet_id, handle, name,
                 post.get("avatarUrl"), permalink, int(post.get("postedAt") or 0),
                 price.symbol if price else None, price.price if price else None,
                 price.label if price else None, price.session_date if price else None, now))
            created_doc = True
        else:
            doc_id = doc["id"]
            # A card `tweet_capture_sync` emptied stays empty. The sweep never re-checks it, so
            # words written back here would stay for good. The `except` below rolls this back.
            capture = conn.execute(
                "SELECT removed_at FROM j2_note_tweet_captures WHERE document_id = ? AND user_id = ?",
                (doc_id, user_id)).fetchone()
            if capture is not None and capture["removed_at"] is not None:
                raise TweetCaptureError(REMOVED_POST_SENTENCE, status=409)

        page = conn.execute(
            "SELECT text FROM j2_note_document_pages WHERE document_id = ? AND user_id = ? AND page_number = 1",
            (doc_id, user_id)).fetchone()
        if page is None:
            page_text = text
            conn.execute(
                "INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text, text_origin)"
                " VALUES (?,?,?,?,?)", (doc_id, user_id, 1, page_text, TEXT_ORIGIN_WEB_PASSAGE))
            created_page = True
        else:
            # A page is written ONCE (Wave J): the stored text is the anchor's text.
            page_text = page["text"]

        dup = conn.execute(
            "SELECT id FROM j2_note_excerpts WHERE user_id = ? AND note_id = ? AND document_id = ?"
            " AND page_number = 1 AND captured_text = ? ORDER BY created_at LIMIT 1",
            (user_id, note_id, doc_id, page_text)).fetchone()
        if dup is not None:
            conn.commit()
            # The same post again is the same excerpt. If the member had since removed its node
            # from the note, it goes back in (once); otherwise the note is untouched.
            placed = conn.execute(
                "SELECT 1 FROM j2_note_excerpt_refs WHERE user_id = ? AND note_id = ? AND excerpt_id = ?",
                (user_id, note_id, dup["id"])).fetchone()
            if placed is None:
                try:
                    notes_service.append_document_excerpt(user_id, note_id, dup["id"], conn=conn)
                except notes_service.NoteLockedError as ex:
                    raise TweetCaptureError(str(ex), status=423) from ex
                except notes_service.NoteValidationError as ex:
                    raise TweetCaptureError(str(ex)) from ex
            return dup["id"], doc_id, False

        excerpt = note_excerpts.create_excerpt(
            user_id, note_id, document_id=doc_id, page_number=1, captured_text=page_text,
            char_start=0, char_end=len(page_text),
            conn=conn)          # commits the document, the page, the sidecar and the excerpt together
    except TweetCaptureError:
        _rollback(conn)
        raise
    except note_excerpts.ExcerptValidationError as ex:
        _rollback(conn)
        raise TweetCaptureError(str(ex)) from ex
    except sqlite3.IntegrityError as ex:
        _rollback(conn)
        raise TweetCaptureError("This post cannot be saved into that note.", status=404) from ex
    except Exception:
        _rollback(conn)
        raise

    try:
        note = notes_service.append_document_excerpt(user_id, note_id, excerpt["id"], conn=conn)
    except notes_service.NoteLockedError as ex:
        _undo(conn, user_id, excerpt["id"], doc_id, created_doc, created_page)
        raise TweetCaptureError(str(ex), status=423) from ex
    except notes_service.NoteValidationError as ex:
        _undo(conn, user_id, excerpt["id"], doc_id, created_doc, created_page)
        raise TweetCaptureError(str(ex)) from ex
    except Exception:
        _undo(conn, user_id, excerpt["id"], doc_id, created_doc, created_page)
        raise
    if note is None:
        _undo(conn, user_id, excerpt["id"], doc_id, created_doc, created_page)
        raise TweetCaptureError("Note not found.", status=404)
    return excerpt["id"], doc_id, created_doc


def _copy_image(user_id: str, note_id: str, url: str, deadline: float) -> str:
    """One image copied into the note's attachments. Returns its stored URL. Raises on any
    failure. `save` is a sync route in the threadpool, so `asyncio.run` has no loop to fight."""
    from api.services.journal_two import hotlink_fetch, media_policy

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("this import's image time is spent")
    data, content_type = asyncio.run(
        hotlink_fetch.download(url, deadline_s=min(remaining, IMAGE_DEADLINE_S)))
    result = media_policy.normalize_media(data, content_type, hotlink_fetch.filename_of(url))
    if result.kind != "image":
        raise ValueError("not an image")
    budget = media_policy.MediaBudget.for_member(user_id)
    return media_policy.store_media(user_id, note_id, result, budget=budget).url


def _copy_images(conn, user_id: str, note_id: str, doc_id: str, post: dict[str, Any], deadline: float,
                 warnings: list[str]) -> None:
    """After the post committed: copy its images and record them on the sidecar. A failure warns
    and never touches the saved post."""
    urls = [u for u in post.get("media") or []
            if isinstance(u, str) and urlsplit(u).scheme == "https" and urlsplit(u).hostname == IMAGE_HOST]
    stored: list[str] = []
    warning = f"An image from @{post.get('handle')} could not be copied."
    for url in urls[:MAX_IMAGES_PER_POST]:
        try:
            stored.append(_copy_image(user_id, note_id, _SMALL_RENDITION_RE.sub(r"\1large", url), deadline))
        except Exception as e:  # noqa: BLE001 -- an image never costs the post
            logger.warning("[tweet_capture] image copy failed: %s", type(e).__name__)
            if warning not in warnings:
                warnings.append(warning)
    if not stored:
        return
    try:
        conn.execute("UPDATE j2_note_tweet_captures SET media_json = ? WHERE document_id = ? AND user_id = ?",
                     (json.dumps(stored), doc_id, user_id))
        conn.commit()
    except sqlite3.Error:
        logger.exception("[tweet_capture] could not record copied images")
        _rollback(conn)
        if warning not in warnings:
            warnings.append(warning)


def save(user_id: str, note_id: Any, tweet_ids: Any) -> dict[str, Any]:
    """Save posts, by numeric id, into `note_id` as cited excerpts, in the requested order.

    Returns {excerpts, note: {id, updatedAt}, warnings}. A failure on one post stops the import.
    Once a post is saved the note's revision has moved and the client needs it, so a later
    failure is still this normal answer plus `stopped`, the sentence saying what happened and
    how many were saved. With nothing saved, it raises TweetCaptureError with its status.
    """
    from api.services.journal_two import note_excerpts, notes as notes_service

    ids = _clean_ids(tweet_ids)
    if not isinstance(note_id, str) or not note_id:
        raise TweetCaptureError("Pick the note to save into.")

    conn = notes_service.get_connection()
    try:
        note = notes_service.get_note(user_id, note_id, conn=conn)
        if note is None:
            raise TweetCaptureError("Note not found.", status=404)
        if conn.in_transaction:     # get_note may have opened one (its thumbnail write)
            conn.commit()
        note_ticker = note.get("ticker")
        posts = _read_posts(ids)    # the vendor read, before any write transaction

        saved: list[str] = []
        warnings: list[str] = []
        stopped: Optional[str] = None
        deadline = time.monotonic() + IMPORT_IMAGES_BUDGET_S
        price_wait_until = time.monotonic() + PRICE_REFRESH_BUDGET_S
        _start_price_refreshes(posts, note_ticker, price_wait_until)
        for tweet_id in ids:
            try:
                post = posts.get(tweet_id)
                if post is None:
                    raise TweetCaptureError(NOT_FOUND_SENTENCE, status=404)
                excerpt_id, doc_id, created = _save_post(conn, user_id, note_id, note_ticker, post,
                                                         price_wait_until)
            except TweetCaptureError as e:
                if not saved:
                    raise
                stopped = _with_progress(str(e), len(saved))
                break
            except Exception:
                if not saved:
                    raise
                logger.exception("[tweet_capture] save stopped after %d posts", len(saved))
                stopped = _with_progress(SAVE_FAILED_SENTENCE, len(saved))
                break
            saved.append(excerpt_id)
            if created:
                _copy_images(conn, user_id, note_id, doc_id, post, deadline, warnings)

        excerpts = [note_excerpts.get_excerpt(user_id, ex_id, conn=conn) for ex_id in saved]
        row = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ? AND user_id = ?",
                           (note_id, user_id)).fetchone()
        out: dict[str, Any] = {
            "excerpts": excerpts,
            "note": {"id": note_id, "updatedAt": row["updated_at"] if row else None},
            "warnings": warnings,
        }
        if stopped is not None:
            out["stopped"] = stopped
        return out
    finally:
        conn.close()
