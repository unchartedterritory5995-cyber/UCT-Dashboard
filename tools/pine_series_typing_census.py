# -*- coding: utf-8 -*-
"""item (g) — the SERIES TYPING census: `s := close` and everything shaped like it.

WHAT (g) ASKS. A REASSIGNMENT — `:=`, never a declaration — whose right-hand side is
series-valued: a bare builtin (`close`, `open`, `high`, `low`, `volume`, `hl2`, `hlc3`,
`ohlc4`, `hlcc4`, `time`), another series-valued binding, an expression over one, or a
call that answers with one. The question behind it is whether the engine LOSES the fact
that `s` became a series — so a later `s[1]` or an output read misbehaves — or whether
it refuses correctly with a sentence that reads like a different problem.

WHY A CENSUS AND NOT A REVIEW. `pine.js` has THREE separate `:=` paths — the top-level
walk (`pine.js:11063`), `foldStatements` inside a block (`pine.js:9574`), and the
closing pass that overrules both (`pine.js:11328`) — and which one a use lands in is
decided by where the line SITS, not by what it says. Only counting tells you which path
the corpus actually exercises.

THE FIVE AXES, per use:

  DECLARED   the form of the ORIGINAL declaration — `var float x =` / `float x =` /
             bare `x =` / `varip` / none found. Pine's type word is what a reader
             thinks decides this; the engine DROPS it (`TYPE_WORDS` exists only so
             `boundName` does not mistake `float` for the bound name), so the census
             reports it to show the gap between what is written and what is kept.
  RHS KIND   bare builtin / series binding / call -> series / expression over series
  IN BLOCK   top-level / if / else / for / while / switch / function body. ⭐ THIS IS
             THE LOAD-BEARING AXIS: `if` folds (`foldIfChain`), `for`/`while`/`switch`
             do not and force `pine:reassign` at `pine.js:10938`.
  REACHED    is the target read by an output — INTERPROCEDURALLY, through binding
             chains and through user function BODIES, not by looking for the name
             inside a `plot(...)` argument. Both numbers are printed, because the
             direct one is what a line-based check would have reported.
  HISTORY    is the target later read as `s[k]`. This is where typing actually bites:
             `Resolver.plainRecurrence` (`pine.js:6024`) turns `s[k]` on a reassigned
             name into an `accum` column, and `guardOffsetOfMutable` (`pine.js:6065`)
             refuses `pine:state` when the binding in scope is not the last word.

⛔ COMMENTS AND STRING LITERALS ARE STRIPPED BEFORE MATCHING, and every needle that
could match this file's own prose is built by CONCATENATION. The stripper carries
controls BOTH ways: one proving it removes a commented occurrence, one proving it still
sees a real one.

⚠️ THE OPERATOR TRAP AND ITS CONTROL. `:=` / `=` / `==` / `>=` / `<=` / `!=` / `+=` /
`=>` all contain `=`. A naive `^\\s*(\\w+)\\s*=` swallows `c == close` as a declaration
of `c` AND `h => close` as a declaration of `h`. The declaration reader is anchored on
both sides — a lookbehind rejecting the tail of a longer operator, a lookahead
rejecting `==` and `=>` — and `ordering-naive-would-overcount` PRINTS what the naive
reader counts beside what the anchored one counts, so the ordering is shown and not
merely asserted.

⚰️ A STATEMENT IS NOT A LINE, AND THE CONTROL IS WHAT SAID SO. The first version
anchored `:=` at the head of a line. `corpus/committed/3-level-zigzag-semafor__3078.pine`
writes `int _direction = na , _direction := switch` — Pine's comma-joined statements,
the same split `pine.js::blockStatements` performs — so that file reported ZERO `:=`
while the shipped door refuses it `pine:reassign`. The committed-number control
(`reassign-refusals-explained`) came back 12 of 13 and named the file. Every line is
now split on TOP-LEVEL commas first; commas inside `(...)` or `[...]` are arguments and
a tuple destructure is left whole.

⚠️ NAMED ARGUMENTS ARE ARGUMENTS. `plot(close,\\n     title = "x")` puts a line
beginning `title =` into the file; a line-anchored declaration reader binds a name
`title` that no member wrote. The reader tracks bracket depth across lines and skips
every continuation line, and `named-arg-not-a-declaration` proves it.

⚠️⚠️ ASK THE KIND OF THE VALUE, NEVER "IS A SERIES NAME ANYWHERE IN THE TEXT".
`V_COL := close > open ? upcol : downcol` mentions `close` and `open` and its value is
a COLOUR. A condition is not a value position, so `value_parts` strips the condition of
every top-level ternary and asks only the ARMS — and a colour, a string, a drawing
handle or a collection is EXCLUDED from the population by name, because each already
has its own refusal code (`pine:colour-value`, `pine:text-value`, `pine:drawing`,
`pine:collection`) and none of them is (g).

⛔ THE ADMISSIBILITY AUTHORITIES ARE READ, NOT TYPED. `NODE_TYPES` out of `parse.js`,
the `REFUSALS` roster out of `pine.js`, `OUTPUT_CALLS` out of `pine.js`, and the served
call set out of `closedTable.json` the way `parse.js::hostAdmissible` reads it. Each is
a CONTROL with a committed expected value and this tool exits non-zero if any disagrees.

Usage:  python tools/pine_series_typing_census.py [--list FORM_INDEX]
"""
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, 'corpus', 'committed')
MEMBER = os.path.join(ROOT, 'tests', 'fixtures', 'member')
ENGINE = os.path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine', 'ast')
METRIC = os.path.join(ROOT, 'tools', 'corpus_metric.json')

# ── needles built by CONCATENATION so this file's own prose is never a match ──
OP_REASSIGN = ':' + '='

#: Pine's bare series builtins. ⛔ `bar_index` is deliberately NOT here: it is a bar
#: counter, and calling it a price series would drag every `i := bar_index` into a
#: census about price typing. It is a series for Pine's purposes and is reported on
#: its own line rather than silently folded into the population.
SERIES_BUILTINS = ('close', 'open', 'high', 'low', 'volume',
                   'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time', 'time_close')
COUNTER_BUILTINS = ('bar_index',)

#: Namespaces whose calls answer with a column when any argument is one.
SERIES_NAMESPACES = ('ta.', 'request.', 'math.')

#: Namespaces whose value is NOT a number, with the refusal code that already owns
#: each — which is why none of them is (g) and none needs a 42nd code.
NON_NUMERIC_NS = (
    ('color.', 'colour', 'pine:colour-value'),
    ('str.', 'string', 'pine:text-value'),
    ('label.', 'drawing', 'pine:drawing'),
    ('line.', 'drawing', 'pine:drawing'),
    ('box.', 'drawing', 'pine:drawing'),
    ('table.', 'drawing', 'pine:drawing'),
    ('polyline.', 'drawing', 'pine:drawing'),
    ('linefill.', 'drawing', 'pine:drawing'),
    ('array.new', 'collection', 'pine:collection'),
    ('matrix.new', 'collection', 'pine:collection'),
    ('map.new', 'collection', 'pine:collection'),
)
#: Declared type words that settle the kind without reading the right-hand side.
NON_NUMERIC_TYPES = {'color': 'colour', 'string': 'string', 'label': 'drawing',
                     'line': 'drawing', 'box': 'drawing', 'table': 'drawing',
                     'polyline': 'drawing', 'linefill': 'drawing',
                     'array': 'collection', 'matrix': 'collection', 'map': 'collection'}

#: Constructs the frozen 11 `NODE_TYPES` cannot carry as a scalar value. A numeric
#: `:=` whose RHS reaches one of these is NOT admissible for (g) — and still needs no
#: 42nd refusal, because `pine:collection` and `pine:type` already exist.
INADMISSIBLE_MARKS = ('array.', 'matrix.', 'map.', '.new(')

BLOCK_HEADS = ('if', 'else', 'for', 'while', 'switch')
TYPE_WORDS = ('series', 'simple', 'const', 'input', 'int', 'float', 'bool', 'string',
              'color', 'line', 'linefill', 'label', 'box', 'polyline', 'table',
              'array', 'matrix', 'map')
STATE_WORDS = ('var', 'varip')
KEYWORDS = set(BLOCK_HEADS) | set(TYPE_WORDS) | set(STATE_WORDS) | {
    'and', 'or', 'not', 'true', 'false', 'na', 'to', 'by', 'in', 'export', 'import',
    'method', 'type', 'enum', 'continue', 'break', 'indicator', 'study', 'strategy',
}


# --------------------------------------------------------------------------- #
# the stripper
# --------------------------------------------------------------------------- #
def strip_pine(src):
    """`//` comments and string literals out, line structure preserved.

    Every removed character becomes a space, so column arithmetic still lands.
    """
    out = []
    for line in src.split('\n'):
        res, i, n, quote = [], 0, len(line), None
        while i < n:
            ch = line[i]
            if quote:
                if ch == '\\':
                    res.append('  ')
                    i += 2
                    continue
                res.append(' ')
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in '"\'':
                quote = ch
                res.append(' ')
                i += 1
                continue
            if ch == '/' and i + 1 < n and line[i + 1] == '/':
                break
            res.append(ch)
            i += 1
        out.append(''.join(res))
    return out


# --------------------------------------------------------------------------- #
# the operator readers — ORDERED BY SPECIFICITY, longest operator first
# --------------------------------------------------------------------------- #
#: `name := rhs`. The two-character operator is matched WHOLE, so no `=` reader can
#: reach it.
RE_REASSIGN = re.compile(r'^\s*([A-Za-z_]\w*)\s*' + re.escape(OP_REASSIGN) + r'\s*(\S.*)$')
#: `name += rhs` and friends — a reassignment too, counted apart because `+=`
#: desugars through `boundNode` and `:=` does not (`pine.js:9593`).
RE_COMPOUND = re.compile(r'^\s*([A-Za-z_]\w*)\s*([+\-*/%]' + '=' + r')\s*(\S.*)$')
#: A DECLARATION. ⚠️ `(?<![=!<>+\-*/%:])` rejects the trailing `=` of `==` `!=` `<=`
#: `>=` `+=` `:=`; `(?![=>])` rejects the LEADING `=` of `==` and of `=>`. Both halves
#: are needed and the ordering control counts what each one saves.
RE_DECLARE = re.compile(
    r'^\s*((?:(?:var|varip)\s+)?(?:(?:series|simple|const|input|int|float|bool|string|'
    r'color|line|linefill|label|box|polyline|table|array|matrix|map)\s+)*)'
    r'([A-Za-z_]\w*)\s*(?<![=!<>+\-*/%:])=(?![=>])\s*(\S.*)$')
#: What a careless reader would have used. Kept ONLY so the ordering control can count
#: it; it classifies nothing.
RE_DECLARE_NAIVE = re.compile(r'^\s*([A-Za-z_]\w*)\s*=\s*(\S.*)$')

RE_IDENT = re.compile(r'\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*')
RE_CALL = re.compile(r'\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(')
RE_FNDEF = re.compile(r'^(\s*)([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.*)$')


def idents(text):
    """Identifiers in `text`, dotted names kept whole, keywords dropped."""
    return [t for t in RE_IDENT.findall(text or '') if t.split('.')[0] not in KEYWORDS]


def indent_of(line):
    return len(line) - len(line.lstrip())


def open_depth(text):
    """Net bracket depth a fragment leaves behind (strings already stripped)."""
    d = 0
    for ch in text:
        if ch in '([':
            d += 1
        elif ch in ')]':
            d -= 1
    return d


def split_statements(line):
    """⭐ A LINE IS NOT A STATEMENT. Pine joins statements with a TOP-LEVEL comma —
    `int d = na , d := switch` — which is the split `pine.js::blockStatements` makes.
    Commas inside `(...)` or `[...]` are arguments or a tuple destructure and are left
    alone."""
    parts, depth, cur = [], 0, []
    for ch in line:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if depth == 0 and ch == ',':
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append(''.join(cur))
    return [p for p in parts if p.strip()]


def value_parts(text):
    """⭐⭐ THE SUB-EXPRESSIONS WHOSE KIND IS THIS EXPRESSION'S KIND.

    For `cond ? a : b` that is `a` and `b` — NEVER `cond`. A condition mentions
    `close` and `open` constantly and decides nothing about the value, which is how
    `V_COL := close > open ? upcol : downcol` was counted as a series-typed
    reassignment in v1 of this tool (54 uses in one file, every one of them a colour).
    """
    body = text.strip()
    while body.startswith('(') and body.endswith(')') and open_depth(body[1:-1]) == 0:
        body = body[1:-1].strip()
    depth, q = 0, -1
    for i, ch in enumerate(body):
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif ch == '?' and depth == 0:
            q = i
            break
    if q < 0:
        return [body]
    depth, pending = 0, 0
    for i in range(q + 1, len(body)):
        ch = body[i]
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif depth == 0 and ch == '?':
            pending += 1
        elif depth == 0 and ch == ':':
            if pending:
                pending -= 1
                continue
            return value_parts(body[q + 1:i]) + value_parts(body[i + 1:])
    return [body[q + 1:].strip()]


# --------------------------------------------------------------------------- #
# per-file model
# --------------------------------------------------------------------------- #
class Script(object):
    """One .pine file, read once, every axis answered off the same token pass."""

    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(path)
        self.lines = strip_pine(io.open(path, encoding='utf-8', errors='replace').read())

        #: lines that BEGIN inside an unclosed bracket — a named argument on a
        #: continuation line is an ARGUMENT, not a declaration.
        self.continuation = []
        depth = 0
        for line in self.lines:
            self.continuation.append(depth > 0)
            depth = max(0, depth + open_depth(line))

        self.decl = {}                     # name -> (line, qualifier, rhs)
        self.assigns = defaultdict(list)   # name -> [rhs, ...] every := and compound
        self.fnbody = {}                   # name -> WHOLE body text of `f(a) => …`
        self.enclosing = []                # per line: innermost block head, or None
        #: ⭐ names bound by `[a, b] = f()`. The recorded ordering-defect class is
        #: "`foldStatements` never learned destructures, and every outer `var` a
        #: branch assigned went opaque as `pine:reassign`" — so whether (g) needs
        #: `destructureBindings` touched is a NUMBER, not an opinion.
        self.destructured = set()
        self._scan()
        self.hist = self._history_names()
        self._kind_memo = {}

    # -- structure ---------------------------------------------------------- #
    def statements(self):
        """(line_index, statement_text) for every statement in the file."""
        for i, line in enumerate(self.lines):
            if self.continuation[i] or not line.strip():
                continue
            for part in split_statements(line):
                yield i, part

    def _block_below(self, at):
        base = indent_of(self.lines[at])
        body = []
        for k in range(at + 1, len(self.lines)):
            if not self.lines[k].strip():
                continue
            if indent_of(self.lines[k]) <= base:
                break
            body.append(self.lines[k].strip())
        return '\n'.join(body)

    def _scan(self):
        stack = []              # (indent, head)
        for i, line in enumerate(self.lines):
            if not line.strip():
                self.enclosing.append(stack[-1][1] if stack else None)
                continue
            ind = indent_of(line)
            while stack and ind <= stack[-1][0]:
                stack.pop()
            self.enclosing.append(stack[-1][1] if stack else None)
            if self.continuation[i]:
                continue

            fn = RE_FNDEF.match(line)
            if fn:
                # ⭐ THE WHOLE BODY, NOT THE TAIL. A multi-line `f() =>` has an EMPTY
                # tail, and taking only the tail cut every interprocedural path that
                # runs through a real user function — which is most of them.
                self.fnbody[fn.group(2)] = (fn.group(4) + '\n' + self._block_below(i)).strip()
                stack.append((ind, 'function'))
                continue

            opened = None
            for part in split_statements(line):
                body = part.strip()
                dst = re.match(r'^\[([^\]]*)\]\s*(?<![=!<>+\-*/%:])=(?![=>])', body)
                if dst:
                    for nm in dst.group(1).split(','):
                        nm = nm.strip().split()[-1] if nm.strip() else ''
                        if re.match(r'^[A-Za-z_]\w*$', nm):
                            self.destructured.add(nm)
                    continue
                lead = body.split('(')[0].split()
                head = lead[0] if lead else ''
                if head in BLOCK_HEADS:
                    opened = 'else' if head == 'else' else head
                    continue
                m = RE_REASSIGN.match(body)
                if m:
                    self.assigns[m.group(1)].append(m.group(2).strip())
                    if m.group(2).strip().split('(')[0].strip() in BLOCK_HEADS:
                        opened = m.group(2).strip().split('(')[0].strip()
                    continue
                m = RE_COMPOUND.match(body)
                if m:
                    self.assigns[m.group(1)].append(m.group(3).strip())
                    continue
                d = RE_DECLARE.match(body)
                if d:
                    if d.group(2) not in self.decl:
                        self.decl[d.group(2)] = (i + 1, d.group(1).strip(), d.group(3).strip())
                    rhs_head = d.group(3).split('(')[0].strip()
                    if rhs_head in BLOCK_HEADS:
                        opened = rhs_head
            if opened:
                stack.append((ind, opened))

    def _history_names(self):
        """Names read as `n[k]`. ⛔ Word-bounded: `bars[1]` is not `s[1]`."""
        out = Counter()
        for line in self.lines:
            for m in re.finditer(r'\b([A-Za-z_]\w*)\s*\[', line):
                out[m.group(1)] += 1
        return out

    # -- the kind of a value ------------------------------------------------ #
    def value_kind(self, text, seen=None):
        """'colour' | 'string' | 'drawing' | 'collection' | 'series' | 'plain'.

        ⭐ ASKED IN SPECIFICITY ORDER, and only at VALUE positions. A non-numeric
        namespace settles it outright; otherwise a builtin column, a series namespace
        call, or a binding that reaches one makes it a series; anything else is plain.
        """
        if not text:
            return 'plain'
        seen = seen if seen is not None else set()
        best = 'plain'
        for part in value_parts(text):
            for prefix, kind, _code in NON_NUMERIC_NS:
                if prefix in part:
                    return kind
            toks = idents(part)
            if any(t in SERIES_BUILTINS for t in toks):
                best = 'series'
                continue
            if any(ns in part for ns in SERIES_NAMESPACES):
                best = 'series'
                continue
            for t in toks:
                if '.' in t or t in seen or t in SERIES_BUILTINS or t in COUNTER_BUILTINS:
                    continue
                seen.add(t)
                if t in self._kind_memo:
                    k = self._kind_memo[t]
                else:
                    sources = []
                    if t in self.decl:
                        sources.append(self.decl[t][2])
                    sources.extend(self.assigns.get(t, []))
                    if t in self.fnbody:
                        sources.append(self.fnbody[t])
                    k = 'plain'
                    for s in sources:
                        sk = self.value_kind(s, seen)
                        if sk in ('colour', 'string', 'drawing', 'collection'):
                            k = sk
                            break
                        if sk == 'series':
                            k = 'series'
                    self._kind_memo[t] = k
                if k in ('colour', 'string', 'drawing', 'collection'):
                    return k
                if k == 'series':
                    best = 'series'
        return best

    def rhs_kind(self, rhs, declared_type):
        """The RHS's shape, ORDERED BY SPECIFICITY — a whole-RHS builtin, then a
        whole-RHS name, then a whole-RHS call, then the general expression.

        Returns (shape, why_excluded). `shape` is None when the use is not (g)."""
        for word in (declared_type or '').split():
            if word in NON_NUMERIC_TYPES:
                return None, 'declared %s' % NON_NUMERIC_TYPES[word]
        kind = self.value_kind(rhs)
        if kind in ('colour', 'string', 'drawing', 'collection'):
            return None, 'value is a %s' % kind
        if kind != 'series':
            return None, 'RHS not series-valued'
        body = rhs.strip()
        while body.startswith('(') and body.endswith(')') and open_depth(body[1:-1]) == 0:
            body = body[1:-1].strip()
        if body in SERIES_BUILTINS:
            return 'bare builtin', None
        if re.match(r'^[A-Za-z_]\w*$', body):
            return 'series binding', None
        m = re.match(r'^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\((.*)\)$', body)
        if m and open_depth(m.group(2)) == 0:
            return 'call -> series', None
        return 'expr over series', None

    # -- reachability ------------------------------------------------------- #
    def output_arg_text(self):
        """The argument text of every output call, NAMED ARGUMENT NAMES REMOVED.

        ⛔ `plot(x, title = colTitle)` mentions `title`; seeding reachability with it
        would make a parameter name a binding. The NAME before a `=` inside a call is
        dropped; the VALUE after it is kept, because that is where a real read lives
        (`color = trendCol`)."""
        chunks = []
        for i, line in enumerate(self.lines):
            for m in RE_CALL.finditer(line):
                if m.group(1) not in OUTPUT_CALLS:
                    continue
                text, depth, j, k = '', 0, i, m.end() - 1
                while j < len(self.lines):
                    seg = self.lines[j][k:] if j == i else self.lines[j]
                    for ch in seg:
                        text += ch
                        if ch in '([':
                            depth += 1
                        elif ch in ')]':
                            depth -= 1
                            if depth == 0:
                                break
                    if depth == 0:
                        break
                    j += 1
                    k = 0
                chunks.append(re.sub(r'\b[A-Za-z_]\w*\s*(?<![=!<>+\-*/%:])=(?![=>])',
                                     ' ', text))
        return chunks

    def reachable(self):
        """⭐ INTERPROCEDURAL. A line-based "is the name inside a `plot(...)`" answers
        for the FIRST HOP ONLY; real scripts reach a reassigned name through three or
        four bindings and through a user function's whole body."""
        seeds = set()
        for chunk in self.output_arg_text():
            seeds.update(idents(chunk))
        direct = set(seeds)
        frontier, seen = list(seeds), set(seeds)
        while frontier:
            n = frontier.pop()
            nxt = []
            if n in self.decl:
                nxt.append(self.decl[n][2])
            nxt.extend(self.assigns.get(n, []))
            if n in self.fnbody:
                nxt.append(self.fnbody[n])
            for text in nxt:
                for t in idents(text):
                    if t not in seen:
                        seen.add(t)
                        frontier.append(t)
        return direct, seen


# --------------------------------------------------------------------------- #
# the authorities — READ out of the engine, never retyped
# --------------------------------------------------------------------------- #
def _brace_block(src, at):
    depth, i = 0, src.index('{', at)
    start = i
    while i < len(src):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    return src[start:i]


def read_node_types():
    src = io.open(os.path.join(ENGINE, 'parse.js'), encoding='utf-8').read()
    at = src.index('export const NODE_TYPES')
    return re.findall(r"'([a-z_]+)'", src[at:src.index('])', at)])


def read_refusals():
    src = io.open(os.path.join(ENGINE, 'pine.js'), encoding='utf-8').read()
    return re.findall(r"^  '([a-z]+:[a-z-]+)':",
                      _brace_block(src, src.index('const REFUSALS')), re.M)


def read_output_calls():
    src = io.open(os.path.join(ENGINE, 'pine.js'), encoding='utf-8').read()
    out = set()
    for tag in ('const OUTPUT_CALLS = Object.freeze({',
                'const MULTI_OUTPUT_CALLS = Object.freeze({'):
        out.update(re.findall(r'^  ([a-z]+):', _brace_block(src, src.index(tag)), re.M))
    # ⭐ AND THE PAINT CALLS. `bgcolor`/`barcolor`/`fill` read a member's series and
    # produce no column; a value that reaches one has still been READ, and leaving
    # them out would report a live binding as unreached.
    out.update({'bgcolor', 'barcolor', 'fill'})
    return out


def read_served_calls():
    """`closedTable.json::functions` plus what `parse.js::hostAdmissible` admits —
    derived the way that function derives it, never typed here."""
    table = json.load(io.open(os.path.join(ENGINE, 'closedTable.json'), encoding='utf-8'))
    served = set(table.get('functions', {}).keys())
    for tag, spec in (table.get('_requirement_tags') or {}).items():
        if tag.startswith('_') or not isinstance(spec, dict):
            continue
        if 'pane' not in (spec.get('accepted_by') or []):
            continue
        served.update(spec.get('calls') or [])
    return served


NODE_TYPES = read_node_types()
REFUSALS = read_refusals()
OUTPUT_CALLS = read_output_calls()
SERVED = read_served_calls()


# --------------------------------------------------------------------------- #
# controls
# --------------------------------------------------------------------------- #
CONTROLS = []


def control(name, expected, got):
    CONTROLS.append((name, expected, got, expected == got))


def run_controls():
    # ── the stripper, BOTH ways ──────────────────────────────────────────────
    probe = '\n'.join([
        '// s %s close    <- a COMMENT, not a use' % OP_REASSIGN,
        'msg = "s %s close"   <- a STRING, not a use' % OP_REASSIGN,
        's %s close' % OP_REASSIGN,
    ])
    control('stripper-sees-all-3-unstripped', 3,
            len(re.findall(re.escape(OP_REASSIGN), probe)))
    control('stripper-leaves-the-1-real-one', 1,
            sum(1 for ln in strip_pine(probe) if RE_REASSIGN.match(ln)))

    # ── the operator ordering, SHOWN and not merely asserted ─────────────────
    ops = ['a = close', 'b %s close' % OP_REASSIGN, 'c == close', 'd >= close',
           'e <= close', 'f != close', 'g += close', 'h => close']
    control('ordering-reassign-finds-only-b', 1, sum(1 for ln in ops if RE_REASSIGN.match(ln)))
    control('ordering-compound-finds-only-g', 1, sum(1 for ln in ops if RE_COMPOUND.match(ln)))
    control('ordering-declare-finds-only-a', 1, sum(1 for ln in ops if RE_DECLARE.match(ln)))
    # ⚰️ THE DEFECT THE ANCHORS PREVENT, MEASURED RATHER THAN CLAIMED: the naive
    # reader takes `a = close` AND `c == close` AND `h => close` — three, not one.
    control('ordering-naive-would-take-3', 3,
            sum(1 for ln in ops if RE_DECLARE_NAIVE.match(ln)))

    # ── a statement is not a line ────────────────────────────────────────────
    control('comma-joined-statement-split', 1,
            sum(1 for p in split_statements('    int d = na , d %s switch' % OP_REASSIGN)
                if RE_REASSIGN.match(p.strip())))
    control('tuple-destructure-not-split', 1,
            len(split_statements('[a, b] = f(x, y)')))

    # ── named arguments are arguments ────────────────────────────────────────
    lines = strip_pine('plot(close,\n     title = "HTF MA",\n     color = c)')
    depth, cont = 0, []
    for ln in lines:
        cont.append(depth > 0)
        depth = max(0, depth + open_depth(ln))
    control('named-arg-not-a-declaration', 0,
            sum(1 for k, ln in enumerate(lines) if RE_DECLARE.match(ln) and not cont[k]))

    # ── the kind is asked before the literal ─────────────────────────────────
    control('ternary-condition-is-not-a-value', ['upcol', 'downcol'],
            value_parts('close > open ? upcol : downcol'))

    # ── the admissibility authorities ────────────────────────────────────────
    control('NODE_TYPES-frozen-11', 11, len(NODE_TYPES))
    control('REFUSALS-frozen-41', 41, len(REFUSALS))
    control('pine-reassign-is-in-REFUSALS', True, 'pine:reassign' in REFUSALS)
    control('served-calls-read-from-table', 72, len(SERVED))


# --------------------------------------------------------------------------- #
# the population
# --------------------------------------------------------------------------- #
def scripts():
    out = []
    for d in (CORPUS, MEMBER):
        for n in sorted(os.listdir(d)):
            if n.endswith('.pine'):
                out.append(os.path.join(d, n))
    return out


def declared_form(qualifier):
    q = (qualifier or '').split()
    if not q:
        return 'bare  x ='
    if q[0] == 'varip':
        return 'varip %s' % (' '.join(q[1:]) or '(untyped)')
    if q[0] == 'var':
        return 'var %s' % (' '.join(q[1:]) or '(untyped)')
    return ' '.join(q)


def admissible(rhs):
    """Expressible with no 12th `NODE_TYPES` member and no 42nd `REFUSALS` entry."""
    return not any(mark in rhs for mark in INADMISSIBLE_MARKS)


def served_rhs(rhs):
    """Every call in the RHS is one `closedTable.json` declares."""
    return all(name.split('.')[-1] in SERVED for name in RE_CALL.findall(rhs))


def collect():
    rows, totals, excluded, every = [], Counter(), Counter(), []
    for path in scripts():
        s = Script(path)
        direct, deep = s.reachable()
        totals['files'] += 1
        for i, part in s.statements():
            body = part.strip()
            if RE_COMPOUND.match(body):
                totals['compound'] += 1
                continue
            m = RE_REASSIGN.match(body)
            if not m:
                continue
            totals['reassign'] += 1
            name, rhs = m.group(1), m.group(2).strip()
            decl = s.decl.get(name)
            every.append((s.name, i + 1, s.enclosing[i] or 'top-level',
                          decl[0] if decl else None))
            kind, why = s.rhs_kind(rhs, decl[1] if decl else '')
            if kind is None:
                excluded[why] += 1
                continue
            rows.append({
                'file': s.name, 'line': i + 1, 'name': name, 'rhs': rhs,
                'declared': declared_form(decl[1]) if decl else 'no declaration',
                'decl_line': decl[0] if decl else None,
                'kind': kind,
                'block': s.enclosing[i] or 'top-level',
                'direct': name in direct,
                'reached': name in deep,
                'history': s.hist.get(name, 0),
                'admissible': admissible(rhs),
                'served': served_rhs(rhs),
                'destructured': name in s.destructured,
            })
    return rows, totals, excluded, every


def metric_controls(every):
    """⛔⛔ THE CONTROL THAT CAN ACTUALLY FAIL ON A CENSUS DEFECT, and did.

    The engine refuses `pine:reassign` when a mutation lands where the fold could not
    read it — `pine.js:10938` (a `for`/`while`/`switch` body) or `pine.js:11347` (any
    `:=` token the walk never consumed). So for EVERY script the SHIPPED DOOR refuses,
    this census must find at least one `:=` that is not a plain top-level reassignment
    of a name it also found a declaration for. It came back 12 of 13 on the first run
    and named `3-level-zigzag-semafor__3078.pine`, whose `:=` follows a comma.
    """
    metric = json.load(io.open(METRIC, encoding='utf-8'))
    control('corpus-scripts', 266, metric['scripts'])
    control('door-host-ok', 32, metric['host_ok'])
    refusing = {r['file'] for r in metric['rows']
                if 'pine:reassign' in (r['hostGuards'] or [])}
    control('scripts-the-door-refuses-reassign', 13, len(refusing))

    by_file = defaultdict(list)
    for f, line, block, decl in every:
        by_file[f].append((block, decl))
    def unfoldable(f):
        return any(b != 'top-level' or d is None for b, d in by_file.get(f, []))
    control('reassign-refusals-explained', 13, sum(1 for f in refusing if unfoldable(f)))
    # ⭐ AND THE ANTI-VACUITY NUMBER, because a predicate that fires everywhere would
    # "explain" all 13 and mean nothing.
    fires = sum(1 for f in by_file if unfoldable(f))
    return metric, refusing, fires


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #
def main():
    w = sys.stdout.buffer.write
    run_controls()
    rows, totals, excluded, every = collect()
    metric, refusing, fires = metric_controls(every)

    w(b'ITEM (g) - SERIES TYPING AT `:' + b'=` : THE CENSUS\n\n')
    w(('files scanned                        : %d  (266 corpus + %d member fixtures)\n'
       % (totals['files'], totals['files'] - 266)).encode())
    w(('statement-form `%s` reassignments     : %d\n'
       % (OP_REASSIGN, totals['reassign'])).encode())
    w(('compound `+=` and friends            : %d  (counted, a different desugaring)\n'
       % totals['compound']).encode())
    for why, n in excluded.most_common():
        w(('  excluded, %-33s: %d\n' % (why, n)).encode())
    w(('THE POPULATION (RHS series-valued)   : %d uses in %d files\n\n'
       % (len(rows), len({r['file'] for r in rows}))).encode())

    w(b'--- CONTROLS ---\n')
    for name, exp, got, ok in CONTROLS:
        w(('CONTROL: %-34s expected %-22s got %-22s %s\n'
           % (name, exp, got, 'OK' if ok else 'FAIL')).encode())
    w(('  anti-vacuity for `reassign-refusals-explained`: the same predicate fires on '
       '%d of %d files\n\n' % (fires, totals['files'])).encode())

    # ── the form table ──────────────────────────────────────────────────────
    forms = defaultdict(list)
    for r in rows:
        forms[(r['declared'], r['kind'], r['block'])].append(r)
    order = sorted(forms.items(), key=lambda kv: -len(kv[1]))

    w(b'--- THE TABLE: one row per FORM (declared-type x RHS-kind x in-block) ---\n')
    w(b'  A&R  = admissible (no 12th NODE_TYPE, no 42nd REFUSAL) AND reachable from an\n')
    w(b'         output INTERPROCEDURALLY.   dir = the same, reachability line-based.\n')
    w(b'  hist = uses whose target is later read `s[k]`.\n')
    w(b'  BINDING CONSTRAINT names the file:line of the specimen the row is read from.\n\n')
    w(('%-3s %-17s %-17s %-9s %5s %5s %5s %5s %5s  %s\n'
       % ('#', 'declared', 'RHS kind', 'in block', 'uses', 'files', 'A&R', 'dir',
          'hist', 'binding constraint (a named corpus script)')).encode())
    w(b'-' * 137 + b'\n')
    for n, (key, rs) in enumerate(order, 1):
        ar = [r for r in rs if r['admissible'] and r['reached']]
        spec = (ar or rs)[0]
        w(('%-3d %-17s %-17s %-9s %5d %5d %5d %5d %5d  %s:%d\n'
           % (n, key[0][:17], key[1][:17], key[2][:9], len(rs),
              len({r['file'] for r in rs}), len(ar),
              sum(1 for r in rs if r['direct']), sum(1 for r in rs if r['history']),
              spec['file'][:44], spec['line'])).encode('utf-8', 'replace'))

    w(b'\n--- THRESHOLD VERDICT PER FORM (~20 admissible-and-reachable) ---\n')
    for n, (key, rs) in enumerate(order, 1):
        ar = [r for r in rs if r['admissible'] and r['reached']]
        w(('  %-3d %-17s %-17s %-9s A&R %4d  -> %s\n'
           % (n, key[0][:17], key[1][:17], key[2][:9], len(ar),
              'BUILD candidate' if len(ar) >= 20
              else 'RETIRE (refuse or note BY NAME at its own line)')).encode())

    w(b'\n--- SENSITIVITY: each axis alone over the whole population ---\n')
    for label, keep in (
            ('admissible', lambda r: r['admissible']),
            ('reachable, INTERPROCEDURAL', lambda r: r['reached']),
            ('reachable, line-based only', lambda r: r['direct']),
            ('target later read as `s[k]`', lambda r: r['history'] > 0),
            ('top-level        (folds today)', lambda r: r['block'] == 'top-level'),
            ('inside if/else   (folds today)', lambda r: r['block'] in ('if', 'else')),
            ('inside a function(folds today)', lambda r: r['block'] == 'function'),
            ('inside for/while/switch (NOT)', lambda r: r['block'] in ('for', 'while', 'switch')),
            ('every RHS call served', lambda r: r['served']),
            ('target bound by a DESTRUCTURE', lambda r: r['destructured']),
    ):
        w(('  %-32s %5d of %d\n'
           % (label, sum(1 for r in rows if keep(r)), len(rows))).encode())

    w(b'\n--- THE HEADLINE ---\n')
    ar = [r for r in rows if r['admissible'] and r['reached']]
    w(('  admissible AND reachable                     : %d of %d uses, %d files\n'
       % (len(ar), len(rows), len({r['file'] for r in ar}))).encode())
    w(('  the same count with LINE-BASED reachability  : %d   <- what a check that is\n'
       % len([r for r in rows if r['admissible'] and r['direct']])).encode())
    w(b'                                                      not interprocedural reports\n')
    w(('  of the admissible-and-reachable, read `s[k]` : %d\n'
       % len([r for r in ar if r['history']])).encode())
    w(('  of the admissible-and-reachable, in for/while/switch (refused today): %d\n'
       % len([r for r in ar if r['block'] in ('for', 'while', 'switch')])).encode())
    w(('  of the admissible-and-reachable, top-level or if/else/function     : %d\n'
       % len([r for r in ar if r['block'] not in ('for', 'while', 'switch')])).encode())
    w(('  targets bound by a DESTRUCTURE (the recorded ordering-defect class)  : %d\n'
       % len([r for r in rows if r['destructured']])).encode())

    # ── g.4: what the SHIPPED DOOR already says about these same scripts ────
    w(b'\n--- g.4 EVIDENCE: the door\'s own measured answer, corpus_metric.json ---\n')
    m_by = {r['file']: r for r in metric['rows']}
    pop = {r['file'] for r in rows} & set(m_by)
    ok_files = sorted(f for f in pop if m_by[f]['host'])
    reass = sorted(f for f in pop if 'pine:reassign' in (m_by[f]['hostGuards'] or []))
    w(('  corpus scripts in the population                 : %d\n' % len(pop)).encode())
    w(('  of those the door translates END TO END (host ok): %d\n' % len(ok_files)).encode())
    w(('  of those the door refuses `pine:reassign`        : %d\n' % len(reass)).encode())

    w(b'\n  scripts carrying a REACHABLE ADMISSIBLE series-typed `:'
      + b'=` that the door translates END TO END\n'
      + b'  (each is a use that works today, on the shipped door, with no refusal):\n')
    shown = 0
    for f in ok_files:
        hits = [r for r in rows if r['file'] == f and r['reached'] and r['admissible']]
        if not hits:
            continue
        shown += 1
        for h in hits[:2]:
            w(('    %-44s :%-5d `%s %s %s`  [%s, %s, hist=%d]\n'
               % (f[:44], h['line'], h['name'][:16], OP_REASSIGN, h['rhs'][:24],
                  h['declared'], h['block'], h['history'])).encode('utf-8', 'replace'))
    w(('  -> %d script(s) of the %d host-ok scripts in the population.\n'
       % (shown, len(ok_files))).encode())
    w('  AN ABSENCE WOULD BE EVIDENCE ONLY IF A PRESENCE COULD HAVE BEEN SEEN, and it\n'
      '  can: these rows ARE the presence, read off the door\'s own measurement.\n'
      .encode())

    w(b'\n  scripts the door refuses `pine:reassign` - where the refusing use SITS:\n')
    for f in reass:
        hits = [r for r in rows if r['file'] == f]
        blocky = [h for h in hits if h['block'] in ('for', 'while', 'switch')]
        h = (blocky or hits)[0]
        w(('    %-44s :%-5d in %-9s reached=%-5s (for/while/switch uses here: %d)\n'
           % (f[:44], h['line'], h['block'], h['reached'], len(blocky)))
          .encode('utf-8', 'replace'))

    if len(sys.argv) > 2 and sys.argv[1] == '--list':
        key, rs = order[int(sys.argv[2]) - 1]
        w(('\nform %s: %s / %s / %s -- %d use(s)\n'
           % (sys.argv[2], key[0], key[1], key[2], len(rs))).encode())
        for r in rs[:80]:
            w(('  %-44s :%-5d %-16s %s %-28s A=%-5s R=%-5s h=%d\n'
               % (r['file'][:44], r['line'], r['name'][:16], OP_REASSIGN, r['rhs'][:28],
                  r['admissible'], r['reached'], r['history'])).encode('utf-8', 'replace'))

    bad = [c for c in CONTROLS if not c[3]]
    if bad:
        w(('\n*** %d CONTROL(S) FAILED: %s ***\n'
           % (len(bad), ', '.join(c[0] for c in bad))).encode())
        return 1
    w(b'\nall controls OK\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
