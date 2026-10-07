"""The ONE marker that says "this note is part of the sample notebook", and the ONE predicate
every reader of notes-as-data asks.

THE MARKER. `j2_notes.import_source = 'sample'`. It is written once, at insert, by
`notes.import_confirm` when `sample_notebook` / `sample_examples` seed (their `SOURCE` /
`IMPORT_SOURCE` are this module's `SAMPLE_SOURCE`). No later write touches the column: an
edit, a move, an archive and Trash all leave it. It is the server's: the member-facing import
door refuses it (`journal_two.notes_import_confirm_endpoint` -> `reserved_for_the_sample`), so
a client can neither hide its own notes behind it nor have "Remove sample" trash them.

WHY IT EXISTS. The sample's example notes name real tickers and real-looking levels so each
capability has something to show. A note is also DATA: a plan a trade is graded against,
"what you wrote before a loss", "a symbol you have research on", a stop on a chip. Read as
data, an example becomes a fact about the member -- a real NVDA trade graded against the
example NVDA thesis, the plan rate going up, an alert that says "you wrote research on this".
So: ⛔ SAMPLE CONTENT NEVER FEEDS A STATISTIC, A GRADE, AN ALERT OR A CHIP. A sample is read
as a note (opened, searched, exported, shown as its own example card) and never as a fact.

HOW A READER USES IT.
  * in SQL:      `... AND ` + `not_sample_sql("n")`   (the note table's alias)
  * on a row:    `is_sample(row["import_source"])`
  * by id:       `is_sample_note(conn, user_id, note_id)` / `sample_note_ids(conn, user_id)`

THE RAIL. `tests/test_sample_never_feeds_real_numbers.py` lists every module under `api/`
whose code reads a note table. Each is GUARDED (must use a name from this module) or EXEMPT
with a reason. A new reader in neither list fails by name, and so does a reader that types
the marker itself rather than asking here.

This module imports nothing from the app, on purpose: `notes.py` asks it, and every other
reader imports `notes.py`.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Iterable

#: The value of `j2_notes.import_source` on every note the sample notebook wrote.
SAMPLE_SOURCE = "sample"

#: The SQL test, as a template over the note table's alias prefix ("" or "n."). `IS NOT`
#: (never `!=`) so a NULL `import_source` -- every note a member wrote by hand -- is kept.
NOT_SAMPLE_SQL = "{alias}import_source IS NOT '" + SAMPLE_SOURCE + "'"


def not_sample_sql(alias: str = "") -> str:
    """The WHERE fragment that leaves sample notes out. `alias` is the note table's alias in
    the caller's query (`"n"`), or empty when the query names no alias. A constant: nothing a
    caller passes is interpolated but its own alias."""
    if alias and not alias.isidentifier():
        raise ValueError("alias must be a plain SQL identifier")
    return NOT_SAMPLE_SQL.format(alias=f"{alias}." if alias else "")


def is_sample(import_source: Any) -> bool:
    """Is this `import_source` value the sample's?"""
    return import_source == SAMPLE_SOURCE


def reserved_for_the_sample(source: Any) -> bool:
    """Would this client-sent import `source` read as the marker once stored? The import door
    stores `source[:40]` verbatim, so only the exact value matters; the loose comparison here
    refuses near-misses too, so nobody finds the edge."""
    return isinstance(source, str) and source.strip().lower() == SAMPLE_SOURCE


def sample_note_ids(conn: sqlite3.Connection, user_id: str) -> set[str]:
    """Every sample note this member has -- live, archived AND trashed. Trash is included on
    purpose: cleaning up after a removed sample needs to know what the sample was."""
    return {r[0] for r in conn.execute(
        "SELECT id FROM j2_notes WHERE user_id = ? AND import_source = ?", (user_id, SAMPLE_SOURCE))}


def is_sample_note(conn: sqlite3.Connection, user_id: str, note_id: str | None) -> bool:
    """Is this note one of this member's sample notes? False for an unknown or foreign id."""
    if not note_id:
        return False
    r = conn.execute("SELECT import_source FROM j2_notes WHERE id = ? AND user_id = ?",
                     (note_id, user_id)).fetchone()
    return r is not None and is_sample(r[0])


# ── a sample added before its chart levels took the drawn shape ─────────────────────────────

_PLAN_ROLES = ("entry", "stop", "target")


def _needs_upgrade(a: Any) -> bool:
    """An example level in the OLD shape: a role and a plain positive price, with no id or no
    anchor. (A drawn level has both; anything else is not ours to touch.)"""
    if not isinstance(a, dict) or a.get("role") not in _PLAN_ROLES:
        return False
    price = a.get("price")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not price > 0 or price != price:
        return False
    pts = a.get("points")
    has_anchor = isinstance(pts, list) and bool(pts) and isinstance(pts[0], dict)
    return not (isinstance(a.get("id"), str) and a["id"]) or not has_anchor


def upgrade_sample_levels(body: Any) -> Any:
    """A SAMPLE note's body with any old-shape chart level in the drawn shape, IN MEMORY.

    The sample's chart plans used to store each level as `{role, type, price}`. A level a
    member draws is `{id, type, role, points: [{time, price}]}`, and the client's role buttons,
    its alert door and its chart overlay all need that shape (`sample_examples._drawn_levels`).
    Sandboxes and testers already hold the old shape. So a sample note is READ in the drawn
    shape: same ids the new seed writes (`<embed id>-<role>`), the anchor at the chart's frozen
    instant, the top-level `price` gone.

    ⛔ NEVER WRITTEN BACK BY A READ. This returns a new body and leaves its input alone; the
    stored note changes only if the member saves it. ⛔ ONLY CALLED FOR A SAMPLE NOTE
    (`notes._row_to_note` asks `is_sample` first): `{role, price}` with no drawing is also a
    shape the product writes for a member (a level with no line on the chart), and a member's
    note is served exactly as stored. Returns the SAME object when there is nothing to
    upgrade, and never raises."""
    try:
        if not isinstance(body, dict) or not isinstance(body.get("content"), list):
            return body
        stack: list[Any] = [body]
        found = False
        while stack and not found:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            attrs = node.get("attrs")
            if node.get("type") == "widgetEmbed" and isinstance(attrs, dict) \
                    and isinstance(attrs.get("annotations"), list):
                found = any(_needs_upgrade(a) for a in attrs["annotations"])
            children = node.get("content")
            if isinstance(children, list):
                stack.extend(children)
        if not found:
            return body
        import copy
        out = copy.deepcopy(body)
        stack = [out]
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            attrs = node.get("attrs")
            if node.get("type") == "widgetEmbed" and isinstance(attrs, dict) \
                    and isinstance(attrs.get("annotations"), list):
                embed = attrs.get("embedId") if isinstance(attrs.get("embedId"), str) and attrs.get("embedId") else "chart"
                params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
                to = params.get("to")
                taken = {a.get("id") for a in attrs["annotations"] if isinstance(a, dict)}
                fixed = []
                for a in attrs["annotations"]:
                    if not _needs_upgrade(a):
                        fixed.append(a)
                        continue
                    level_id, n = f"{embed}-{a['role']}", 2
                    while level_id in taken:
                        level_id, n = f"{embed}-{a['role']}-{n}", n + 1
                    taken.add(level_id)
                    anchor: dict[str, Any] = {"price": float(a["price"])}
                    if isinstance(to, (int, float)) and not isinstance(to, bool):
                        anchor = {"time": to, "price": float(a["price"])}
                    rest = {k: v for k, v in a.items() if k not in ("price", "id", "points")}
                    fixed.append({"id": level_id, **rest, "points": [anchor]})
                attrs["annotations"] = fixed
            children = node.get("content")
            if isinstance(children, list):
                stack.extend(children)
        return out
    except Exception:  # noqa: BLE001 -- a read never fails on an upgrade; the stored body is served
        return body


def without_sample_notes(conn: sqlite3.Connection, user_id: str, items: Iterable[Any], *,
                         note_id=lambda item: item["noteId"]) -> list[Any]:
    """`items` minus the ones that belong to a sample note. For a reader handed rows by another
    module's index (a chart block, a level), where the note table is not in its own query."""
    items = list(items)
    if not items:
        return items
    sample = sample_note_ids(conn, user_id)
    return [it for it in items if note_id(it) not in sample] if sample else items
