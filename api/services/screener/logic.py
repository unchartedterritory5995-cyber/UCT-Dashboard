"""Logical groups for a screen -- all-of / any-of / none-of, nestable (FT-026).

A screen spec's `filters` list has always been ONE all-of group: `build_where`
joins its clauses with AND. This module adds an optional `logic` node beside it:

    node := <filter>                 a leaf, exactly the dict `filters` holds
          | {"all":  [node, ...]}    every child matches
          | {"any":  [node, ...]}    at least one child matches
          | {"none": [node, ...]}    no child matches
          | {"not":  node}

The spec's `filters` and its `logic` are ANDed: `filters` stays the all-of
group every existing saved screen already is, and `logic` is what a screen can
now say that a flat list cannot.

⛔ ONE AUTHORITY FOR A LEAF'S SQL. A leaf is rendered by calling
`query.build_where([leaf], ...)` -- the same function, the same column check
(X27), the same overlay `col_expr` and the same operator table the flat list
uses -- and wrapping what it returns. Nothing here names a column or an
operator, so a leaf inside a group cannot mean something different from the
same filter outside one.

⛔ THREE KEYS ARE REFUSED INSIDE A GROUP: `scan`, `list` and `universe`. They
are not column predicates -- `scan` binds a nightly receipt, `list` resolves
the caller's own watchlists and can add a join, `universe` scopes the whole
statement -- and negating or OR-ing them has no meaning this module can promise.
They stay in the flat `filters` list, where they already work.

DARK: `SCREENER_LOGIC_ENABLED` (default off, read per request). Off, a spec that
carries `logic` is REFUSED with a sentence -- never silently ignored, because a
screen that quietly drops a criterion returns more rows and reads as a broader
market.
"""
from __future__ import annotations

import os

FLAG = "SCREENER_LOGIC_ENABLED"
GROUP_KEYS = ("all", "any", "none")
MAX_DEPTH = 4
#: thinkorswim's Stock Hacker allows 25 filters per scan; the same ceiling here.
MAX_LEAVES = 25
REFUSED_IN_GROUP = ("scan", "list", "universe")

DISABLED_SENTENCE = ("Grouped criteria (any of / none of) are not switched on "
                     "yet, so this screen was not run.")


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _kind(node) -> str:
    if not isinstance(node, dict):
        raise ValueError("a group must be an object")
    if "key" in node:
        return "leaf"
    keys = [k for k in node if k in GROUP_KEYS or k == "not"]
    if len(keys) != 1 or len(node) != 1:
        raise ValueError("a group is exactly one of all / any / none / not")
    return keys[0]


def validate(node) -> int:
    """Shape-check the tree; returns the leaf count. Raises ValueError with a
    sentence a member can read."""
    count = 0

    def walk(n, depth):
        nonlocal count
        if depth > MAX_DEPTH:
            raise ValueError(f"groups can nest at most {MAX_DEPTH} deep")
        k = _kind(n)
        if k == "leaf":
            if n.get("key") in REFUSED_IN_GROUP:
                raise ValueError(
                    f"'{n.get('key')}' cannot go inside an any-of / none-of group; "
                    "keep it in the main filter list")
            count += 1
            if count > MAX_LEAVES:
                raise ValueError(f"a screen can hold at most {MAX_LEAVES} grouped criteria")
            return
        if k == "not":
            walk(n["not"], depth + 1)
            return
        kids = n[k]
        if not isinstance(kids, list) or not kids:
            raise ValueError(f"an '{k}' group needs at least one criterion")
        for c in kids:
            walk(c, depth + 1)

    walk(node, 1)
    return count


def to_sql(node, leaf_where) -> tuple[str, list]:
    """Render the tree. `leaf_where(leaf) -> (" WHERE a AND b", params)` is the
    caller's `build_where` bound to its overlay and connection; a leaf that
    renders no clause (an `in` with no values) is TRUE, the same meaning it has
    in the flat list, where it contributes nothing."""
    k = _kind(node)
    if k == "leaf":
        where, params = leaf_where(node)
        body = where.replace(" WHERE ", "", 1).strip() if where else ""
        # ⛔ TWO-VALUED. SQL compares NULL to NULL, and NOT NULL is still NULL,
        # so a row missing the field would vanish from BOTH "any of X" and
        # "none of X". A row we cannot evaluate does not match the criterion
        # (same as the flat list) -- and therefore DOES pass "none of" it, the
        # rule `not_in` already keeps: excluding a thing must not also drop
        # rows whose value we simply do not hold.
        return (f"COALESCE(({body}), 0)" if body else "1"), list(params)
    if k == "not":
        inner, params = to_sql(node["not"], leaf_where)
        return f"(NOT {inner})", params
    parts, params = [], []
    for c in node[k]:
        sql, p = to_sql(c, leaf_where)
        parts.append(sql)
        params.extend(p)
    if k == "all":
        return "(" + " AND ".join(parts) + ")", params
    joined = "(" + " OR ".join(parts) + ")"
    if k == "any":
        return joined, params
    return f"(NOT {joined})", params      # none


def leaves(node) -> list[dict]:
    k = _kind(node)
    if k == "leaf":
        return [node]
    if k == "not":
        return leaves(node["not"])
    out = []
    for c in node[k]:
        out.extend(leaves(c))
    return out
