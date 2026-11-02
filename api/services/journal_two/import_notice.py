"""The `importNotice` block: the in-note marker for anything an import could not bring over.

A connector or file import that cannot copy an image, a file or an embed never drops it in
silence. It leaves ONE block atom where the thing was:

    {"type": "importNotice",
     "attrs": {"reason": str, "name": str | None, "sourceUrl": str | None,
               "ref": str | None, "attempts": int}}

The words a member reads are DERIVED from those attrs, never stored: `marker_text` here and
`importNoticeText` in `app/src/pages/journal-2-0/lib/importNoticeText.js`.

⛔⛔ ONE COPY TABLE IN TWO FILES. `NOTICE_COPY` below is the server half; the client half is
`NOTICE_COPY` in `importNoticeText.js`. `tests/test_import_notice.py` IMPORTS that file in Node
and asserts the two tables are equal, so a sentence changed on one side goes red (a copy of the
table inside the test would be a third authority).

Reasons:
  * SERVER_REASONS -- what the connector engine writes (Plan A).
  * CLIENT_REASONS -- what the file importer in the browser writes (Plan B).
  * PLUGIN_REASONS -- what only the Obsidian plugin path writes (Plan C). Plan C's shared
    meanings (`too_large`, `storage_limit`, `fetch_failed`) use the codes above.
An UNKNOWN reason reads as `unsupported`: never blank, never a crash. A hyphenated code
(`too-large`, Plan C's spelling) reads as its snake_case twin.

`fetch_failed` has two sentences: while `attempts < MEDIA_RETRY_MAX_ATTEMPTS` the engine will try
again on the next sync, and the marker says so; after that it is final.

The node is a block leaf with no text of its own (`note_citation_text._LEAF_TYPES`): the search
index, Ask and History read it as nothing. It never leaves the member's notebook: share, publish
and gallery drop it (`public_note_payload.NODE_POLICY`).
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

IMPORT_NOTICE_TYPE = "importNotice"

SERVER_REASONS: tuple[str, ...] = ("too_large", "storage_limit", "unsupported", "fetch_failed", "unsafe")
CLIENT_REASONS: tuple[str, ...] = (
    "upload_failed", "type_refused", "unresolvable_src", "decode_failed", "missing_resource")
#: Plan C (the Obsidian plugin), plugin-only meanings. Codes converted to snake_case.
PLUGIN_REASONS: tuple[str, ...] = (
    "obsidian_plugin_outdated", "obsidian_attachments_unavailable", "not_found", "sync_off")
NOTICE_REASONS: tuple[str, ...] = SERVER_REASONS + CLIENT_REASONS + PLUGIN_REASONS

MEDIA_RETRY_MAX_ATTEMPTS = 3

#: The fallback when a notice carries no usable name.
NAME_FALLBACK = "this item"

#: The copy table, the single server authority. `{name}` is the notice's name. The key
#: `fetch_failed_retrying` is the `fetch_failed` sentence while a retry is still due.
NOTICE_COPY: dict[str, str] = {
    "fetch_failed_retrying": "Couldn't copy {name} — retrying on the next sync",
    "fetch_failed": "Couldn't copy {name}",
    "too_large": "{name} is too large to copy (limit 25 MB)",
    "storage_limit": "Not copied: storage limit. {name} will be copied once space frees up",
    "unsupported": "{name} can't be shown here",
    "unsafe": "{name} wasn't copied: its address isn't allowed",
    "upload_failed": "Couldn't upload {name}",
    "type_refused": "{name} is a file type that can't be stored here",
    "unresolvable_src": "Couldn't find the image file for {name}",
    "decode_failed": "{name} couldn't be read",
    "missing_resource": "{name} was missing from the export",
    # Plan C (Obsidian plugin) -- copy verbatim from the Plan C plan.
    "obsidian_plugin_outdated": (
        "{name} wasn't synced. Update the UCT Notebook Sync plugin in Obsidian to bring images and files over."),
    "obsidian_attachments_unavailable": "{name} wasn't synced yet. It will be retried on the next sync.",
    "not_found": "{name} wasn't found in the vault.",
    "sync_off": "{name} wasn't synced because image and file sync is turned off in the plugin settings.",
}

#: What the renderer appends, as a link, when `sourceUrl` is a safe http(s) address.
OPEN_ORIGINAL = "open the original"


def _reason(reason: Any) -> str:
    """The table reason a stored code reads as: snake_case, and `unsupported` when unknown."""
    code = reason.strip().replace("-", "_") if isinstance(reason, str) else ""
    return code if code in NOTICE_REASONS else "unsupported"


def _attempts(value: Any) -> int:
    """A stored attempt count: a non-negative int, anything else is 0 (a bool is not a count)."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _name(name: Any) -> str:
    return " ".join(name.split()) if isinstance(name, str) and name.strip() else NAME_FALLBACK


def safe_source_url(value: Any) -> str | None:
    """`sourceUrl` as a link target: an http(s) address with a host and no credentials, or None.
    The server twin of the client's `safeLinkHref`; `javascript:`, `data:`, `vbscript:` and
    `file:` addresses stay text."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 2048 or any(c.isspace() for c in text) or any(c in text for c in "<>"):
        return None
    try:
        parts = urlsplit(text)
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    return text


def marker_text(reason: str, name: str | None, *, attempts: int = 0, source_url: str | None = None) -> str:
    """The sentence a notice reads as. With a safe `source_url`, the visible line the editor
    shows: the sentence, then " — open the original" (the link's words)."""
    code = _reason(reason)
    if code == "fetch_failed" and _attempts(attempts) < MEDIA_RETRY_MAX_ATTEMPTS:
        code = "fetch_failed_retrying"
    text = NOTICE_COPY[code].replace("{name}", _name(name))
    if safe_source_url(source_url):
        text = f"{text} — {OPEN_ORIGINAL}"
    return text


def notice_text(attrs: Any) -> str:
    """`marker_text` read from a node's attrs, without the link tail (exports add their own)."""
    a = attrs if isinstance(attrs, dict) else {}
    return marker_text(a.get("reason"), a.get("name"), attempts=a.get("attempts"))


def notice_node(reason: str, *, name: str | None, source_url: str | None, ref: str | None,
                attempts: int) -> dict:
    """One `importNotice` node. attrs are exactly the five interface names."""
    return {"type": IMPORT_NOTICE_TYPE, "attrs": {
        "reason": reason,
        "name": name if isinstance(name, str) and name.strip() else None,
        "sourceUrl": source_url if isinstance(source_url, str) and source_url.strip() else None,
        "ref": ref if isinstance(ref, str) and ref else None,
        "attempts": _attempts(attempts),
    }}


def is_retryable(attrs: Any) -> bool:
    """A notice the engine will try again: `fetch_failed` with attempts left."""
    a = attrs if isinstance(attrs, dict) else {}
    return a.get("reason") == "fetch_failed" and _attempts(a.get("attempts")) < MEDIA_RETRY_MAX_ATTEMPTS


def notice_attempts_by_ref(body_json: Any) -> dict[str, int]:
    """{ref: attempts} for every notice in a stored body (a dict or its JSON text) that carries a
    ref. A ref seen twice keeps its larger count. A malformed body is {}."""
    if isinstance(body_json, (str, bytes)):
        try:
            body_json = json.loads(body_json)
        except (ValueError, TypeError):
            return {}
    out: dict[str, int] = {}
    stack = [body_json]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        if node.get("type") == IMPORT_NOTICE_TYPE and isinstance(node.get("attrs"), dict):
            ref = node["attrs"].get("ref")
            if isinstance(ref, str) and ref:
                out[ref] = max(out.get(ref, 0), _attempts(node["attrs"].get("attempts")))
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(content)
    return out
