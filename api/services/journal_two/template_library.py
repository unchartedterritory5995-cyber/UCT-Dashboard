"""Notebook widgets phase 2, wave 11 (Task 11.10): the 27 official templates of spec §10 (ruling W11-R4).

An official template is a gallery row like a firm style (`template_gallery.seed_firm_styles`), with
`kind = 'official'`, `item_type = 'style'`, its id `template_gallery.firm_style_id(seed key)` and its group in
the `template_group` column. Its payload is the shared template format (`share.FORMAT`, 2), so the library reads
it through the same safe reader a member's shared template takes (`template_gallery._safe_listed`), and using one
adopts it once per member (`template_gallery.use_library_template`). Visible only while the library switch AND
wave 11 are on: `template_gallery._hidden_styles` is the one rule, and this module never decides it.

The seed is `template_library_seed.json`, one row per template:

    {"seedKey": "uct-template-<slug>-v1", "slug", "title", "group", "kindId", "category", "description",
     "blocks": [{"block", "enabled", "settings"}], "sections": [{"heading", "prompt", "blocks": [ids]}],
     "definitions": [{"key", "plan", "name", "description"}], "slots": [{"id", "type", "label", "any",
     "source", "field"}]}

Ruling W11-R37: this module ALWAYS imports. `GROUPS` / `GROUP_KEYS` are static constants that never depend on the
seed (the gallery's `group=` filter reads them), and the seed is loaded and checked once, lazily, by
`library_state()`, which caches an ok/error answer. A broken seed (`load_library_seed` raises `LibrarySeedError`
naming the row) therefore never crashes a boot and never 500s a member: the seeder writes nothing and logs loudly,
the official templates are simply absent, and every gallery read keeps working on the remaining rows. The CI guard
stays: `tests/test_template_library_seed.py` fails on a broken seed, so one cannot ship.
`seed_template_library` writes the rows INSERT OR IGNORE by seed key, so an admin's later hide or unfeature is never
undone by a reboot; a failure there is logged, never raised (the P5 row 27 rule).

⛔ A released row never changes (R-P5-4): to change an official template, add a `-v2` row and list the `-v1` key in
the file's `retired` list. `tests/test_template_library_seed.py::test_released_rows_never_change` holds this file
against `origin/master`'s copy and FAILS (never skips) when git or `origin/master` cannot be read.
"""
from __future__ import annotations

import copy
import json
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, NamedTuple

from api.services.journal_two.template_tools import LibraryError  # noqa: F401 -- the one refusal class (W9-R14)

#: The official templates' groups, in the order the Template library section draws them, and their words.
#: ⛔ ONE FACT IN TWO FILES with the client's LIBRARY_GROUPS (app/src/pages/journal-2-0/lib/templateLibrary.js):
#: a plain tuple of `(key, label)` string pairs, so a client rail can parse it from this file.
GROUPS = (("night_before", "The night before"), ("before_open", "Before the open"), ("during_day", "During the day"), ("after_close", "After the close"), ("weekly_monthly", "Weekly / monthly"), ("playbook", "Playbook"), ("mindset", "Mindset"), ("challenges", "Challenges"), ("habits", "Habits"))
GROUP_KEYS = tuple(k for k, _ in GROUPS)

SEED_FILE = Path(__file__).with_name("template_library_seed.json")
SEED_KEY_RE = re.compile(r"uct-template-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)-v(?P<v>[1-9][0-9]*)")
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
PICK_ID_RE = re.compile(r"p[1-9][0-9]?")
ROW_KEYS = frozenset({"seedKey", "slug", "title", "group", "kindId", "category", "description", "blocks",
                      "sections", "definitions", "slots"})
SECTION_KEYS = frozenset({"heading", "prompt", "blocks"})
DEFINITION_KEYS = frozenset({"key", "plan", "name", "description"})
SLOT_KEYS = frozenset({"id", "type", "label", "any", "source", "field"})
MIN_SECTIONS, MAX_SECTIONS = 2, 4
MAX_HEADING_CHARS = 80
MAX_PROMPT_CHARS = 200
#: The author label of every official row (W11-R7): the gallery's `FIRM_AUTHOR`, through `UCT_KINDS`.
KIND = "official"

#: The typed stand-in each "pick yours" choice takes when the seed's inline plans are checked at import: never a
#: member's value, never a suggestion (no account is read), only something of the right type.
_DUMMY_ANSWERS: dict[str, Any] = {"setup": "Setup", "tag": "tag", "symbol": "AAPL", "account": "account",
                                  "property": "property", "folder": "folder", "note_kind": "daily_prep",
                                  "routine": "routine", "tracker": "tracker", "number": 1}


class LibrarySeedError(RuntimeError):
    """The official template seed is malformed: raised at import, naming the row (never a member's card)."""


def _fail(name: str, msg: str) -> None:
    raise LibrarySeedError(f"{name}: {msg}")


def _text(name: str, row: dict, key: str, limit: int) -> str:
    v = row.get(key)
    if not isinstance(v, str) or not v.strip() or v != " ".join(v.split()) or len(v) > limit:
        _fail(name, f"{key} must be 1 to {limit} characters of single-spaced text")
    return v


def _picks(obj: Any, out: set) -> set:
    """Every pick id a plan names: `{"pick": "p<n>"}` markers and `[#p<n>]` formula tokens."""
    from api.services.journal_two.widget_engine import share
    if isinstance(obj, dict):
        if set(obj) == {"pick"} and isinstance(obj["pick"], str):
            out.add(obj["pick"])
        for v in obj.values():
            _picks(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _picks(v, out)
    elif isinstance(obj, str):
        out.update("p" + m.group(1) for m in share.PICK_TOKEN_RE.finditer(obj))
    return out


def _manifest_pins(manifest_path: Path) -> frozenset:
    """`{(shelf id, rev)}` of every revision file the shelf MANIFEST lists (read only, never written)."""
    from api.services.journal_two.widget_engine import shelf
    try:
        man = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        files = [e["file"] for e in man["files"]]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise LibrarySeedError(f"the shelf manifest could not be read: {e}") from e
    out = set()
    for f in files:
        m = re.fullmatch(r"(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.r(?P<rev>[1-9][0-9]*)\.json", f)
        if m is not None:
            out.add((shelf.ID_PREFIX + m["slug"], int(m["rev"])))
    return frozenset(out)


def _check_slots(name: str, raw: Any) -> list[dict]:
    from api.services.journal_two.widget_engine import share
    if not isinstance(raw, list):
        _fail(name, "slots must be a list")
    seen = set()
    for s in raw:
        if not isinstance(s, dict) or set(s) != SLOT_KEYS:
            _fail(name, f"each slot is exactly {sorted(SLOT_KEYS)}")
        if not isinstance(s["id"], str) or not PICK_ID_RE.fullmatch(s["id"]) or s["id"] in seen:
            _fail(name, f"slot id {s['id']!r} is not a unique 'p<n>'")
        seen.add(s["id"])
        if s["type"] not in share.SLOT_TYPES:
            _fail(name, f"slot {s['id']} has unknown type {s['type']!r}")
        if not isinstance(s["any"], bool):
            _fail(name, f"slot {s['id']}: any must be true or false")
        if not isinstance(s["label"], str) or not s["label"].strip():
            _fail(name, f"slot {s['id']} needs a label")
        if not all(isinstance(s[k], str) for k in ("source", "field")):
            _fail(name, f"slot {s['id']}: source and field are text")
    return raw


def _check_definitions(name: str, raw: Any, slots: list[dict]) -> dict[str, dict]:
    """Every inline plan validates against `sources.CATALOG` with its picks answered by typed stand-ins (an "Any"
    choice as Any), through the same `share.resolve_plan` an adoption takes. Answers `{key: definition}`."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import plan as wplan
    from api.services.journal_two.widget_engine import share
    from api.services.journal_two.widget_engine.sources import CATALOG
    if not isinstance(raw, list):
        _fail(name, "definitions must be a list")
    answers = {s["id"]: ({"any": True} if s["any"] else _DUMMY_ANSWERS[s["type"]]) for s in slots}
    out: dict[str, dict] = {}
    used: set = set()
    for d in raw:
        if not isinstance(d, dict) or set(d) != DEFINITION_KEYS:
            _fail(name, f"each definition is exactly {sorted(DEFINITION_KEYS)}")
        key = d["key"]
        if not isinstance(key, str) or not js.INLINE_KEY_RE.fullmatch(key) or key in out:
            _fail(name, f"definition key {key!r} is not a unique inline key")
        dname = f"{name} definition {key}"
        _text(dname, d, "name", share.NAME_MAX)
        _text(dname, d, "description", share.DESCRIPTION_MAX)
        if not isinstance(d["plan"], dict):
            _fail(dname, "the plan is not an object")
        picks = _picks(d["plan"], set())
        unknown = sorted(picks - set(answers))
        if unknown:
            _fail(dname, f"names undeclared choices {unknown}")
        used |= picks
        try:
            resolved = share.resolve_plan(copy.deepcopy(d["plan"]), slots, answers, catalog=CATALOG)
        except share.ShareError as e:
            _fail(dname, f"the plan does not validate: {e.sentence}")
        if wplan.needed_version(resolved) > wplan.PLAN_VERSION:
            _fail(dname, "the plan needs a newer server")
        out[key] = d
    unused = sorted({s["id"] for s in slots} - used)
    if unused:
        _fail(name, f"declares choices no plan uses {unused}")
    return out


def _check_blocks(name: str, raw: Any, defs: dict[str, dict], pins: frozenset) -> list[str]:
    """Every block passes `journal_styles._clean_blocks` and is ALREADY its reduction (so the stored payload is the
    seed, byte for byte); every `shelf:` ref pins a revision the MANIFEST lists (W10-R5); every `inline:` ref names a
    definition and every definition is named; every `template` key is in `template_tools`. Answers the block ids."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import template_tools
    try:
        clean = js._clean_blocks(copy.deepcopy(raw))
    except js.StyleValidationError as e:
        _fail(name, f"a block does not pass the style grammar: {e}")
    if not raw or clean != raw:
        _fail(name, "blocks must be a non-empty list already in their reduced form")
    named = set()
    for b in clean:
        bid, s = b["block"], b["settings"]
        family = js.slot_family(bid)
        if family == "built":
            ref = s["ref"]
            if ref.startswith("shelf:") and (ref, s["defRev"]) not in pins:
                _fail(name, f"{bid} pins {ref} r{s['defRev']}, which the shelf MANIFEST does not list")
            if ref.startswith("def:"):
                _fail(name, f"{bid} names a member's own widget")
            if ref.startswith("inline:"):
                if ref[len("inline:"):] not in defs:
                    _fail(name, f"{bid} names no definition {ref}")
                named.add(ref[len("inline:"):])
        elif family in ("routine", "tracker"):
            if "inline" in s or ("ref" in s and s["ref"].startswith(f"{family}:")):
                _fail(name, f"{bid} must name a template key or a check-in")
            table = template_tools.ROUTINE_TEMPLATES if family == "routine" else template_tools.TRACKER_TEMPLATES
            if "template" in s and s["template"] not in table:
                _fail(name, f"{bid} names no {family} template {s['template']!r}")
    if named != set(defs):
        _fail(name, f"definitions no block names {sorted(set(defs) - named)}")
    return [b["block"] for b in clean]


def _check_sections(name: str, raw: Any, block_ids: list[str]) -> None:
    if not isinstance(raw, list) or not MIN_SECTIONS <= len(raw) <= MAX_SECTIONS:
        _fail(name, f"a template has {MIN_SECTIONS} to {MAX_SECTIONS} sections")
    placed: list[str] = []
    for i, sec in enumerate(raw):
        sname = f"{name} section {i + 1}"
        if not isinstance(sec, dict) or set(sec) != SECTION_KEYS:
            _fail(sname, f"a section is exactly {sorted(SECTION_KEYS)}")
        _text(sname, sec, "heading", MAX_HEADING_CHARS)
        _text(sname, sec, "prompt", MAX_PROMPT_CHARS)
        if not isinstance(sec["blocks"], list) or not all(isinstance(b, str) for b in sec["blocks"]):
            _fail(sname, "blocks is a list of block ids")
        placed.extend(sec["blocks"])
    if sorted(placed) != sorted(block_ids) or len(placed) != len(set(placed)):
        _fail(name, "every block id appears in exactly one section")


def _check_row(i: int, row: Any, pins: frozenset) -> dict:
    from api.services.journal_two import note_kinds
    from api.services.journal_two import template_gallery as tg
    name = row.get("seedKey") if isinstance(row, dict) and isinstance(row.get("seedKey"), str) else f"row {i + 1}"
    if not isinstance(row, dict) or set(row) != ROW_KEYS:
        _fail(name, f"a row is exactly {sorted(ROW_KEYS)}")
    m = SEED_KEY_RE.fullmatch(row["seedKey"])
    if m is None:
        _fail(name, "the seed key is not 'uct-template-<slug>-v<n>'")
    if not isinstance(row["slug"], str) or not SLUG_RE.fullmatch(row["slug"]) or m["slug"] != row["slug"]:
        _fail(name, "the slug and the seed key disagree")
    _text(name, row, "title", tg.MAX_TITLE_CHARS)
    _text(name, row, "description", tg.MAX_DESCRIPTION_CHARS)
    if row["group"] not in GROUP_KEYS:
        _fail(name, f"unknown group {row['group']!r}")
    if row["kindId"] not in note_kinds.BUILTIN_KIND_IDS:
        _fail(name, f"unknown kind of note {row['kindId']!r}")
    if row["category"] not in tg.CATEGORIES:
        _fail(name, f"unknown category {row['category']!r}")
    slots = _check_slots(name, row["slots"])
    defs = _check_definitions(name, row["definitions"], slots)
    block_ids = _check_blocks(name, row["blocks"], defs, pins)
    _check_sections(name, row["sections"], block_ids)
    return row


def load_library_seed(path: Path | str = SEED_FILE, *, manifest_path: Path | str | None = None) -> list[dict]:
    """The seed's rows, in file order, each checked (`LibrarySeedError` naming the row otherwise): the seed key's
    shape and uniqueness, its group, kind of note and category, its blocks, definitions, choices and sections. A
    `retired` key must name a row of the file (rows are never removed) and have a newer live row for its slug, and
    the live rows' slugs are unique. RAISES: the CI rails call it directly; runtime reads go through
    `library_state()`, which never raises."""
    return _load(path, manifest_path=manifest_path)[0]


def _load(path: Path | str = SEED_FILE, *, manifest_path: Path | str | None = None) -> tuple[list[dict], tuple]:
    """`(rows, retired keys)` of the seed, every row checked; `LibrarySeedError` naming the row otherwise."""
    from api.services.journal_two.widget_engine import shelf
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise LibrarySeedError(f"the official template seed could not be read: {e}") from e
    if not isinstance(data, dict) or not isinstance(data.get("templates"), list):
        raise LibrarySeedError("the official template seed holds a 'templates' list")
    retired = data.get("retired", [])
    if not isinstance(retired, list) or not all(isinstance(k, str) for k in retired):
        raise LibrarySeedError("'retired' is a list of seed keys")
    pins = _manifest_pins(Path(manifest_path) if manifest_path else shelf.MANIFEST_PATH)
    rows, keys, live_slugs = [], set(), set()
    for i, raw in enumerate(data["templates"]):
        row = _check_row(i, raw, pins)
        if row["seedKey"] in keys:
            _fail(row["seedKey"], "the seed key is listed twice")
        keys.add(row["seedKey"])
        if row["seedKey"] not in retired:
            if row["slug"] in live_slugs:
                _fail(row["seedKey"], f"a second live row for {row['slug']} (retire the older one)")
            live_slugs.add(row["slug"])
        rows.append(row)
    stray = sorted(set(retired) - keys)
    if stray:
        raise LibrarySeedError(f"{', '.join(stray)}: retired but not a row of the seed")
    by_key = {r["seedKey"]: r for r in rows}
    orphaned = sorted(k for k in retired if by_key[k]["slug"] not in live_slugs)
    if orphaned:
        raise LibrarySeedError(f"{', '.join(orphaned)}: retired with no newer row for its slug (add the -v2 row)")
    return copy.deepcopy(rows), tuple(retired)


class LibraryState(NamedTuple):
    """`library_state()`'s cached answer: the checked rows and retired keys, or `error` (then both are empty)."""
    rows: tuple
    retired: tuple
    error: str | None


_STATE_LOCK = threading.Lock()
_STATE: LibraryState | None = None


def library_state() -> LibraryState:
    """The seed, loaded and checked ONCE and cached (W11-R37). Never raises: a broken seed answers `error` (logged
    loudly, once) with no rows, so the official templates are simply absent."""
    global _STATE
    st = _STATE
    if st is not None:
        return st
    with _STATE_LOCK:
        if _STATE is None:
            try:
                rows_, retired_ = _load(SEED_FILE)
                _STATE = LibraryState(tuple(rows_), retired_, None)
            except Exception as e:  # noqa: BLE001 -- a broken seed is an absent library, never a crash
                msg = f"{type(e).__name__}: {e}"
                print(f"[template-library] ERROR: the official template seed is broken; no official template is"
                      f" listed until it is fixed: {msg}")
                _STATE = LibraryState((), (), msg)
        return _STATE


def reset_library_state() -> None:
    """Drop the cached answer (tests, after pointing `SEED_FILE` elsewhere)."""
    global _STATE
    with _STATE_LOCK:
        _STATE = None


def rows() -> list[dict]:
    """Every seed row (retired ones included), as fresh copies; empty while the seed is broken."""
    return copy.deepcopy(list(library_state().rows))


def retired() -> tuple[str, ...]:
    """The seed keys replaced by a newer version (`-v2`); empty while the seed is broken."""
    return library_state().retired


def live_rows() -> list[dict]:
    """The rows the seeder writes: every row not retired."""
    gone = set(retired())
    return [r for r in rows() if r["seedKey"] not in gone]


def _para(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _outline_from_sections(sections: list[dict]) -> list[dict]:
    """An official template's outline: per section, a level-2 heading, the prompt paragraph, then one
    `{{block:<id>}}` paragraph per block id (where compose places that block). The one place this shape is written."""
    out: list[dict] = []
    for sec in sections:
        out.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": sec["heading"]}]})
        out.append(_para(sec["prompt"]))
        out.extend(_para("{{block:%s}}" % bid) for bid in sec["blocks"])
    return out


def row_parts(row: dict) -> tuple[dict, dict, list[dict]]:
    """`(outline, payload, preview)` for one seed row, exactly as the seeder stores them. The outline goes through
    the gallery reducer (`sanitize_body`); the preview is the outline's first lines as a member reads them, with no
    `{{block:...}}` line."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import template_gallery as tg
    from api.services.journal_two.widget_engine import share
    outline = tg.sanitize_body({"type": "doc", "content": _outline_from_sections(row["sections"])}, "")
    payload = {"kindId": row["kindId"], "outlineBodyJson": outline, "blocks": copy.deepcopy(row["blocks"]),
               "properties": {}, "definitions": copy.deepcopy(row["definitions"]), "routines": [], "trackers": [],
               "slots": copy.deepcopy(row["slots"]), "format": share.FORMAT}
    shown = [n for n in outline.get("content") or []
             if not (isinstance(n, dict) and n.get("type") == "paragraph"
                     and js.PLACEHOLDER_RE.match(tg._node_text(n).strip()))]
    return outline, payload, tg.preview_lines({"type": "doc", "content": shown})


#: The marker `seed_template_library` writes as `hidden_by` when it hides a retired row.
RETIRED_BY = "uct-template-library"


def seed_template_library(conn: sqlite3.Connection) -> int:
    """INSERT OR IGNORE each live official template by seed key: `kind = 'official'`, `item_type = 'style'`,
    approved, featured, no author, version 1, its group in `template_group`. Returns how many rows were added (0 on
    every boot after the first).

    A retired row is never inserted. The seed sets visibility only for rows it newly creates: a stored retired row
    is hidden in the same pass that newly inserts its replacement (its `-v2`), and never again, so an admin who
    unhides it later keeps it as they left it. A broken seed writes nothing and is logged loudly (W11-R37); any
    other failure is rolled back and logged, never raised."""
    from api.services.journal_two import template_gallery as tg
    state = library_state()
    if state.error is not None:
        print(f"[template-library] ERROR: official template seed skipped, the seed is broken: {state.error}")
        return 0
    try:
        gone = set(state.retired)
        added = 0
        new_slugs: set = set()
        now = tg._now()
        for row in state.rows:
            if row["seedKey"] in gone:
                continue
            outline, payload, preview = row_parts(row)
            cur = conn.execute(
                "INSERT OR IGNORE INTO j2_template_gallery (id, user_id, source_template_id, seed_key,"
                " kind, title, description, category, body_json, property_defs_json, status,"
                " featured, listed_at, created_at, updated_at, preview_json, item_type, payload_json,"
                " version, template_group)"
                f" VALUES (?, NULL, NULL, ?, '{KIND}', ?, ?, ?, ?, NULL, 'approved', 1, ?, ?, ?, ?, 'style', ?, 1, ?)",
                (tg.firm_style_id(row["seedKey"]), row["seedKey"], row["title"], row["description"],
                 row["category"], json.dumps(outline), now, now, now, json.dumps(preview), json.dumps(payload),
                 row["group"]))
            if cur.rowcount:
                added += cur.rowcount
                new_slugs.add(row["slug"])
        for row in state.rows:
            if row["seedKey"] in gone and row["slug"] in new_slugs:
                conn.execute("UPDATE j2_template_gallery SET hidden = 1, hidden_by = ?, hidden_at = ?"
                             " WHERE seed_key = ? AND kind = ? AND hidden = 0",
                             (RETIRED_BY, now, row["seedKey"], KIND))
        conn.commit()
        return added
    except Exception as e:  # noqa: BLE001 -- never crash startup over a seed (P5 row 27)
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        print(f"[template-library] official template seed skipped: {type(e).__name__}: {e}")
        return 0


def payload_hash(row: dict) -> str:
    """The canonical SHA-256 of what the seeder STORES for a row (outline, payload, preview), so a change in the
    code that derives them is as visible to the released-rows rail as a change in the seed row itself (M-4)."""
    from api.services.journal_two.widget_engine import shelf
    outline, payload, preview = row_parts(row)
    return shelf.canonical_hash({"outline": outline, "payload": payload, "preview": preview})


#: The committed `payload_hash` of each live row, checked by the tests; append-only once released.
PAYLOADS_FILE = Path(__file__).with_name("template_library_payloads.json")
