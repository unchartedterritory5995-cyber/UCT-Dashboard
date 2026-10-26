"""Notebook widgets phase 2, wave 11 (Task 11.5): a built-widget template slot, filled when a note is made.

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
from datetime import datetime
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
