# -*- coding: utf-8 -*-
"""Which other scripts hit the same wall, and which merely use the name.

Three sources, each labelled with what it can say:

* ``docs/pine/coverage-map.json`` (committed): every sampled script's wall list,
  from the census peel. "blocked by" and "sole wall" come from here.
* the census cache's ``census.jsonl`` (``--cache``, local only): the raw refusals,
  so a name the map keyed under a capability is still found by its token.
* the corpus text (``corpus/committed/*.pine`` and the cache's ``reference/`` and
  ``builtin/`` sources): scripts that USE the name. Using is not hitting: a script
  may never reach the line because another wall stops it first.

A wall is keyed the way the coverage map keys it: the refusal's token when that is a
Pine item, otherwise ``[capability]`` from ``coverage_map.GUARD_BUCKET`` (imported,
not re-typed).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from tools.pine_coverage.coverage_map import GUARD_BUCKET

REPO = Path(__file__).resolve().parents[2]
COVERAGE_MAP = REPO / "docs" / "pine" / "coverage-map.json"
COMMITTED = REPO / "corpus" / "committed"
REF_URL = "https://www.tradingview.com/pine-script-reference/v6/"
_ANCHOR = {"function": "fun_", "method": "fun_", "variable": "var_", "constant": "const_",
           "keyword": "kw_", "type": "type_", "operator": "op_", "annotation": "an_"}


def load_map(path: Optional[Path] = None) -> dict:
    p = Path(path or COVERAGE_MAP)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def capability_of(guard: Optional[str]) -> Optional[str]:
    return GUARD_BUCKET.get(guard or "")


def wall_label(token: Optional[str], guard: Optional[str], item_names: set) -> str:
    if token and token in item_names:
        return token
    cap = capability_of(guard)
    return f"[{cap}]" if cap else f"[{guard or 'unknown'}]"


def item_names(cmap: dict) -> set:
    return {i["name"] for i in ((cmap.get("inventory") or {}).get("items") or []) if "name" in i}


def inventory_item(cmap: dict, name: str) -> Optional[dict]:
    for i in ((cmap.get("inventory") or {}).get("items") or []):
        if i.get("name") == name:
            return i
    return None


def reference_link(cmap: dict, name: str) -> str:
    it = inventory_item(cmap, name)
    kinds = (it or {}).get("kinds") or []
    for k in ("function", "variable", "constant", "keyword", "type", "method", "operator", "annotation"):
        if k in kinds:
            return f"{REF_URL}#{_ANCHOR[k]}{name}"
    return f"{REF_URL}#fun_{name}"


def _census_rows(cache: Optional[Path]) -> list[dict]:
    if not cache:
        return []
    p = Path(cache) / "census.jsonl"
    rows = []
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def _uses_re(name: str) -> re.Pattern:
    """The name as written, and for ``ta.``/``math.`` names the legacy v3/v4 bare
    CALL spelling too (``alma(``), which is how ``doorCoverage.PINE_PREFIXES``
    says real scripts still write them."""
    pat = r"(?<![\w.])" + re.escape(name) + r"(?![\w])"
    head, _, bare = name.partition(".")
    if head in ("ta", "math") and bare:
        pat += r"|(?<![\w.])" + re.escape(bare) + r"\s*\("
    return re.compile(pat)


def corpus_files(cache: Optional[Path]) -> list[tuple[str, Path]]:
    out = [("committed", p) for p in sorted(COMMITTED.glob("*.pine"))] if COMMITTED.exists() else []
    if cache:
        for pop in ("reference", "builtin"):
            d = Path(cache) / pop
            if d.exists():
                out += [(pop, p) for p in sorted(d.glob("*.pine"))]
    return out


def similar(*, label: str, name: Optional[str], cmap: dict, cache: Optional[Path] = None,
            limit: int = 15) -> dict:
    """``label`` is the wall key (a Pine item or ``[capability]``); ``name`` the
    built-in to search the text for (None for a capability wall)."""
    blocked, sole = [], []
    for s in cmap.get("scripts") or []:
        w = s.get("walls") or []
        if label in w:
            row = {"key": s.get("key"), "title": s.get("title"), "population": s.get("population"),
                   "walls": w}
            blocked.append(row)
            if w == [label]:
                sole.append(row)
    keys = {b["key"] for b in blocked}
    from_cache = []
    if name:
        for r in _census_rows(cache):
            if r.get("key") in keys or str(r.get("key", "")).startswith("example:"):
                continue
            if any(x.get("token") == name for st in (r.get("steps") or []) for x in (st.get("refusals") or [])):
                from_cache.append({"key": r.get("key")})
    uses = []
    if name:
        rx = _uses_re(name)
        for pop, p in corpus_files(cache):
            try:
                if rx.search(p.read_text(encoding="utf-8", errors="replace")):
                    uses.append({"population": pop, "path": str(p)})
            except OSError:
                pass
    by_key = {s.get("key"): s for s in cmap.get("scripts") or []}
    return {
        "label": label,
        "blocked": len(blocked), "sole": len(sole),
        "blocked_sample": sorted(blocked, key=lambda b: (b["walls"] != [label], len(b["walls"]), b["key"]))[:limit],
        "census_token_hits": len(from_cache),
        "census_token_sample": from_cache[:limit],
        "uses": len(uses), "uses_sample": uses[:limit],
        "transfer_of_users": sum(1 for u in uses if (by_key.get(_key_for(u)) or {}).get("clean")),
    }


def _key_for(use: dict) -> str:
    return f"{use['population']}:{Path(use['path']).stem}"
