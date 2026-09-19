#!/usr/bin/env python3
"""Census every `volume` read in `corpus/committed/*.pine`, classified by FORM,
with interprocedural reachability to an output — plus the controls that say the
instrument could have seen what it reports as absent.

    python tools/pine_volume_provenance_census.py

READ-ONLY. Touches no network, no database, no `C:\\data`. It reads
`corpus/committed/*.pine`, `tests/fixtures/member/*.pine`, two committed
`/api/bars` bar fixtures and two committed JSON records, and prints.

⛔ WHAT THIS INSTRUMENT DOES NOT CLAIM
  * It does not parse Pine. It strips comments and strings, then walks a
    bracket stack. Every classification below is "what the call stack around
    this token says", not "what the Pine compiler binds".
  * Reachability is a NAME graph over user definitions, functions included, and
    it is interprocedural: a `volume` inside `f()` is live when `f` is reached
    from a sink. An occurrence whose scope it cannot attribute is reported under
    `unresolved`, never silently as unreachable (standard 6).

⭐ THE FORM THAT CARRIES NO `volume` TOKEN. `ta.obv`, `ta.vwap`, `ta.mfi` and
friends read the volume series without naming it, so a census of the token would
report a smaller population than the one that actually depends on volume
provenance. They are counted as their own form, and the list is printed so a
reader can see exactly which names were looked for.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "corpus", "committed")
MEMBER = os.path.join(ROOT, "tests", "fixtures", "member")
VENDOR = os.path.join(ROOT, "tests", "fixtures", "vendor")

FAILURES: list[str] = []


# --------------------------------------------------------------------------- #
# 1. the stripper
# --------------------------------------------------------------------------- #

def strip_comments_and_strings(src: str, *, enabled: bool = True) -> str:
    """Blank out Pine comments and string BODIES, preserving every offset.

    A comment becomes spaces; a string keeps its quotes and loses its contents.
    Offsets are preserved so a line number computed on the stripped text is the
    line number in the file — the instrument never reports a line it cannot
    point at.

    `enabled=False` is the MUTATION ARM of the stripper control: the same
    function with the stripping turned off, so the control can show the counts
    move. A stripper that is never run without is a stripper nobody measured.
    """
    if not enabled:
        return src
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            j = i
            while j < n and src[j] != "\n":
                out[j] = " "
                j += 1
            i = j
            continue
        if ch in "\"'":
            quote = ch
            j = i + 1
            while j < n and src[j] != "\n":
                if src[j] == "\\" and j + 1 < n:
                    out[j] = " "
                    out[j + 1] = " "
                    j += 2
                    continue
                if src[j] == quote:
                    break
                out[j] = " "
                j += 1
            i = j + 1
            continue
        i += 1
    return "".join(out)


# --------------------------------------------------------------------------- #
# 2. the bracket walk — which call encloses this token
# --------------------------------------------------------------------------- #

IDENT_TAIL = re.compile(r"[A-Za-z_][A-Za-z_0-9.]*$")

#: Calls that PRODUCE an output rather than transform a value. A `volume`
#: whose only enclosing call is one of these is a BARE read handed straight to
#: a drawing — `plot(volume)` is not "volume under `plot`", it is bare volume.
OUTPUT_SINKS = frozenset({
    "plot", "plotshape", "plotchar", "plotarrow", "plotbar", "plotcandle",
    "bgcolor", "barcolor", "fill", "hline",
    "alertcondition", "alert",
    "label.new", "line.new", "box.new", "table.cell", "table.new",
    "label.set_text", "label.set_y", "line.set_y1", "line.set_y2",
    "strategy.entry", "strategy.exit", "strategy.close", "strategy.order",
})


def call_stack_scan(stripped: str):
    """Yield `(offset, stack)` for every bare `volume` identifier.

    `stack` is the list of enclosing callee names, outermost first. A grouping
    paren contributes `""`; a `[` contributes `"["`.

    ⛔ THE DOT GUARD IS LOAD-BEARING. `format.volume` — which
    `uncharted-volume-v2.pine` writes on line 24 — contains the token `volume`
    and is NOT a read of the volume series. A `\\bvolume\\b` regex counts it.
    """
    stack: list[str] = []
    i, n = 0, len(stripped)
    while i < n:
        ch = stripped[i]
        if ch == "(":
            m = IDENT_TAIL.search(stripped[:i].rstrip())
            # `rstrip` only: `ta.sma (x)` is legal Pine spacing, `foo\n(x)` is not
            # a call we will claim, and an empty match is a grouping paren.
            name = m.group(0) if m and stripped[:i].rstrip() == stripped[:i] else ""
            stack.append(name)
            i += 1
            continue
        if ch == ")":
            if stack:
                stack.pop()
            i += 1
            continue
        if ch == "[":
            stack.append("[")
            i += 1
            continue
        if ch == "]":
            if stack:
                stack.pop()
            i += 1
            continue
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (stripped[j].isalnum() or stripped[j] == "_"):
                j += 1
            word = stripped[i:j]
            prev = stripped[:i].rstrip()
            dotted = prev.endswith(".")
            if word == "volume" and not dotted:
                yield i, list(stack)
            i = j
            continue
        i += 1


def classify(stack: list[str]) -> tuple[str, str]:
    """`(form, detail)` for one occurrence's enclosing call stack."""
    calls = [s for s in stack if s and s != "["]
    for s in calls:
        if s.startswith("request.security"):
            return "request.security", s
    nearest_ta = None
    for s in calls:
        if s.startswith("ta."):
            nearest_ta = s
    if nearest_ta:
        return "ta.* over volume", nearest_ta
    transforms = [s for s in calls if s not in OUTPUT_SINKS]
    if not transforms:
        return "bare volume", (calls[-1] if calls else "(no call)")
    inner = transforms[-1]
    if inner.startswith("math."):
        return "math.* over volume", inner
    return "other call over volume", inner


# --------------------------------------------------------------------------- #
# 3. scopes and the interprocedural name graph
# --------------------------------------------------------------------------- #

FUNC_DEF = re.compile(r"^[ \t]*(?:export[ \t]+)?(?P<name>[A-Za-z_]\w*)[ \t]*\((?P<args>[^()]*)\)[ \t]*=>")
ASSIGN = re.compile(
    r"^[ \t]*(?:(?:var|varip)[ \t]+)?"
    r"(?:(?:float|int|bool|string|color|line|label|box|table|linefill|polyline|chart\.point|array<[^>]*>|matrix<[^>]*>|map<[^>]*>)[ \t]+)?"
    r"(?P<name>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*(?P<op>:=|=)(?!=)[ \t]*(?P<rhs>.*)$"
)
TUPLE_ASSIGN = re.compile(r"^[ \t]*\[(?P<names>[^\]]*)\][ \t]*=(?!=)[ \t]*(?P<rhs>.*)$")
BLOCK_HEAD = re.compile(r"^[ \t]*(?:if|else[ \t]+if|else|for|while|switch)\b")
IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*")
#: `array.push(avg, volume[i])` writes INTO `avg`. Pine's collection mutators are
#: how a loop body produces a value, so the first argument is the scope.
COLLECTION_MUTATOR = re.compile(
    r"^[ \t]*(?:array|matrix|map)\.\w+[ \t]*\([ \t]*(?P<target>[A-Za-z_]\w*)")

#: Trailing tokens that mean "this statement is not finished".
CONT_TAIL = re.compile(r"(?:[+\-*/%?:,=<>!&|^~([]|\b(?:and|or|not)\b)[ \t]*$")
#: Leading tokens that mean "this line continues the previous one". `=` is here
#: because a tuple destructure is written with the `=` on its own line in the
#: corpus (`volume-delta-oi-delta-kioseff-trading`, lines 27-28).
CONT_HEAD = re.compile(r"^[ \t]*(?:[?:+*/%,)\]]|=(?!=)|\b(?:and|or)\b|=>|-(?=[ \t]))")


def line_starts(text: str) -> list[int]:
    out, pos = [0], 0
    for line in text.split("\n"):
        pos += len(line) + 1
        out.append(pos)
    return out


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


class ScriptModel:
    """Logical lines, scopes, and the interprocedural name graph.

    ⚰️ V1 OF THIS CLASS SCOPED BY PHYSICAL LINE AND PUT 67 OF 346 READS IN
    `unresolved` — the same shape as the failure the brief warns about ("a
    line-based check once reported (nothing) for 82 of 158"). A `volume` on the
    second physical line of a wrapped assignment had no assignment to belong to,
    and a `volume` in an `if` CONDITION had no statement to belong to. Both are
    fixed here by joining continuations into LOGICAL lines and by resolving a
    block header through the block it guards. The residual `unresolved` count is
    printed rather than absorbed.
    """

    def __init__(self, stripped: str):
        self.lines = stripped.split("\n")
        self.starts = line_starts(stripped)
        self.logical: list[dict] = []          # {first, last, text, indent, kind, name}
        self.phys_to_logical: dict[int, int] = {}
        self.scope_of_logical: dict[int, str] = {}
        self.children: dict[int, list[int]] = defaultdict(list)
        self.refs: dict[str, set[str]] = defaultdict(set)
        self.roots: set[str] = set()
        self._build()

    # -- helpers ----------------------------------------------------------- #
    @staticmethod
    def _names_in(text: str) -> set[str]:
        return {m.group(0) for m in IDENT.finditer(text)}

    @staticmethod
    def _is_sink(text: str) -> bool:
        for sink in OUTPUT_SINKS:
            if re.search(r"(?<![A-Za-z_0-9.])" + re.escape(sink) + r"[ \t]*\(", text):
                return True
        return False

    # -- construction ------------------------------------------------------ #
    def _join_logical(self) -> None:
        i, n = 0, len(self.lines)
        while i < n:
            if not self.lines[i].strip():
                i += 1
                continue
            first = i
            text = self.lines[i]
            depth = (text.count("(") - text.count(")")
                     + text.count("[") - text.count("]"))
            j = i + 1
            while j < n:
                nxt = self.lines[j]
                if not nxt.strip():
                    j += 1
                    continue
                cont = (depth > 0
                        or CONT_TAIL.search(text.rstrip())
                        or (CONT_HEAD.match(nxt) and _indent(nxt) > _indent(self.lines[first])))
                if not cont:
                    break
                text += " " + nxt.strip()
                depth += (nxt.count("(") - nxt.count(")")
                          + nxt.count("[") - nxt.count("]"))
                j += 1
            idx = len(self.logical)
            for k in range(first, j):
                self.phys_to_logical[k] = idx
            self.logical.append({
                "first": first, "last": j - 1, "text": text,
                "indent": _indent(self.lines[first]),
            })
            i = j

    def _classify_logical(self) -> None:
        for L in self.logical:
            t = L["text"]
            m = FUNC_DEF.match(t)
            if m:
                L["kind"], L["name"] = "fn", m.group("name")
                continue
            tup = TUPLE_ASSIGN.match(t)
            if tup:
                L["kind"] = "tuple"
                L["name"] = [x.strip() for x in tup.group("names").split(",") if x.strip()]
                L["rhs"] = tup.group("rhs")
                continue
            if BLOCK_HEAD.match(t):
                L["kind"], L["name"] = "block", None
                continue
            asg = ASSIGN.match(t)
            if asg:
                # A UDT field write (`vwap.volume := …`) is a write to `vwap`.
                L["kind"] = "assign"
                L["name"] = asg.group("name").split(".")[0]
                L["rhs"] = asg.group("rhs")
                continue
            if self._is_sink(t):
                L["kind"], L["name"] = "sink", None
                continue
            mut = COLLECTION_MUTATOR.match(t)
            if mut:
                L["kind"], L["name"] = "assign", mut.group("target")
                L["rhs"] = t
                continue
            L["kind"], L["name"] = "stmt", None

    def _nest(self) -> None:
        stack: list[int] = []
        for idx, L in enumerate(self.logical):
            while stack and self.logical[stack[-1]]["indent"] >= L["indent"]:
                stack.pop()
            if stack:
                self.children[stack[-1]].append(idx)
            L["parent"] = stack[-1] if stack else None
            stack.append(idx)

    def _enclosing_fn(self, idx: int) -> str | None:
        cur = self.logical[idx]["parent"]
        while cur is not None:
            if self.logical[cur]["kind"] == "fn":
                return self.logical[cur]["name"]
            cur = self.logical[cur]["parent"]
        return None

    def _enclosing_assign(self, idx: int) -> str | None:
        """⭐ A `switch` ARM BELONGS TO THE ASSIGNMENT IT IS AN ARM OF.

        ⚰️ MEASURED: the whole residual `unresolved` population after the
        logical-line fix was ONE shape — `vwma1 = switch maSrc` with `"SMA" =>
        ta.sma(TfClose1*volume, len) / ta.sma(volume, len)` on the lines below.
        20 of 39 residual reads were in a single script written that way. The
        arms are indented children of the assignment, so the assignment is their
        scope; without this they had no value to be live or dead about.
        """
        cur = self.logical[idx]["parent"]
        while cur is not None:
            L = self.logical[cur]
            if L["kind"] == "assign":
                return L["name"]
            if L["kind"] == "tuple" and L["name"]:
                return L["name"][0]
            if L["kind"] == "fn":
                return None
            cur = L["parent"]
        return None

    def _scopes(self) -> None:
        for idx, L in enumerate(self.logical):
            fn = self._enclosing_fn(idx)
            if L["kind"] == "fn":
                self.scope_of_logical[idx] = f"fn:{L['name']}"
            elif fn:
                # ⭐ INSIDE A FUNCTION, THE FUNCTION IS THE SCOPE. Whether the
                # read reaches an output is decided by whether the function is
                # called — that is the interprocedural half.
                self.scope_of_logical[idx] = f"fn:{fn}"
            elif L["kind"] == "assign":
                self.scope_of_logical[idx] = f"sym:{L['name']}"
            elif L["kind"] == "tuple":
                self.scope_of_logical[idx] = f"sym:{L['name'][0]}" if L["name"] else f"stmt:{idx}"
            elif L["kind"] == "sink":
                self.scope_of_logical[idx] = f"sink:{idx}"
            elif (owner := self._enclosing_assign(idx)):
                self.scope_of_logical[idx] = f"sym:{owner}"
            elif L["kind"] == "block":
                self.scope_of_logical[idx] = f"blk:{idx}"
            else:
                self.scope_of_logical[idx] = f"stmt:{idx}"

    def _edges(self) -> None:
        for idx, L in enumerate(self.logical):
            scope = self.scope_of_logical[idx]
            names = self._names_in(L["text"])
            if L["kind"] == "fn":
                # A function's references are its WHOLE body, descendants included.
                body = self._descendants(idx)
                for b in body:
                    names |= self._names_in(self.logical[b]["text"])
                self.refs[f"fn:{L['name']}"] |= names
                continue
            if L["kind"] in ("assign", "tuple"):
                rhs_names = self._names_in(L.get("rhs", L["text"]))
                targets = L["name"] if L["kind"] == "tuple" else [L["name"]]
                for t in targets:
                    self.refs[f"sym:{t}"] |= rhs_names
                    # An assignment guarded by an `if` depends on the condition.
                    p = L["parent"]
                    while p is not None and self.logical[p]["kind"] == "block":
                        self.refs[f"sym:{t}"] |= self._names_in(self.logical[p]["text"])
                        p = self.logical[p]["parent"]
                if scope.startswith("fn:"):
                    self.refs[scope] |= rhs_names
                continue
            if L["kind"] == "sink":
                self.roots |= names
                self.roots.add(scope)
                continue
            self.refs[scope] |= names

    def _descendants(self, idx: int) -> list[int]:
        out, queue = [], list(self.children.get(idx, ()))
        while queue:
            c = queue.pop()
            out.append(c)
            queue.extend(self.children.get(c, ()))
        return out

    def _build(self) -> None:
        self._join_logical()
        self._classify_logical()
        self._nest()
        self._scopes()
        self._edges()

    # -- reachability ------------------------------------------------------ #
    def live_names(self) -> set[str]:
        seen: set[str] = set()
        queue = list(self.roots)
        while queue:
            name = queue.pop()
            if name in seen:
                continue
            seen.add(name)
            for key in (f"sym:{name}", f"fn:{name}", name):
                for ref in self.refs.get(key, ()):
                    if ref not in seen:
                        queue.append(ref)
        return seen

    def logical_of_offset(self, off: int) -> int:
        lo, hi = 0, len(self.starts) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.starts[mid] <= off:
                lo = mid
            else:
                hi = mid
        return self.phys_to_logical.get(lo, -1)

    def line_of_offset(self, off: int) -> int:
        lo, hi = 0, len(self.starts) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.starts[mid] <= off:
                lo = mid
            else:
                hi = mid
        return lo + 1

    def reach_of_offset(self, off: int, live: set[str]) -> tuple[str, str]:
        idx = self.logical_of_offset(off)
        if idx < 0:
            return "unresolved", "(no logical line)"
        scope = self.scope_of_logical[idx]
        kind, _, nm = scope.partition(":")
        if kind == "sink":
            return "yes", scope
        if kind in ("fn", "sym"):
            return ("yes" if (nm in live or scope in live) else "no"), scope
        if kind == "blk":
            # ⭐ A BLOCK HEADER IS RESOLVED THROUGH THE BLOCK IT GUARDS. `if
            # volume > avg` has no value of its own; it is live exactly when
            # something the block writes is live.
            for d in self._descendants(idx):
                s = self.scope_of_logical[d]
                k2, _, n2 = s.partition(":")
                if k2 == "sink" or n2 in live or s in live:
                    return "yes", scope
            return "no", scope
        return "unresolved", scope


#: Pine builtins that READ the volume series without naming it. The list is
#: printed with the census so the reader can audit what was looked for; a name
#: absent from a corpus is only evidence when the instrument searched for it.
IMPLICIT_VOLUME_BUILTINS = (
    "ta.obv", "ta.pvt", "ta.nvi", "ta.pvi", "ta.wad", "ta.accdist",
    "ta.vwap", "ta.vwma", "ta.mfi", "ta.iii",
)


def census_one(path: str) -> dict:
    raw = open(path, "r", encoding="utf-8", errors="replace").read()
    stripped = strip_comments_and_strings(raw)
    model = ScriptModel(stripped)
    live = model.live_names()
    occ = []
    for off, stack in call_stack_scan(stripped):
        form, detail = classify(stack)
        reach, scope = model.reach_of_offset(off, live)
        occ.append({
            "line": model.line_of_offset(off), "form": form, "detail": detail,
            "scope": scope, "reach": reach,
        })
    implicit = []
    for name in IMPLICIT_VOLUME_BUILTINS:
        for m in re.finditer(r"(?<![A-Za-z_0-9.])" + re.escape(name) + r"(?![A-Za-z_0-9])", stripped):
            implicit.append({"line": stripped[:m.start()].count("\n") + 1, "name": name})
    return {"file": os.path.basename(path), "occ": occ, "implicit": implicit,
            "raw": raw, "stripped": stripped}


# --------------------------------------------------------------------------- #
# 4. controls
# --------------------------------------------------------------------------- #

def control(name: str, expected, got, note: str = "") -> None:
    ok = expected == got
    if not ok:
        FAILURES.append(name)
    print(f"CONTROL: {name} expected {expected} got {got} {'OK' if ok else 'FAIL'}"
          + (f"   [{note}]" if note else ""))


#: ⭐ THE PROBE IS SYMMETRIC ON PURPOSE — two reads that reach an output and two
#: that cannot, so a reachability answer of "all live" and one of "all dead" both
#: fail it. Standard 6: an absence is evidence only when a presence was visible.
#:
#: ⚰️ THE FIRST VERSION OF THIS PROBE FAILED ITS OWN CONTROL AND THE INSTRUMENT
#: WAS RIGHT. It wrote `x = volume` and `y = ta.sma(volume, 20)`, plotted NEITHER,
#: and expected 3 live. The control said 1 live / 3 dead, which is the correct
#: answer for a script whose only drawing is `plot(f_live(close))`. The
#: EXPECTATION was the defect. It is recorded rather than quietly corrected,
#: because the run that catches it is the only evidence the control can fail.
STRIPPER_PROBE = """//@version=6
// this comment says volume and must not be counted
indicator('volume in a title', format = format.volume)
x = volume
y = ta.sma(volume, 20)
label.new(bar_index, high, "volume in a string")
f_dead(a) =>
    a * volume
f_live(b) =>
    b + volume
plot(y)
plot(f_live(close))
"""


def run_controls(corpus_files: list[str]) -> None:
    print("=" * 78)
    print("CONTROLS")
    print("=" * 78)

    # -- C1: the population, against a committed number ---------------------- #
    metric_path = os.path.join(ROOT, "tools", "corpus_metric.json")
    metric = json.load(open(metric_path, "r", encoding="utf-8"))
    control("corpus-size-reproduces-tools/corpus_metric.json::scripts",
            metric["scripts"], len(corpus_files),
            "committed number, reproduced — not a new baseline")

    # -- C2: the volume-granularity boundary, against a committed record ----- #
    #    ⭐ BOTH SIDES ARE DERIVED. The expectation is READ OUT of the committed
    #    divergence record and the measurement is computed from the committed
    #    `/api/bars` fixture. Typing 606 here would be a second authority.
    agen_rec = json.load(open(os.path.join(
        VENDOR, "uncharted-volume-v2-agen-1d-hve-2026-09-12.json"), "r", encoding="utf-8"))
    boundary = agen_rec["volume_source_boundary"]
    exp_bars = boundary["ours_from_2024_04_12"]["bars"]
    exp_pct = boundary["ours_from_2024_04_12"]["multiples_of_100_pct"]
    agen_bars = json.load(open(os.path.join(
        VENDOR, "agen-1d-bars-2000-2026-09-13.json"), "r", encoding="utf-8"))["bars"]
    post = [b for b in agen_bars if str(b["t"]) >= "2024-04-12"]
    got_pct = round(100.0 * sum(1 for b in post if int(b["v"]) % 100 == 0) / max(len(post), 1), 1)
    control("agen-post-boundary-bar-count (committed record vs the /api/bars fixture)",
            exp_bars, len(post), "reproduction")
    control("agen-post-boundary-pct-multiples-of-100",
            exp_pct, got_pct, "reproduction")

    # -- C3: the stripper, BOTH WAYS ---------------------------------------- #
    on = [c for _, c in call_stack_scan(strip_comments_and_strings(STRIPPER_PROBE))]
    off = [c for _, c in call_stack_scan(strip_comments_and_strings(STRIPPER_PROBE, enabled=False))]
    # 4 real reads: x, ta.sma, f_dead body, f_live body.
    control("stripper-ON-counts-only-real-reads", 4, len(on), "probe has 4 code reads")
    control("stripper-OFF-over-counts (the mutation arm: it must move)", 7, len(off),
            "+1 comment, +1 title string, +1 label string")
    if len(on) == len(off):
        FAILURES.append("stripper-does-nothing")
        print("CONTROL: stripper-discriminates expected different got identical FAIL")
    else:
        print("CONTROL: stripper-discriminates expected different got different OK")

    # -- C4: the dot guard --------------------------------------------------- #
    naive = len(re.findall(r"\bvolume\b", strip_comments_and_strings(STRIPPER_PROBE)))
    control("dot-guard (a `\\bvolume\\b` regex counts `format.volume`)", 5, naive,
            "the naive count is 5; the guarded count above is 4")

    # -- C5: reachability can see BOTH answers ------------------------------- #
    probe_stripped = strip_comments_and_strings(STRIPPER_PROBE)
    probe_model = ScriptModel(probe_stripped)
    probe_live = probe_model.live_names()
    reach = Counter()
    for off_, _stack in call_stack_scan(probe_stripped):
        reach[probe_model.reach_of_offset(off_, probe_live)[0]] += 1
    control("reachability-sees-a-PRESENCE (`y` is plotted, `f_live` is called)",
            2, reach["yes"])
    control("reachability-sees-an-ABSENCE (`x` unused, `f_dead` never called)",
            2, reach["no"],
            "an absence is only evidence if a presence was visible — both arms fire")
    control("reachability-leaves-nothing-unresolved-on-the-probe", 0, reach["unresolved"])

    print()


# --------------------------------------------------------------------------- #
# 5. report
# --------------------------------------------------------------------------- #

def main() -> int:
    # ⚰️ MEASURED WHILE BUILDING THIS. On Windows, `python tools/…py > file.txt`
    # gives stdout a cp1252 encoder, and the first `⛔` in a printed line raised
    # `UnicodeEncodeError` — the report died AFTER printing the census table, so
    # a reader who only saw the top of the file would have thought it finished.
    # A report that renders in a terminal and dies in a redirect is a report
    # nobody can hand to anyone.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                                            # pragma: no cover
        pass
    corpus_files = sorted(
        os.path.join(CORPUS, f) for f in os.listdir(CORPUS) if f.endswith(".pine"))
    run_controls(corpus_files)

    results = [census_one(p) for p in corpus_files]

    form_uses = Counter()
    form_files = defaultdict(set)
    form_reach = defaultdict(Counter)
    form_example = {}
    detail_uses = defaultdict(Counter)

    for r in results:
        for o in r["occ"]:
            f = o["form"]
            form_uses[f] += 1
            form_files[f].add(r["file"])
            form_reach[f][o["reach"]] += 1
            detail_uses[f][o["detail"]] += 1
            if f not in form_example or o["reach"] == "yes":
                if f not in form_example or form_example[f][1] != "yes":
                    form_example[f] = (f"{r['file']}:{o['line']}", o["reach"])

    imp_uses = Counter()
    imp_files = defaultdict(set)
    imp_example = {}
    for r in results:
        for im in r["implicit"]:
            imp_uses[im["name"]] += 1
            imp_files[im["name"]].add(r["file"])
            imp_example.setdefault(im["name"], f"{r['file']}:{im['line']}")

    print("=" * 78)
    print("PART 1 — `volume` READS IN corpus/committed/*.pine")
    print("=" * 78)
    total = sum(form_uses.values())
    files_any = len({r["file"] for r in results if r["occ"]})
    print(f"scripts scanned: {len(results)}   scripts with a `volume` token: {files_any}"
          f"   total reads: {total}")
    print()
    print("| form | uses | files | reaches an output | does not | unresolved | a named script |")
    print("|---|---|---|---|---|---|---|")
    for f, n in form_uses.most_common():
        rc = form_reach[f]
        print(f"| {f} | {n} | {len(form_files[f])} | {rc['yes']} | {rc['no']} | "
              f"{rc['unresolved']} | `{form_example[f][0]}` |")
    print()
    for f in form_uses:
        det = detail_uses[f].most_common()
        print(f"  {f}: " + ", ".join(f"{k}×{v}" for k, v in det[:24])
              + (" …" if len(det) > 24 else ""))
    print()
    resid = [(r["file"], o["line"], o["scope"])
             for r in results for o in r["occ"] if o["reach"] == "unresolved"]
    print(f"UNRESOLVED RESIDUAL — {len(resid)} of {total} reads the scope model could not "
          f"attribute. ⛔ REPORTED, NOT ABSORBED: counting these as 'does not reach an "
          f"output' would be the absence-without-evidence error.")
    for f, ln, sc in resid:
        print(f"  {f}:{ln}  scope={sc}")
    print()
    # ⭐ WHICH LANES EVEN SEE THESE SCRIPTS. A provenance difference between the
    # pane and the screener can only bite a script BOTH lanes admit, so the
    # population that matters is the intersection — read off the committed
    # `tools/corpus_metric.json`, never re-derived here.
    metric = json.load(open(os.path.join(ROOT, "tools", "corpus_metric.json"),
                            "r", encoding="utf-8"))
    by_file = {r["file"]: r for r in metric["rows"]}
    vol_files = {r["file"] for r in results if r["occ"] or r["implicit"]}
    tok_files = {r["file"] for r in results if r["occ"]}
    host = sum(1 for f in vol_files if by_file.get(f, {}).get("host"))
    scr = sum(1 for f in vol_files if by_file.get(f, {}).get("screener"))
    both = sum(1 for f in vol_files
               if by_file.get(f, {}).get("host") and by_file.get(f, {}).get("screener"))
    print("LANE ADMISSION OF THE VOLUME-READING SCRIPTS "
          "(lane verdicts read from tools/corpus_metric.json, not re-derived)")
    print(f"  scripts that read volume at all (token or implicit builtin): {len(vol_files)}")
    print(f"  ... of which the token appears in: {len(tok_files)}")
    print(f"  admitted by the HOST lane: {host}")
    print(f"  admitted by the SCREENER lane: {scr}")
    print(f"  admitted by BOTH — the population a pane/screener provenance split can bite: {both}")
    cum_files = sorted(f for f in vol_files
                       if re.search(r"(?<![A-Za-z_0-9.])ta\.cum[ \t]*\(",
                                    next(r["stripped"] for r in results if r["file"] == f)))
    print(f"  ... and {len(cum_files)} of them call `ta.cum`, which "
          f"`closedTable.json::_requirement_tags.window_dependent` refuses for the "
          f"screener consumer: {', '.join(cum_files) or '(none)'}")
    print()
    print("IMPLICIT-VOLUME BUILTINS (no `volume` token appears; the series is read anyway)")
    print("  looked for: " + ", ".join(IMPLICIT_VOLUME_BUILTINS))
    print("| builtin | uses | files | a named script |")
    print("|---|---|---|---|")
    for name in IMPLICIT_VOLUME_BUILTINS:
        if imp_uses[name]:
            print(f"| `{name}` | {imp_uses[name]} | {len(imp_files[name])} | `{imp_example[name]}` |")
        else:
            print(f"| `{name}` | 0 | 0 | — (searched, not found) |")
    print()

    # -- the primary specimen ---------------------------------------------- #
    print("=" * 78)
    print("PART 3 INPUT — `tests/fixtures/member/uncharted-volume-v2.pine`")
    print("=" * 78)
    v2 = census_one(os.path.join(MEMBER, "uncharted-volume-v2.pine"))
    for o in v2["occ"]:
        print(f"  line {o['line']:>4}  {o['form']:<24} {o['detail']:<20} "
              f"scope={o['scope']:<22} output={o['reach']}")
    if v2["implicit"]:
        for im in v2["implicit"]:
            print(f"  line {im['line']:>4}  implicit builtin {im['name']}")
    else:
        print("  implicit-volume builtins: none (searched for all "
              f"{len(IMPLICIT_VOLUME_BUILTINS)})")
    print()
    for other in ("uncharted-volume.pine", "uncharted-clouds.pine"):
        c = census_one(os.path.join(MEMBER, other))
        print(f"  {other}: {len(c['occ'])} `volume` reads, "
              f"{len(c['implicit'])} implicit-volume builtins")
    print()

    if FAILURES:
        print(f"CONTROLS FAILED: {', '.join(FAILURES)}")
        return 1
    print("ALL CONTROLS OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
