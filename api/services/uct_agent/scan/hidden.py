"""Screener fields the Agent never reaches (owner decision, Sprint 2: F-16 + flow). Owner: agent-sc. SC-1 §2d.

Hidden means: not in any catalog the planner sees, never a filter, logic leaf, sort, rank criterion or requested
column, never a value in a returned row, never a saved screen the Agent runs. A spec that names one is REFUSED with
a sentence saying why, before any read (`spec.validate` -> the gateway's pre-admission hook, so it spends nothing).
Never silently dropped, never substituted. The member-facing Screener page is not touched: this is the Agent's view.

ONE AUTHORITY, DERIVED where it can be:
  * RATINGS: every column `screener/enrich.ratings_fields()` writes under a CONSTANT name (read by AST, so a rating
    column added there tomorrow is hidden the day it lands; its variable-name passthroughs, the raw vendor fundamentals
    eps_growth / rev_growth / pe_fwd / sector, are not ratings and stay), plus the owner-named RS pair (rs_rank, a
    percentile of rs_return; agent-lead ruling: both hide).
  * FLOW: every catalog field whose category is "flow" (dark pool + options flow), read from the live catalog.
  * PROPRIETARY: the other UCT-computed scores and signals (owner F-16 final ruling): candle_score,
    earnings_setup_grade, in_uct20 and every pattern-engine field. EXPLICIT names, each with a comment, because no
    metadata marks them (see OWNER_NAMED_PROPRIETARY). They are refused with the ratings sentence.
  * EXTRA: further owner rulings, one line each.
The browser mirror is app/src/agent/capabilities/scanHidden.js, generated from this module (`--write`) and pinned by
tests/test_uct_agent_scan_hidden.py.

    python -m api.services.uct_agent.scan.hidden --write
"""
from __future__ import annotations

import ast
import functools
import json
import sys
from pathlib import Path
from typing import Iterable, Optional

RATINGS_REFUSAL = ("UCT Agent can't screen on UCT's proprietary ratings and scores. You can use them on the Screener page")
FLOW_REFUSAL = ("UCT Agent can't screen on options-flow or dark-pool data. You can use it on the Screener page")

#: owner-named, not written by enrich: rs_rank (RS Rank) and the return it is a percentile of (agent-lead ruling)
OWNER_NAMED_RATINGS = frozenset({"rs_rank", "rs_return"})
#: OWNER F-16 FINAL RULING: other UCT-computed proprietary scores and signals. ⛔ EXPLICIT NAMES, because NO metadata
#: marks them: the catalog carries only key/label/type/unit/category, and their producer modules also produce ordinary
#: technicals (setup_score.py also writes ema20_rising; context_joins.py also writes index_sp500; live_tier.py also
#: writes price). Proposed to agent-lead: a `proprietary` tag on the field catalog (screener/filters.py, the Screener
#: workstream's file); this set is then derived from it and these lines go.
OWNER_NAMED_PROPRIETARY = frozenset({
    "candle_score",            # "Setup Score" (screener/setup_score.py), a UCT score
    "earnings_setup_grade",    # "Earnings Setup Grade" (screener/earnings_context.py), a UCT grade
    "in_uct20",                # "In UCT 20" (screener/context_joins.py), UCT's own list
    "archive_calls_n",         # UCT's internal research archive (owner F-16 follow-up: proprietary)
    "base_structure", "base_relation_count", "base_pivot_px",   # UCT's base detector (screener/base_*.py), owner decision
    "hvc_52w",                 # "HVC", UCT's own construct and terminology, owner decision: proprietary
    "theme",                   # "UCT Theme", UCT's theme taxonomy, owner decision: protected pending an exposure review
    # every pattern-engine score and signal (screener/pattern_join.py + the live tier's entry/stop distances)
    "pattern_engine_id", "pattern_engine_conf", "pattern_engine_dir", "pattern_engine_vcp", "pattern_engine_flat_base",
    "pattern_expectancy_r", "pattern_entry_dist_pct", "pattern_stop_dist_pct",
})
#: the only non-catalog columns the Agent may name or receive: a row's identity. Every other raw snapshot column
#: (33 sit outside the catalog, incl. archive_* research and base-detector internals) is never used (SC-1 §2d).
IDENTITY_COLUMNS = frozenset({"ticker", "company"})

#: further owner rulings go here, one line each
EXTRA_RATINGS: frozenset = frozenset()
EXTRA_FLOW: frozenset = frozenset()

_REPO = Path(__file__).resolve().parents[4]
_ENRICH = _REPO / "api" / "services" / "screener" / "enrich.py"
MIRROR = _REPO / "app" / "src" / "agent" / "capabilities" / "scanHidden.js"


def enrich_rating_columns(source: Optional[str] = None) -> frozenset:
    """Every `out["<constant>"] = ...` in enrich.ratings_fields, by AST (never a grep)."""
    tree = ast.parse(source if source is not None else _ENRICH.read_text(encoding="utf-8"))
    fn = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "ratings_fields"), None)
    if fn is None:
        raise RuntimeError("screener/enrich.py has no ratings_fields(): the rating inventory cannot be derived")
    keys = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Assign):
            for t in n.targets:
                if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == "out"
                        and isinstance(t.slice, ast.Constant) and isinstance(t.slice.value, str)):
                    keys.add(t.slice.value)
    return frozenset(keys)


def _catalog() -> list:
    from api.services.screener import filters
    return list(filters.field_catalog())


@functools.lru_cache(maxsize=1)
def rating_keys() -> frozenset:
    return frozenset(enrich_rating_columns() | OWNER_NAMED_RATINGS | OWNER_NAMED_PROPRIETARY | EXTRA_RATINGS)


@functools.lru_cache(maxsize=1)
def flow_keys() -> frozenset:
    return frozenset({f["key"] for f in _catalog() if f.get("category") == "flow"} | EXTRA_FLOW)


def hidden_keys() -> frozenset:
    return rating_keys() | flow_keys()


def agent_column(key: str, catalog: frozenset) -> bool:
    """May a returned row carry this column? Catalog fields that are not hidden, and the identity columns."""
    return (key in catalog or key in IDENTITY_COLUMNS) and key not in hidden_keys()


def refusal_for(keys: Iterable[str]) -> Optional[str]:
    """The sentence for the first hidden key among `keys` (ratings first), or None."""
    ks = list(keys)
    if any(k in rating_keys() for k in ks):
        return RATINGS_REFUSAL
    if any(k in flow_keys() for k in ks):
        return FLOW_REFUSAL
    return None


def _default_sort() -> dict:
    """SC-1 §2d: the server's own default order (spec.DEFAULT_SORT), mirrored so the browser holds no copy of it."""
    from api.services.uct_agent.scan import spec as scan_spec
    return dict(scan_spec.DEFAULT_SORT)


def _default_order_words() -> str:
    from api.services.uct_agent.scan import spec as scan_spec
    note = scan_spec.DEFAULT_ORDER_NOTE.rstrip(".")
    return note[0].lower() + note[1:]


def mirror_text() -> str:
    """The browser mirror (scanHidden.js), byte-for-byte."""
    ratings, flow = sorted(rating_keys()), sorted(flow_keys())
    return ("// GENERATED by api/services/uct_agent/scan/hidden.py (--write) -- do not edit by hand. Owner: agent-sc.\n"
            "// Screener fields the Agent never reaches (owner decision, F-16 + flow; SC-1 §2d). Pinned by\n"
            "// tests/test_uct_agent_scan_hidden.py: the Python module is the one authority.\n"
            f"export const RATING_FIELDS = new Set({json.dumps(ratings)})\n"
            f"export const FLOW_FIELDS = new Set({json.dumps(flow)})\n"
            f"export const RATINGS_REFUSAL = {json.dumps(RATINGS_REFUSAL)}\n"
            f"export const FLOW_REFUSAL = {json.dumps(FLOW_REFUSAL)}\n"
            f"export const DEFAULT_SORT = Object.freeze({json.dumps(_default_sort())})\n"
            f"export const DEFAULT_ORDER_WORDS = {json.dumps(_default_order_words())}\n"
            "export const isHidden = (key) => RATING_FIELDS.has(key) || FLOW_FIELDS.has(key)\n"
            "/** the sentence for the first hidden key among `keys` (ratings first), or null */\n"
            "export const refusalFor = (keys) => {\n"
            "  const ks = [...(keys || [])]\n"
            "  if (ks.some(k => RATING_FIELDS.has(k))) return RATINGS_REFUSAL\n"
            "  if (ks.some(k => FLOW_FIELDS.has(k))) return FLOW_REFUSAL\n"
            "  return null\n"
            "}\n")


if __name__ == "__main__":
    if "--write" in sys.argv:
        MIRROR.write_text(mirror_text(), encoding="utf-8", newline="\n")
        print(f"wrote {MIRROR}")
    else:
        sys.stdout.write(mirror_text())
