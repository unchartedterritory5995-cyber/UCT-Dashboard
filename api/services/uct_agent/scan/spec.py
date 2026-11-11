"""SC-1 §3 — the scan spec IS the screener's own JSON spec, checked against its field catalog.

There is no Agent filter language. This module only refuses what the screener's catalog does not
know (a key, a sort column, a view, a requested column), bounds the size of what a model can ask for,
and pins the paging the Agent may use (page 1, at most ROW_CAP rows). Everything else — operators,
values, logic trees, ranks — is the screener service's own validation (`query.build_scan_sql` raises
ValueError with a sentence), which the adapter surfaces unchanged as a refusal.

Owner: agent-sc.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from api.services.uct_agent.scan import hidden

#: SC-1 §2 / MD-1 §5 — a scan returns at most 50 rows.
ROW_CAP = 50
#: Size bounds on what a model can hand the screener in one spec.
MAX_FILTERS = 25
MAX_LOGIC_LEAVES = 40
MAX_COLUMNS = 20
MAX_SPEC_BYTES = 8000

#: Filter keys that are scopes / joins, not catalog fields (query.py `_SCOPE_KEYS`, `_ARITH_KEY`).
SPECIAL_KEYS = frozenset({"list", "universe", "tickers", "arith"})
#: Indicator-condition keys: `scan` joins nightly definition results by def_hash (query.py `_scan_clauses`).
#: Out of scope for SC-1 in Sprint 1 (agent-lead ruling 2026-11-01): refused, never approximated. A later
#: SC-1 version adds one kind that delegates to Indicators' IC-1 exactly as IC-1 specifies.
INDICATOR_KEYS = frozenset({"scan"})
INDICATOR_REFUSAL = ("indicator-condition scans (crosses, custom or saved indicators) aren't available to the "
                     "Agent yet; only Screener field filters can be scanned")
#: Spec keys the screener's own ScanSpec model accepts (api/routers/screener.py `ScanSpec`), minus paging.
SPEC_KEYS = frozenset({"filters", "sort", "view", "columns", "rank", "logic"})
#: SC-1 §2d (owner decision, agent-lead ruling): the order when none is asked for. Never a rating.
DEFAULT_SORT = {"key": "market_cap", "dir": "desc"}
DEFAULT_ORDER_NOTE = "Ordered by market cap, largest first (no other order was asked for)."


class SpecError(ValueError):
    """A spec the Agent refuses before the screener sees it. The message is shown to the member."""


def catalog_keys() -> frozenset:
    """The live filter registry's keys (`filters.field_catalog`, the same list `/api/screener/fields` serves)."""
    from api.services.screener import filters
    return frozenset(f["key"] for f in filters.field_catalog())


def column_keys() -> frozenset:
    from api.services.screener import snapshot_db
    return frozenset(snapshot_db.COLUMNS)


def view_names() -> frozenset:
    from api.services.screener import filters
    return frozenset(filters.VIEWS)


def view_columns(view: str) -> list:
    from api.services.screener import filters
    v = filters.VIEWS.get(view) or {}
    return list(v.get("columns") or []) if isinstance(v, dict) else list(v or [])


def _arith_fields(e: Any, depth: int = 0) -> list:
    """The field keys an arithmetic term names (query._arith_sql's shape: {f} | {n} | {o, a, b})."""
    if depth > 16 or not isinstance(e, dict):
        return []
    if "f" in e:
        return [e["f"]] if isinstance(e["f"], str) else []
    return _arith_fields(e.get("a"), depth + 1) + _arith_fields(e.get("b"), depth + 1)


def named_fields(spec: Any, depth: int = 0) -> list:
    """Every field name a spec carries, in any shape: a `key`, `other`, `f` or `column` string at any depth, the
    `columns` list, and the columns of a named `view`. No validation; a listing uses it to decide whether a spec
    that failed validation for ANY reason still names a hidden field (screen.saved nulls it then)."""
    if depth > 24:
        return []
    if isinstance(spec, list):
        return [n for x in spec for n in named_fields(x, depth + 1)]
    if not isinstance(spec, dict):
        return []
    out = [spec[k] for k in ("key", "other", "f", "column") if isinstance(spec.get(k), str)]
    if depth == 0:
        if isinstance(spec.get("columns"), list):
            out += [c for c in spec["columns"] if isinstance(c, str)]
        if isinstance(spec.get("view"), str):
            out += view_columns(spec["view"])
    return out + [n for v in spec.values() for n in named_fields(v, depth + 1)]


def _leaves(spec: dict) -> list:
    leaves = list(spec.get("filters") or [])
    if spec.get("logic"):
        from api.services.screener import logic
        try:
            leaves += logic.leaves(spec["logic"])
        except Exception as e:  # noqa: BLE001 — a malformed tree is the member's spec, not our crash
            raise SpecError(f"the logic tree is not a valid screener tree ({type(e).__name__})") from e
    return leaves


def validate(spec: Any, *, catalog: frozenset | None = None, columns: frozenset | None = None,
             views: frozenset | None = None) -> dict:
    """Return a normalised copy of `spec` ready for `query.run_scan` / `preview_count`, or raise SpecError.

    The copy keeps only ScanSpec's own keys; `page`/`page_size` are set by the adapter, never the caller."""
    if not isinstance(spec, dict):
        raise SpecError("the scan spec must be a screener spec object ({filters, sort, view, columns, rank, logic})")
    try:
        size = len(json.dumps(spec, default=str))
    except (TypeError, ValueError) as e:
        raise SpecError("the scan spec is not plain JSON") from e
    if size > MAX_SPEC_BYTES:
        raise SpecError(f"the scan spec is too large (at most {MAX_SPEC_BYTES} characters)")
    unknown_top = sorted(set(spec) - SPEC_KEYS - {"page", "page_size", "limit"})
    if unknown_top:
        raise SpecError(f"the screener spec has no field {unknown_top[0]!r}")

    catalog = catalog if catalog is not None else catalog_keys()
    columns = columns if columns is not None else column_keys()
    views = views if views is not None else view_names()

    filters_ = spec.get("filters") or []
    if not isinstance(filters_, list) or not all(isinstance(f, dict) for f in filters_):
        raise SpecError("`filters` must be a list of screener filters")
    if len(filters_) > MAX_FILTERS:
        raise SpecError(f"at most {MAX_FILTERS} filters in one scan")
    if spec.get("logic") is not None and not isinstance(spec["logic"], dict):
        raise SpecError("`logic` must be a screener logic tree")
    leaves = _leaves(spec)
    # F-16: a hidden name ANYWHERE in the tree or the rank, even where the engine would not read it, is refused
    if hidden.refusal_for(named_fields({"logic": spec.get("logic"), "rank": spec.get("rank")})):
        raise SpecError(hidden.refusal_for(named_fields({"logic": spec.get("logic"), "rank": spec.get("rank")})))
    if len(leaves) - len(filters_) > MAX_LOGIC_LEAVES:
        raise SpecError(f"at most {MAX_LOGIC_LEAVES} conditions in the logic tree")
    for f in leaves:
        key = f.get("key")
        if not isinstance(key, str) or not key:
            raise SpecError("every filter names a screener field (`key`)")
        if key in INDICATOR_KEYS:
            raise SpecError(INDICATOR_REFUSAL)
        if key == "arith":
            # an arithmetic filter names fields inside its terms ({"f": key}); a hidden one is refused like any
            # other use (a rating times 1 is still the rating)
            refusal = hidden.refusal_for(_arith_fields(f.get("lhs")) + _arith_fields(f.get("rhs")))
            if refusal:
                raise SpecError(refusal)
            continue
        if key in SPECIAL_KEYS:
            continue
        other = f.get("other")
        if other is not None and not isinstance(other, str):
            raise SpecError("a compared field (`other`) is one screener field's key")
        refusal = hidden.refusal_for([key, other])
        if refusal:                                   # SC-1 §2d: refused, never dropped or substituted
            raise SpecError(refusal)
        if key not in catalog:
            raise SpecError(f"the Screener has no field {key!r}")
        if other is not None and other not in catalog:
            raise SpecError(f"the Screener has no field {other!r}")

    sort = spec.get("sort")
    if sort is not None:
        if not isinstance(sort, dict) or not isinstance(sort.get("key"), str):
            raise SpecError("`sort` must be {key, dir}")
        if hidden.refusal_for([sort["key"]]):
            raise SpecError(hidden.refusal_for([sort["key"]]))
        if sort["key"] not in catalog and sort["key"] not in hidden.IDENTITY_COLUMNS:
            # SC-1 §2d: only the catalog's own fields, never a raw snapshot column (33 exist outside the catalog,
            # among them UCT research-archive and base-detector internals that no hidden list names)
            raise SpecError(f"the Screener cannot sort by {sort['key']!r}")
        if sort.get("dir") not in (None, "asc", "desc"):
            raise SpecError("`sort.dir` is asc or desc")

    view = spec.get("view", "overview")
    if not isinstance(view, str) or view not in views:
        raise SpecError(f"the Screener has no view {view!r}")
    if "view" in spec:
        # SC-1 §2d: a view ASKED FOR by name that shows hidden columns (uct_ratings, flow, patterns...) is refused;
        # the default view's hidden columns are dropped from the rows instead, and the receipt says so (screen.run)
        refusal = hidden.refusal_for(view_columns(view))
        if refusal:
            raise SpecError(refusal)

    cols = spec.get("columns")
    if cols is not None:
        if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
            raise SpecError("`columns` must be a list of screener columns")
        if len(cols) > MAX_COLUMNS:
            raise SpecError(f"at most {MAX_COLUMNS} columns")
        if hidden.refusal_for(cols):
            raise SpecError(hidden.refusal_for(cols))
        bad = [c for c in cols if c not in columns or (c not in catalog and c not in hidden.IDENTITY_COLUMNS)]
        if bad:
            raise SpecError(f"the Screener has no column {bad[0]!r}")

    rank = spec.get("rank")
    if rank is not None and not isinstance(rank, dict):
        raise SpecError("`rank` must be a screener rank object")
    if isinstance(rank, dict):
        # The screener's ranking reads each criterion's `key` (screener/ranking.py) and resolves the column itself;
        # a `column` on the request is ignored there. BOTH are checked here, so neither shape can name a hidden
        # field (a public `column` beside a hidden `key` once rode through — agent-int review of W1-SEC #704).
        criteria = rank.get("criteria") or []
        if not isinstance(criteria, list) or not all(isinstance(c, dict) for c in criteria):
            raise SpecError("`rank.criteria` must be a list of {key, weight} objects")
        named = [c[k] for c in criteria for k in ("key", "column") if isinstance(c.get(k), str)]
        if hidden.refusal_for(named):
            raise SpecError(hidden.refusal_for(named))
        for c in criteria:
            key = c.get("key")
            if not isinstance(key, str) or not key:
                raise SpecError("every rank criterion names a screener field (`key`)")
            if key not in catalog:
                raise SpecError(f"the Screener has no field {key!r} to rank by")
            col = c.get("column")
            if col is not None and (not isinstance(col, str) or (col not in catalog and col not in hidden.IDENTITY_COLUMNS)):
                raise SpecError(f"the Screener has no field {col!r} to rank by")

    out = {k: spec[k] for k in SPEC_KEYS if k in spec and spec[k] is not None}
    out.setdefault("filters", [])
    out["view"] = view
    # SC-1 §2d: never the screener's own default order (UCT Composite, a proprietary rating). With no order
    # asked for, the Agent's screens are ordered by market cap, largest first, and the receipt says so.
    if "sort" not in out and not out.get("rank"):
        out["sort"] = dict(DEFAULT_SORT)
    return out


def logic_refusal(checked: dict) -> Optional[str]:
    """The engine's own sentence for a tree on a server that has groups off, else None. Said before admission, a tree
    that could never run spends none of the turn's budget. `query.build_scan_sql` still refuses on its own."""
    if checked.get("logic"):
        from api.services.screener import logic
        if not logic.is_enabled():
            return logic.DISABLED_SENTENCE
    return None


def precheck(params: Any) -> Optional[str]:
    """The gateway's pre-admission hook (`Kind.validate`): None, or the sentence refusing the request.
    A refusal here spends none of the turn's budget. The adapter re-validates after admission
    (defence in depth); an admitted request that the screener then refuses has spent its scan."""
    p = params if isinstance(params, dict) else {}
    try:
        checked = validate(p.get("spec"))
    except SpecError as e:
        return str(e)
    return logic_refusal(checked)


def row_limit(spec: Any) -> int:
    """The rows the caller asked for (`limit`, else `page_size`), clamped to 1..ROW_CAP."""
    raw = None
    if isinstance(spec, dict):
        raw = spec.get("limit", spec.get("page_size"))
    try:
        n = int(raw) if raw is not None else ROW_CAP
    except (TypeError, ValueError):
        n = ROW_CAP
    return max(1, min(ROW_CAP, n))
