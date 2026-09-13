"""Speaker-label normalization (W1 §4.4, D14; manifest §9; CONTRACTS §2.4).

normalize_speaker(label, title, description) -> author_id | 'guest:<slug>' | None

  1. An author: the label, or the label with Zoom decorations and a stray bracket removed,
     matches an alias in docs/wisdom/authors.json exactly (case-insensitive), through
     core.authors. "Patrick TSDR)", "Uncharted Territory" -> tsdr; "Brac" -> bracco.
  2. A guest (D14): not an author, and EVERY name token of the label appears as a whole
     word in the session title or description ("Pradeep Bonde" in "Workshop with
     Pradeep Bonde (Stockbee)"). A label made only of title words ("Live", "Trading")
     is never a guest.
  3. Otherwise None: an attendee. The caller stores no name for an attendee, ever.

Never inferred from voice or style, never fuzzy.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

from api.services.wisdom.core import authors

GUEST_PREFIX = "guest:"
TITLE_STOPWORDS = frozenset({
    "live", "trading", "session", "sessions", "workshop", "with", "and", "the", "update", "evening",
    "morning", "today", "interview", "webinar", "meeting", "zoom", "desk", "show", "part", "special",
    "guest", "host", "recap", "market", "week", "weekly", "daily",
})
_DECORATION_RE = re.compile(
    r"\s*[(\[](?:host|co-?host|guest|me|he/him|she/her|they/them|pinned|presenter)[)\]]\s*$", re.IGNORECASE)
_DEVICE_RE = re.compile(r"\s*[-–|]\s*(?:iphone|ipad|android|zoom|mobile|phone)\s*$", re.IGNORECASE)
#: A name token is Unicode letters (a guest can be "Zoë"), with inner apostrophes, dots and hyphens.
_NAME_TOKEN_RE = re.compile(r"[^\W\d_](?:[^\W\d_]|['’.\-])*")


def clean_label(label) -> str:
    text = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(label or ""))).strip()
    previous = None
    while previous != text:
        previous = text
        text = _DEVICE_RE.sub("", _DECORATION_RE.sub("", text)).strip()
    return text


def _balanced(text: str) -> str:
    if text.count("(") != text.count(")"):
        text = text.replace("(", " ").replace(")", " ")
    return re.sub(r"\s+", " ", text).strip()


def slugify(name: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "_", ascii_text).strip("_")[:48]


def normalize_speaker(label, title: Optional[str] = None, description: Optional[str] = None) -> Optional[str]:
    if label is None or not str(label).strip():
        return None
    cleaned = clean_label(label)
    for candidate in dict.fromkeys((str(label), cleaned, _balanced(cleaned))):
        if candidate:
            author_id = authors.author_for_alias(candidate)
            if author_id:
                return author_id
    tokens = [t.strip(".'’-") for t in _NAME_TOKEN_RE.findall(_balanced(cleaned))]
    tokens = [t for t in tokens if len(t) >= 2]
    if not tokens or not any(len(t) >= 3 and t.lower() not in TITLE_STOPWORDS for t in tokens):
        return None
    haystack = " ".join(part for part in (title, description) if part)
    if not haystack.strip():
        return None
    haystack = unicodedata.normalize("NFKC", haystack).lower()
    for token in tokens:
        if not re.search(r"(?<!\w)" + re.escape(token.lower()) + r"(?!\w)", haystack):
            return None
    slug = slugify(" ".join(tokens))
    return GUEST_PREFIX + slug if slug else None
