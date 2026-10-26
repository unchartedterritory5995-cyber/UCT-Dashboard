"""Notebook widgets phase 2, wave 11 (Task 11.5): a built-widget template slot, filled when a note is made.

A template (a journal style) holds a `built_<k>` block whose settings name the widget by reference
(ruling W11-R2, reduced by `journal_styles.slot_settings_of`):

* `shelf:<slug>` + `defRev`  a ready-made widget, run at EXACTLY the pinned revision (W10-R5);
* `def:<uuid4>` + `defRev`   the member's own saved widget, resolved at FILL time for the session member
                             only (`widget_definitions.resolve_for_run`, `WHERE id = ? AND user_id = ?`): a
                             foreign, unknown or deleted id is one sentence, never another member's row;
* `inline:<key>`             a definition carried by a shared payload or an official seed, handed in by
                             the caller of a use or an adoption as `ctx["definitions"][key]`.

`build_built_slot` runs the plan through the wave 8 engine (`run.run_plan`, lane `run`) for the session
member and answers the `builtWidget` node the client's insert makes (`builtRefreshParams({}, payload)`).

⛔ The deadlock rule (journal_styles `_SLOT_POOL`): this runs INSIDE a slot pool task and calls `run_plan`
synchronously. `run_plan` takes the engine's own non-blocking admission gate (`run.admit`), never a second
pool, so a slot never waits on another pool's worker. A busy engine (`EngineBusy`, e.g. a template with more
built slots than the member's `run.MEMBER_MAX`) is retried briefly inside the slot budget, then the slot is
its "couldn't load" sentence.

⛔ Live state never enters a note: the node is a snapshot (`mode: "snapshot"`, `share` off), exactly the
shape a member's own insert writes.

The heavy modules are imported at call time (looked up on the module, so a test's patch reaches them), and
`journal_styles` too: it imports this module."""
from __future__ import annotations

import sqlite3
import time
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
FAILED = "widget-failed"
PREVIEW = "widget-preview"
#: How long a slot waits between tries when the engine answers busy.
BUSY_RETRY_S = 0.1


class SlotCtx(TypedDict, total=False):
    """What a slot builder reads. `definitions` is `{key: definition}` for `inline:` refs (set by the caller of
    a use or an adoption, else `{}`); a definition is `{"plan": {...}, "name": ...}` (share_template's entry)
    or a bare plan. `conn` is a connection on the CALLER's thread; a pool task is handed None and opens its
    own (one sqlite connection is never shared across the slot pool's threads)."""
    user_id: str
    now: datetime
    note_day: str | None
    fill_widgets: bool
    definitions: dict
    answers: dict
    choices: dict
    conn: sqlite3.Connection | None


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


def slot_name(block: dict, ctx: dict) -> tuple[str | None, str | None]:
    """(name, None) when the slot's target resolves for the session member, else (None, reason) with reason
    `slot-unreadable` (its settings do not read) or `slot-missing` (the target is not in the account). A
    `def:` name is an owned read (`widget_definitions.get(user_id, ...)`, `WHERE id = ? AND user_id = ?`)."""
    s = clean_settings(block)
    if s is None:
        return None, UNREADABLE
    ref = s["ref"]
    if ref.startswith("shelf:"):
        entry = _shelf().revision(ref, s["defRev"])
        return (entry["name"], None) if entry else (None, MISSING)
    if ref.startswith("def:"):
        uid = ctx.get("user_id")
        if not isinstance(uid, str) or not uid:
            return None, MISSING
        got = _wd().get(uid, ref[len("def:"):], conn=ctx.get("conn"))
        name = got.get("name") if isinstance(got, dict) else None
        return (name, None) if isinstance(name, str) and name.strip() else (None, MISSING)
    plan, name = _inline_entry(ctx, ref[len("inline:"):])
    if plan is None:
        return None, MISSING
    return (name, None) if name else (DEFAULT_TITLE, None)


def slot_title(block: dict, ctx: dict) -> str:
    """The widget's name for a sentence: a shelf entry's name, an inline definition's `name`, the member's
    definition's name (owned read), else "Widget"."""
    name, _ = slot_name(block, ctx)
    return name or DEFAULT_TITLE


def _dark(plan: Any) -> bool:
    """Does the plan need a release wave that is off now (`uses_tools` and wave 9 off, `uses_wave10` and wave 10
    off)? Such a slot is dropped with no node and no line, as `_slot_wave_off` drops a pinned shelf one."""
    p = _plan_mod()
    return bool((p.uses_tools(plan) and not _wave_on(9)) or (p.uses_wave10(plan) and not _wave_on(10)))


def _shelf_latest(ref: str) -> int | None:
    """The newest revision the flags allow (the router's `_shelf_allowed` rule), for the payload's `latestRev`."""
    p = _plan_mod()
    w9, w10 = _wave_on(9), _wave_on(10)

    def allowed(plan: Any) -> bool:
        return not (p.uses_tools(plan) and not w9) and not (p.uses_wave10(plan) and not w10)
    return _shelf().latest_rev(ref, allowed=allowed)


def refresh_params(old: Any, payload: Any) -> dict:
    """The client's `builtRefreshParams(old, payload)` (lib/builtWidgets.js), twinned through
    tests/fixtures/builtRefreshParamsVectors.json: the payload's keys and the CURRENT `share` switch (a fill
    publishes nothing, so `share` is False). Nothing else is copied from `old`."""
    prev = old if isinstance(old, dict) else {}
    return {**(payload if isinstance(payload, dict) else {}), "share": prev.get("share") is True}


def node_for(payload: dict) -> dict:
    """The `builtWidget` snapshot node for a run payload: the shape the client's insert writes."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": BUILT_KIND, "embedId": uuid.uuid4().hex, "mode": "snapshot",
        "params": refresh_params({}, payload), "capturedAt": payload.get("asOf"),
        "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None,
    }}


def build_built_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """(node, None), or (None, reason) for one sentence, or (None, None) to drop the slot silently (its plan
    needs a dark wave). Reasons, each suffixed `:<block id>`: `slot-unreadable` (the settings do not read),
    `slot-missing` (the target is not in the member's account), `widget-failed` (the run raised or the engine
    stayed busy), `widget-preview` (a preview reads nothing)."""
    bid = block.get("block") if isinstance(block, dict) else None
    s = clean_settings(block)
    if s is None:
        return None, f"{UNREADABLE}:{bid}"
    if not ctx.get("fill_widgets", True):
        return None, f"{PREVIEW}:{bid}"
    uid = ctx.get("user_id")
    if not isinstance(uid, str) or not uid:
        return None, f"{MISSING}:{bid}"
    ref = s["ref"]
    if ref.startswith("shelf:"):
        entry = _shelf().revision(ref, s["defRev"])
        if entry is None:
            return None, f"{MISSING}:{bid}"
        plan, def_id, def_rev, latest = entry["plan"], ref, entry["rev"], _shelf_latest(ref)
    elif ref.startswith("def:"):
        def_id = ref[len("def:"):]
        plan, def_rev, latest = _wd().resolve_for_run(uid, def_id, s["defRev"], conn=ctx.get("conn"))
        if plan is None:
            return None, f"{MISSING}:{bid}"
    else:
        plan, _ = _inline_entry(ctx, ref[len("inline:"):])
        if plan is None:
            return None, f"{MISSING}:{bid}"
        def_id = def_rev = latest = None
    if _dark(plan):
        return None, None
    settings = {"range": dict(s["range"])} if "range" in s else {}
    run = _run()
    js = _js()
    deadline = time.monotonic() + js.SLOT_BUDGET_S
    while True:
        try:
            payload = run.run_plan(uid, plan, settings, lane="run", def_id=def_id, def_rev=def_rev,
                                   latest_rev=latest, now=ctx.get("now"))
            break
        except run.EngineBusy:
            if time.monotonic() + BUSY_RETRY_S >= deadline:
                return None, f"{FAILED}:{bid}"
            time.sleep(BUSY_RETRY_S)
        except Exception as e:  # noqa: BLE001 -- a slot that cannot load is a sentence, never a failed note
            js._log.warning("built slot %s not filled: %s", bid, type(e).__name__)
            return None, f"{FAILED}:{bid}"
    if not isinstance(payload, dict) or not isinstance(payload.get("asOf"), str):
        return None, f"{FAILED}:{bid}"
    return node_for(payload), None
