"""Where a scan's spec comes from (SC-1 §3) — owner: agent-sc. Exactly one of:

* `spec`      the screener's own JSON spec, as given;
* `saved_id`  one of THE MEMBER'S OWN saved screens (`saved_screens.get(id, user_id)` — the service's
              own member-scoped read: another member's id answers "not found", never their spec);
* `text`      the screener's criteria language, through the SAME deterministic path as
              `/api/screener/grammar/parse`: `grammar.compile_text` → `logic.validate` →
              `grammar.resolve_scopes` (scopes resolved for THIS member only). No model call, no second
              parser, no Agent filter language.

⛔ `/api/screener/compile` (English → criteria via `nl_compile.compile_english`) is NOT used: it is a paid
model call with its own daily cap, and the Agent's model-call count and budgets are not ours to change.
The Agent's own planner writes criteria text; the screener parses it.

Every source then goes through `spec.validate` (the field catalog) like a hand-written spec.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Optional

from api.services.uct_agent.scan import spec as scan_spec

MAX_TEXT = 600                      # the same bound the screener's own NL entry uses (nl_compile.MAX_ENGLISH)
_SOURCES = ("spec", "saved_id", "text")


def _saved_screens():
    from api.services.screener import saved_screens
    return saved_screens


def read_saved(user_id: Any, screen_id: Optional[int] = None):
    """The member's own saved screens (or one), read-only. Never `init()` — that is a CREATE TABLE; a pod
    whose table does not exist yet simply has no saved screens."""
    ss = _saved_screens()
    try:
        if screen_id is None:
            return ss.list_for(user_id)
        return ss.get(screen_id, user_id)
    except sqlite3.OperationalError as e:
        if "no such table" in str(e):
            return [] if screen_id is None else None
        raise


def _which(params: dict) -> str:
    given = [k for k in _SOURCES if params.get(k) not in (None, "")]
    if len(given) != 1:
        raise scan_spec.SpecError("give exactly one of a screener spec, a saved screen id, or criteria text")
    return given[0]


def precheck(params: Any) -> Optional[str]:
    """The gateway's pre-admission hook (`Kind.validate`), so a refusal here spends nothing. It checks
    only what needs no member data: one source, a hand-written spec against the field catalog, a numeric
    id, and the text bounds. Whether a saved id is THIS member's, and whether the text parses, are known
    only after admission, so those attempts spend the scan."""
    p = params if isinstance(params, dict) else {}
    try:
        src = _which(p)
        if src == "spec":
            scan_spec.validate(p["spec"])
        elif src == "saved_id":
            try:
                int(p["saved_id"])
            except (TypeError, ValueError):
                raise scan_spec.SpecError("a saved screen id is a number") from None
        else:
            t = p["text"]
            if not isinstance(t, str) or not t.strip():
                raise scan_spec.SpecError("criteria text is required")
            if len(t) > MAX_TEXT:
                raise scan_spec.SpecError(f"criteria text is at most {MAX_TEXT} characters")
    except scan_spec.SpecError as e:
        return str(e)
    return None


def resolve(params: dict, user_id: Any) -> tuple[dict, dict]:
    """(validated spec, provenance) or SpecError. Provenance says where the spec came from, so the member
    sees it: `{"source": "spec"}`, `{"source": "saved", "id", "name"}` or `{"source": "text", "text",
    "explanation"}`."""
    src = _which(params)
    if src == "spec":
        return scan_spec.validate(params["spec"]), {"source": "spec"}

    if src == "saved_id":
        try:
            sid = int(params["saved_id"])
        except (TypeError, ValueError):
            raise scan_spec.SpecError("a saved screen id is a number") from None
        rec = read_saved(user_id, sid)
        if not rec:
            raise scan_spec.SpecError("you have no saved screen with that id")
        return scan_spec.validate(rec.get("spec")), {"source": "saved", "id": rec.get("id"), "name": rec.get("name")}

    text = params["text"]
    if not isinstance(text, str) or not text.strip():
        raise scan_spec.SpecError("criteria text is required")
    if len(text) > MAX_TEXT:
        raise scan_spec.SpecError(f"criteria text is at most {MAX_TEXT} characters")
    from api.services.screener import grammar, logic
    if not logic.is_enabled():
        # the screener's own gate on criteria text (`/grammar/parse` is 404 while it is off)
        raise scan_spec.SpecError("the Screener's criteria language is off on this server")
    try:
        out = grammar.compile_text(text)
        node = out["logic"]
        if node is not None:
            logic.validate(node)
        scope_filters = grammar.resolve_scopes(out["subjects"], user_id)
    except ValueError as e:              # GrammarError is a ValueError, with a sentence saying where and why
        raise scan_spec.SpecError(f"the Screener could not read those criteria: {e}") from None
    built: dict = {"filters": list(scope_filters)}
    if node is not None:
        built["logic"] = node
    for k in ("sort", "view", "columns", "rank"):
        if params.get(k) is not None:
            built[k] = params[k]
    explanation = [line["text"] for line in grammar.explain(node)] if node is not None else []
    return scan_spec.validate(built), {"source": "text", "text": text, "explanation": explanation}
