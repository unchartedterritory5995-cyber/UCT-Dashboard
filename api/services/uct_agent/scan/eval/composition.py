"""Scoring for the expressibility corpus (composition.json).

⛔ THIS MEASURES WHETHER A VALID SPEC EXISTS, NOT WHETHER THE MODEL PRODUCES IT. No model, no planner and no provider
runs here. A high figure says the catalog and the engine can say a request; it says nothing about how often the Agent
will actually say it. Planner accuracy is a separate, paid measurement.

Every gold spec goes through the real gates: `scan.spec.validate` (SC-1) and `query.build_scan_sql` (the screener's own
operator and value checks), then the statement is prepared against a real `screener_rows` table. A `logic` tree and
arithmetic are dark in production, so the two flags are on for THIS check only, and `surface` reports that a spec needs
them.

Classes, per item:
  flat                      a gold spec exists and the Agent's screener.run schema can say it today
  agent_schema_narrower     a gold spec exists but needs logic, a field-to-field op, `contains`, rank or more filters
                            than screener.run takes; or SC-1 refuses it by owner decision (the IC-1 scan join)
  engine_primitive_missing  no catalog field or combination says it
  f16_hidden                the real validator refuses it, never substituted
"""
from __future__ import annotations

import json
import os
import pathlib
import sqlite3
from typing import Any, Iterable, Optional

CORPUS = pathlib.Path(__file__).with_name("composition.json")

FLAT = "flat"
NARROWER = "agent_schema_narrower"
MISSING = "engine_primitive_missing"
HIDDEN = "f16_hidden"
CLASSES = (FLAT, NARROWER, MISSING, HIDDEN)

#: What app/src/agent/capabilities/screener.js `screener.run` can say today (RANGE_OPS, LIST_OPS, MAX_FILTERS).
#: Pinned against that file by tests/test_uct_agent_scan_composition_corpus.py.
AGENT_OPS = frozenset({"gt", "gte", "lt", "lte", "eq", "between", "in", "not_in"})
AGENT_MAX_FILTERS = 12

_FLAGS = ("SCREENER_LOGIC_ENABLED", "SCREENER_ALERT_GRAMMAR_ENABLED")


def load() -> dict:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def agent_flat(spec: dict) -> bool:
    """Can `screener.run` as it stands say this spec?"""
    if spec.get("logic") or spec.get("rank"):
        return False
    filters = spec.get("filters") or []
    return len(filters) <= AGENT_MAX_FILTERS and all(f.get("op") in AGENT_OPS and f.get("key") != "arith" for f in filters)


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
    return FLAT if agent_flat(spec) else NARROWER


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
                                 "flat_pct": round(100 * counts[FLAT] / n, 1)},
                      "after": coverage(items)}
    return out


if __name__ == "__main__":
    print(json.dumps(before_after(), indent=1))
