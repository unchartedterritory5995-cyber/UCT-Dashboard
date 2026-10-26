"""Notebook widgets wave 11 (Task 11.9, ruling W11-R12): preview with my data.

`POST /api/j2/template-gallery/{gallery_id}/preview-mine` (Task 11.12) answers `preview_mine`: a listed template,
widget, routine or tracker, shown over the VIEWER's own data before they adopt it. ONE answer is what the adoption
sheet (`AdoptSheet.jsx`, Task 11.17) renders:

    {"slots":     [{"id", "type", "label", "any", "suggested": {value, label} | None, "value"}],
     "cards":     [{"slot", "title", "payload" | "sentence", "sample": bool}],
     "tools":     [{"slot", "kind", "name", "items" | "trackerKind", "bind", "forDayLabel"}],
     "questions": <slot_fill.tool_questions output>,
     "credit":    "Based on <label>'s <title>" | None}

* Each "pick yours" choice (`share.SLOT_TYPES`, W11-R5) takes the viewer's answer, else their suggested value
  (`gallery_suggest.suggest`, the member's own most-used), else Any where the choice allows it. A widget whose plan
  still holds a choice with no value and no Any is the sentence `"Pick a <label> to see this widget."`, never a run
  and never a zero (Review Focus 5).
* Widgets run through the examples lane (`run.run_plans_batch`): at most `run.MAX_EXAMPLES` cards, the viewer's own
  rows only, the Sample data book (labelled `sample: True`) under `run.SAMPLE_BELOW` closed trades.
* A built slot runs `shelf:` at its PINNED revision, `inline:` from the payload's own definitions, and `def:` only for
  the item's own author previewing it (an owned read, `WHERE id = ? AND user_id = ?`); anyone else gets the slot's
  sentence and nothing of the author's is read.
* ⛔ No day state: a routine or tracker slot previews as its name, item list or kind and the day its note would bind
  to (`tool_binding`). Nothing here reads `j2_routine_ticks`, `j2_routine_days` or `j2_tracker_values`.
* The credit is built HERE (W11-R7, W11-R24) and the client shows it as it came: `"UCT"` for official and firm rows,
  the author's gallery display label while their author row exists, `"a former member's"` once it does not. None for
  the viewer's own item.
* Cached per (gallery id, listed version, viewer, ET day, sha256 of the canonical answers) for `CACHE_TTL_S`.
  ⚠️ Per process, like every cache on the one web pod: a second process keeps its own.
* Writes nothing. List endpoints never call this (W11-R12: a list card says it fills in later).

Visibility is the gallery's own rule (`template_gallery._row` + `_can_see`, which applies `_library_hides`), and the
payload is the LISTED version (`_listed_payload`: `payload_json`, never `pending_json`). Those three are read through
the gallery module rather than restated here, so "who may see this item" has one authority.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Mapping

from api.services.cache import TTLCache
from api.services.journal_two import gallery_suggest
from api.services.journal_two import slot_fill
from api.services.journal_two import tool_binding
from api.services.journal_two import trading_days
from api.services.journal_two.widget_engine import share

#: How long one preview answer is reused (W11-R12).
CACHE_TTL_S = 300
#: ⚠️ Per process (the one web pod's memory). Named in CLAUDE.md's single-process list by Task 11.21.
_CACHE = TTLCache(max_size=500)

S_PICK = "Pick a {label} to see this widget."
#: A built slot past the batch's `run.MAX_EXAMPLES` cards (the wording a list card uses, W11-R12).
S_NOT_PREVIEWED = "Fills in with your own data when you make a note."
#: The credit's words (W11-R7). The label is the one `template_gallery._author_label` answers.
CREDIT = "Based on {label}'s {title}"
CREDIT_FORMER = "Based on a former member's {title}"

#: The card slot of a single listed widget, and the tool slot of a single listed routine or tracker.
WIDGET_SLOT = "widget"
#: How a single listed widget is put to the one wave decider: as the built slot an adoption places.
LISTED_WIDGET_BLOCK = "built_a"
LISTED_WIDGET_KEY = "w"
_TOOL_TYPES = {"routine": "routine", "tracker": "tracker"}


def _tg():
    from api.services.journal_two import template_gallery
    return template_gallery


def _js():
    from api.services.journal_two import journal_styles
    return journal_styles


def _run():
    from api.services.journal_two.widget_engine import run
    return run


def _plan():
    from api.services.journal_two.widget_engine import plan
    return plan


def _catalog():
    from api.services.journal_two.widget_engine.sources import CATALOG
    return CATALOG


@contextmanager
def _read(conn: sqlite3.Connection | None) -> Iterator[sqlite3.Connection]:
    if conn is not None:
        yield conn
        return
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        yield c
    finally:
        c.close()


# -- answers ---------------------------------------------------------------------------------------

def _canonical(answers: Mapping) -> str:
    return json.dumps(answers, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def cache_key(gallery_id: str, version: Any, user_id: str, et_day: str, answers: Mapping) -> str:
    """THE key (W11-R12): the item, its listed version, the viewer, the ET day and the answers' hash."""
    digest = hashlib.sha256(_canonical(answers).encode("utf-8")).hexdigest()
    return "preview_mine::" + json.dumps([gallery_id, version, user_id, et_day, digest], default=str)


def _number(x: Any) -> bool:
    return (isinstance(x, (int, float)) and not isinstance(x, bool) and x == x
            and x not in (float("inf"), float("-inf")))


def _refuse(sentence: str, sid: str) -> share.ShareError:
    """A refusal of one choice, naming it (W11-R24: the sheet shows it at that choice)."""
    err = share.ShareError("invalid", sentence)
    err.slot = sid
    return err


#: The most a preview's answers may weigh altogether: the gallery route's own body bound (16 KB).
MAX_ANSWERS_BYTES = 16 * 1024
S_ANSWERS_TOO_LONG = "Your answers are too long. Shorten one and try again."
#: Choices that take exactly one text (an account, a property, a routine or tracker ref); the rest take one text or
#: a list of texts (a filter's values).
_SINGLE_TYPES = frozenset({"account", "property", "routine", "tracker"})
#: The sources the Sample data book carries rows for (`run.sample_rows`).
_BOOK_SOURCES = ("closed_trades", "open_positions", "trading_days")
#: The value choices the book can be filtered by. An account is never the book's (a sample run reads every account).
_BOOK_TYPES = frozenset({"setup", "tag", "symbol"})


def _label_of(slot: Mapping) -> str:
    return slot.get("label") or share.TYPE_LABELS.get(slot.get("type"), "this choice")


def _text_ok(x: Any, label: str, sid: str) -> None:
    if not isinstance(x, str) or not x.strip():
        raise _refuse(share.S_NEED_VALUE.format(label=label), sid)
    if len(x) > _plan().MAX_TEXT:                       # the plan's own bound, in its own words (as resolve answers)
        raise _refuse(_plan().S_TEXT_TOO_LONG, sid)


def _check_answer(slot: Mapping, a: Any) -> None:
    """The viewer's own answer for one choice, refused (naming the choice) in the reducer's and the plan's own words
    when it cannot fill it: Any where Any is not offered, a non-number for a number, a list where one value goes,
    an empty or over-long text, too many values."""
    sid, label = slot["id"], _label_of(slot)
    if isinstance(a, Mapping):
        if a.get("any") is True and set(a) == {"any"}:
            if slot.get("any") is not True:
                raise _refuse(share.S_NO_ANY.format(label=label), sid)
            return
        raise _refuse(share.S_NEED_VALUE.format(label=label), sid)
    if slot.get("type") == "number":
        if not _number(a):
            raise _refuse(share.S_NEED_NUMBER.format(label=label), sid)
        return
    if isinstance(a, list):
        if slot.get("type") in _SINGLE_TYPES or not a:
            raise _refuse(share.S_NEED_VALUE.format(label=label), sid)
        if len(a) > _plan().MAX_FILTER_VALUES:
            raise _refuse(_plan().S_TOO_MANY_VALUES, sid)
        for x in a:
            _text_ok(x, label, sid)
        return
    _text_ok(a, label, sid)


def _slots_of(payload: Mapping) -> list[dict]:
    """The payload's choices, each one the reducer typed (anything else is not a choice and is left out)."""
    out: list[dict] = []
    seen: set[str] = set()
    for s in payload.get("slots") if isinstance(payload.get("slots"), list) else []:
        if (isinstance(s, Mapping) and isinstance(s.get("id"), str) and s["id"] not in seen
                and s.get("type") in share.SLOT_TYPES):
            seen.add(s["id"])
            out.append(dict(s))
    return out


def clean_answers(slots: list[dict], answers: Mapping) -> dict:
    """W11 fix round 1 (I-3): the answers the preview takes, keyed and cached: ONLY the payload's declared choices
    (any other key is dropped, so it can neither key a cache entry nor be echoed), each one checked
    (`_check_answer`), and all of them together within `MAX_ANSWERS_BYTES`."""
    declared = {s["id"]: s for s in slots}
    out: dict[str, Any] = {}
    for sid, a in answers.items():
        if sid in declared and a is not None:
            _check_answer(declared[sid], a)
            out[sid] = copy.deepcopy(a)
    if out and len(_canonical(out).encode("utf-8")) > MAX_ANSWERS_BYTES:
        biggest = max(out, key=lambda k: len(_canonical(out[k])))
        raise _refuse(S_ANSWERS_TOO_LONG, biggest)
    return out


# -- the Sample data book (ruling W11-R27) ----------------------------------------------------------

def _book_values(slot: Mapping) -> list | None:
    """The values the Sample data book holds for a choice it can be filtered by (a setup, tag or symbol of a source
    the book carries), most used first, ties by first met; None for any other choice (it never filters the book)."""
    source, fld = slot.get("source"), slot.get("field")
    if slot.get("type") not in _BOOK_TYPES or source not in _BOOK_SOURCES or not isinstance(fld, str):
        return None
    field = _catalog().sources[source].fields.get(fld)
    if field is None:
        return None
    from collections import Counter
    counts: Counter = Counter()
    order: dict = {}
    for row in _run().sample_rows(source):
        v = field.py(row)
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, str) and x.strip():
                counts[x] += 1
                order.setdefault(x, len(order))
    return sorted(counts, key=lambda k: (-counts[k], order[k]))


def _in_book(a: Any, values: list, ci: bool) -> bool:
    have = {v.lower() for v in values} if ci else set(values)
    items = a if isinstance(a, list) else [a]
    return all(isinstance(x, str) and (x.lower() if ci else x) in have for x in items)


def _choices(slots: list[dict], answers: Mapping, user_id: str, conn: sqlite3.Connection, *, sample: bool
             ) -> tuple[list[dict], dict[str, Any], dict[str, Any]]:
    """(the served `slots`, {slot id: the value each choice runs with}, {slot id: what it runs with when the
    viewer's own answer is set aside}). A choice with no value is absent from the second.

    `answers` is `clean_answers`' output. `suggested` (and `value` when unanswered) is ALWAYS the member's own value
    or None (W11-R27b): it is what the sheet sends on Use. Under `run.SAMPLE_BELOW` closed trades (`sample`), ruling
    W11-R27: the member's real values never filter the Sample data book. A value the book lacks runs, INTERNALLY,
    with the book's most used value (else Any where allowed), shown only as `sampleValue`; the card says so
    through its Sample data label. No own value keeps no suggestion (Review Focus 5: Any, else "Pick a ...")."""
    real = gallery_suggest.suggest_for(user_id, slots, conn=conn) if slots else {}
    out: list[dict] = []
    used: dict[str, Any] = {}
    defaults: dict[str, Any] = {}
    for s in slots:
        sid = s["id"]
        any_ok = s.get("any") is True
        sug = real.get(sid)                                  # ALWAYS the member's own, or None (W11-R27b)
        shown = answers.get(sid, sug["value"] if sug is not None else ({"any": True} if any_ok else None))
        ran = shown                                          # what the card runs with
        book = _book_values(s) if sample else None
        if book is not None and ran is not None and not (isinstance(ran, Mapping) and ran.get("any") is True):
            fld = _catalog().sources[s["source"]].fields[s["field"]]
            if not _in_book(ran, book, bool(getattr(fld, "ci", False))):
                # never a real value over the book (W11-R27): the book's own, else Any where allowed
                ran = book[0] if book else ({"any": True} if any_ok else None)
        row = {"id": sid, "type": s["type"], "label": _label_of(s), "any": any_ok, "suggested": sug,
               "value": copy.deepcopy(shown)}
        if ran != shown:
            row["sampleValue"] = copy.deepcopy(ran)          # what the Sample data card used, never sent on Use
        out.append(row)
        if ran is not None:
            used[sid] = ran
        if sid in answers:
            default = sug["value"] if sug is not None else ({"any": True} if any_ok else None)
            if book is not None and default is not None and not isinstance(default, Mapping) \
                    and not _in_book(default, book, False):
                default = book[0] if book else ({"any": True} if any_ok else None)
            if default is not None:
                defaults[sid] = default
    return out, used, defaults


def _pick_ids(obj: Any) -> list[str]:
    """Every choice id a plan names (`{"pick": id}` markers and `[#pN]` formula tokens), in first-met order."""
    out: list[str] = []
    stack = [obj]
    while stack:
        v = stack.pop(0)
        if isinstance(v, Mapping):
            if set(v) == {"pick"} and isinstance(v["pick"], str):
                out.append(v["pick"])
                continue
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
        elif isinstance(v, str):
            out.extend("p" + m.group(1) for m in share.PICK_TOKEN_RE.finditer(v))
    return list(dict.fromkeys(out))


def _resolve(plan: Any, slots: list[dict], served: list[dict], used: Mapping, *, answered: Mapping = None,
             defaults: Mapping = None) -> tuple[dict | None, str | None]:
    """(a plan with every choice filled, None) or (None, the card's sentence).

    A refusal `share.resolve_plan` traces to ONE of the viewer's own answers (the plan resolves once that answer
    is set back to its default) is raised as `share.ShareError` naming that choice, in share's own words (I-2);
    any other refusal is the card's sentence. A plan naming a choice the payload does not declare is refused
    with that choice id (`unresolved`)."""
    if not isinstance(plan, Mapping):
        return None, _js().SLOT_UNREADABLE_SENTENCES["built"]
    answered = answered or {}
    defaults = defaults or {}
    by_id = {s["id"]: s for s in served}
    ids = _pick_ids(plan)
    for sid in ids:
        if sid not in by_id:
            err = share.ShareError("unresolved", share.S_UNRESOLVED)
            err.slot = sid
            raise err
        if sid not in used:
            return None, S_PICK.format(label=str(by_id[sid]["label"]).lower())
    if not ids:
        return copy.deepcopy(dict(plan)), None
    catalog = _catalog()
    try:
        return share.resolve_plan(dict(plan), slots, dict(used), catalog=catalog), None
    except share.ShareError as e:
        failure = e
    for sid in ids:
        if sid not in answered:
            continue
        trial = dict(used)
        if sid in defaults:
            trial[sid] = defaults[sid]
        else:
            trial.pop(sid, None)
        try:
            share.resolve_plan(dict(plan), slots, trial, catalog=catalog)
        except share.ShareError:
            continue
        raise _refuse(failure.sentence, sid)
    return None, failure.sentence


# -- built slots -----------------------------------------------------------------------------------

def _built_target(block: dict, s: dict, *, author: bool, user_id: str, conn: sqlite3.Connection,
                  definitions: dict) -> tuple[Any, str, str | None]:
    """(plan, title, None) or (None, title, the slot's sentence). `def:` is read only for the author (owned)."""
    js = _js()
    ref = s["ref"]
    if ref.startswith("def:"):
        if not author:                              # never a read of the author's (or anyone's) definition
            return None, slot_fill.DEFAULT_TITLE, js.SLOT_MISSING_SENTENCES["built"]
        from api.services.journal_two import widget_definitions
        plan, _rev, _latest = widget_definitions.resolve_for_run(user_id, ref[len("def:"):], s["defRev"],
                                                                 conn=conn)
        title = slot_fill.slot_title(block, {"user_id": user_id, "conn": conn})
        if plan is None:
            return None, title, js.SLOT_MISSING_SENTENCES["built"]
        return plan, title, None
    title = slot_fill.slot_title(block, {"definitions": definitions})
    if ref.startswith("shelf:"):
        from api.services.journal_two.widget_engine import shelf
        entry = shelf.revision(ref, s["defRev"])
        return (entry["plan"], title, None) if entry else (None, title, js.SLOT_MISSING_SENTENCES["built"])
    entry = definitions.get(ref[len("inline:"):])
    plan = entry.get("plan") if isinstance(entry, Mapping) else None
    return (plan, title, None) if isinstance(plan, Mapping) else (None, title, js.SLOT_MISSING_SENTENCES["built"])


def _with_range(plan: dict, s: dict) -> dict:
    """The slot's own range over the plan's (the slot settings the fill passes as viewer settings)."""
    if "range" in s:
        plan = dict(plan)
        plan["range"] = dict(s["range"])
    return plan


def _run_cards(user_id: str, pending: list[tuple[dict, dict]], now: datetime) -> None:
    """Fill each pending card (`(card, plan)`) from ONE `run_plans_batch` call; past the cap, the not-previewed
    sentence. A card the batch refused carries the plan module's own sentence."""
    run = _run()
    batch = pending[:run.MAX_EXAMPLES]
    for card, _plan in pending[run.MAX_EXAMPLES:]:
        card["sentence"] = S_NOT_PREVIEWED
    if not batch:
        return
    answer = run.run_plans_batch(user_id, [(f"c{i}", plan) for i, (_c, plan) in enumerate(batch)], now=now)
    by_key = {c["key"]: c for c in answer["cards"]}
    for i, (card, _plan) in enumerate(batch):
        got = by_key.get(f"c{i}") or {}
        if isinstance(got.get("payload"), dict):
            card["payload"] = got["payload"]
            card["sample"] = got["payload"].get("sample") is True
        else:
            card["sentence"] = got.get("message") or _js().SLOT_UNREADABLE_SENTENCES["built"]


# -- routine and tracker slots (no day state) --------------------------------------------------------

def _items(raw: Any) -> list[dict]:
    out = []
    for it in raw if isinstance(raw, list) else []:
        text = it.get("text") if isinstance(it, Mapping) else it
        if isinstance(text, str) and text.strip():
            out.append({"text": text})
    return out


def _template_tool(family: str, key: str) -> dict | None:
    """A `template` ref's routine or tracker from `template_tools` (Task 11.6), when that module has landed."""
    try:
        import importlib
        tt = importlib.import_module(share.TEMPLATE_TOOLS_MODULE)
    except ImportError:
        return None
    table = getattr(tt, "ROUTINE_TEMPLATES" if family == "routine" else "TRACKER_TEMPLATES", None)
    found = table.get(key) if isinstance(table, Mapping) else None
    return found if isinstance(found, Mapping) else None


def _tool(bid: str, family: str, st: dict, *, author: bool, user_id: str, conn: sqlite3.Connection,
          payload: Mapping, note_day: str) -> dict:
    js = _js()
    name: Any = None
    items: list[dict] = []
    kind: Any = None
    if "inline" in st:
        pool = payload.get("routines" if family == "routine" else "trackers")
        entry = next((e for e in (pool if isinstance(pool, list) else [])
                      if isinstance(e, Mapping) and e.get("key") == st["inline"]), None)
        if isinstance(entry, Mapping):
            name, items, kind = entry.get("name"), _items(entry.get("items")), entry.get("kind")
    elif "template" in st:
        entry = _template_tool(family, st["template"])
        if entry is not None:
            name, items, kind = entry.get("name"), _items(entry.get("items")), entry.get("kind")
    elif family == "tracker" and st["ref"] in _builtin_trackers():
        entry = _builtin_trackers()[st["ref"]]
        name, kind = entry.get("name"), entry.get("kind")
    elif author:                                   # the author's own routine or tracker: an owned read
        if family == "routine":
            from api.services.journal_two import routines
            got = routines.get(user_id, st["ref"][len("routine:"):], conn=conn)
        else:
            from api.services.journal_two import trackers
            got = trackers.get(user_id, st["ref"][len("tracker:"):], conn=conn)
        if isinstance(got, Mapping):
            name, items, kind = got.get("name"), _items(got.get("items")), got.get("kind")
    if not isinstance(name, str) or not name.strip():
        # a member's own ref that is not the viewer's reads as the slot's sentence; a template or inline target
        # this server cannot name (template_tools not landed, a malformed payload) is just its family's word
        name = js.SLOT_MISSING_SENTENCES[family] if "ref" in st else share.TYPE_LABELS[family]
    day = tool_binding.bind_day(note_day, st["bind"])
    out: dict = {"slot": bid, "kind": family, "name": name, "bind": st["bind"],
                 "forDayLabel": tool_binding.for_day_label(day, st["bind"])}
    if family == "routine":
        out["items"] = items
    else:
        out["trackerKind"] = kind if isinstance(kind, str) and kind in share.TRACKER_KINDS else None
    return out


def _builtin_trackers() -> Mapping:
    from api.services.journal_two import trackers
    return trackers.BUILTIN


# -- the item kinds --------------------------------------------------------------------------------

def _template(payload: Mapping, *, author: bool, user_id: str, conn: sqlite3.Connection, answers: Mapping,
              now: datetime) -> dict:
    js = _js()
    slots = _slots_of(payload)
    served, used, defaults = _choices(slots, answers, user_id, conn, sample=_run().wants_sample(conn, user_id))
    definitions = {d["key"]: d for d in payload.get("definitions") if isinstance(d, Mapping)
                   and isinstance(d.get("key"), str)} if isinstance(payload.get("definitions"), list) else {}
    note_day = trading_days.today_et(now).isoformat()
    blocks = payload.get("blocks") if isinstance(payload.get("blocks"), list) else []
    # The ONE decider's slot ctx (W11-R20, 11.5 fix round 1): the inline definitions, and the author's own `def:`
    # refs in one owned read. A non-author gets no member here, so nothing of anyone's is read for them.
    wave_ctx = js._slot_ctx(user_id if author else None, conn, blocks, definitions)
    cards: list[dict] = []
    tools: list[dict] = []
    pending: list[tuple[dict, dict]] = []
    for b in blocks:
        if not isinstance(b, Mapping) or b.get("enabled", True) is False:
            continue
        bid = b.get("block")
        family = js.slot_family(bid)
        if family is None or js._slot_wave_off(bid, b.get("settings"), wave_ctx):
            continue                                 # not a family slot, or its wave is dark: no card, no line
        block = {"block": bid, "settings": b.get("settings")}
        if family == "built":
            s = slot_fill.clean_settings(block)
            if s is None:
                cards.append({"slot": bid, "title": slot_fill.DEFAULT_TITLE,
                              "sentence": js.SLOT_UNREADABLE_SENTENCES["built"], "sample": False})
                continue
            plan, title, sentence = _built_target(block, s, author=author, user_id=user_id, conn=conn,
                                                  definitions=definitions)
            card: dict = {"slot": bid, "title": title, "sample": False}
            if sentence is None:
                resolved, sentence = _resolve(plan, slots, served, used, answered=answers,
                                              defaults=defaults)
            if sentence is not None:
                card["sentence"] = sentence
            else:
                pending.append((card, _with_range(resolved, s)))
            cards.append(card)
        else:
            try:
                st = js.slot_settings_of(family, b.get("settings"))
            except js.StyleValidationError:
                continue
            tools.append(_tool(bid, family, st, author=author, user_id=user_id, conn=conn, payload=payload,
                               note_day=note_day))
    _run_cards(user_id, pending, now)
    return {"slots": served, "cards": cards, "tools": tools,
            "questions": _questions(payload, user_id=user_id, conn=conn)}


def _questions(payload: Mapping, *, user_id: str, conn: sqlite3.Connection) -> list:
    """`slot_fill.tool_questions` (Task 11.6), the reuse questions the sheet asks. [] until that function lands."""
    asker = getattr(slot_fill, "tool_questions", None)
    if asker is None:
        return []
    def by_key(name: str) -> dict:
        pool = payload.get(name)
        return {e["key"]: e for e in (pool if isinstance(pool, list) else [])
                if isinstance(e, Mapping) and isinstance(e.get("key"), str)}
    return asker(dict(payload), user_id=user_id, conn=conn, inline_routines=by_key("routines"),
                 inline_trackers=by_key("trackers"))


def _widget(payload: Mapping, *, user_id: str, conn: sqlite3.Connection, answers: Mapping,
            now: datetime) -> dict:
    slots = _slots_of(payload)
    served, used, defaults = _choices(slots, answers, user_id, conn, sample=_run().wants_sample(conn, user_id))
    name = payload.get("name")
    card: dict = {"slot": WIDGET_SLOT,
                  "title": name if isinstance(name, str) and name.strip() else slot_fill.DEFAULT_TITLE,
                  "sample": False}
    js = _js()
    # A listed widget is judged by the ONE decider too, as the built slot an adoption would place (W11-R20).
    if js._slot_wave_off(LISTED_WIDGET_BLOCK, {"ref": "inline:" + LISTED_WIDGET_KEY},
                         {"definitions": {LISTED_WIDGET_KEY: {"plan": payload.get("plan")}}}):
        return {"slots": served, "cards": [], "tools": [], "questions": []}
    resolved, sentence = _resolve(payload.get("plan"), slots, served, used, answered=answers,
                                  defaults=defaults)
    cards = [card]
    if sentence is not None:
        card["sentence"] = sentence
    else:
        _run_cards(user_id, [(card, resolved)], now)
    return {"slots": served, "cards": cards, "tools": [], "questions": []}


def _standalone_tool(family: str, payload: Mapping) -> dict:
    """A listed routine or tracker on its own: its name, items or kind. No note, so no bound day."""
    name = payload.get("name")
    out: dict = {"slot": family, "kind": family,
                 "name": name if isinstance(name, str) and name.strip() else share.TYPE_LABELS[family],
                 "bind": None, "forDayLabel": None}
    if family == "routine":
        out["items"] = _items(payload.get("items"))
    else:
        kind = payload.get("kind")
        out["trackerKind"] = kind if isinstance(kind, str) and kind in share.TRACKER_KINDS else None
    return {"slots": [], "cards": [], "tools": [out], "questions": []}


def credit_line(row: Any, user_id: str) -> str | None:
    """W11-R7 for a listed row: None for the viewer's own item; `"UCT"` for official and firm rows; the author's
    gallery display label while their author row exists; `"a former member's"` once it does not."""
    tg = _tg()
    title = row["title"] if isinstance(row["title"], str) and row["title"].strip() else None
    if title is None:
        return None
    if row["kind"] in tg.UCT_KINDS:
        return CREDIT.format(label=tg.FIRM_AUTHOR, title=title)
    if row["user_id"] == user_id:
        return None
    if not row["author_handle"]:
        return CREDIT_FORMER.format(title=title)
    label = tg._author_label(row)
    if label == tg.ANONYMOUS_AUTHOR:                  # "A UCT member" mid-sentence reads "a UCT member" (M-4)
        label = label[:1].lower() + label[1:]
    return CREDIT.format(label=label, title=title)


# -- the door --------------------------------------------------------------------------------------

def preview_mine(user_id: str, gallery_id: str, *, answers: dict | None = None, now: datetime | None = None,
                 conn: sqlite3.Connection | None = None) -> dict | None:
    """The preview with the viewer's own data, or None when the item is not visible to them (the route's 404).

    Raises `share.ShareError` (an answer that cannot fill its choice, with `.slot` naming it), `PlanError`,
    `run.EngineBusy` or `run.EngineTooLong`; the router maps each from its class (W9-R14)."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a preview needs the session member's id")
    if not isinstance(gallery_id, str) or not gallery_id:
        return None
    if answers is None:
        answers = {}
    if not isinstance(answers, Mapping):
        raise share.ShareError("invalid", share.S_UNREADABLE)
    now = now or datetime.now(timezone.utc)
    tg = _tg()
    with _read(conn) as c:
        row = tg._row(c, gallery_id, user_id)
        if not tg._can_see(row, user_id, False, c):
            return None
        item_type = row["item_type"]
        if item_type != "style" and item_type not in tg.TOOL_ITEM_TYPES:
            return None
        payload = tg._listed_payload(row) or {}
        # I-3: only the declared choices, each checked, key the cache, run and are echoed
        answers = clean_answers(_slots_of(payload), answers)
        key = cache_key(gallery_id, row["version"], user_id, trading_days.today_et(now).isoformat(), answers)
        hit = _CACHE.get(key)
        if hit is not None:
            return copy.deepcopy(hit)
        author = row["user_id"] == user_id
        if item_type == "style":
            out = _template(payload, author=author, user_id=user_id, conn=c, answers=answers, now=now)
        elif item_type == "widget_definition":
            out = _widget(payload, user_id=user_id, conn=c, answers=answers, now=now)
        else:
            out = _standalone_tool(_TOOL_TYPES[item_type], payload)
        out["credit"] = credit_line(row, user_id)
    _CACHE.set(key, out, CACHE_TTL_S)
    return copy.deepcopy(out)


__all__ = ["CACHE_TTL_S", "S_PICK", "S_NOT_PREVIEWED", "cache_key", "credit_line", "preview_mine"]
