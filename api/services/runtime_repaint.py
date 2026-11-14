"""RT2 (2026-10-02) — the repaint class of a RUNTIME-LANE document, server side.

⛔ THE MIRROR OF ``app/src/components/chart/engine/runtime/runtimeRepaint.js``,
rule for rule, over the SAME table (``runtimeRepaint.json``, read off the app tree
the way ``ast_table`` reads ``closedTable.json``). The store's save door
re-derives a runtime document's class from the source it is sent and never
trusts the client's (``runtime_definitions.validate`` / ``repaint_stamp``).

The vocabulary and the reach -> class step are the HOST linter's
(``ast_lint.mode_from_reach``); a clock leaf's reach is the host linter's answer
for that leaf (``ast_lint.ast_reach``) over the shared manifest and nothing else
(RT4: the right-edge leaves declare their ``forward`` there, ``_clock_right_edge``). ``tests/test_runtime_repaint.py`` holds this module to the answer
the JS module committed for every corpus script.
"""
from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import re
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from api.services import ast_lint

RULES_PATH: pathlib.Path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app" / "src" / "components" / "chart" / "engine" / "runtime" / "runtimeRepaint.json"
)
RULES: Dict[str, Any] = json.loads(RULES_PATH.read_text(encoding="utf-8"))

UNBOUNDED = ast_lint.UNBOUNDED
UNKNOWN = ast_lint.UNKNOWN

_IDENT_START = re.compile(r"[A-Za-z_]")
_IDENT_PART = re.compile(r"[A-Za-z0-9_]")
_DIGIT = re.compile(r"[0-9]")
_HEX = re.compile(r"[0-9A-Fa-f]")


def _entries(o: Any) -> Dict[str, Any]:
    return {k: v for k, v in (o or {}).items() if not k.startswith("_")}


def _join(a: Any, b: Any) -> Any:
    """``max`` over the host's reach lattice: UNKNOWN > UNBOUNDED > n."""
    if a == UNKNOWN or b == UNKNOWN:
        return UNKNOWN
    if a == UNBOUNDED or b == UNBOUNDED:
        return UNBOUNDED
    return max(a, b)


def _at(text: str, k: int) -> str:
    return text[k] if 0 <= k < len(text) else ""


def lex(src: Any) -> List[Dict[str, str]]:
    """The tokens the classifier reads — ``lexRepaint`` in the JS module.

    Raises ``ValueError`` on an unterminated string."""
    text = re.sub(r"\r\n?", "\n", "" if src is None else str(src))
    out: List[Dict[str, str]] = []
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch in (" ", "\t", "\n"):
            i += 1
            continue
        if ch == "/" and _at(text, i + 1) == "/":
            end = text.find("\n", i)
            i = n if end == -1 else end
            continue
        if ch in ('"', "'"):
            j = i + 1
            while j < n and text[j] != ch:
                j += 2 if text[j] == "\\" else 1
            if j >= n:
                raise ValueError(f"an unterminated string opens at offset {i}")
            out.append({"k": "str", "v": text[i + 1:j]})
            i = j + 1
            continue
        if _DIGIT.match(ch) or (ch == "." and _DIGIT.match(_at(text, i + 1) or "x")):
            j = i
            while j < n and (_DIGIT.match(text[j]) or text[j] == "."):
                j += 1
            if _at(text, j) in ("e", "E"):
                k = j + 1
                if _at(text, k) in ("+", "-"):
                    k += 1
                if _DIGIT.match(_at(text, k) or "x"):
                    while k < n and _DIGIT.match(text[k]):
                        k += 1
                    j = k
            out.append({"k": "num", "v": text[i:j]})
            i = j
            continue
        if _IDENT_START.match(ch):
            j = i
            while j < n and _IDENT_PART.match(text[j]):
                j += 1
            while True:
                k = j
                while _at(text, k) in (" ", "\t"):
                    k += 1
                if _at(text, k) != ".":
                    break
                m = k + 1
                while _at(text, m) in (" ", "\t"):
                    m += 1
                if not _IDENT_START.match(_at(text, m) or "0"):
                    break
                j = m
                while j < n and _IDENT_PART.match(text[j]):
                    j += 1
            out.append({"k": "id", "v": re.sub(r"[ \t]+", "", text[i:j])})
            i = j
            continue
        if ch == "#":
            j = i + 1
            while j < n and _HEX.match(text[j]):
                j += 1
            i = j
            continue
        out.append({"k": "p", "v": ch})
        i += 1
    return out


def _is_p(t: Optional[Dict[str, str]], v: str) -> bool:
    return bool(t) and t["k"] == "p" and t["v"] == v


def _tok(tokens: List[Dict[str, str]], k: int) -> Optional[Dict[str, str]]:
    return tokens[k] if 0 <= k < len(tokens) else None


def _args_at(tokens: List[Dict[str, str]], open_: int) -> Optional[List[List[Dict[str, str]]]]:
    args: List[List[Dict[str, str]]] = []
    cur: List[Dict[str, str]] = []
    depth = 0
    for j in range(open_ + 1, len(tokens)):
        t = tokens[j]
        if _is_p(t, "(") or _is_p(t, "["):
            depth += 1
        if _is_p(t, ")") or _is_p(t, "]"):
            if depth == 0:
                args.append(cur)
                return args
            depth -= 1
        if depth == 0 and _is_p(t, ","):
            args.append(cur)
            cur = []
            continue
        cur.append(t)
    return None


def _named_of(arg: List[Dict[str, str]]):
    if (len(arg) >= 2 and arg[0]["k"] == "id" and _is_p(arg[1], "=")
            and not _is_p(_tok(arg, 2), "=")):
        return arg[0]["v"], arg[2:]
    return None, arg


def _one_of(value: List[Dict[str, str]], allowed: List[str]) -> bool:
    return (len(value) == 1 and value[0]["k"] in ("id", "str")
            and value[0]["v"] in allowed)


def _identity_request(tokens: List[Dict[str, str]], at: int) -> bool:
    if not _is_p(_tok(tokens, at + 1), "("):
        return False
    args = _args_at(tokens, at + 1)
    if args is None:
        return False
    req = RULES["requests"]
    symbol = None
    timeframe = None
    pos = 0
    for arg in args:
        name, value = _named_of(arg)
        if name is None:
            if pos == 0:
                symbol = value
            elif pos == 1:
                timeframe = value
            pos += 1
        elif name == "symbol":
            symbol = value
        elif name in ("timeframe", "resolution"):
            timeframe = value
    return (bool(symbol) and bool(timeframe)
            and _one_of(symbol, req["identitySymbol"])
            and _one_of(timeframe, req["identityTimeframe"]))


_HOST_CLOCK: Dict[str, Any] = {}


def clock_leaf_reach(key: str, table: Optional[Dict[str, Any]] = None) -> Any:
    """The host linter's reach for one clock leaf, and only the host linter's.
    ``table`` is a rail's copy of the shared manifest (never memoised)."""
    if table is not None:
        host = ast_lint.ast_reach({"type": "series", "name": key}, {"table": table})["forward"]
    else:
        if key not in _HOST_CLOCK:
            _HOST_CLOCK[key] = ast_lint.ast_reach({"type": "series", "name": key})["forward"]
        host = _HOST_CLOCK[key]
    return host


#: ⭐ THE REPAINT MEMO (2026-11-13, "memoise the repaint lex per source hash"). Every server
#: question about a runtime document's source -- the save door (`runtime_definitions.validate`),
#: the served repaint stamp (`repaint_stamp`), the requirements read the three server lanes ask
#: (`request_reads`, once per lane) and the capability detector (`pine_capabilities`) -- asks
#: `runtime_repaint_of`, and each ask used to LEX the whole script again: 150 lexes for a list of
#: 50 near-cap runtime rows (16.8 s measured by the reviewer, 7-9.7 s here). The answer is a pure
#: function of the source text, this module's rules (`CLASSIFIER_VERSION`, the code) and its table
#: (`RULES`, fingerprinted), so it is computed ONCE per distinct source per process and kept in one
#: bounded LRU. ONE AUTHORITY: this is the only cache; every caller goes through it.
#:
#: The key is ``(sha256 of the source, CLASSIFIER_VERSION, RULES fingerprint)``: a rule change
#: (bump `CLASSIFIER_VERSION`) or a different table recomputes. The clock leaves' reach is the host
#: linter's per-process answer (`_HOST_CLOCK`, already a process constant), so it adds no key part.
#: The cache holds no source text, only the small answer, and every call returns a deep COPY of it,
#: so a caller can never mutate what the next caller reads.
CLASSIFIER_VERSION = 1
#: The LRU's bound (entries). An answer is a few hundred bytes; the source is never held.
REPAINT_MEMO_MAX = 2048
_MEMO: "OrderedDict[tuple, Dict[str, Any]]" = OrderedDict()
_MEMO_LOCK = threading.Lock()
_RULES_FP: List[Any] = [None, ""]   # [the RULES object fingerprinted, its fingerprint]


def _rules_fingerprint() -> str:
    """sha256 of `RULES` (canonical JSON), recomputed only when `RULES` is a different object."""
    rules = RULES
    if _RULES_FP[0] is not rules:
        fp = hashlib.sha256(json.dumps(rules, sort_keys=True).encode("utf-8")).hexdigest()
        _RULES_FP[0], _RULES_FP[1] = rules, fp
    return _RULES_FP[1]


def memo_key(text: str) -> tuple:
    """The memo's key for a source text: its sha256, the classifier's version, the table's."""
    digest = hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()
    return (digest, CLASSIFIER_VERSION, _rules_fingerprint())


def _reset_repaint_memo() -> None:
    """Empty the memo (a fresh process; rails)."""
    with _MEMO_LOCK:
        _MEMO.clear()


def runtime_repaint_of(source: Any) -> Dict[str, Any]:
    """``runtimeRepaintOf`` in the JS module: ``{ok, mode, forward, reads}`` or
    ``{ok: False, why}``.

    Memoised per source (`_MEMO`, above): the lex runs once per distinct source per process,
    and the caller always receives its own copy. Two threads asking a NEW source at the same
    moment may both lex it (the lex is not run under the lock, so one slow script never stalls
    another's serve); both store the same answer."""
    text = "" if source is None else str(source)
    key = memo_key(text)
    with _MEMO_LOCK:
        hit = _MEMO.get(key)
        if hit is not None:
            _MEMO.move_to_end(key)
    if hit is None:
        hit = _classify(text)
        with _MEMO_LOCK:
            _MEMO[key] = hit
            _MEMO.move_to_end(key)
            while len(_MEMO) > REPAINT_MEMO_MAX:
                _MEMO.popitem(last=False)
    return copy.deepcopy(hit)


def _classify(source: str) -> Dict[str, Any]:
    """The classifier itself (uncached): lex the source and read its rules. Only
    `runtime_repaint_of` calls it."""
    try:
        tokens = lex(source)
    except ValueError as err:
        return {"ok": False,
                "why": f"the script could not be read to state its repaint behaviour ({err})"}
    found: Dict[str, Dict[str, Any]] = {}

    def note(name: str, forward: Any, why: str) -> None:
        if forward == 0:
            return
        prev = found.get(name)
        if prev:
            prev["forward"] = _join(prev["forward"], forward)
        else:
            found[name] = {"name": name, "forward": forward, "why": why}

    clock_reads = _entries(RULES["clockReads"])
    reads = _entries(RULES["reads"])
    flags = _entries(RULES["namedFlags"])
    req = RULES["requests"]
    for i, t in enumerate(tokens):
        if t["k"] != "id":
            continue
        v = t["v"]
        if v in clock_reads:
            note(v, clock_leaf_reach(clock_reads[v]),
                 f"`{v}` reads the chart's newest bar, which moves when a later bar arrives")
        elif v in reads:
            note(v, reads[v][0], reads[v][1])
        elif v in req["calls"] and _is_p(_tok(tokens, i + 1), "("):
            if not _identity_request(tokens, i):
                note(v, UNBOUNDED,
                     f"`{v}` reads another symbol or timeframe, whose bars this pane does not hold")
        elif v.startswith(req["prefix"]):
            note(v, UNBOUNDED, f"`{v}` reads data this pane does not hold")
        elif (v in flags and _is_p(_tok(tokens, i + 1), "=")
              and not _is_p(_tok(tokens, i + 2), "=")):
            value: List[Dict[str, str]] = []
            depth = 0
            for j in range(i + 2, len(tokens)):
                u = tokens[j]
                if _is_p(u, "(") or _is_p(u, "["):
                    depth += 1
                if _is_p(u, ")") or _is_p(u, "]"):
                    if depth == 0:
                        break
                    depth -= 1
                if depth == 0 and _is_p(u, ","):
                    break
                value.append(u)
            if not _one_of(value, flags[v]):
                allowed = " or ".join(f"`{x}`" for x in flags[v])
                note(v, UNBOUNDED, f"`{v}` is set to something other than {allowed}")
    forward: Any = 0
    for r in found.values():
        forward = _join(forward, r["forward"])
    listed = sorted(found.values(), key=lambda r: r["name"])
    return {"ok": True, "mode": ast_lint.mode_from_reach(forward), "forward": forward,
            "reads": listed}
