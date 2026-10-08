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
    # ── 2: wave 6 (2026-09-24) — editor content 2 ──
    "column": 2,
    "columns": 2,
    "dateMention": 2,
    "imageCaption": 2,
    "imageFigure": 2,
    "linkPreview": 2,
    "tableOfContents": 2,
    "webEmbed": 2,
    # ── 3: wave 11 lane 11D (2026-10-01) — the trade-plan canvas ──
    # ⛔ NEVER-REVERT, like every row above. A canvas note's body is ONE
    # `tradeCanvas` block atom holding the whole board in its attrs; an editor
    # that lacks the node would open it EMPTY and its next save would write the
    # empty document over the plan. Level 3 makes the server refuse that write.
    "tradeCanvas": 3,
}

# {"<nodeType>.<attr>": introducedAtSchema} -- an ATTRIBUTE on an existing type
# whose absence would change what the note means (wave 13 lane 13H-1, the first
# one; `docs/notebook/wave5-rollback.md`, "Level 4").
#
# Why a second table. TipTap reads an unknown TYPE as "blank the whole note"
# (the hazard above), but an unknown ATTRIBUTE on a known type is dropped
# silently at parse time -- the note opens fine and its next save writes the
# attribute away. The type table cannot express that, so attributes get their
# own rows here, and `required_schema` counts a row only when the stored node
# CARRIES the attribute with a value (null, an empty object or an empty list is
# nothing an older editor could lose, so it needs nothing newer).
#
# ⛔ The same rules as the type table: ONE FACT IN TWO FILES (the client half is
# `NOTEBOOK_ATTR_SCHEMA` in `lib/notebookSchema.js`, pinned equal by
# tests/test_notebook_schema_guard.py), NEVER REMOVE A ROW, never reverted.
# Levels continue the type table's numbering: a client declares "everything,
# types and attributes, at or below N".
NOTEBOOK_ATTR_SCHEMA: dict[str, int] = {
    # ── 4: wave 13 lane 13H-1 (2026-10-02) -- chart plan data on a chart embed ──
    # ⛔ NEVER-REVERT. `widgetEmbed.ta` holds the setup tag, the frozen technical
    # fingerprint and the plan block (planned shares, which engine sized them).
    # An editor without the attr would drop it on its next save; level 4 makes
    # the server refuse that write instead.
    "widgetEmbed.ta": 4,
}


def _attr_rows() -> dict[str, tuple[tuple[str, int], ...]]:
    """`NOTEBOOK_ATTR_SCHEMA` grouped by node type: {type: ((attr, level), ...)}."""
    rows: dict[str, list[tuple[str, int]]] = {}
    for key, level in NOTEBOOK_ATTR_SCHEMA.items():
        node_type, _, attr = key.partition(".")
        rows.setdefault(node_type, []).append((attr, level))
    return {t: tuple(v) for t, v in rows.items()}


_ATTRS_BY_TYPE = _attr_rows()


def _carries(value: Any) -> bool:
    """Does a stored attribute value hold anything an older editor would lose?"""
    return value is not None and value != {} and value != [] and value != ""


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
    """The newest schema any node or mark in `body` needs -- its type's row, and
    the row of every attribute it carries a value for (`NOTEBOOK_ATTR_SCHEMA`).
    A type the map does not know counts as 0 (an importer's stray type is not a
    newer client's content), and a body that is not JSON, or not a doc, needs 0.

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
            attr_rows = _ATTRS_BY_TYPE.get(t)
            attrs = node.get("attrs")
            if attr_rows and isinstance(attrs, dict):
                for attr, level in attr_rows:
                    if _carries(attrs.get(attr)):
                        required = max(required, level)
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
