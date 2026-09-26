"""The Notebook body schema a client can READ, and the write it may not make.

⛔⛔ THIS FILE AND ITS GUARD MUST NEVER BE REVERTED WITH THE FEATURES THAT ADDED
NODE TYPES. Rolling back a wave that added node or mark types is exactly when
this guard is needed most: see `docs/notebook/wave5-rollback.md`.

The hazard (H14, measured 2026-09-23): TipTap's JSON loader reads a document
whole or not at all. A stored body holding ONE node or mark type the loading
editor's schema lacks opens as an EMPTY document
(`@tiptap/core` `createNodeFromContent` catches the `nodeFromJSON` error and
returns `createNodeFromContent("")`), and that editor's next save writes the
empty document over the note. The compare-and-set on `updated_at` cannot stop
it: the old tab holds the current revision.

So a client DECLARES the newest schema it can read, in the
`X-UCT-Notebook-Schema` header, on every body write. The server knows which
schema introduced each type the STORED body holds, and refuses a body write
whose client is older than that body. A bundle that predates the header never
sends it, which reads as 0 — so the refusal also protects every tab open at
deploy time AND every member after a rollback.

⛔⛔ ONE FACT IN TWO FILES, PINNED AGAINST EACH OTHER. `NOTEBOOK_TYPE_SCHEMA`
below is the server half; the client half is
`app/src/pages/journal-2-0/lib/notebookSchema.js`, and
`tests/test_notebook_schema_guard.py` PARSES that file and asserts the two are
equal (the saved-views precedent — a copy in the test would be a third
authority). A vitest rail asserts every name the LIVE editor schema registers
is in the client list, so a node added later without an entry goes red.

⛔ NEVER REMOVE AN ENTRY — not in a rollback, not when a feature is retired. A
type the map forgets counts as 0, and a 0 is exactly "every client can read
this", which is the lie this file exists to stop.
"""
from __future__ import annotations

import json
from typing import Any

NOTEBOOK_SCHEMA_HEADER = "X-UCT-Notebook-Schema"

# Said to the member verbatim: the editor shows a backend `detail` unchanged
# (`friendlySaveError`), on origin/master's bundle too, which is the one that
# will actually read it.
REFUSAL_DETAIL = "This note has content from a newer version of the app. Reload to edit it."

# {type: introducedAtSchema}. 0 = production's schema before wave 5
# (measured at origin/master 3207690b4: 28 nodes + 7 marks). 1 = G-064 (#183)
# and wave 5.
NOTEBOOK_TYPE_SCHEMA: dict[str, int] = {
    # ── 0: nodes ──
    "attachmentChip": 0,
    "blockquote": 0,
    "bulletList": 0,
    "callout": 0,
    "codeBlock": 0,
    "doc": 0,
    "documentExcerpt": 0,
    "financialFact": 0,
    "hardBreak": 0,
    "heading": 0,
    "horizontalRule": 0,
    "image": 0,
    "listItem": 0,
    "noteLink": 0,
    "orderedList": 0,
    "paragraph": 0,
    "table": 0,
    "tableCell": 0,
    "tableHeader": 0,
    "tableRow": 0,
    "taskItem": 0,
    "taskList": 0,
    "text": 0,
    "toggle": 0,
    "toggleContent": 0,
    "toggleSummary": 0,
    "videoTimestamp": 0,
    "widgetEmbed": 0,
    # ── 0: marks ──
    "bold": 0,
    "code": 0,
    "italic": 0,
    "link": 0,
    "strike": 0,
    "textStyle": 0,
    "underline": 0,
    # ── 1: G-064 (#183) ──
    "askCitation": 1,
    "askInsert": 1,
    # ── 1: wave 5 ──
    "blockMath": 1,
    "inlineMath": 1,
    "highlight": 1,
    "textColor": 1,
}


class NotebookSchemaTooOld(Exception):
    """A body write from a client that cannot read the stored body. The
    routers map it to 409 with `REFUSAL_DETAIL`."""

    def __init__(self, required: int, declared: int):
        super().__init__(REFUSAL_DETAIL)
        self.required = required
        self.declared = declared


def declared_schema(raw: Any) -> int:
    """The schema a request declares. ⛔ Missing, blank, unparseable or
    negative ⇒ 0: a bundle that predates the header is the whole reason it
    exists, and it must read as the OLDEST client, never the newest."""
    if raw is None:
        return 0
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return 0
    return value if value > 0 else 0


def required_schema(body: Any) -> int:
    """The newest schema any node or mark in `body` needs. A type the map does
    not know counts as 0 (an importer's stray type is not a newer client's
    content), and a body that is not JSON, or not a doc, needs 0.

    Walks with an explicit stack: a stored body can nest deeper than Python's
    recursion limit (a long list of nested bullets)."""
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except (TypeError, ValueError):
            return 0
    required = 0
    stack = [body]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        t = node.get("type")
        if isinstance(t, str):
            required = max(required, NOTEBOOK_TYPE_SCHEMA.get(t, 0))
        marks = node.get("marks")
        if isinstance(marks, list):
            for mark in marks:
                if isinstance(mark, dict) and isinstance(mark.get("type"), str):
                    required = max(required, NOTEBOOK_TYPE_SCHEMA.get(mark["type"], 0))
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(content)
    return required


def check_body_write(stored_body: Any, declared: int | None) -> None:
    """Refuse a body write whose client is older than the STORED body.

    `declared=None` means the write did not come from a client at all (a
    version restore, a server-side append): nothing to check. Every router door
    that forwards a client's body passes `declared_schema(header)`, which is
    never None."""
    if declared is None:
        return
    required = required_schema(stored_body)
    if required > declared:
        raise NotebookSchemaTooOld(required, declared)
