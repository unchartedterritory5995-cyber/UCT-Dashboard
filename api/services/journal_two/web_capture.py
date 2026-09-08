"""Wave L — the web-capture contract.

A captured web source is a DOCUMENT (entry checkpoint §2). That single decision
is what lets capture inherit, unchanged: FTS indexing through the existing page
triggers, excerpt quote-anchors and re-location, the `documentExcerpt` node and
its page-anchored citation, thesis evidence through the EXISTING
`document_excerpt` target type, Ask retrieval as `document_page` /
`document_excerpt`, Wave K's lineage dedupe, tenant scoping and purge cascades.

⛔ THE RIGHTS BOUNDARY IS A TYPE HERE, NOT A COMMENT (entry checkpoint §3).

Three tiers of captured material, and they are genuinely different things:

    REFERENCE  title + canonical URL + domain + captured_at.
               A citation, not a copy. Always permitted.

    PASSAGE    text the MEMBER selected. Their own act of quoting — the same
               object shape they already store from a PDF (`j2_note_excerpts`).
               Always permitted.

    FULL_PAGE  the whole article body, or a rendered snapshot of it, stored
               permanently. ⛔ NOT PERMITTED IN WAVE L. This is Phase Zero
               §21's shape (permanent storage of third-party content), it is a
               redistribution vector the moment a note is shared (G-080), and
               it needs the owner's rights ruling — not an implementer's.

`assert_permitted_tier` REFUSES the third one. It is a refusal, not a filter:
silently dropping the body would let a caller believe it had been stored.

⭐ If full-page storage is later cleared, it lands in these SAME tables as more
page rows. Nothing here gets rebuilt — which is the point of stopping at the
boundary rather than designing around it.

⛔ CAPTURED CONTENT IS DATA, NEVER INSTRUCTION. This wave adds a SECOND
untrusted producer (the open web) to the one Wave K already fenced. A captured
title, byline, meta tag or body may contain anything at all, including text
shaped like instructions. Nothing here is ever rendered as markup, and every
value that leaves this module is plain text with control characters stripped.
Ask's own fence (`ask_prompt`) is unchanged and still applies to the page rows
this module writes.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

# ── Rights tiers ─────────────────────────────────────────────────────────────

TIER_REFERENCE = "reference"
TIER_PASSAGE = "passage"
TIER_FULL_PAGE = "full_page"

#: What Wave L may store. FULL_PAGE is deliberately absent.
PERMITTED_TIERS = frozenset({TIER_REFERENCE, TIER_PASSAGE})
ALL_TIERS = frozenset({TIER_REFERENCE, TIER_PASSAGE, TIER_FULL_PAGE})

SOURCE_KIND_ATTACHMENT = "attachment"
SOURCE_KIND_WEB = "web"

#: Ceilings. A passage is a quote, not a transcript: a caller sending 400KB of
#: "selected" text is either buggy or attempting the full-page tier by another
#: name, and both should fail loudly rather than fill the shared auth.db.
MAX_PASSAGE_CHARS = 8_000
MAX_TITLE_CHARS = 300
MAX_URL_CHARS = 2_048

_ALLOWED_SCHEMES = ("http", "https")


class CaptureRightsError(ValueError):
    """A caller asked to store material Wave L is not permitted to store."""


class CaptureValidationError(ValueError):
    """The capture envelope is malformed."""


# ── Sanitization ─────────────────────────────────────────────────────────────

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WS_RUN = re.compile(r"[ \t ]+")
_NL_RUN = re.compile(r"\n{3,}")


def sanitize_text(raw: Any, *, limit: int) -> str:
    """Plain text, always. Never markup, never a rendered string.

    ⛔ The output of this function is the ONLY form captured text takes anywhere
    downstream. It is not "escaped HTML" — it is text, and the surfaces that
    show it must render it as text. An escaped-HTML representation invites some
    later caller to unescape it.
    """
    if raw is None:
        return ""
    s = str(raw)
    # NFC first: a lookalike built from combining marks should normalize before
    # anything measures or truncates it.
    s = unicodedata.normalize("NFC", s)
    s = _CONTROL.sub("", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = _WS_RUN.sub(" ", s)
    s = _NL_RUN.sub("\n\n", s)
    s = s.strip()
    if len(s) > limit:
        s = s[:limit].rstrip()
    return s


# ── Identity ─────────────────────────────────────────────────────────────────

def canonical_url(url: Any) -> str:
    """A stable identity for one page.

    Lowercases scheme and host and drops the fragment — `#section-2` is a
    position on a page, not a different page. The QUERY IS KEPT: for a great
    many publishers `?id=123` IS the article, and dropping it would collapse
    two different sources onto one identity.
    """
    s = sanitize_text(url, limit=MAX_URL_CHARS)
    if not s:
        raise CaptureValidationError("a captured source needs a URL")
    parts = urlsplit(s)
    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise CaptureValidationError(f"unsupported URL scheme: {parts.scheme or '(none)'!r}")
    if not parts.netloc:
        raise CaptureValidationError("URL has no host")
    return urlunsplit((
        parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, "",
    ))


def source_domain(url: str) -> str:
    """The host, for display and grouping. Never trusted as provenance on its
    own — the canonical URL is the provenance."""
    host = urlsplit(canonical_url(url)).netloc
    return host[4:] if host.startswith("www.") else host


def web_document_identity(url: str) -> str:
    """The note-scoped identity for a web source.

    ⛔ This is what goes in `j2_note_documents.attachment_url`, and it is
    deliberately NOT a URL. That column is regex-parsed by
    `document_extraction._resolve_pdf_bytes` to read bytes off disk, and
    rewritten by `note_shares` for share links. A `web:` token cannot match the
    anchored `^/api/j2/notes/attachments/…$` pattern, so the PDF path declines
    it instead of touching the filesystem — and `UNIQUE(note_id, attachment_url)`
    then gives capture idempotency for free: re-capturing the same page into the
    same note returns the existing row.
    """
    digest = hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()
    return f"web:{digest[:32]}"


# ── The rights gate ──────────────────────────────────────────────────────────

def assert_permitted_tier(tier: str) -> str:
    """⛔ REFUSE, never silently drop.

    A caller that sent a full page and got a 2xx with the body quietly
    discarded would reasonably believe the page was stored. The refusal is the
    honest answer, and it is the one that reaches the owner's rights decision
    instead of routing around it.
    """
    if tier not in ALL_TIERS:
        raise CaptureValidationError(f"unknown capture tier {tier!r}")
    if tier not in PERMITTED_TIERS:
        raise CaptureRightsError(
            "full-page capture is not permitted: Wave L stores a reference and "
            "the passages the member selected, never a stored copy of the page. "
            "See docs/notebook/wave-l-entry-checkpoint.md §3."
        )
    return tier


# ── The capture envelope ─────────────────────────────────────────────────────

def build_capture(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate + sanitize one capture into the envelope the writer stores.

    ⭐ Provenance is structural: `title`, `url` and `domain` describe the SOURCE.
    `passage` is what the member chose to keep FROM that source. `annotation` is
    the member's OWN words about it. They are three different fields because
    they are three different kinds of claim, and collapsing them is how source
    material silently becomes member belief.
    """
    if not isinstance(payload, dict):
        raise CaptureValidationError("capture payload must be an object")

    tier = assert_permitted_tier(str(payload.get("tier") or TIER_REFERENCE))
    url = canonical_url(payload.get("url"))

    passage = sanitize_text(payload.get("passage"), limit=MAX_PASSAGE_CHARS)
    if tier == TIER_PASSAGE and not passage:
        raise CaptureValidationError("a passage capture needs the selected text")
    if tier == TIER_REFERENCE and passage:
        # Not an error to fix silently: the caller disagrees with itself about
        # what it is sending, and guessing which half is right is how the wrong
        # half gets stored.
        raise CaptureValidationError(
            "a reference capture carries no passage — send tier='passage' instead"
        )

    raw_len = len(str(payload.get("passage") or ""))
    if raw_len > MAX_PASSAGE_CHARS:
        raise CaptureRightsError(
            f"selected passage is {raw_len} characters, over the {MAX_PASSAGE_CHARS} "
            "ceiling — a quote, not a transcript"
        )

    return {
        "tier": tier,
        # ⛔ TWO URLs, on purpose (Wave L §7). `url` is the CANONICAL form and is
        # the only thing identity is derived from. `source_url` is what the
        # member actually captured, kept verbatim (minus sanitization) because a
        # fragment like `#risk-factors` is how they get back to the passage.
        # Canonicalization stays conservative: scheme/host lowercased, fragment
        # dropped, QUERY KEPT — for many publishers `?id=N` IS the article, and
        # no tracking-parameter stripping is performed at all, because "looks
        # like tracking" is a guess and a wrong guess merges two sources.
        "url": url,
        "source_url": _navigable_url(payload.get("url")),
        "domain": source_domain(url),
        "title": sanitize_text(payload.get("title"), limit=MAX_TITLE_CHARS) or source_domain(url),
        "passage": passage,
        # The member's own words ABOUT the source — never mixed into it.
        "annotation": sanitize_text(payload.get("annotation"), limit=MAX_PASSAGE_CHARS),
        "captured_at": _captured_at(payload.get("capturedAt")),
        "identity": web_document_identity(url),
        "source_kind": SOURCE_KIND_WEB,
    }


def _navigable_url(raw: Any) -> str:
    """The member's own URL, sanitized and scheme-checked but NOT canonicalized —
    what "open the original" should use."""
    s = sanitize_text(raw, limit=MAX_URL_CHARS)
    canonical_url(s)          # scheme/host validation, raises on anything unsafe
    return s


def _captured_at(raw: Any) -> str:
    """Trust a caller-supplied timestamp only if it parses; otherwise stamp now.

    ⛔ Never invent metadata. A capture whose time we cannot establish gets the
    time we DID establish — the moment the server accepted it — not a guess at
    what the client meant.
    """
    if isinstance(raw, str) and raw.strip():
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()
