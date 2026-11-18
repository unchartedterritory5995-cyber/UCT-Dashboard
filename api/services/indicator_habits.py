"""⭐ WHAT A MEMBER USUALLY USES, read from their OWN saved indicators (slice E of "clarify and learn";
owner direction 2026-11-18: "Learn about the member and what they want and do!").

The door asks before it assumes ("which kind of moving average?", "how many bars?"). A member who
has saved nine indicators and used an exponential average in seven of them should not have to read
past "Simple" every time: their usual choice is offered FIRST, and says why. It is never applied
without being chosen; asking stays the rule.

WHAT THIS IS NOT. It reads the FORMULAS of the member's own saved indicators and counts two things:
which kind of average each uses, and with what whole-number length. Nothing else is read, nothing
is stored (it is derived each time it is needed), and nothing here is another member's.

    habits(definitions)      -> the counts
    usual_kind(counts)       -> the kind to offer first, or None
    usual_lengths(counts)    -> up to two lengths to offer first

A habit is offered only when it IS one (`MIN_INDICATORS`, `MAJORITY`): two saved indicators are a
coincidence, not a habit.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

#: The kinds of average the door's own question offers (`clarify_questions.json`, `average_kind`),
#: as the engine names them. A kind outside this set is not a habit the question could offer.
AVERAGE_KINDS: Tuple[str, ...] = ("sma", "ema", "wma", "hma", "vwma")
#: A kind (or a length) is "what they usually use" only when at least this many of their saved
#: indicators use it ...
MIN_INDICATORS = 3
#: ... and, for the kind, when more than this share of the indicators that use ANY average use it.
MAJORITY = 0.5
#: How many lengths are offered first.
MAX_LENGTHS = 2
#: The longest list of saved indicators read (the newest are read first by the caller).
MAX_DEFINITIONS = 200
#: The most nodes read in one formula (a saved formula is bounded far below this when it is saved).
MAX_NODES = 5000


def averages_in(tree: Any) -> List[Tuple[str, Optional[int]]]:
    """Every average in a formula tree, as (kind, its whole-number length or None). Iterative."""
    found: List[Tuple[str, Optional[int]]] = []
    stack, seen = [tree], 0
    while stack and seen < MAX_NODES:
        node = stack.pop()
        if not isinstance(node, Mapping):
            continue
        seen += 1
        args = node.get("args")
        if node.get("type") == "call" and node.get("name") in AVERAGE_KINDS and isinstance(args, list):
            length = None
            for a in args[1:]:                                   # the series comes first; the length is a literal after it
                v = a.get("value") if isinstance(a, Mapping) and a.get("type") == "num" else None
                if isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() and v >= 1:
                    length = int(v)
                    break
            found.append((str(node["name"]), length))
        if isinstance(args, list):
            stack.extend(args)
    return found


def _trees_of(definition: Any) -> List[Any]:
    """The formula trees of one saved indicator (a document or a stored row holding one)."""
    doc = definition.get("definition") if isinstance(definition, Mapping) and isinstance(definition.get("definition"), Mapping) else definition
    compute = doc.get("compute") if isinstance(doc, Mapping) else None
    if not isinstance(compute, Mapping) or compute.get("kind") != "ast":
        return []                                                # a Pine script is not a formula of this kind
    trees = compute.get("trees")
    if isinstance(trees, Mapping) and trees:
        return [t for t in trees.values() if isinstance(t, Mapping)]
    return [compute["ast"]] if isinstance(compute.get("ast"), Mapping) else []


def habits(definitions: Iterable[Any]) -> Dict[str, Any]:
    """Counts over the member's saved indicators. Each indicator counts ONCE for a kind and once for
    a length, however many times it uses it (one ribbon of eight EMAs is one indicator)."""
    kinds: Dict[str, int] = {}
    lengths: Dict[int, int] = {}
    read = with_average = 0
    for definition in list(definitions or [])[:MAX_DEFINITIONS]:
        trees = _trees_of(definition)
        if not trees:
            continue
        read += 1
        used = [pair for tree in trees for pair in averages_in(tree)]
        if not used:
            continue
        with_average += 1
        for kind in {k for k, _ in used}:
            kinds[kind] = kinds.get(kind, 0) + 1
        for length in {n for _, n in used if n is not None}:
            lengths[length] = lengths.get(length, 0) + 1
    return {
        "indicators": read,
        "with_an_average": with_average,
        # most used first; a tie is broken by the order the question lists them / by the smaller length
        "kinds": [{"value": k, "indicators": n} for k, n in sorted(kinds.items(), key=lambda kv: (-kv[1], AVERAGE_KINDS.index(kv[0])))],
        "lengths": [{"value": n, "indicators": c} for n, c in sorted(lengths.items(), key=lambda kv: (-kv[1], kv[0]))],
    }


def usual_kind(counts: Mapping[str, Any]) -> Optional[Dict[str, int]]:
    """The kind of average to offer first: used in at least `MIN_INDICATORS` saved indicators, in
    more than `MAJORITY` of those that use any, and by more of them than any other kind. Else None."""
    kinds = list(counts.get("kinds") or [])
    total = int(counts.get("with_an_average") or 0)
    if not kinds or total <= 0:
        return None
    top = kinds[0]
    if top["indicators"] < MIN_INDICATORS or top["indicators"] <= MAJORITY * total:
        return None
    if len(kinds) > 1 and kinds[1]["indicators"] == top["indicators"]:
        return None                                              # two kinds used equally: neither is "usual"
    return {"value": top["value"], "indicators": top["indicators"], "of": total}


def usual_lengths(counts: Mapping[str, Any]) -> List[Dict[str, int]]:
    """Up to `MAX_LENGTHS` lengths to offer first: each used in at least `MIN_INDICATORS` saved
    indicators, most used first."""
    total = int(counts.get("with_an_average") or 0)
    return [{"value": row["value"], "indicators": row["indicators"], "of": total}
            for row in (counts.get("lengths") or []) if row["indicators"] >= MIN_INDICATORS][:MAX_LENGTHS]
