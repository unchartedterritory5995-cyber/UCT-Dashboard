"""Scoring for the expressibility corpus (composition.json).

⛔ THIS MEASURES WHETHER A VALID SPEC EXISTS, NOT WHETHER THE MODEL PRODUCES IT. No model, no planner and no provider
runs here. A high figure says the catalog and the engine can say a request; it says nothing about how often the Agent
will actually say it. Planner accuracy is a separate, paid measurement.

Every gold spec goes through the real gates: `scan.spec.validate` (SC-1) and `query.build_scan_sql` (the screener's own
operator and value checks), then the statement is prepared against a real `screener_rows` table. A `logic` tree and
arithmetic are dark in production, so the two flags are on for THIS check only, and the `logic_flagged` class reports
that a spec needs them.

Classes, per item, read from what `screener.run` can say NOW:
  flat                      a gold spec exists and screener.run says it with SCREENER_LOGIC_ENABLED off: flat filters,
                            field-to-field, `contains`, rank, or a `logic` tree that is exactly a flat list
  logic_flagged             a gold spec exists and screener.run can say it, but only as a real tree: it runs with
                            SCREENER_LOGIC_ENABLED on, and is refused in a sentence with it off
  agent_schema_narrower     a gold spec exists but screener.run can't say it: more filters or criteria than it takes,
                            or SC-1 refuses it by owner decision (the IC-1 scan join)
  engine_primitive_missing  no catalog field or combination says it
  f16_hidden                the real validator refuses it, never substituted

Corpora: composition.json (frozen baseline in composition_baseline.json, written before the engine primitives) and
composition_fresh.json (requests written before the Agent's composition surface, each carrying its own frozen `before`).
Held-out figures are always reported apart from design figures.
"""
from __future__ import annotations

import json
import os
import pathlib
import sqlite3
from typing import Any, Iterable, Optional

CORPUS = pathlib.Path(__file__).with_name("composition.json")
FRESH = pathlib.Path(__file__).with_name("composition_fresh.json")

FLAT = "flat"
LOGIC = "logic_flagged"
NARROWER = "agent_schema_narrower"
MISSING = "engine_primitive_missing"
HIDDEN = "f16_hidden"
CLASSES = (FLAT, LOGIC, NARROWER, MISSING, HIDDEN)

#: What app/src/agent/capabilities/screener.js `screener.run` can say (RANGE_OPS, LIST_OPS, COL_OPS, TOKEN_OPS, MAX_FILTERS,
#: LOGIC_LEAVES, RANK_MAX). Pinned against that file by tests/test_uct_agent_scan_composition_corpus.py.
AGENT_OPS = frozenset({"gt", "gte", "lt", "lte", "eq", "between", "in", "not_in",
                       "gt_col", "gte_col", "lt_col", "lte_col", "contains"})
AGENT_MAX_FILTERS = 12
AGENT_MAX_LEAVES = 25
AGENT_MAX_RANK = 8

_FLAGS = ("SCREENER_LOGIC_ENABLED", "SCREENER_ALERT_GRAMMAR_ENABLED")


def load() -> dict:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def load_fresh() -> dict:
    return json.loads(FRESH.read_text(encoding="utf-8"))


def _leaf_ok(f: dict) -> bool:
    return f.get("op") in AGENT_OPS and f.get("key") != "arith"


def flatten_logic(node: dict, neg: bool = False) -> Optional[list]:
    """The Python mirror of screener.js `flattenLogic`: a tree that says EXACTLY what a flat list says, else None. Both
    are pinned to composition_flatten_cases.json, and that file to real rows, blanks included."""
    if "key" in node:
        if not neg:
            return [node]
        if node.get("op") == "in":
            return [{**node, "op": "not_in"}]
        if node.get("op") == "not_in":
            return [{**node, "op": "in"}]
        if node.get("op") == "contains":
            return [{"key": node["key"], "op": "not_in", "values": [node["value"]]}]
        return None
    if "not" in node:
        return flatten_logic(node["not"], not neg)
    k = next(g for g in ("all", "any", "none") if g in node)
    parts = [flatten_logic(c, (not neg) if k == "none" else neg) for c in node[k]]
    if any(p is None for p in parts):
        return None
    if (neg if k == "any" else not neg):                     # every part must hold
        return [f for p in parts for f in p]
    if len(parts) == 1:
        return parts[0]
    one = [p[0] if len(p) == 1 else None for p in parts]     # any ONE part may hold: only one field's values are one `in`
    if any(p is None or p.get("op") != "in" or p.get("key") != one[0].get("key") for p in one):
        return None
    return [{**one[0], "values": list(dict.fromkeys(v for p in one for v in p["values"]))}]


def agent_surface(spec: dict) -> Optional[str]:
    """FLAT, LOGIC, or None when `screener.run` can't say this spec."""
    filters = list(spec.get("filters") or [])
    rank = spec.get("rank") or {}
    if rank and len(rank.get("criteria") or []) > AGENT_MAX_RANK:
        return None
    tree = spec.get("logic")
    if tree:
        from api.services.screener import logic
        leaves = logic.leaves(tree)
        flat = flatten_logic(tree)
        if len(leaves) > AGENT_MAX_LEAVES or not all(_leaf_ok(f) for f in leaves):
            return None
        if flat is None:
            return LOGIC if len(filters) <= AGENT_MAX_FILTERS and all(_leaf_ok(f) for f in filters) else None
        filters += flat
    return FLAT if len(filters) <= AGENT_MAX_FILTERS and all(_leaf_ok(f) for f in filters) else None


def agent_flat(spec: dict) -> bool:
    """Can `screener.run` say this spec with SCREENER_LOGIC_ENABLED off?"""
    return agent_surface(spec) == FLAT


def _schema_conn() -> sqlite3.Connection:
    from api.services.screener import snapshot_db
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE screener_rows (" + ", ".join(snapshot_db._coldef(c) for c in snapshot_db.COLUMNS) + ")")
    return conn


def check_spec(spec: dict, conn: Optional[sqlite3.Connection] = None) -> dict:
    """Run a gold spec through the real gates; raises (SpecError or ValueError) when it is not valid."""
    from api.services.screener import query
    from api.services.uct_agent.scan import spec as scan_spec
    normal = scan_spec.validate(spec)
    saved = {k: os.environ.get(k) for k in _FLAGS}
    own = conn is None
    conn = conn or _schema_conn()
    try:
        for k in _FLAGS:
            os.environ[k] = "1"
        plan = query.build_scan_sql(normal, conn=conn)
        conn.execute(plan["sql"], plan["params"]).fetchall()
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if own:
            conn.close()
    return normal


def classify(item: dict) -> str:
    spec = item.get("spec")
    if spec is None:
        return item["reason"]
    return agent_surface(spec) or NARROWER


def coverage(items: Iterable[dict], classify_fn=classify) -> dict:
    items = list(items)
    out = {c: 0 for c in CLASSES}
    for it in items:
        out[classify_fn(it)] += 1
    n = len(items) or 1
    out["total"] = len(items)
    out["spec_exists"] = sum(1 for it in items if it.get("spec") is not None)
    out["spec_exists_pct"] = round(100 * out["spec_exists"] / n, 1)
    out["flat_pct"] = round(100 * out[FLAT] / n, 1)
    out["agent_says_pct"] = round(100 * (out[FLAT] + out[LOGIC]) / n, 1)
    return out


def report(doc: Optional[dict] = None) -> dict[str, Any]:
    doc = doc or load()
    items = doc["items"]
    return {"all": coverage(items),
            "design": coverage(i for i in items if i["split"] == "design"),
            "held_out": coverage(i for i in items if i["split"] == "held_out")}


def before_after(doc: Optional[dict] = None) -> dict[str, Any]:
    """Coverage at the frozen baseline against now, per split. Held-out figures stay separate."""
    doc = doc or load()
    base = json.loads(CORPUS.with_name("composition_baseline.json").read_text(encoding="utf-8"))["items"]
    out: dict[str, Any] = {}
    for split in ("design", "held_out"):
        items = [i for i in doc["items"] if i["split"] == split]
        n = len(items)
        counts = {c: sum(1 for i in items if base[i["id"]] == c) for c in CLASSES}
        spec = counts[FLAT] + sum(1 for i in items if base[i["id"]] == NARROWER and not i.get("needs"))
        out[split] = {"before": {**counts, "total": n, "spec_exists": spec, "spec_exists_pct": round(100 * spec / n, 1),
                                 "flat_pct": round(100 * counts[FLAT] / n, 1),
                                 "agent_says_pct": round(100 * counts[FLAT] / n, 1)},
                      "after": coverage(items)}
    return out


def fresh_before_after(doc: Optional[dict] = None) -> dict[str, Any]:
    """The fresh corpus, each item against its own frozen `before`, per split."""
    doc = doc or load_fresh()
    out: dict[str, Any] = {}
    for split in ("design", "held_out"):
        items = [i for i in doc["items"] if i["split"] == split]
        n = len(items)
        counts = {c: sum(1 for i in items if i["before"] == c) for c in CLASSES}
        spec = sum(1 for i in items if i.get("spec") is not None)
        out[split] = {"before": {**counts, "total": n, "spec_exists": spec, "spec_exists_pct": round(100 * spec / n, 1),
                                 "flat_pct": round(100 * counts[FLAT] / n, 1),
                                 "agent_says_pct": round(100 * counts[FLAT] / n, 1)},
                      "after": coverage(items)}
    return out


if __name__ == "__main__":
    print(json.dumps({"composition": before_after(), "fresh": fresh_before_after()}, indent=1))
