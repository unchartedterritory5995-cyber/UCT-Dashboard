"""SC-2 §3 refinement state (W1-C C-01, builder-c): the member's LAST SCREEN, persisted per conversation, and the
rules a follow-up composes onto it.

The browser (capabilities/screener.js) runs screens and refines them; what this module adds is the server side of
"after a reload, 'now only technology' still composes onto the last screen":

* `validate_last_screen(value)` — the shape the store accepts for key `lastScreen` (store.set_state), checked
  against the screener's field catalog through `spec.validate` (an unknown key is refused), with the result ids
  bounded to ROW_CAP tickers. The browser's local-only measure conditions (`post`, capabilities/sessionMeasures.js)
  are kept by shape only: they are not catalog keys.
* F-16: a stored or composed spec may never name a hidden UCT field. The refusal is the owner's sentence
  (`RATINGS_REFUSAL` / `FLOW_REFUSAL`, identical to scan/hidden.py's) PLUS one PUBLIC alternative. The alternative
  names a public field only — never a formula, a weight or an input-by-input reconstruction (F-16-R, owner decision
  2026-11-02): "strength"-type hidden fields offer the 3-month change, "setup"-type ones the distance from the
  52-week high, flow fields the volume-vs-30-day ratio.
* `compose(last, delta)` — the SC-2 §3 deltas as a pure function over wire specs (add/narrow replace by key,
  replace_universe swaps the sector/industry slot, sort replaces only the sort, remove drops named keys, show changes
  the row count). The browser mirrors these rules in capabilities/scanRefine.js; `tests/test_uct_agent_scan_refine.py`
  pins both the rules and the sentence.

The hidden set and the two refusal sentences are scan/hidden.py's (W1-SEC, #704): one authority, never a copy.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from api.services.uct_agent.scan import spec as scan_spec

STATE_KEY = "lastScreen"
ROW_CAP = scan_spec.ROW_CAP
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,11}$")
_OPS = frozenset({"gt", "gte", "lt", "lte", "eq", "between", "in", "not_in", "contains",
                  "gt_col", "gte_col", "lt_col", "lte_col"})
UNIVERSE_KEYS = frozenset({"sector", "industry"})

from api.services.uct_agent.scan import hidden

RATINGS_REFUSAL = hidden.RATINGS_REFUSAL
FLOW_REFUSAL = hidden.FLOW_REFUSAL
_SETUP_KEYS = frozenset({"candle_score", "earnings_setup_grade", "pattern_engine_id", "pattern_engine_conf",
                         "pattern_engine_dir", "pattern_engine_vcp", "pattern_engine_flat_base", "pattern_expectancy_r",
                         "pattern_entry_dist_pct", "pattern_stop_dist_pct", "base_structure", "base_relation_count",
                         "base_pivot_px", "hvc_52w"})

#: the PUBLIC alternatives (key, member label). Two for ratings/strength/setup, one for flow — never a formula input map.
ALT_STRENGTH = ("chg_pct_3m", "3-month price change")
ALT_SETUP = ("dist_52w_high_pct", "distance from the 52-week high")
ALT_FLOW = ("vol_ratio", "volume vs its 30-day average")


class RefineError(ValueError):
    """A refinement the Agent refuses; the message is shown to the member."""


def hidden_keys() -> frozenset:
    """scan/hidden.py's set (ratings + owner-named proprietary + flow): the one authority."""
    return frozenset(hidden.hidden_keys())


def is_flow(key: str) -> bool:
    return key in hidden.flow_keys()


def public_alternative(key: str) -> dict:
    """{key, label} — one public field a member can use instead of the hidden `key`."""
    k, label = ALT_FLOW if is_flow(key) else ALT_SETUP if key in _SETUP_KEYS else ALT_STRENGTH
    return {"key": k, "label": label}


def refusal_for(keys: Iterable[str]) -> Optional[str]:
    """The F-16 sentence for the first hidden key among `keys`, with one public alternative, else None."""
    hid = hidden_keys()
    for k in keys:
        if k in hid:
            alt = public_alternative(k)
            base = FLOW_REFUSAL if is_flow(k) else RATINGS_REFUSAL
            return f"{base}. A public alternative: {alt['label']} ({alt['key']})."
    return None


def refusal_for_text(text: Any) -> Optional[str]:
    """W1.1 R-05 (live LT-8): the F-16 sentence + the public alternative when the member's own WORDS name a hidden
    field ("rs rank", "uct composite", "dark pool"…) — checked BEFORE any catalog or look-alike matching, so a
    hidden field is never re-mapped to a public look-alike (rs_rank → rs_line_trend) and run in its place. None when
    no hidden phrase is present. The phrase list is scan/hidden.py's (one authority; mirrored to scanHidden.js)."""
    hit = hidden.hidden_phrase_in(text)
    return refusal_for([hit[0]]) if hit else None


# ── the stored shape ───────────────────────────────────────────────────────────────────────────────────────────────

def _filter_keys(filters: Any) -> list:
    return [f.get("key") for f in filters if isinstance(f, dict)] if isinstance(filters, list) else []


#: a `list` filter's display label (the watchlist's name, capabilities/screener.js describeFilter) is the only label
#: kept, capped; every other browser-side decoration (`pending`, a label on a catalog filter) is dropped before storage
LABEL_MAX = 60


def _check_filters(filters: Any, what: str) -> list:
    if not isinstance(filters, list) or not all(isinstance(f, dict) for f in filters):
        raise RefineError(f"`{what}` must be a list of screener filters")
    out = []
    for f in filters:
        if not isinstance(f.get("key"), str) or not f["key"]:
            raise RefineError(f"every {what} filter names a field (`key`)")
        if f.get("op") not in _OPS:
            raise RefineError(f"`{f['key']}` has no comparison the Screener knows")
        clean = {k: v for k, v in f.items() if k not in ("pending", "label")}
        if f["key"] == "list" and isinstance(f.get("label"), str) and f["label"]:
            clean["label"] = f["label"][:LABEL_MAX]
        out.append(clean)
    return out


def validate_last_screen(value: Any) -> dict:
    """The normalised `lastScreen` record or RefineError: {spec: {filters, post, sort}, symbols, total, asOf,
    name, savedId}. The catalog filters pass `spec.validate`; a hidden key is refused with the F-16 sentence."""
    if not isinstance(value, dict):
        raise RefineError("the last screen must be an object")
    spec = value.get("spec")
    if not isinstance(spec, dict):
        raise RefineError("the last screen needs a `spec`")
    filters = _check_filters(spec.get("filters") or [], "filters")
    post = _check_filters(spec.get("post") or [], "post")
    sort = spec.get("sort")
    if sort is not None and (not isinstance(sort, dict) or not isinstance(sort.get("key"), str)):
        raise RefineError("`sort` must be {key, dir}")
    logic, rank = spec.get("logic") or None, spec.get("rank") or None
    # every name the record carries, in every shape: a compared field, a leaf of the group, a rank measure
    keys = (_filter_keys(filters) + _filter_keys(post) + ([sort["key"]] if sort else [])
            + scan_spec.named_fields({"filters": filters, "logic": logic, "rank": rank}))
    why = refusal_for(keys)
    if why:
        raise RefineError(why)
    try:
        # the catalog decides what a filter key is; `list` / `universe` scopes pass as the screener's own specials
        checked = scan_spec.validate({"filters": [{k: v for k, v in f.items() if k != "label"} for f in filters],
                                      **({"sort": sort} if sort else {}), **({"logic": logic} if logic else {}),
                                      **({"rank": rank} if rank else {})})
    except scan_spec.SpecError as e:
        raise RefineError(str(e)) from None
    syms = value.get("symbols") or []
    if not isinstance(syms, list) or not all(isinstance(s, str) and _SYMBOL_RE.match(s) for s in syms):
        raise RefineError("`symbols` must be a list of tickers")
    if len(syms) > ROW_CAP:
        raise RefineError(f"at most {ROW_CAP} result ids are kept")
    total = value.get("total")
    if total is not None and (not isinstance(total, int) or isinstance(total, bool) or total < 0):
        raise RefineError("`total` must be a count")
    # ⛔ the group and the rank are the screen: stored without them, a restored spec would refine a LOOSER screen
    out = {"spec": {"filters": filters, "post": post, "sort": checked.get("sort") if sort else None,
                    **({"logic": logic} if logic else {}), **({"rank": rank} if rank else {})},
           "symbols": syms, "total": total, "asOf": value.get("asOf") if isinstance(value.get("asOf"), str) else None,
           "name": value.get("name") if isinstance(value.get("name"), str) else None,
           "savedId": str(value["savedId"]) if value.get("savedId") not in (None, "") else None}
    for k in ("asOf", "name", "savedId"):
        if out[k] is not None and len(out[k]) > 120:
            raise RefineError(f"`{k}` is too long")
    return out


# ── SC-2 §3: composing a follow-up onto the last spec ──────────────────────────────────────────────────────────────

def compose(last: dict, delta: dict) -> dict:
    """A new {filters, post, sort, show?} from `last` and the SC-2 §3 delta
    {add: [wire filters], post: [measure filters], universe: [list filters on sector/industry], remove: [keys],
     sort: {key, dir} | None, logic: tree | None, rank: {criteria} | None, show: int | None}. Pure; raises RefineError
    for a hidden key or a `remove` of a key the last screen does not have. A group stays: a new one is ANDed onto it, so
    a refinement narrows it and never loses it. One order at a time: a sort clears a rank, a rank clears the sort."""
    last = last or {}
    filters = [dict(f) for f in (last.get("filters") or []) if isinstance(f, dict)]
    post = [dict(f) for f in (last.get("post") or []) if isinstance(f, dict)]
    sort = dict(last["sort"]) if isinstance(last.get("sort"), dict) else None
    delta = delta or {}
    add = _check_filters(delta.get("add") or [], "add")
    add_post = _check_filters(delta.get("post") or [], "post")
    universe = _check_filters(delta.get("universe") or [], "universe")
    new_sort = delta.get("sort")
    new_logic, new_rank = delta.get("logic") or None, delta.get("rank") or None
    keys = (_filter_keys(add) + _filter_keys(add_post) + _filter_keys(universe)
            + ([new_sort["key"]] if isinstance(new_sort, dict) else [])
            + scan_spec.named_fields({"filters": add, "logic": new_logic, "rank": new_rank}))
    why = refusal_for(keys)
    if why:
        raise RefineError(why)
    for key in delta.get("remove") or []:
        if key not in _filter_keys(filters) + _filter_keys(post):
            raise RefineError(f"Your last screen has no {key} filter")
        filters = [f for f in filters if f.get("key") != key]
        post = [f for f in post if f.get("key") != key]
    if universe:                                               # replace_universe: the sector/industry slot as a whole
        bad = [f["key"] for f in universe if f["key"] not in UNIVERSE_KEYS]
        if bad:
            raise RefineError(f"{bad[0]} is not a universe field (sector or industry)")
        filters = [f for f in filters if f.get("key") not in UNIVERSE_KEYS] + universe
    mine = {f["key"] for f in add} | {f["key"] for f in add_post}
    filters = [f for f in filters if f.get("key") not in mine] + add       # add / narrow: replace by key
    post = [f for f in post if f.get("key") not in mine] + add_post
    rank = last.get("rank") or None
    if isinstance(new_sort, dict) and isinstance(new_sort.get("key"), str):
        sort = {"key": new_sort["key"], "dir": "asc" if new_sort.get("dir") == "asc" else "desc"}
        rank = None
    if new_rank:
        rank, sort = new_rank, None
    logic = last.get("logic") or None
    logic = {"all": [logic, new_logic]} if logic and new_logic else (new_logic or logic)
    out = {"filters": filters, "post": post, "sort": sort}
    if logic:
        out["logic"] = logic
    if rank:
        out["rank"] = rank
    if delta.get("show") is not None:
        try:
            out["show"] = max(1, min(ROW_CAP, int(delta["show"])))
        except (TypeError, ValueError):
            raise RefineError("`show` must be a number of rows") from None
    return out
