"""The provenance marker every Wisdom publish adapter writes (§8c.3; CONTRACTS §6.6).

WHY THIS EXISTS, and why it is a marker rather than an argument
The "did anything reach the member-facing tables?" audit is SHAPE-BASED: it hunts a
marker through the consumer tables. Until this module existed nobody was REQUIRED to
write one, so a row published without one could never be found and an empty
`wisdom_publish_log` was an argument, not a proof. From here every write a publish
adapter makes into a consumer surface carries `MARKER_RE`, so the audit's question has
a mechanical answer: scan the consumer table for the marker and you have found every
row Wisdom wrote, including the ones Wisdom does not remember writing.

THE MARKER is one line of text, recognised by `MARKER_RE`:

    [wisdom-provenance-v1 consumer=<consumer> ref=<subject_ref> cite=<locator> flag=<ENV>]

Text, not a column, on purpose. A consumer owns its own schema — `modelbook_service`
filters an insert through `_EXAMPLE_FIELDS`, the ENGINE `knowledge_base` is a different
repository's table, and the Pattern Intelligence Lab is PAUSED so `pattern_vision.db`
may not gain a column at all. A marker that has to live in a new column is a marker
some consumer can refuse. One recognisable string rides in whatever the consumer
already stores — a free-text column, a row object, a prompt line, an exported file —
and `is_marked()` finds it in any of them.

WHERE EACH FIELD COMES FROM
  consumer     the adapter's own `CONSUMER` constant (brainkb, modelbook, desk_markers…)
  subject_ref  `<table>:<key>` of the Wisdom row that caused the write
  cite         the interim S8 locator (adapters/common.py owns that grammar and the D2
               migration note); `unplaced` when the write has no single segment
  flag         the adapter's `FLAG_ENV`, so a marked row names the flag that let it out

STANDARD LIBRARY ONLY, like kbrow.py and voicefmt.py beside it: the PC-side tools load
this file BY PATH so they never import the `api` package and so can never capture a
`/data` path (CLAUDE.md "C:\\data IS REAL"). Keep it that way.

⛔ The rail that makes this real is `api/services/wisdom/publish/provenance_check.py`,
run by `tests/test_wisdom_publish_provenance.py`. It derives the adapter write-path set
from the source with an AST — never a typed roster — and fails on any consumer write
that cannot be shown to carry the marker.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

#: Bump with the grammar, never with the content. A reader of an old row must still
#: be able to recognise it, so `MARKER_RE` accepts any `wisdom-provenance-v<n>`.
MARKER_VERSION = "wisdom-provenance-v1"

#: The key the marker takes on a row object / payload dict.
MARKER_KEY = "wisdom_provenance"

#: The value of a consumer row's `source`-style column when Wisdom wrote it. The KB sync
#: keys on it (`source = 'wisdom'`), which is why it is one definition and not two.
SOURCE = "wisdom"

#: A SQL write that already constrains itself to rows carrying the marker source. The
#: checker accepts it as marking: such a statement cannot reach an unmarked row.
SQL_MARKED_PREDICATE = re.compile(r"\bsource\s*=\s*'" + SOURCE + r"'", re.I)

MARKER_RE = re.compile(
    r"\[wisdom-provenance-v\d+"
    r" consumer=(?P<consumer>[^\s\]]+)"
    r" ref=(?P<ref>[^\s\]]+)"
    r" cite=(?P<cite>[^\s\]]+)"
    r" flag=(?P<flag>[^\s\]]+)\]")

_UNSAFE = re.compile(r"[\[\]\s]+")


class UnmarkedWrite(RuntimeError):
    """Raised when a publish adapter is about to write something that carries no marker."""


def _field(value: object, fallback: str) -> str:
    text = _UNSAFE.sub("_", str(value if value is not None else "").strip())
    return text[:200] or fallback


def marker_text(*, consumer: object, subject_ref: object, locator: object = None,
                flag_env: object) -> str:
    """The one place the marker string is built. Nothing may hand-build it elsewhere."""
    return (f"[{MARKER_VERSION}"
            f" consumer={_field(consumer, 'unknown')}"
            f" ref={_field(subject_ref, 'unknown')}"
            f" cite={_field(locator, 'unplaced')}"
            f" flag={_field(flag_env, 'unflagged')}]")


def marker(*, consumer: object, subject_ref: object, locator: object = None,
           flag_env: object) -> dict:
    """The marker as row fields, for a consumer that takes objects rather than text."""
    return {"source": SOURCE,
            MARKER_KEY: marker_text(consumer=consumer, subject_ref=subject_ref,
                                    locator=locator, flag_env=flag_env)}


def stamp(payload: dict, *, consumer: object, subject_ref: object, locator: object = None,
          flag_env: object, text_field: Optional[str] = None) -> dict:
    """A NEW dict carrying the marker. `text_field` also appends it to that field's text.

    `text_field` is what survives a consumer that filters an insert through its own column
    allowlist (`modelbook_service._EXAMPLE_FIELDS` drops every key it does not know), so
    the marker reaches the stored row rather than the dict on the way to it."""
    out = dict(payload or {})
    text = marker_text(consumer=consumer, subject_ref=subject_ref, locator=locator, flag_env=flag_env)
    out["source"] = SOURCE
    out[MARKER_KEY] = text
    if text_field:
        existing = str(out.get(text_field) or "").strip()
        if not MARKER_RE.search(existing):
            out[text_field] = f"{existing} {text}".strip()
    return out


def stamp_text(text: Optional[str], *, consumer: object, subject_ref: object,
               locator: object = None, flag_env: object, separator: str = "\n") -> str:
    """Append the marker to a block of text (a KB row's content, a corpus header)."""
    body = text or ""
    if MARKER_RE.search(body):
        return body
    mark = marker_text(consumer=consumer, subject_ref=subject_ref, locator=locator, flag_env=flag_env)
    return f"{body.rstrip()}{separator}{mark}" if body.strip() else mark


def is_marked(value: Any) -> bool:
    """True when `value` — text, dict, list, anything JSON-able — carries the marker."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(MARKER_RE.search(value))
    try:
        blob = json.dumps(value, default=str)
    except (TypeError, ValueError):
        blob = str(value)
    return bool(MARKER_RE.search(blob))


def assert_marked(value: Any, *, what: str = "publish write") -> Any:
    """Return `value` when it carries the marker; raise `UnmarkedWrite` when it does not.

    The runtime half of the rail: the AST check proves the call is there, this proves the
    thing being written actually carries a marker at the moment it is written."""
    if not is_marked(value):
        raise UnmarkedWrite(f"{what}: no {MARKER_VERSION} marker — refusing to write to a consumer")
    return value


def parse(text: Optional[str]) -> Optional[dict]:
    """The audit's reader: the marker's fields, or None. Finds the FIRST marker."""
    match = MARKER_RE.search(text or "")
    return dict(match.groupdict()) if match else None


def find_all(text: Optional[str]) -> list:
    return [dict(m.groupdict()) for m in MARKER_RE.finditer(text or "")]
