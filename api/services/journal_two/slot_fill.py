"""Notebook widgets phase 2, wave 11 (Tasks 11.5 and 11.6): template slots, filled when a note is made.

Task 11.6 adds the routine and tracker slots at the end of this module (`build_tool_slot`, `tool_questions`,
`remember_choices`); the rest of this docstring is the built-widget slot's (Task 11.5).

A template (a journal style) holds a `built_<k>` block whose settings name the widget by reference
(ruling W11-R2, reduced by `journal_styles.slot_settings_of`):

* `shelf:<slug>` + `defRev`  a ready-made widget, run at EXACTLY the pinned revision (W10-R5);
* `def:<uuid4>` + `defRev`   the member's own saved widget, resolved at FILL time for the session member
                             only (`widget_definitions.resolve_many` / `resolve_for_run`, `WHERE id = ? AND
                             user_id = ?`): a foreign, unknown or deleted id is one sentence, never another
                             member's row. The revision rule is the one every placement follows: it runs
                             `max(defRev, placed_rev)`, so an "Update everywhere" save moves a template slot
                             too, and a pruned pin runs the newest kept revision at or below it (fix round 1,
                             m-2: decided, documented and railed, not changed);
* `inline:<key>`             a definition carried by a shared payload or an official seed, handed in by the
                             caller of a use or an adoption as `ctx["definitions"][key]`.

Reads are BATCHED (fix round 1, I-3): `prefetch` reads every `def:` ref a request names in ONE owned statement
(`widget_definitions.resolve_many`) into `ctx["defs"]`, within `PREFETCH_MAX` ids; a ref past the budget, or a
read that fails, reads as unknown (the slot word, never an error), never as "not in your account".

Visibility has ONE decider, `journal_styles._slot_wave_off(block_id, settings, ctx)`, which asks `plan_dark`
here for a `def:` / `inline:` plan (fix round 1, I-2).

`build_built_slot` runs the plan through the wave 8 engine (`run.run_plan`, lane `run`) for the session member
and answers the `builtWidget` node the client's insert makes (`buildWidgetEmbedAttrs` over
`builtRefreshParams({}, payload)`: the registry's params normalisation and search line, twinned through
tests/fixtures/builtRefreshParamsVectors.json).

⛔ No slot task ever sleeps holding a pool permit (fix round 1, I-1): a busy engine answers `engine-busy` at once,
and the slot dispatcher in journal_styles (`_build_slots_bounded`) re-dispatches it from the REQUEST thread,
with at most `run.MEMBER_MAX` of one fill's built slots in flight.

⛔ Live state never enters a note: the node is a snapshot (`mode: "snapshot"`, `share` off).

The heavy modules are imported at call time (looked up on the module, so a test's patch reaches them), and
`journal_styles` too: it imports this module."""
from __future__ import annotations

import json
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, TypedDict

#: The widget kind a filled slot becomes (notebook_widgets.BUILT_KIND, restated: this module imports it lazily).
BUILT_KIND = "builtWidget"
#: A slot whose target has no name the member can read.
DEFAULT_TITLE = "Widget"
#: The skip reasons this module answers (journal_styles.slot_skip_sentence turns each into a sentence).
MISSING = "slot-missing"
UNREADABLE = "slot-unreadable"
TOO_NEW = "slot-too-new"
FAILED = "widget-failed"
PREVIEW = "widget-preview"
#: Not a final answer: the engine was busy; the dispatcher re-dispatches the slot (never shown to a member).
BUSY = "engine-busy"
#: How long the dispatcher waits before re-dispatching a busy slot.
BUSY_RETRY_S = 0.1
#: At most this many `def:` ids are read per request (one statement); the rest read as unknown.
PREFETCH_MAX = 200

#: ⛔ ONE FACT IN TWO FILES with app/src/widgets/registry.js `builtWidget` (snapshotManifest: `asOf`, `source`,
#: the payload schema, `_SNAP_COMMON`, `share`), in that order: `(key, type, default)`. Both sides are railed against
#: the `fields` list of tests/fixtures/builtRefreshParamsVectors.json, so neither re-derives the other.
BUILT_PARAM_FIELDS: tuple[tuple[str, str, Any], ...] = tuple(
    (k, t, False if k == "share" else None) for k, t in (
        ("asOf", "string"), ("source", "string"),
        ("defId", "string"), ("defRev", "number"), ("latestRev", "number"), ("def", "json"), ("defRef", "json"),
        ("title", "string"), ("summary", "string"), ("view", "string"), ("sourceKey", "string"),
        ("measures", "json"), ("value", "json"), ("compare", "json"), ("compareLabel", "string"),
        ("rows", "json"), ("series", "json"), ("points", "json"), ("cells", "json"), ("coverage", "json"),
        ("count", "number"), ("scopeLabel", "string"), ("rangeLabel", "string"), ("range", "json"),
        ("accountId", "string"), ("filter", "json"), ("capped", "boolean"), ("sample", "boolean"),
        ("notice", "string"), ("truncated", "number"), ("footnotes", "json"), ("labelKind", "string"),
        ("label2Kind", "string"), ("drawdown", "json"), ("target", "number"), ("targetLabel", "string"),
        ("stop", "json"), ("quadrants", "string"), ("publicHidden", "boolean"),
        ("empty", "string"), ("partial", "boolean"), ("failed", "boolean"), ("tooLarge", "boolean"),
        ("earningsUnknown", "boolean"), ("sourceDetail", "string"), ("priceBasis", "string"),
        ("mistakesTruncated", "number"), ("list", "string"), ("from", "string"), ("to", "string"),
        ("share", "boolean")))


class SlotCtx(TypedDict, total=False):
    """What a slot builder reads. `definitions` is `{key: definition}` for `inline:` refs (set by the caller of
    a use or an adoption, else `{}`); a definition is `{"plan": {...}, "name": ...}` (share_template's entry)
    or a bare plan. `conn` is a connection on the CALLER's thread; a pool task is handed None and opens its
    own (one sqlite connection is never shared across the slot pool's threads). `defs` is the batched read
    (`prefetch`), shared read-only with the pool tasks."""
    user_id: str
    now: datetime
    note_day: str | None
    fill_widgets: bool
    definitions: dict
    answers: dict
    choices: dict
    conn: sqlite3.Connection | None
    defs: dict
    defs_loaded: bool
    # Task 11.6: routine and tracker slots.
    inline_routines: dict          # {inline key: share_routine entry} (a shared payload's `routines`)
    inline_trackers: dict          # {inline key: share_tracker entry}
    template_title: str            # the template's title, stored as the tool's `fromTemplate` (W11-R13)
    gallery_id: str | None         # the gallery item a member-shared template came from (`gal:` keys)
    tools: dict                    # the batched owned name read: {(family, id): entry | None}
    tools_loaded: bool
    created: dict                  # {block id: tool id} for each tool this fill created


def _js():
    from api.services.journal_two import journal_styles
    return journal_styles


def _wd():
    from api.services.journal_two import widget_definitions
    return widget_definitions


def _shelf():
    from api.services.journal_two.widget_engine import shelf
    return shelf


def _plan_mod():
    from api.services.journal_two.widget_engine import plan
    return plan


def _run():
    from api.services.journal_two.widget_engine import run
    return run


def _wave_on(wave: int) -> bool:
    from api.services.journal_two import notebook_widgets
    return notebook_widgets.notebook_widgets_wave_on(wave)


def clean_settings(block: Any) -> dict | None:
    """The block's settings re-reduced by the ONE grammar (`journal_styles.slot_settings_of`), or None when they
    do not read. ⛔ 11.3 re-review m-3: a legacy-kept block is stored VERBATIM, so a builder never trusts the
    stored settings without this."""
    js = _js()
    if not isinstance(block, dict):
        return None
    try:
        return js.slot_settings_of("built", block.get("settings"))
    except js.StyleValidationError:
        return None


def _inline_entry(ctx: dict, key: str) -> tuple[dict | None, str | None]:
    """(plan, name) of `ctx["definitions"][key]`, or (None, None)."""
    defs = ctx.get("definitions")
    found = defs.get(key) if isinstance(defs, dict) else None
    if not isinstance(found, dict):
        return None, None
    plan = found.get("plan") if isinstance(found.get("plan"), dict) else found
    name = found.get("name") if isinstance(found.get("name"), str) and found.get("name").strip() else None
    return plan, name


# ── the batched owned read (I-3) ────────────────────────────────────────────────────────────────

_UNKNOWN = object()          # past the budget, or the read failed: neither found nor "not in your account"


def def_refs(blocks: Any) -> list[tuple[str, int]]:
    """The `(uuid, defRev)` of every readable `def:` built slot in `blocks`, in order."""
    out = []
    for b in blocks if isinstance(blocks, list) else []:
        if isinstance(b, dict) and _js().slot_family(b.get("block")) == "built":
            s = clean_settings(b)
            if s is not None and s["ref"].startswith("def:"):
                out.append((s["ref"][len("def:"):], s["defRev"]))
    return out


def prefetch(blocks: Any, ctx: dict) -> dict:
    """Read every `def:` ref in `blocks` for `ctx["user_id"]` in ONE statement into `ctx["defs"]` (at most
    `PREFETCH_MAX` distinct ids; later ids read as unknown). A failed read leaves them unknown, never raises.
    Marks the ctx as loaded, so no later lookup queries again."""
    cache = ctx.setdefault("defs", {})
    refs = [r for r in def_refs(blocks) if r not in cache]
    uid = ctx.get("user_id")
    ctx["defs_loaded"] = True
    if refs and isinstance(uid, str) and uid:
        ids = list(dict.fromkeys(d for d, _ in refs))[:PREFETCH_MAX]
        within = [r for r in refs if r[0] in set(ids)]
        try:
            got = _wd().resolve_many(uid, within, conn=ctx.get("conn"))
        except Exception as e:  # noqa: BLE001 -- a read that fails is the slot word, never an error
            _js()._log.warning("template slot names not read: %s", type(e).__name__)
            got = {}
        for r in within:
            if r in got:
                cache[r] = got[r]
    prefetch_tools(blocks, ctx)
    return cache


def _def_entry(ctx: dict, def_id: str, rev: int) -> Any:
    """The batched entry for `(def_id, rev)`: a dict, None (not the member's), or `_UNKNOWN`. A ctx that was
    never prefetched reads this one ref on its own (one statement)."""
    cache = ctx.setdefault("defs", {})
    key = (def_id, rev)
    if key in cache:
        return cache[key]
    if not ctx.get("defs_loaded"):
        uid = ctx.get("user_id")
        if not isinstance(uid, str) or not uid:
            return None
        try:
            got = _wd().resolve_many(uid, [key], conn=ctx.get("conn"))
        except Exception as e:  # noqa: BLE001
            _js()._log.warning("template slot not read: %s", type(e).__name__)
            return _UNKNOWN
        cache[key] = got.get(key)
        return cache[key]
    return _UNKNOWN


def _target(block: Any, ctx: dict) -> dict:
    """What a built slot names: `{"status": ok|missing|unreadable|unknown, "plan", "def_id", "def_rev",
    "latest", "name", "settings"}`. ⛔ A `def:` target is read for the session member only."""
    s = clean_settings(block)
    if s is None:
        return {"status": "unreadable"}
    ref = s["ref"]
    if ref.startswith("shelf:"):
        entry = _shelf().revision(ref, s["defRev"])
        if entry is None:
            return {"status": "missing", "settings": s}
        return {"status": "ok", "plan": entry["plan"], "def_id": ref, "def_rev": entry["rev"], "latest": None,
                "name": entry["name"], "settings": s, "shelf": True}
    if ref.startswith("def:"):
        e = _def_entry(ctx, ref[len("def:"):], s["defRev"])
        if e is _UNKNOWN:
            return {"status": "unknown", "settings": s}
        if not isinstance(e, dict) or e.get("plan") is None:
            return {"status": "missing", "settings": s}
        name = e.get("name") if isinstance(e.get("name"), str) and e.get("name").strip() else None
        return {"status": "ok", "plan": e["plan"], "def_id": ref[len("def:"):], "def_rev": e["rev"],
                "latest": e["latest_rev"], "name": name, "settings": s}
    plan, name = _inline_entry(ctx, ref[len("inline:"):])
    if plan is None:
        return {"status": "missing", "settings": s}
    return {"status": "ok", "plan": plan, "def_id": None, "def_rev": None, "latest": None, "name": name,
            "settings": s}


def plan_dark(block: Any, ctx: dict) -> bool:
    """Does this built slot's plan need a release wave that is off now (`uses_tools` and wave 9 off, `uses_wave10`
    and wave 10 off)? Asked ONLY by `journal_styles._slot_wave_off` (the one decider). A target that cannot be
    read is not dark (it is its sentence)."""
    t = _target(block, ctx)
    return t["status"] == "ok" and _dark(t["plan"])


def slot_name(block: dict, ctx: dict) -> tuple[str | None, str | None]:
    """(name, None) when the slot's target resolves for the session member (an unnamed inline or a read past
    the budget gives the slot word), else (None, reason) with reason `slot-unreadable` or `slot-missing`."""
    t = _target(block, ctx)
    if t["status"] == "unreadable":
        return None, UNREADABLE
    if t["status"] == "missing":
        return None, MISSING
    if t["status"] == "unknown":
        return DEFAULT_TITLE, None
    return t.get("name") or DEFAULT_TITLE, None


def slot_title(block: dict, ctx: dict) -> str:
    """The widget's name for a sentence: a shelf entry's name, an inline definition's `name`, the member's
    definition's name (owned read), else "Widget"."""
    name, _ = slot_name(block, ctx)
    return name or DEFAULT_TITLE


def _dark(plan: Any) -> bool:
    p = _plan_mod()
    return bool((p.uses_tools(plan) and not _wave_on(9)) or (p.uses_wave10(plan) and not _wave_on(10)))


def plan_is_dark(plan: Any) -> bool:
    """Public name for `_dark` (Task 11.6, the 11.9 carry): does this plan need a release wave that is off now?
    It calls `_dark` (looked up at call time), so the private name stays the one implementation and a patch of
    either reaches both. ⛔ Not a second visibility decider: `journal_styles.slot_wave_off` is the one."""
    return _dark(plan)


def _shelf_latest(ref: str) -> int | None:
    """The newest revision the flags allow (the router's `_shelf_allowed` rule), for the payload's `latestRev`."""
    p = _plan_mod()
    w9, w10 = _wave_on(9), _wave_on(10)

    def allowed(plan: Any) -> bool:
        return not (p.uses_tools(plan) and not w9) and not (p.uses_wave10(plan) and not w10)
    return _shelf().latest_rev(ref, allowed=allowed)


# ── the client's insert, twinned (m-4) ──────────────────────────────────────────────────────────

def refresh_params(old: Any, payload: Any) -> dict:
    """The client's `builtRefreshParams(old, payload)` (lib/builtWidgets.js): the payload's keys and the CURRENT
    `share` switch (a fill publishes nothing, so `share` is False). Nothing else is copied from `old`."""
    prev = old if isinstance(old, dict) else {}
    return {**(payload if isinstance(payload, dict) else {}), "share": prev.get("share") is True}


def _js_string(v: Any) -> str:
    """JavaScript's `String(v)` for the values a payload holds."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer() and math.isfinite(v):
        return str(int(v))
    if isinstance(v, (int, float, str)):
        return str(v)
    if isinstance(v, list):
        return ",".join("" if x is None else _js_string(x) for x in v)
    return "[object Object]"


def _coerce(kind: str, v: Any) -> Any:
    """registry.js `coerce(field, v)` for the types `builtWidget` declares; `_ABSENT` drops the key."""
    if v is None:
        return _ABSENT
    if kind == "string":
        s = _js_string(v)
        return s if s else _ABSENT
    if kind == "number":
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, (int, float)):
            return v if math.isfinite(v) else _ABSENT
        if isinstance(v, str):
            t = v.strip()
            if not t:
                return 0
            try:
                n = float(t)
            except ValueError:
                return _ABSENT
            return (int(n) if n.is_integer() else n) if math.isfinite(n) else _ABSENT
        return _ABSENT
    if kind == "boolean":
        return bool(v) if not isinstance(v, (dict, list)) else True
    if kind == "json":
        try:
            return json.loads(json.dumps(v))
        except (TypeError, ValueError):
            return _ABSENT
    return _ABSENT


_ABSENT = object()


def normalize_params(live: Any) -> dict:
    """registry.js `normalizeParams('builtWidget', live)`: each declared field coerced, defaults applied,
    undeclared keys dropped."""
    src = live if isinstance(live, dict) else {}
    out = {}
    for key, kind, default in BUILT_PARAM_FIELDS:
        v = _coerce(kind, src.get(key))
        if v is _ABSENT and default is not None:
            v = default
        if v is not _ABSENT:
            out[key] = v
    return out


def search_text(params: dict) -> str:
    """registry.js `builtWidget.plainText`: `[widget: <title> · as of <YYYY-MM-DD>]`, never a figure."""
    title = params.get("title") or "widget"
    day = params["asOf"][:10] if isinstance(params.get("asOf"), str) else ""
    ok = len(day) == 10 and day[4] == "-" and day[7] == "-" and (day[:4] + day[5:7] + day[8:]).isdigit()
    return f"[widget: {title}{f' · as of {day}' if ok else ''}]"


def node_for(payload: dict) -> dict:
    """The `builtWidget` snapshot node for a run payload: `buildWidgetEmbedAttrs(BUILT_KIND,
    builtRefreshParams({}, payload), {capturedAt: payload.asOf})`."""
    params = normalize_params(refresh_params({}, payload))
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": BUILT_KIND, "params": params, "capturedAt": payload.get("asOf"),
        "embedId": uuid.uuid4().hex, "mode": "snapshot", "fallback": None, "tradeRef": None,
        "tradeRefType": None, "annotations": [], "caption": None, "layout": {"width": "full", "height": None},
        "searchText": search_text(params),
    }}


def build_built_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """(node, None), or (None, reason) for one sentence. Reasons,
    each suffixed `:<block id>`: `slot-unreadable`, `slot-missing`, `slot-too-new` (made with a newer app),
    `widget-failed` (the run raised), `widget-preview` (a preview reads nothing), or `engine-busy` (not final:
    the dispatcher re-dispatches it). ⛔ Never sleeps: a busy engine answers at once."""
    bid = block.get("block") if isinstance(block, dict) else None
    js = _js()
    # Visibility (a plan needing a dark wave) was decided by compose through `_slot_wave_off`, the ONE decider;
    # this builder is only ever handed a slot that is shown (I-2: no second copy of the decision here).
    if not ctx.get("fill_widgets", True):
        return (None, f"{UNREADABLE}:{bid}") if clean_settings(block) is None else (None, f"{PREVIEW}:{bid}")
    uid = ctx.get("user_id")
    t = _target(block, ctx)
    if t["status"] == "unreadable":
        return None, f"{UNREADABLE}:{bid}"
    if t["status"] != "ok" or not isinstance(uid, str) or not uid:
        if t["status"] == "unknown":
            js._log.warning("built slot %s not filled: its widget was not read", bid)
            return None, f"{FAILED}:{bid}"
        return None, f"{MISSING}:{bid}"
    s = t["settings"]
    latest = _shelf_latest(t["def_id"]) if t.get("shelf") else t["latest"]
    settings = {"range": dict(s["range"])} if "range" in s else {}
    run = _run()
    try:
        payload = run.run_plan(uid, t["plan"], settings, lane="run", def_id=t["def_id"], def_rev=t["def_rev"],
                               latest_rev=latest, now=ctx.get("now"))
    except run.EngineBusy:
        return None, f"{BUSY}:{bid}"
    except _plan_mod().PlanTooNew:
        return None, f"{TOO_NEW}:{bid}"
    except Exception as e:  # noqa: BLE001 -- a slot that cannot load is a sentence, never a failed note
        js._log.warning("built slot %s not filled: %s", bid, type(e).__name__)
        return None, f"{FAILED}:{bid}"
    if not isinstance(payload, dict) or not isinstance(payload.get("asOf"), str):
        return None, f"{FAILED}:{bid}"
    return node_for(payload), None


# ── Task 11.6: routine and tracker slots ───────────────────────────────────────────────────────
# A `routine_<k>` / `tracker_<k>` slot names its tool by `{"ref": "routine:<uuid>" | "tracker:<uuid>" |
# "checkin:mood" | "checkin:focus"}` (the member's own, read at FILL time `WHERE id = ? AND user_id = ?`), or by
# `{"template": <key>}` / `{"inline": <key>}` (a tool the template makes). A template or inline slot asks the reuse
# question once (`tool_questions`); the answer is `ctx["choices"][<block id>]`: `{"use": "<id>"}` (one of the
# member's own) or `{"create": True}` (made from the template, unique on `(user_id, source_template_key)`, W11-R13).
#
# ⛔ Live state never enters a note: the node holds only `{routineId|trackerId, day, bind, display}`. Nothing here
# reads or writes `j2_routine_ticks`, `j2_routine_days` or `j2_tracker_values`.
# ⛔ Tools never use the widget engine, so they never take a share of the member's engine slots (11.5's per-member
# in-flight count): `compose` builds them on the request thread, in order, outside the slot pool.

#: family -> the block's params id key (lib/toolEmbed.js `KINDS`, railed against that file).
TOOL_ID_KEYS = {"routine": "routineId", "tracker": "trackerId"}
TOOL_WORDS = {"routine": "Routine", "tracker": "Tracker"}
#: A preview of a tool slot (it reads nothing); journal_styles words its line by the slot's bind.
TOOL_PREVIEW = "tool-preview"
#: Fix round 1 (I3, ruling W11-R30): a template slot left unanswered where nothing can ask (switching a note to a
#: style). Skipped with its line, in the update dry run and in the write alike.
UNANSWERED = "slot-unanswered"
#: A `{"use": id}` answer that is not one of the member's own (W9-R18: never a read of another member's row).
S_CHOICE_NOT_YOURS = "That choice isn't in your account."
#: At most this many tool ids are read per family per request (one statement each); later ids read as unknown.
TOOL_PREFETCH_MAX = 200
_CHECKINS = ("checkin:mood", "checkin:focus")


def _store(family: str):
    if family == "routine":
        from api.services.journal_two import routines
        return routines
    from api.services.journal_two import trackers
    return trackers


def _tt():
    from api.services.journal_two import template_tools
    return template_tools


def _tb():
    from api.services.journal_two import tool_binding
    return tool_binding


def tool_settings(block: Any) -> dict | None:
    """A routine or tracker slot's settings re-reduced by the ONE grammar (`journal_styles.slot_settings_of`), or
    None when they do not read (a "Follow today" bind included: a template never follows today)."""
    js = _js()
    if not isinstance(block, dict):
        return None
    family = js.slot_family(block.get("block"))
    if family not in TOOL_ID_KEYS:
        return None
    try:
        return js.slot_settings_of(family, block.get("settings"))
    except js.StyleValidationError:
        return None


def _ref_id(ref: str) -> str:
    return ref if ref in _CHECKINS else ref.split(":", 1)[1]


def tool_refs(blocks: Any) -> list[tuple[str, str]]:
    """The `(family, id)` of every readable `ref` routine or tracker slot in `blocks`, in order."""
    out = []
    for b in blocks if isinstance(blocks, list) else []:
        s = tool_settings(b)
        if s is not None and "ref" in s:
            out.append((_js().slot_family(b.get("block")), _ref_id(s["ref"])))
    return out


def prefetch_tools(blocks: Any, ctx: dict) -> dict:
    """W11-R21: read the name of every `ref` tool slot in `blocks` for `ctx["user_id"]`, ONE statement per family
    (`routines.resolve_many` / `trackers.resolve_many`, `WHERE user_id = ?`), into `ctx["tools"]`. At most
    `TOOL_PREFETCH_MAX` ids per family; the rest, and every id of a read that fails, read as unknown (the family
    word), never as "not in your account". Never raises. Marks the ctx as loaded."""
    cache = ctx.setdefault("tools", {})
    uid = ctx.get("user_id")
    ctx["tools_loaded"] = True
    if not isinstance(uid, str) or not uid:
        return cache
    refs = tool_refs(blocks)
    for family in TOOL_ID_KEYS:
        ids = list(dict.fromkeys(i for f, i in refs if f == family and (f, i) not in cache))[:TOOL_PREFETCH_MAX]
        if not ids:
            continue
        try:
            got = _store(family).resolve_many(uid, ids, conn=ctx.get("conn"))
        except Exception as e:  # noqa: BLE001 -- a read that fails is the family word, never an error
            _js()._log.warning("template %s names not read: %s", family, type(e).__name__)
            continue
        for i in ids:
            if i in got:
                cache[(family, i)] = got[i]
    return cache


def _tool_entry(ctx: dict, family: str, tid: str) -> Any:
    """The batched entry for `(family, tid)`: a dict, None (not the member's), or `_UNKNOWN`. A ctx never
    prefetched reads this one id on its own (one statement)."""
    cache = ctx.setdefault("tools", {})
    key = (family, tid)
    if key in cache:
        return cache[key]
    if not ctx.get("tools_loaded"):
        uid = ctx.get("user_id")
        if not isinstance(uid, str) or not uid:
            return None
        try:
            got = _store(family).resolve_many(uid, [tid], conn=ctx.get("conn"))
        except Exception as e:  # noqa: BLE001
            _js()._log.warning("template %s not read: %s", family, type(e).__name__)
            return _UNKNOWN
        cache[key] = got.get(tid)
        return cache[key]
    return _UNKNOWN


def _made_by_template(family: str, s: dict, ctx: dict) -> dict | None:
    """What a `template` / `inline` slot would create: `{"name", "items"}` (routine) or `{"name", "kind", "unit",
    "days"}` (tracker), or None when the template table or the payload does not hold it."""
    if "template" in s:
        table = _tt().ROUTINE_TEMPLATES if family == "routine" else _tt().TRACKER_TEMPLATES
        return table[s["template"]] if s["template"] in table else None
    pool = ctx.get("inline_routines" if family == "routine" else "inline_trackers")
    entry = pool.get(s["inline"]) if isinstance(pool, dict) else None
    if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not entry["name"].strip():
        return None
    return entry


def _tool_target(block: Any, ctx: dict) -> dict:
    """What a tool slot names: `{"status": ok|missing|unreadable|unknown, "family", "settings", "name"}`.
    ⛔ A `ref` is read for the session member only (the batched read)."""
    s = tool_settings(block)
    if s is None:
        return {"status": "unreadable"}
    family = _js().slot_family(block.get("block"))
    if "ref" in s:
        if s["ref"] in _CHECKINS:
            return {"status": "ok", "family": family, "settings": s,
                    "name": _store("tracker").BUILTIN[s["ref"]]["name"]}
        e = _tool_entry(ctx, family, _ref_id(s["ref"]))
        if e is _UNKNOWN:
            return {"status": "unknown", "family": family, "settings": s}
        if not isinstance(e, dict):
            return {"status": "missing", "family": family, "settings": s}
        return {"status": "ok", "family": family, "settings": s, "name": e.get("name")}
    made = _made_by_template(family, s, ctx)
    if made is None:
        # a template or inline target this server cannot name reads as its family word (11.9, 422f3f392e)
        return {"status": "unknown", "family": family, "settings": s}
    return {"status": "ok", "family": family, "settings": s, "name": made.get("name")}


def tool_name(block: dict, ctx: dict) -> tuple[str | None, str | None]:
    """`FAMILY_NAMERS` for routine and tracker slots (W11-R21): (name, None) when the target resolves for the
    session member (an unnamed one, or a read past the budget, gives the family word), else (None, reason) with
    reason `slot-unreadable` or `slot-missing`."""
    t = _tool_target(block, ctx)
    if t["status"] == "unreadable":
        return None, UNREADABLE
    if t["status"] == "missing":
        return None, MISSING
    name = t.get("name")
    return (name.strip() if isinstance(name, str) and name.strip() else TOOL_WORDS[t["family"]]), None


def tool_title(block: dict, ctx: dict) -> str:
    """`FAMILY_TITLES` for routine and tracker slots: the tool's name for a sentence, else its family word."""
    name, _ = tool_name(block, ctx)
    if name:
        return name
    family = _js().slot_family(block.get("block") if isinstance(block, dict) else None)
    return TOOL_WORDS.get(family, DEFAULT_TITLE)


def tool_node(family: str, tool_id: str, name: Any, day: str, bind: str, display: str, *,
              now: datetime | None = None) -> dict:
    """The routine or tracker block node the W9 client insert writes (`lib/toolEmbed.js` `toolBlockOf` through
    `buildWidgetEmbedAttrs`): params `{routineId|trackerId, day, bind, display}` and the name-and-day search text
    (`tool_binding.search_text`, the client's `toolSearchText` twin). ⛔ Live state never enters it."""
    shown = name.strip() if isinstance(name, str) and name.strip() else TOOL_WORDS[family]
    at = now if isinstance(now, datetime) else datetime.now(timezone.utc)
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": family, "embedId": uuid.uuid4().hex, "mode": "snapshot",
        "params": {TOOL_ID_KEYS[family]: tool_id, "day": day, "bind": bind, "display": display},
        "capturedAt": at.isoformat().replace("+00:00", "Z"), "fallback": None, "tradeRef": None,
        "tradeRefType": None, "annotations": [], "caption": None, "layout": {"width": "full", "height": None},
        "searchText": _tb().search_text(family, shown, day, bind)}}


def _owned_choice(family: str, uid: str, tid: Any, conn: sqlite3.Connection | None) -> dict:
    """The member's own routine (tracker) a `{"use": id}` answer names, else ShareError `not_yours`. The read is
    `WHERE id = ? AND user_id = ?` (the store's `get`), so another member's row is never read."""
    from api.services.journal_two.widget_engine.share import ShareError
    got = _store(family).get(uid, tid, conn=conn) if isinstance(tid, str) and tid else None
    if not isinstance(got, dict):
        raise ShareError("not_yours", S_CHOICE_NOT_YOURS)
    return got


def _create_from_template(family: str, s: dict, made: dict, uid: str, ctx: dict) -> dict:
    """Create (or find again) the tool a template slot makes, under its unique key (W11-R13; W9-R12 restores a
    soft-deleted one). The template's title is stored as `fromTemplate`, at most 80 characters."""
    tt = _tt()
    if "template" in s:
        key = tt.template_key(family, template=s["template"])
    else:
        key = tt.template_key(family, gallery_id=ctx.get("gallery_id"), inline=s["inline"])
    title = ctx.get("template_title")
    settings: dict = {"fromTemplate": title[:80]} if isinstance(title, str) and title.strip() else {}
    store = _store(family)
    if family == "routine":
        return store.create(uid, name=made["name"], items=made.get("items") or [], schedule={"kind": "every"},
                            settings=settings, source_template_key=key, source_gallery_id=ctx.get("gallery_id"),
                            now=ctx.get("now"), conn=ctx.get("conn"))
    days = made.get("days")
    if isinstance(days, str) and days in store.DAYS_CHOICES:
        settings["days"] = days
    return store.create(uid, name=made["name"], kind=made.get("kind"), unit=made.get("unit"), settings=settings,
                        source_template_key=key, source_gallery_id=ctx.get("gallery_id"), now=ctx.get("now"),
                        conn=ctx.get("conn"))


def build_tool_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """`FAMILY_BUILDERS` for routine and tracker slots: (node, None), or (None, reason) for one sentence, reasons
    suffixed `:<block id>`: `slot-unreadable`, `slot-missing`, or `tool-preview` (a preview reads nothing).

    `ref` -> the member's own routine (tracker) by `get` (an archived one is placed and renders its read-only
    state; `checkin:*` always resolves). `template` / `inline` -> `ctx["choices"][<block id>]`: `{"use": id}` (the
    member's own, else ShareError `not_yours`) or `{"create": True}` (the unique key: a second create returns the
    first); no answer raises LibraryError. The day is `tool_binding.bind_day(ctx["note_day"], bind)`."""
    bid = block.get("block") if isinstance(block, dict) else None
    s = tool_settings(block)
    if s is None:
        return None, f"{UNREADABLE}:{bid}"
    family = _js().slot_family(bid)
    if not ctx.get("fill_widgets", True):
        return None, f"{TOOL_PREVIEW}:{bid}"
    uid = ctx.get("user_id")
    if not isinstance(uid, str) or not uid:
        return None, f"{MISSING}:{bid}"
    conn = ctx.get("conn")
    if "ref" in s:
        got = _store(family).get(uid, _ref_id(s["ref"]), conn=conn)
        if not isinstance(got, dict):
            return None, f"{MISSING}:{bid}"
    else:
        made = _made_by_template(family, s, ctx)
        if made is None:
            return None, f"{MISSING}:{bid}"
        if ctx.get("tool_answers") is False:
            return None, f"{UNANSWERED}:{bid}"            # W11-R30: no surface to answer on, so never asked
        choices = ctx.get("choices") if isinstance(ctx.get("choices"), dict) else {}
        choice = choices.get(bid)
        if isinstance(choice, dict) and choice.get("use") is not None:
            got = _owned_choice(family, uid, choice.get("use"), conn)
            ctx.setdefault("chosen", {})[bid] = got["id"]          # verified as the member's own (I2)
        elif isinstance(choice, dict) and choice.get("create") is True:
            if "inline" in s and not (isinstance(ctx.get("gallery_id"), str) and ctx["gallery_id"]):
                return None, f"{UNREADABLE}:{bid}"           # an inline tool only ever comes from a gallery item
            got = _create_from_template(family, s, made, uid, ctx)
            ctx.setdefault("created", {})[bid] = got["id"]
            ctx.setdefault("chosen", {})[bid] = got["id"]
        else:
            tt = _tt()
            raise tt.LibraryError(tt.S_CHOOSE_ROUTINE if family == "routine" else tt.S_CHOOSE_TRACKER)
    note_day = ctx.get("note_day")
    if not isinstance(note_day, str):
        from api.services.journal_two import trading_days
        note_day = trading_days.today_et(ctx.get("now") or datetime.now(timezone.utc)).isoformat()
    try:
        day = _tb().bind_day(note_day, s["bind"])
    except ValueError:
        return None, f"{UNREADABLE}:{bid}"
    return tool_node(family, got["id"], got.get("name"), day, s["bind"], s["display"], now=ctx.get("now")), None


def _outline_content(style: dict, user_id: Any, conn: sqlite3.Connection | None) -> list:
    """The top-level content `compose` would place blocks into (`journal_styles._outline_doc`: a linked template
    when it is the member's, else the style's own outline). A shared payload has none."""
    js = _js()
    if conn is None or not isinstance(user_id, str) or not user_id:
        body = style.get("outlineBodyJson")
        return body.get("content") if isinstance(body, dict) and isinstance(body.get("content"), list) else []
    try:
        return js._outline_doc(user_id, style, conn).get("content") or []
    except Exception as e:  # noqa: BLE001 -- an outline that cannot be read orders by block order
        js._log.warning("template outline not read: %s", type(e).__name__)
        return []


def tool_questions(style: dict, *, user_id: str, conn: sqlite3.Connection | None,
                   inline_routines: dict | None = None, inline_trackers: dict | None = None) -> list[dict]:
    """The reuse questions the adoption sheet asks (`AdoptSheet.jsx`): one per unresolved routine or tracker slot
    (`template` or `inline`; a `ref` asks nothing), in the note's own block order (`journal_styles.placement_order`,
    W11-R28): `{"slot", "kind", "createName", "use": {"id", "name"} | None}`, `use` being
    `template_tools.best_match` over the member's OWN tools (one read per family per call). A slot whose wave is
    dark asks nothing (the one decider, `journal_styles.slot_wave_off`). Writes nothing."""
    js = _js()
    style = style if isinstance(style, dict) else {}
    raw = style.get("blocks") if isinstance(style.get("blocks"), list) else []
    blocks = [b for b in raw if isinstance(b, dict) and b.get("enabled", True) is not False]
    ctx = {"user_id": user_id, "conn": conn, "definitions": {}, "defs": {}, "defs_loaded": True,
           "tools": {}, "tools_loaded": True,
           "inline_routines": dict(inline_routines or {}), "inline_trackers": dict(inline_trackers or {})}
    # W11-R28: the note's final block order, from compose's own placement.
    rank = {bid: i for i, bid in enumerate(js.placement_order(_outline_content(style, user_id, conn), blocks))}

    def position(p: tuple[int, dict]) -> tuple:
        bid = p[1].get("block")
        return (rank.get(bid, len(rank)), p[0])

    pools: dict[str, list] = {}
    out: list[dict] = []
    seen: set[str] = set()
    for _i, b in sorted(enumerate(blocks), key=position):
        bid = b.get("block")
        family = js.slot_family(bid)
        if family not in TOOL_ID_KEYS or bid in seen or js.slot_wave_off(bid, b.get("settings"), ctx):
            continue
        s = tool_settings(b)
        if s is None or "ref" in s:
            continue
        made = _made_by_template(family, s, ctx)
        if made is None:
            continue
        seen.add(bid)
        if family not in pools:
            try:
                pools[family] = _tt().candidates(user_id, family, conn=conn) if user_id else []
            except Exception as e:  # noqa: BLE001 -- no suggestion is "Create", never an error
                js._log.warning("template %s candidates not read: %s", family, type(e).__name__)
                pools[family] = []
        out.append({"slot": bid, "kind": family, "createName": made["name"],
                    "use": _tt().best_match(user_id, family, made, pool=pools[family])})
    return out


def remember_choices(user_id: str, style_id: Any, choices: Any, created: Any, *,
                     conn: sqlite3.Connection) -> None:
    """"The choice is remembered for that template": rewrite the member's OWN style's `template` / `inline` routine
    and tracker slots to `{"ref": "routine:<id>"}` (`"tracker:<id>"`; a check-in id as itself), keeping `bind` and
    `display`, from `created` (`{block id: tool id}`, the ids a fill created or verified) and the `{"use": id}`
    answers in `choices`.

    Fix round 1 (I2): only an ENABLED slot that is SHOWN now (`journal_styles.slot_wave_off`, the one decider) is
    eligible; a disabled or hidden slot's answer is ignored and its template slot is kept. Every id is validated
    `WHERE id = ? AND user_id = ?` BEFORE anything is written: one that is not the member's live routine (tracker)
    raises ShareError `not_yours` ("That choice isn't in your account.") and nothing is written. A slot that is a
    ref already keeps its ref. Remembering is not an edit of the template: no version moves (so a note stamped with
    the version it was composed from stays current). Runs in the CALLER's transaction and never commits."""
    js = _js()
    if not isinstance(style_id, str) or not style_id or style_id.startswith(js.BUILTIN_PREFIX):
        return
    row = conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                       (style_id, user_id)).fetchone()
    if row is None:
        return
    try:
        blocks = json.loads(row["blocks_json"] or "[]")
    except (TypeError, ValueError):
        return
    made = created if isinstance(created, dict) else {}
    answers = choices if isinstance(choices, dict) else {}
    plan: list[tuple[dict, dict]] = []
    for b in blocks if isinstance(blocks, list) else []:
        if not isinstance(b, dict) or js.slot_family(b.get("block")) not in TOOL_ID_KEYS or not b.get("enabled"):
            continue
        if js.slot_wave_off(b["block"], b.get("settings")):
            continue                                       # hidden now: kept exactly as stored
        s = tool_settings(b)
        if s is None or "ref" in s:
            continue
        family, bid = js.slot_family(b["block"]), b["block"]
        answer = answers.get(bid) if isinstance(answers.get(bid), dict) else {}
        tid = made.get(bid) if isinstance(made.get(bid), str) else answer.get("use")
        if tid is None:
            continue
        _owned_choice(family, user_id, tid, conn)         # raises not_yours before any write
        ref = tid if family == "tracker" and tid in _CHECKINS else f"{family}:{tid}"
        try:
            new = js.slot_settings_of(family, {"ref": ref, "bind": s["bind"], "display": s["display"]})
        except js.StyleValidationError:
            continue
        plan.append((b, new))
    if not plan:
        return
    for b, new in plan:
        b["settings"] = new
    conn.execute("UPDATE j2_journal_styles SET blocks_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                 (json.dumps(blocks), js._now(), style_id, user_id))
