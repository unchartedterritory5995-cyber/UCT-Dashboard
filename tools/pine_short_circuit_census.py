# -*- coding: utf-8 -*-
"""item (e) - the SHORT-CIRCUIT census.

Pine's `and`, `or` and the ternary `?:` short-circuit: the right operand is not
evaluated when the left decides. This engine PLANS expressions rather than
evaluating them, so the question this census has to answer is whether that
difference is OBSERVABLE - and where.

⭐⭐ WHAT THE ENGINE DOES TODAY, READ OFF THE SOURCE, NOT INFERRED. Every one of
these is a line this file re-verifies at import (see `CITATIONS`), because a
citation nobody can quote is struck:

  * `and`/`or`/`?:` are all ONE node type - `op` - with the operator on `name`
    and the operands in `args`. `closedTable.json::operators` declares `&&`
    arity 2 yields bool, `||` arity 2 yields bool, `?:` arity 3 yields
    passthrough. No `ternary` node type exists and none is implied
    (`parse.js:378` freezes eleven).
  * THE ENGINE ALREADY SHORT-CIRCUITS AT PLAN TIME, and only when the deciding
    operand FOLDS TO A CONSTANT. `pine.js:5897` resolves the LEFT first and, if
    it folds to the operator's annihilator (`logicalAnnihilator`, `pine.js:4197`
    - 0 for `&&`, 1 for `||`), returns that constant WITHOUT RESOLVING THE
    RIGHT AT ALL. `pine.js:5914` does the same for the ternary: a branch a
    constant test never takes is not resolved.
  * AT RUN TIME NOTHING SHORT-CIRCUITS, AND THE SOURCE SAYS SO. `interpret.js`
    lifts both operands elementwise (`logical`, `interpret.js:2157`; `TERNARY`,
    `interpret.js:2191`) and `vm.js:306` states the position outright: "ARGUMENTS
    ARE ALREADY EVALUATED, which is correct HERE and will NOT be correct once a
    branch can have an effect."
  * LOOKBACK WALKS BOTH OPERANDS UNCONDITIONALLY. `interpret.js:2582`'s `op` arm
    is `Math.max` over EVERY arg; `lint.js:634`'s is `maxReach` over every arg.
    Neither asks which operand decides.

⛔⛔ AND THAT LAST PAIR IS WHY CASE (A) IS NOT THE DEFECT IT LOOKS LIKE, which
this census measures rather than argues. `maxLookback` is a STATIC upper bound
over every bar. When the left is a SERIES the short-circuit is a per-bar fact -
on some bar the left does not decide, the right runs, and its history is really
needed - so reserving it is CORRECT. When the left is PLAN-TIME DECIDABLE the
resolver has already dropped the right entirely, so there is nothing left to
account for. The instrument therefore reports both halves separately and lets
the table settle it.

⛔ COMMENTS AND STRING LITERALS ARE STRIPPED before matching - `strip_pine` is
imported from the (b) census rather than copied, so this lane and that one can
never answer differently about what a use is. The needles are built by
CONCATENATION (`_AND`, `_OR`, `_NA`, `_SEC`). ⚠️ The usual reason for that -
"the instrument must not match its own source" - is weaker here than in the
alert or security censuses, because `and`/`or`/`?` are English and this tool
reads only `.pine` files. It is done anyway, and the REAL guard is the stripper
control below, which runs BOTH ways.

⭐⭐ THE CONTROL IS ANOTHER CENSUS'S COMMITTED NUMBER, RE-DERIVED THROUGH ITS OWN
WALK. The (b) census measured **97** `input.timeframe` uses consumed by
`request.security`, over its own SOURCES. This tool re-derives that exact number
by calling (b)'s module - the same interprocedural `consumers_of` this census
uses for reachability - and exits non-zero if it cannot. A second control
re-verifies every engine citation above by reading the named line. An instrument
that cannot reproduce the number it extends, or quote the line it cites, is
measuring something else.

Usage:  python tools/pine_short_circuit_census.py
"""
import importlib.util
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: ⭐ THE TASK'S CORPUS, and deliberately NOT (b)/(c)/(d)'s wider one. The claim
#: this census is set against - `SESSION-STATE.md:723`, "No script in the
#: 266-script corpus depends on it" - is about THIS population, and a headline
#: measured over a different one is not comparable to it. The control still runs
#: over (b)'s own SOURCES, through (b)'s own enumeration, so the two populations
#: never get confused for one another.
SOURCES = [
    os.path.join(ROOT, 'corpus', 'committed'),
    os.path.join(ROOT, 'tests', 'fixtures', 'member'),
]
ENGINE = os.path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine')
TABLE_PATH = os.path.join(ENGINE, 'ast', 'closedTable.json')


def _load_b():
    """(b)'s module: ONE stripper, ONE interprocedural walk, not two."""
    p = os.path.join(ROOT, 'tools', 'pine_time_input_census.py')
    spec = importlib.util.spec_from_file_location('b_census', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


B = _load_b()
strip_pine = B.strip_pine
call_args = B.call_args
split_args = B.split_args

TABLE = json.load(io.open(TABLE_PATH, encoding='utf-8'))

# --------------------------------------------------------------------------- #
# the needles, by concatenation
# --------------------------------------------------------------------------- #
_AND = 'a' + 'nd'
_OR = 'o' + 'r'
_NA = 'n' + 'a'
_SEC = 'secu' + 'rity'
_REQ = 'requ' + 'est'

AND_RE = re.compile(r'(?<![\w.])%s(?![\w])' % _AND)
OR_RE = re.compile(r'(?<![\w.])%s(?![\w])' % _OR)
QMARK = re.compile(r'\?')
#: a BARE `na` - never `na(` (that is a declared function that translates)
NA_BARE = re.compile(r'(?<![\w.])%s(?![\w(])' % _NA)
SEC_CALL = re.compile(r'(?<![\w.])(?:%s\.)?%s\s*\(' % (_REQ, _SEC))
REQ_OTHER = re.compile(r'(?<![\w.])%s\.\w+\s*\(' % _REQ)
IFF_CALL = re.compile(r'(?<![\w.])iff\s*\(')
ANY_CALL = re.compile(r'(?<![\w.])([A-Za-z_][\w.]*)\s*\(')
HIST_REF = re.compile(r'\[[^\[\]]*\]')
IF_STMT = re.compile(r'^\s*(?:else\s+)?if(?![\w])')

#: ⛔ THE LOOKBACK-BEARING NAMES ARE READ OFF THE MANIFEST, NEVER TYPED. A
#: literal roster here would be a second authority over `closedTable.json`, and
#: the next function to declare a window would silently stop counting.
#: ⛔ `(?<![\w.])(?:ta\.)?` is instrument-standard 7's guard: `\blog\b` once
#: matched inside `math.log(...)` and moved a headline 84 -> 192 -> 193. A name
#: reached through ANY other namespace (`math.max`, `array.max`, `str.length`)
#: is a different function and is not counted.
def _lookback_names(table):
    out = set()
    for name, spec in (table.get('functions') or {}).items():
        if not isinstance(spec, dict):
            continue
        lb = spec.get('lookback', 0)
        if lb in (0, None, '0'):
            continue
        out.add(name)
    return out


LOOKBACK_NAMES = _lookback_names(TABLE)
LOOKBACK_CALL = re.compile(
    r'(?<![\w.])(?:ta\.)?(?:%s)\s*\('
    % '|'.join(re.escape(n) for n in sorted(LOOKBACK_NAMES, key=len, reverse=True)))

#: Pine's bar-reading scalars. A bare one of these makes an operand a SERIES.
BAR_SERIES = {'open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4',
              'hlcc4', 'time', 'time_close', 'bar_index', 'tr'}
#: Namespaces the engine settles at BIND time - one answer per symbol, per
#: chart, for the whole run. Not plan-time in the parse sense, but decidable
#: before any bar is read, which is the property (A) and (B) turn on.
BIND_TIME_NS = ('syminfo.', 'timeframe.', 'chart.', 'currency.')
LITERAL_WORDS = {'true', 'false'}

PLOT_RE = re.compile(r'(?<![\w.])(plot|plotshape|plotchar|plotcandle|plotarrow|'
                     r'plotbar|alertcondition|hline|fill|bgcolor|barcolor)\s*\(')


# --------------------------------------------------------------------------- #
# statements
# --------------------------------------------------------------------------- #
CONT_END = re.compile(
    r'(?:[+\-*/%%<>=!?:,(\[]|(?<![\w.])(?:%s|%s|not)(?![\w]))\s*$' % (_AND, _OR))
#: ⚰️⚰️ `=>` WAS IN THIS SET AND IT MERGED EVERY `switch` ARM WITH THE NEXT.
#: `3-level-zigzag-semafor__3078.pine:24` reads `_isDown[1] and _isUp and
#: _direction[1] != 1 => low`, its own statement; with `=>` here the following
#: arm `=> na` was glued on and the `and`'s right operand came back as
#: `_isDown[1] != 1 => low => na` - a bare `na` this census then counted as a
#: case-(B) poisoning site that does not exist. Found by reading the table's own
#: `na` rows, never by review.
CONT_START = re.compile(
    r'^\s*(?:[?:)\]]|[*/%%]|==|>=|<=|!=|(?:%s|%s)(?![\w]))' % (_AND, _OR))
#: `cond => value` - a `switch` arm or a one-line user function. Both put an
#: expression on each side of the arrow and neither is one expression.
ARROW = re.compile(r'=>')


def strip_pine_lines(raw):
    """(b)'s stripper, with the LINE STRUCTURE restored.

    ⚰️⚰️ `strip_pine` BLANKS EVERY CHARACTER INSIDE A STRING INCLUDING THE
    NEWLINE, so a quote that never closes on its line swallows the line break
    and the file loses a line. Measured on this corpus: **4 of 269 files**, up to
    **26 lines** in `delta-volume-candles-lucf__qADnaAfCPp.pine`. It is harmless
    to (b), which only ever asks "how many `\\n` precede this offset"; it is
    fatal here, because this census reads the stripped text and the
    comment-stripped text AS TWO PARALLEL LINE ARRAYS. They desynchronised, so
    after the first unterminated quote every continuation decision was made
    against the WRONG raw line and every reported line number was off - the
    single case-(B) hit in v3 was `higher-time-frame-fair-value-gap…pine:382`
    reported as `:374`, and it was a phantom produced by joining
    `if barstate.isconfirmed and i_alert_price` to the line below it.

    ⛔ THE STRIPPER IS STILL (b)'s - only the newlines are put back, one for one
    against `raw`, so what counts as a string or a comment has exactly one
    owner. `strip_pine` is substitution-only and therefore length-preserving,
    which is what makes the correction index-for-index safe.
    """
    s = list(strip_pine(raw))
    for i, c in enumerate(raw):
        if c == '\n':
            s[i] = '\n'
    return ''.join(s)


def strip_comments(src):
    """Comments out, STRINGS KEPT, length preserved.

    ⛔⛔ THE JOIN HEURISTIC MUST NOT SEE THE STRIPPER'S OUTPUT, and this function
    exists only because it did. `crv_cond = disp=='CRVOL (…)' and
    crv_disp=='Candles'` ends in a string; `strip_pine` blanks it, `rstrip()`
    then exposes the `==`, `CONT_END` reads a trailing `=` as a continuation and
    the next line - `plotcandle(...)` - is glued on. Measured on
    `volume-suite-by-leviathan__48da793360.pine:382`. It corrupted the right
    operand AND, because the joined text now contained a `plotcandle(` call,
    flipped that statement's `reaches an output` to true. An over-join fails in
    the FLATTERING direction, which is why it needs a control rather than a
    comment.
    """
    out = list(src)
    i, n, q = 0, len(src), None
    while i < n:
        c = src[i]
        if q:
            if c == '\\':
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in '"\'':
            q = c
            i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        i += 1
    return ''.join(out)
#: `f(a, b) =>` - a user function declaration, so a body expression can be
#: attributed to the function whose callers decide whether it reaches an output.
UDF_DECL = re.compile(r'^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>')
STMT_HEAD = re.compile(r'^\s*(?:(?:else\s+)?if|while|for)(?![\w])\s*')


def _bracket_delta(s):
    d = 0
    for c in s:
        if c in '([':
            d += 1
        elif c in ')]':
            d -= 1
    return d


def logical_lines(stripped, commentless):
    """Physical lines joined into STATEMENTS -> [(line_no, indent, stripped)].

    ⚠️ Pine continues an expression across lines, so a census that read physical
    lines would truncate every multi-line condition - and a truncated right
    operand classifies as `constant`, which is the flattering direction. The
    join count is printed as a diagnostic so this is a measurement rather than
    an assumption.

    ⛔ TWO TEXTS, TWO JOBS. Brackets are counted on the STRIPPED text (a `(`
    inside a string literal is not a bracket) and the continuation test is run
    on the COMMENTLESS text (a line ending in a string literal does not end in
    whatever character the stripper left behind). Using one text for both is the
    defect recorded above `strip_comments`.
    """
    slines = stripped.split('\n')
    rlines = commentless.split('\n')
    out = []
    sbuf, rbuf, start, indent, joins = None, None, 0, 0, 0
    for i in range(len(slines)):
        if sbuf is None:
            if not rlines[i].strip():
                continue
            sbuf, rbuf, start = slines[i], rlines[i], i + 1
            indent = len(slines[i]) - len(slines[i].lstrip())
        else:
            sbuf = sbuf + ' ' + slines[i]
            rbuf = rbuf + ' ' + rlines[i]
            joins += 1
        nxt = rlines[i + 1] if i + 1 < len(rlines) else ''
        if _bracket_delta(sbuf) > 0:
            continue
        if CONT_END.search(rbuf.rstrip()):
            continue
        if nxt.strip() and CONT_START.match(nxt):
            continue
        out.append((start, indent, sbuf))
        sbuf = rbuf = None
    if sbuf is not None:
        out.append((start, indent, sbuf))
    return out, joins


def split_arrows(expr):
    """Split a statement at top-level `=>`. A `switch` arm and a one-line user
    function each put an expression on BOTH sides, and neither side belongs in
    the other's operand."""
    dp = depths(expr)
    cuts = [m.start() for m in ARROW.finditer(expr) if dp[m.start()] == 0]
    if not cuts:
        return [expr]
    parts, prev = [], 0
    for c in cuts:
        parts.append(expr[prev:c])
        prev = c + 2
    parts.append(expr[prev:])
    return parts


def depths(s):
    """index -> bracket depth AT that index (a bracket reads its OUTER depth)."""
    d = 0
    arr = [0] * len(s)
    for i, c in enumerate(s):
        if c in '([':
            arr[i] = d
            d += 1
        elif c in ')]':
            d -= 1
            arr[i] = d
        else:
            arr[i] = d
    return arr


# --------------------------------------------------------------------------- #
# decomposition
# --------------------------------------------------------------------------- #
#
# ⛔⛔ PRECEDENCE, AND THE ORDER IS LOAD-BEARING (instrument standard 5). Pine
# binds `?:` loosest, then `or`, then `and`. Asking for `and` first would make
# `a and b or c` read as right operand `b or c` - a different expression with a
# different right operand and a different answer to every column below.
# ⛔ `or`/`and` are LEFT-associative, so the TOP node splits at the RIGHTMOST
# top-level occurrence; `?:` is RIGHT-associative, so it splits at the LEFTMOST
# `?` and the colon that matches it.
def decompose(expr, emit, depth=0):
    if depth > 48 or not expr.strip():
        return
    s = expr
    dp = depths(s)

    q = next((m.start() for m in QMARK.finditer(s) if dp[m.start()] == 0), None)
    if q is not None:
        nest, colon, i = 0, None, q + 1
        while i < len(s):
            if dp[i] == 0:
                if s[i] == '?':
                    nest += 1
                elif s[i] == ':' and (i + 1 >= len(s) or s[i + 1] != '='):
                    if nest == 0:
                        colon = i
                        break
                    nest -= 1
            i += 1
        if colon is not None:
            test, yes, no = s[:q], s[q + 1:colon], s[colon + 1:]
            emit('?:', test, [yes, no])
            for part in (test, yes, no):
                decompose(part, emit, depth + 1)
            return

    for label, rx in (('or', OR_RE), (_AND, AND_RE)):
        ms = [m for m in rx.finditer(s) if dp[m.start()] == 0]
        if ms:
            m = ms[-1]
            left, right = s[:m.start()], s[m.end():]
            emit(label, left, [right])
            decompose(left, emit, depth + 1)
            decompose(right, emit, depth + 1)
            return

    # Nothing at THIS level - descend into call arguments. `plot(a and b)` puts
    # every operator one bracket down, so a census that stopped here would find
    # the empty set and report it as evidence.
    for m in ANY_CALL.finditer(s):
        if dp[m.start()] != 0:
            continue
        inner = call_args(s, m.end() - 1)
        args = split_args(inner)
        # ⭐ `iff(cond, a, b)` IS Pine v2/v3's ternary, and `pine.js:1451` rewrites
        # it to `cOp('?:', ...)` - the same node, so it is the same use-shape and
        # is counted as one rather than as an ordinary call.
        if IFF_CALL.match(s, m.start()) and len(args) == 3:
            emit('iff', args[0], [args[1], args[2]])
        for a in args:
            decompose(a, emit, depth + 1)


# --------------------------------------------------------------------------- #
# classification
# --------------------------------------------------------------------------- #
NAMES_RE = re.compile(r'(?<![\w.])([A-Za-z_]\w*(?:\.\w+)*)')


def input_defaults(raw, stripped):
    """name -> (kind, defval), for every `input.*` bound to a name in this file."""
    out = {}
    for m in B.CALL.finditer(stripped):
        name = B.bound_name(raw, m.start())
        if not name:
            continue
        paren = raw.find('(', m.start())
        if paren < 0:
            continue
        out[name] = (m.group(1) or 'input', B.defval_of(call_args(raw, paren)) or '')
    return out


#: `x := …`, `x += …` - a REASSIGNMENT, which is what makes a name bar-varying.
REASSIGN = re.compile(r'^\s*(?:[A-Za-z_]\w*\s+)?([A-Za-z_]\w*)\s*(?::=|\+=|-=|\*=|/=|%%=)')


def bindings(stripped):
    """(name -> first right-hand side, names that are REASSIGNED).

    ⚰️⚰️ A NAME'S FIRST ASSIGNMENT IS NOT ITS VALUE, AND V2 OF THIS CENSUS
    BELIEVED IT WAS. `ai-supertrend-x-pivot-percentile-strategy…pine:103` writes
    `int direction = na` and then `direction := 1` three lines later;
    `atr-god-strategy-by-tradesmart…pine:29` writes `trend_st_1 = 1` and
    reassigns it twice. Reading only the declaration made both names PLAN-TIME
    CONSTANTS, so `direction == -1 and direction[1] == 1` was filed as a
    short-circuit opportunity with a decidable left - when it is an ordinary
    per-bar supertrend flip and the right operand's one bar of history is
    genuinely needed. Found by reading the (A) gap rows the tool printed.
    """
    reass = set()
    for ln in stripped.split('\n'):
        m = REASSIGN.match(ln)
        if m:
            reass.add(m.group(1))
    out = {}
    for ln in stripped.split('\n'):
        m = B.ASSIGN.match(ln)
        if m and m.group(1) not in out and m.group(1) not in reass:
            out[m.group(1)] = ln[m.end():]
    return out, reass


def decidable_names(stripped, inputs, reassigned=frozenset()):
    """Names settled before any bar is read - to a FIXED POINT, not one hop.

    ⛔ ONE HOP IS NOT ENOUGH, and the knob idiom is why: a script writes
    `showX = input.bool(false)` then `gate = showX` then `… and gate`. A
    one-hop test calls `gate` a series, classifies the left as undecidable and
    reports a short-circuit opportunity the resolver has already taken. The walk
    mirrors (b)'s `consumers_of` - iterate over assignments until nothing grows,
    bounded by the line count so a cycle cannot spin.
    """
    known = set(inputs)
    lines = stripped.split('\n')
    for _ in range(len(lines)):
        grew = False
        for ln in lines:
            m = B.ASSIGN.match(ln)
            if not m:
                continue
            lhs = m.group(1)
            if lhs in known or lhs in reassigned:
                continue
            rhs = ln[m.end():]
            if not rhs.strip():
                continue
            if _all_decidable(rhs, known):
                known.add(lhs)
                grew = True
        if not grew:
            break
    return known


def _atoms(text):
    return [n for n in NAMES_RE.findall(text)]


def _all_decidable(text, known):
    t = text.strip()
    if not t:
        return False
    if HIST_REF.search(t):
        return False
    for name in _atoms(t):
        base = name.split('.')[0]
        if name in LITERAL_WORDS or name == _NA:
            continue
        if any(name.startswith(ns) for ns in BIND_TIME_NS):
            continue
        if name in known or base in known:
            continue
        return False
    # a call whose name is not itself a known-decidable binding is not decidable
    for m in ANY_CALL.finditer(t):
        nm = m.group(1)
        if nm in known or any(nm.startswith(ns) for ns in BIND_TIME_NS):
            continue
        return False
    return True


def left_kind(text, inputs, known):
    """How the LEFT operand is settled: this is the column (A) and (B) turn on."""
    t = text.strip()
    if not t:
        # a blanked STRING literal is a plan-time constant, not an absent operand
        return 'literal' if text else 'empty'
    if t in LITERAL_WORDS or re.fullmatch(r'-?\d+(\.\d+)?', t):
        return 'literal'
    if not _all_decidable(t, known):
        return 'series'
    names = set(_atoms(t))
    if any(any(n.startswith(ns) for ns in BIND_TIME_NS) for n in names):
        return 'bind-time'
    if any(n in inputs or n in known for n in names):
        return 'input-default'
    return 'literal'


#: ⛔ ORDER BY SPECIFICITY (instrument standard 5). `request.security(close, …)`
#: is also a call and also mentions a series; asking "is it a call?" first would
#: file every case (C) under `call` and report case (C) as empty.
def right_shape(text):
    t = text.strip()
    # ⚰️ `text-literal` AND `empty` ARE DIFFERENT FACTS AND V1 CALLED BOTH EMPTY.
    # `strip_pine` blanks a string literal, so `marketStatus = isRanging ?
    # "Ranging" : "Trending"` arrives as whitespace of non-zero LENGTH. 687
    # operands read `empty` - which says "the instrument failed to parse an arm"
    # when what it actually met was a TEXT ternary, the one shape the frozen 11
    # hold only under a `textop` (`assertCanonical`). A zero-length arm is the
    # genuine parse artefact and keeps the name.
    if not t:
        return 'text-literal' if text else 'empty'
    if SEC_CALL.search(t):
        return _REQ + '.' + _SEC
    if REQ_OTHER.search(t):
        return _REQ + '.*'
    if NA_BARE.search(t):
        return _NA
    if ANY_CALL.search(t):
        return 'call'
    if HIST_REF.search(t):
        return 'series'
    for n in _atoms(t):
        if n in BAR_SERIES or n.split('.')[0] in BAR_SERIES:
            return 'series'
    if t in LITERAL_WORDS or re.fullmatch(r'-?\d+(\.\d+)?', t):
        return 'constant'
    return 'series'


def right_history(text):
    """Does this operand reserve bars? -> (bool, why)."""
    why = []
    if HIST_REF.search(text):
        why.append('history-ref')
    if LOOKBACK_CALL.search(text):
        why.append('windowed-call')
    return (bool(why), '+'.join(why) or '-')


#: `&&` is decided by a 0 on either side, `||` by a 1 - `logicalAnnihilator`,
#: `pine.js:4197`. Read here so this census and the resolver cannot disagree
#: about which constant prunes which operator.
ANNIHILATOR = {_AND: '0', 'or': '1'}

#: `Resolver.resolveInput`'s NUMERIC set (mirrored from (b)'s `NUMERIC`) - these
#: kinds fold to a `num` node. `source`/`price` fold to a SERIES, not a number,
#: so they are deliberately absent.
NUM_INPUT_KINDS = {'input', 'int', 'float', 'bool'}
#: kinds whose default is TEXT - foldable only through the string comparison.
STR_INPUT_KINDS = {'string', 'timeframe', 'session', 'symbol', 'text_area', 'enum'}
EQ_OPS = re.compile(r'(==|!=)')


def _blank_string(text):
    """True for an operand the stripper emptied - i.e. a string literal."""
    return bool(text) and not text.strip()


def _input_class(kind, defval):
    """'str' | 'num' | None - ASK THE DEFAULT BEFORE THE KIND.

    ⚰️ V2 ASKED THE KIND ONLY, AND THE CORPUS'S MOST-REQUESTING SCRIPT PAID FOR
    IT. `screener-mean-reversion-channel__nTK2sHWDlB.pine:37` writes the v3 form
    `asset_01 = input(title="Asset 01", type=input.symbol, defval='')`, whose
    CALL NAME is the bare `input` - so a kind test filed it numeric, the fold of
    `asset_01 == ''` was missed and 20 `request.security` gates read as
    unprunable. `pine.js:5281`'s `stringValueOf` does not look at the kind at
    all: it takes `defval` (named or positional) from `input` OR `input.*` and
    returns its string value. So the DEFAULT decides, exactly as (b)'s census
    concluded for time inputs.
    """
    d = (defval or '').strip()
    if d.startswith(('"', "'")):
        return 'str'
    if d in ('true', 'false') or re.fullmatch(r'-?\d+(\.\d+)?', d):
        return 'num'
    if kind in STR_INPUT_KINDS:
        return 'str'
    if kind in NUM_INPUT_KINDS:
        return 'num'
    return None


def _str_const(text, inputs, binds, depth=0):
    t = text.strip()
    if _blank_string(text):
        return True
    if depth > 4 or not t:
        return False
    if t in inputs:
        return _input_class(*inputs[t]) == 'str'
    if any(t.startswith(ns) for ns in BIND_TIME_NS):
        # ⛔ `syminfo.ticker == "SPY"` DOES NOT FOLD TO A NUMBER - `pine.js:5825`
        # defers it into a `textop` the BINDING settles, on purpose, because no
        # symbol has been chosen at resolve time. Counting it as a fold would
        # claim a prune the resolver never performs.
        return False
    if t in binds:
        return _str_const(binds[t], inputs, binds, depth + 1)
    return False


def fold_value(text, inputs, binds, depth=0):
    """What the LEFT resolves to TODAY: '0' | '1' | 'num' | None.

    ⛔⛔ THE FOLD IS NARROWER THAN "PLAN-TIME DECIDABLE", AND THAT GAP IS THE
    FINDING. `pine.js:5899`/`:5914` prune only when the deciding operand's
    resolved node is literally `type === 'num'`. Three things produce one:
    a numeric/boolean literal, an `input.{bool,int,float}` folded to its default,
    and a `==`/`!=` between two plan-time STRINGS (`pine.js:5816`). A NUMERIC
    comparison does NOT - `FOLD_BINARY` (`pine.js:3690`) is `+ - * /` and
    NOTHING ELSE, and its own comment says so ("DELIBERATELY NOT THE COMPARISONS
    OR THE LOGICALS"), with a window slot as its only caller. So
    `len > 5 ? heavy : light` has a test every reader would call constant and
    still resolves BOTH arms.

    ⚠️ 'num' means "folds to a constant this census cannot read the VALUE of" -
    a string comparison whose operands the stripper blanked, or a number that is
    not 0/1. For a ternary that is enough (either way an arm is dropped); for
    `and`/`or` the outcome decides which way, so it is reported as MAY prune
    rather than folded into either column.
    """
    t = text.strip()
    if depth > 4:
        return None
    if _blank_string(text):
        return 'num'
    if not t:
        return None
    if t == 'false':
        return '0'
    if t == 'true':
        return '1'
    if re.fullmatch(r'-?\d+(\.\d+)?', t):
        return {'0': '0', '1': '1'}.get(t, 'num')
    if t in inputs:
        kind, dv = inputs[t]
        if _input_class(kind, dv) == 'num':
            return fold_value(dv, inputs, binds, depth + 1) or 'num'
        return None
    # ⛔ THE ONE COMPARISON THAT FOLDS: two plan-time strings. Split the
    # UNSTRIPPED text - `.strip()` would delete the very blanks that are the
    # evidence a string literal stood there, and the operand would read `empty`
    # instead of `text`. (The first version of this block did exactly that and
    # its own control caught it.)
    dp = depths(text)
    eq = [m for m in EQ_OPS.finditer(text) if dp[m.start()] == 0]
    if len(eq) == 1:
        lhs, rhs = text[:eq[0].start()], text[eq[0].end():]
        if _str_const(lhs, inputs, binds) and _str_const(rhs, inputs, binds):
            return 'num'
    if t in binds:
        return fold_value(binds[t], inputs, binds, depth + 1)
    return None


def left_decides(form, folds):
    """Does the resolver DROP the conditional operand today?

    True = yes; False = no; None = it folds to a constant whose value this
    census cannot read, so `and`/`or` prune on one of the two outcomes.
    """
    if folds is None:
        return False
    if form not in ANNIHILATOR:
        return True                      # a ternary drops an arm either way
    if folds == 'num':
        return None
    return folds == ANNIHILATOR[form]


# --------------------------------------------------------------------------- #
# controls
# --------------------------------------------------------------------------- #
#
# ⛔ THE STRIPPER, BOTH WAYS. One probe proves a use written in a COMMENT and one
# written inside a STRING are not seen; the other proves a real one still is.
_PROBE = '\n'.join([
    '// x = a %s b, t ? y : z in a COMMENT is not a use' % _AND,
    "s = 'a %s b, t ? y : z inside a STRING is not a use'" % _AND,
    'real = a %s b' % _AND,
    'tern = t ? y : z',
])
assert len(AND_RE.findall(_PROBE)) == 3, \
    'stripper control: unstripped, every spelling must be visible'
assert len(QMARK.findall(_PROBE)) == 3, \
    'stripper control: unstripped, every ternary must be visible'
assert len(AND_RE.findall(strip_pine(_PROBE))) == 1, \
    'stripper control: exactly ONE real `%s` survives the strip' % _AND
assert len(QMARK.findall(strip_pine(_PROBE))) == 1, \
    'stripper control: exactly ONE real ternary survives the strip'

# ⛔ PRECEDENCE CONTROL. `a %s b %s c` must split at `or` first; asking for `and`
# first names `b or c` as the right operand, which is a different measurement.
_seen = []
decompose('a %s b %s c' % (_AND, _OR), lambda f, l, rs: _seen.append((f, l.strip(), [r.strip() for r in rs])))
assert _seen[0][0] == 'or' and _seen[0][2] == ['c'], \
    'precedence control: `or` binds looser than `%s` - got %r' % (_AND, _seen[0])
assert any(f == _AND and rs == ['b'] for f, _l, rs in _seen), \
    'precedence control: the inner `%s` must still be found' % _AND

# ⛔ DESCENT CONTROL. Every operator inside `plot(...)` is one bracket down; a
# decomposer that stopped at the top level would report the empty set and the
# reader would take it for evidence.
_seen = []
decompose('plot(a %s b ? 1 : 0)' % _AND,
          lambda f, l, rs: _seen.append((f, l.strip(), [r.strip() for r in rs])))
assert any(f == '?:' for f, _l, _r in _seen), 'descent control: the ternary must be found'
assert any(f == _AND for f, _l, _r in _seen), 'descent control: the `%s` must be found' % _AND

# ⛔⛔ CAN-IT-FIRE CONTROLS (instrument standard 9). Each case gets a synthetic
# use the detector MUST classify into it, so a zero in the table below is a
# measurement rather than a detector that never worked.
assert right_shape('close[20] > 0') == 'series', 'fire control: a history ref is a series'
assert right_history('close[20] > 0')[0] is True, 'fire control (A): a history ref reserves bars'
assert right_history('ta.sma(close, 50) > 0')[0] is True, \
    'fire control (A): a windowed call reserves bars'
assert right_history('close > open')[0] is False, 'fire control (A): a pointwise read does not'
assert right_shape(_NA) == _NA, 'fire control (B): a bare na is an na'
assert right_shape('%s(x)' % _NA) == 'call', \
    'fire control (B): `%s(x)` is a DECLARED function, not a poisoning operand' % _NA
assert right_shape('%s.%s("AAPL","D",close) > 0' % (_REQ, _SEC)) == _REQ + '.' + _SEC, \
    'fire control (C): a request must outrank `call`'
assert right_shape('%s("AAPL","D",close) > 0' % _SEC) == _REQ + '.' + _SEC, \
    'fire control (C): the bare v4 spelling too'
# ⛔ instrument standard 7 - the namespace guard, on a real corpus spelling.
assert right_history('math.log(close) > 0')[0] is False, \
    'blind-spot control: `math.log` is not the manifest `log`'
assert left_kind('false', {}, set()) == 'literal', 'left control: a literal'
assert left_kind('showX', {'showX': ('bool', 'false')}, {'showX'}) == 'input-default', \
    'left control: an input default'
#: ⚠️ THE PROBE GOES THROUGH THE STRIPPER, because the census's input always has.
#: `"AAPL"` is blanked before any classifier sees it; a probe fed the RAW text
#: would answer about a string this instrument never meets, and `AAPL` would read
#: as an undecidable identifier - the control would fail for the wrong reason.
assert left_kind(strip_pine('syminfo.ticker == "AAPL"'), {}, set()) == 'bind-time', \
    'left control: a bind-time constant'
assert left_kind('close > open', {}, set()) == 'series', 'left control: a series'
# ⛔⛔ THE FOLD CONTROLS - and the third one is the whole point of the column.
_I = {'showX': ('bool', 'false'), 'onX': ('bool', 'true'), 'len': ('int', '20'),
      'mode': ('string', '  ')}
assert fold_value('false', {}, {}) == '0', 'fold control: a literal'
assert fold_value('showX', _I, {}) == '0', 'fold control: input.bool(false) -> num 0'
assert fold_value('onX', _I, {}) == '1', 'fold control: input.bool(true) -> num 1'
assert fold_value('gate', _I, {'gate': 'showX'}) == '0', \
    'fold control: a name bound to an input still folds - the knob idiom'
# ⛔⛔ THE REASSIGNMENT CONTROL, BOTH WAYS, on the real corpus shape
# `atr-god-strategy-by-tradesmart__4369755a29.pine:29-31`.
_reass_src = 'trend_st_1 = 1\ntrend_st_1 := nz(trend_st_1[1], trend_st_1)\n'
_rb, _rr = bindings(_reass_src)
assert 'trend_st_1' in _rr, 'reassign control: `:=` must mark the name'
assert 'trend_st_1' not in _rb, \
    'reassign control: a reassigned name must not carry its DECLARATION as a value'
assert fold_value('trend_st_1', {}, _rb) is None, \
    'reassign control: a per-bar name is not a plan-time constant'
assert fold_value('trend_st_1', {}, {'trend_st_1': '1'}) == '1', \
    'reassign control is vacuous unless the same name folds when NOT reassigned'
# ⛔ ASK THE DEFAULT BEFORE THE KIND - the v3 `input(type=…, defval='')` spelling.
assert _input_class('input', "''") == 'str', \
    'input-class control: a bare `input` with a STRING default is a string input'
assert _input_class('input', '20') == 'num', 'input-class control: a numeric default'
assert _str_const('asset_01', {'asset_01': ('input', "''")}, {}) is True, \
    'input-class control: the corpus v3 symbol input must read as text'
# ⛔ THE MEASURED ENGINE FACT: a NUMERIC comparison does NOT fold. `FOLD_BINARY`
# (pine.js:3690) is `+ - * /` only and a window slot is its only caller, so
# `len > 5` resolves to an `op` node and the resolver's `type === 'num'` test
# fails. An instrument that called this a fold would report a prune that does
# not happen, and would report case (A) and case (C) as already-handled.
assert fold_value('len > 5', _I, {}) is None, \
    'fold control: a NUMERIC comparison of constants does NOT fold today'
# ⭐ ...but a STRING comparison does (pine.js:5816), and the stripper has
# blanked both literals, so the census can see THAT it folds, not to what.
assert fold_value(strip_pine('mode == "Auto"'), _I, {}) == 'num', \
    'fold control: two plan-time strings compare to a constant'
assert fold_value(strip_pine('syminfo.ticker == "SPY"'), _I, {}) is None, \
    'fold control: a SYMBOL comparison defers to a textop (pine.js:5825), not a num'
assert left_decides(_AND, '0') is True, \
    'fold control: `false %s X` is decided and the resolver drops X' % _AND
assert left_decides(_AND, '1') is False, \
    'fold control: `true %s X` decides NOTHING - X is the answer' % _AND
assert left_decides('or', '1') is True, 'fold control: `true or X`'
assert left_decides('?:', 'num') is True, \
    'fold control: a folded ternary test drops an arm whatever the value'
assert left_decides('?:', None) is False, 'fold control: an unfolded test drops nothing'
assert left_decides(_AND, 'num') is None, \
    'fold control: an unreadable constant prunes on ONE of two outcomes'

# ⛔⛔ THE LINE-STRUCTURE CONTROL, BOTH WAYS. The first assertion proves the
# defect still reproduces (a control that cannot fail is not a control); the
# second proves the correction holds.
_LOSS = "x = 'abc\ny = 1'\nz = 2\n"
assert strip_pine(_LOSS).count('\n') < _LOSS.count('\n'), \
    'line control is vacuous: the newline-eating case must still reproduce'
assert strip_pine_lines(_LOSS).count('\n') == _LOSS.count('\n'), \
    'line control: the restored stripper must keep every line break'
assert len(strip_pine_lines(_LOSS)) == len(_LOSS), \
    'line control: the correction must stay index-for-index with the source'

# ⛔⛔ THE DEFECTS THIS INSTRUMENT SHIPPED AND HAD TO FIX, RAILED SO THEY
# CANNOT COME BACK. Both were found by reading the table this tool printed, not
# by review, and both failed in the FLATTERING direction.
#
# 1. A LINE ENDING IN A STRING LITERAL IS NOT A CONTINUATION. The real corpus
#    line is `volume-suite-by-leviathan__48da793360.pine:382`.
_j_raw = "crv_cond = disp=='CRVOL (X)' %s crv_disp=='Candles'\nplotcandle(o_, h_)\n" % _AND
_j = logical_lines(strip_pine(_j_raw), strip_comments(_j_raw))[0]
assert len(_j) == 2, \
    'join control: a line ending in a string literal must not swallow the next - got %r' % (_j,)
assert 'plotcandle' not in _j[0][2], \
    'join control: the plot call must NOT land inside the `%s`\'s right operand' % _AND
# ...and the control can FAIL: fed the STRIPPED text for both jobs - which is
# exactly what v1 did - the same two lines come back as one.
_j_bad = logical_lines(strip_pine(_j_raw), strip_pine(_j_raw))[0]
assert len(_j_bad) == 1, \
    'join control is vacuous: the defect it guards must still reproduce on demand'

# 2. A `switch` ARM IS ITS OWN STATEMENT. The real corpus lines are
#    `3-level-zigzag-semafor__3078.pine:23-25`.
_s_raw = ('z := switch\n'
          '    up[1] %s dn %s dir[1] != 1 => low\n'
          '    => %s\n' % (_AND, _AND, _NA))
_s = logical_lines(strip_pine(_s_raw), strip_comments(_s_raw))[0]
assert len(_s) == 3, 'switch control: three statements, got %d -> %r' % (len(_s), _s)
_arms = []
for _piece in split_arrows(_s[1][2]):
    decompose(_piece, lambda f, l, rs: _arms.extend(right_shape(r) for r in rs))
assert _NA not in _arms, \
    'switch control: the arm\'s operands must not carry the NEXT arm\'s `%s` - got %r' % (_NA, _arms)

# 3. A BLANKED STRING IS A TEXT LITERAL, NOT AN ABSENT OPERAND.
assert right_shape(strip_pine('"Ranging"')) == 'text-literal', \
    'text control: a string arm is text, not empty'
assert right_shape('') == 'empty', 'text control: a zero-length arm is the parse artefact'
assert left_kind(strip_pine('"Both"'), {}, set()) == 'literal', \
    'text control: a string constant on the left is plan-time decidable'

#: ⛔ EVERY ENGINE CLAIM THIS CENSUS MAKES, RE-VERIFIED BY READING THE LINE.
#: A citation that cannot be quoted is struck, not softened - and a line number
#: in a 12,800-line file drifts the moment anything above it moves.
CITATIONS = [
    ('ast/parse.js', 378, 'export const NODE_TYPES',
     'the frozen eleven - `op` is one of them and no ternary type exists'),
    ('ast/parse.js', 134, 'export function hostAdmissible',
     'THE admissibility authority; never typed into an instrument'),
    ('ast/pine.js', 1451, 'iff: (a) =>',
     "v2/v3's `iff` rewrites to the SAME `?:` op node"),
    ('ast/pine.js', 4197, 'function logicalAnnihilator',
     'the value that decides an operator on its own: 0 for &&, 1 for ||'),
    ('ast/pine.js', 5873, 'ALREADY DECIDED IS NOT RESOLVED AT ALL',
     'the plan-time short-circuit, stated'),
    ('ast/pine.js', 5897, 'logicalAnnihilator(mapped)',
     'and/or: LEFT is resolved first; a deciding constant drops the right'),
    ('ast/pine.js', 5914, "if (test.type === 'num')",
     'ternary: a branch a constant test never takes is not resolved'),
    ('ast/interpret.js', 2157, 'const logical =',
     'NaN from EITHER operand propagates - case (B) lives here'),
    ('ast/interpret.js', 2191, 'export const TERNARY',
     'both arms arrive as values; the untaken one is computed then discarded'),
    ('ast/interpret.js', 2582, "if (node.type === 'op') {",
     'maxLookback walks EVERY arg unconditionally - case (A) lives here'),
    ('ast/lint.js', 634, "case 'op': {",
     'the repaint linter walks every arg too'),
    ('runtime/vm.js', 306, 'case OP.SELECT',
     'the IR lane says it outright: arguments are already evaluated'),
]


def check_citations():
    bad = []
    for rel, line_no, needle, _why in CITATIONS:
        path = os.path.join(ENGINE, rel)
        try:
            lines = io.open(path, encoding='utf-8').read().split('\n')
            got = lines[line_no - 1]
        except Exception as exc:                      # noqa: BLE001
            bad.append((rel, line_no, needle, 'unreadable: %s' % exc))
            continue
        if needle not in got:
            bad.append((rel, line_no, needle, got.strip()[:60]))
    return bad


# --------------------------------------------------------------------------- #
# the census
# --------------------------------------------------------------------------- #
def scripts():
    out = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine') or f.endswith('.txt'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


VERSION_RE = re.compile(r'@version\s*=\s*(\d+)')
FORMS = (_AND, 'or', '?:', 'iff')


def census_one(fname, raw):
    """The WHOLE per-file pipeline, for one script -> (rows, uses, joins, ifs).

    ⭐ FACTORED OUT SO THE CAN-FIRE CONTROLS RUN THE REAL PATH. A control that
    calls `right_shape` directly proves a classifier works; it proves nothing
    about whether a use ever REACHES that classifier - and three of this
    instrument's five defects were in the statement machinery upstream of it,
    where a hand-called classifier control is blind by construction.
    """
    rows, uses, if_stmts = [], [], 0
    stripped = strip_pine_lines(raw)
    # ⛔ THE ALIGNMENT IS ASSERTED PER FILE, not assumed. `logical_lines` indexes
    # two texts by the same i; one line of drift silently answers the
    # continuation question about a different statement.
    assert stripped.count('\n') == raw.count('\n'), 'line alignment lost on %s' % fname
    binds, reass = bindings(stripped)
    inputs = {k: v for k, v in input_defaults(raw, stripped).items()
              if k not in reass}
    known = decidable_names(stripped, inputs, reass)
    cone = output_cone(stripped)
    stmts, joins = logical_lines(stripped, strip_comments(raw))

    udf, udf_indent = None, -1
    for start, indent, text in stmts:
        if IF_STMT.match(text):
            if_stmts += 1
        m_udf = UDF_DECL.match(text)
        if m_udf:
            udf, udf_indent = m_udf.group(1), indent
            body = text[m_udf.end():]
            bound, expr = None, body
        else:
            if udf is not None and indent <= udf_indent:
                udf = None
            m_as = B.ASSIGN.match(text)
            if m_as:
                bound, expr = m_as.group(1), text[m_as.end():]
            else:
                bound, expr = None, STMT_HEAD.sub('', text)

        direct = bool(PLOT_RE.search(text))
        enclosing = udf

        def emit(form, left, arms, _s=start, _f=fname, _t=text,
                 _b=bound, _u=enclosing, _d=direct, _co=cone,
                 _in=inputs, _kn=known, _bd=binds):
            use_id = len(uses)
            lk = left_kind(left, _in, _kn)
            folds = fold_value(left, _in, _bd)
            decides = left_decides(form, folds)
            reach = _reaches(_co, _b, _u, _d)
            uses.append({'file': _f, 'line': _s, 'form': form,
                         'left_kind': lk, 'folds': folds, 'decides': decides,
                         'reaches': reach, 'text': _t.strip()[:110]})
            for idx, arm in enumerate(arms):
                shape = right_shape(arm)
                hist, why = right_history(arm)
                rows.append({
                    'use': use_id, 'file': _f, 'line': _s, 'form': form,
                    'arm': idx, 'left_kind': lk, 'folds': folds,
                    'decides': decides,
                    'shape': shape, 'history': hist, 'why': why,
                    'reaches': reach,
                    'admissible': shape not in (_REQ + '.' + _SEC, _REQ + '.*'),
                    'right': arm.strip()[:70],
                })

        for piece in split_arrows(expr):
            decompose(piece, emit)

    return rows, uses, joins, if_stmts


def collect():
    rows, uses, joins_total, if_stmts, desync = [], [], 0, 0, 0
    per_file_version = {}
    for _d, fname, path in scripts():
        raw = io.open(path, encoding='utf-8', errors='replace').read()
        if strip_pine(raw).count('\n') != raw.count('\n'):
            desync += 1
        mv = VERSION_RE.search(raw)
        per_file_version[fname] = mv.group(1) if mv else 'none'
        r, u, j, n_if = census_one(fname, raw)
        base = len(uses)
        for row in r:
            row['use'] += base
        uses.extend(u)
        rows.extend(r)
        joins_total += j
        if_stmts += n_if
    return rows, uses, joins_total, per_file_version, if_stmts, desync


WORD_RE = re.compile(r'(?<![\w.])([A-Za-z_]\w*)')


def udf_bodies(stripped):
    """function name -> the set of names in its body (inline and indented)."""
    lines = stripped.split('\n')
    out = defaultdict(set)
    cur, cur_indent = None, -1
    for ln in lines:
        if not ln.strip():
            continue
        indent = len(ln) - len(ln.lstrip())
        m = UDF_DECL.match(ln)
        if m:
            cur, cur_indent = m.group(1), indent
            out[cur] |= set(WORD_RE.findall(ln[m.end():]))
            continue
        if cur is not None and indent > cur_indent:
            out[cur] |= set(WORD_RE.findall(ln))
        elif cur is not None:
            cur = None
    return out


def output_cone(stripped):
    """Every name whose value can reach a plot/alertcondition. INTERPROCEDURAL.

    ⛔ A LINE SCAN IS NOT AN ANSWER (instrument standard 6). (b)'s own census
    reported "(nothing)" for 82 of 158 uses until its walk crossed a function
    boundary, and "admissible AND reachable" is the number the threshold turns
    on - so an under-count here argues for retiring something members use.

    ⭐ THIS IS (b)'s RELATION, BATCHED - NOT A SECOND ONE. (b)'s
    `consumers_of(name)` walks FORWARD from one name and asks whether any line
    mentioning a reached name carries a consumer. Running that per name is
    O(lines^2) per name and this census has thousands of names; the same
    relation computed BACKWARD from the consumer lines is one fixed point per
    file and answers identically. `control_reachability` proves that on a
    sample, against (b)'s own function, and exits non-zero if it cannot.

    ⭐ ONE EDGE IS ADDED ON PURPOSE AND IT IS DECLARED: a user function whose
    NAME reaches an output pulls in its whole BODY. That is the RETURN side,
    which (b)'s forward walk does not have because (b) starts at an input and
    only ever needs the parameter side. An expression inside a UDF body is
    exactly the case this census has to attribute, so the control asserts the
    cone is a SUPERSET of (b)'s answer rather than equal to it.
    """
    lines = stripped.split('\n')
    udfs = B.udf_params(stripped)
    bodies = udf_bodies(stripped)
    cone = set()
    for ln in lines:
        if PLOT_RE.search(ln):
            cone |= set(WORD_RE.findall(ln))
    calls = []
    for i, ln in enumerate(lines):
        for fn, params in udfs.items():
            m = re.search(r'(?<![\w.])%s\s*\(' % re.escape(fn), ln)
            if m:
                calls.append((fn, params, split_args(call_args(ln, m.end() - 1))))
    assigns = []
    for ln in lines:
        m = B.ASSIGN.match(ln)
        if m:
            assigns.append((m.group(1), set(WORD_RE.findall(ln[m.end():]))))
    for _ in range(len(lines) + 2):
        grew = False
        for lhs, rhs_names in assigns:
            if lhs in cone and not rhs_names <= cone:
                cone |= rhs_names
                grew = True
        for fn, params, args in calls:
            for idx, a in enumerate(args):
                if idx >= len(params) or params[idx] not in cone:
                    continue
                names = set(WORD_RE.findall(a))
                if not names <= cone:
                    cone |= names
                    grew = True
        for fn, body in bodies.items():
            if fn in cone and not body <= cone:
                cone |= body
                grew = True
        if not grew:
            break
    return cone


def _reaches(cone, bound, udf, direct):
    if direct:
        return True
    return bool((bound and bound in cone) or (udf and udf in cone))


#: ⛔⛔ CAN-IT-FIRE, END TO END (instrument standard 9). Each fixture is a whole
#: script pushed through `census_one` - the same joiner, the same decomposer,
#: the same classifiers the corpus goes through. A zero in the (A)/(B)/(C)
#: sections below is evidence ONLY because these prove the same pipeline
#: produces a non-zero on a script that has the thing.
_FIRE = [
    # (A) a lookback-bearing operand behind a decidable-but-unfoldable test
    ('A', '//@version=5\nlen = input.int(20)\nx = len > 5 ? ta.sma(close, 200) : close\nplot(x)\n',
     lambda rows: [r for r in rows if r['history'] and r['reaches']
                   and r['left_kind'] != 'series' and r['folds'] is None]),
    # (B) a bare `na` as the right operand of `and`
    ('B', '//@version=5\ng = close > open\nc = g %s %s\nplot(c ? 1 : 0)\n' % (_AND, _NA),
     lambda rows: [r for r in rows if r['shape'] == _NA and r['form'] in (_AND, 'or')]),
    # (C) a request on a ternary arm
    ('C', '//@version=5\nhtf = input.bool(true)\n'
          'v = htf ? %s.%s(syminfo.tickerid, "D", close) : close\nplot(v)\n' % (_REQ, _SEC),
     lambda rows: [r for r in rows if not r['admissible']]),
]
for _case, _src, _pick in _FIRE:
    _r, _u, _j, _n = census_one('fire-%s.pine' % _case, _src)
    assert _pick(_r), \
        'CAN-FIRE control %s: the full pipeline found nothing in a fixture that HAS it' % _case
    # ...and the same fixture with the thing removed must produce nothing, or the
    # detector is answering yes to everything.
_null = '//@version=5\nx = close > open %s volume > 0\nplot(x ? 1 : 0)\n' % _AND
_rn, _un, _jn, _nn = census_one('fire-null.pine', _null)
assert not [r for r in _rn if r['shape'] == _NA or not r['admissible']], \
    'CAN-FIRE control: a script with neither `%s` nor a request must produce neither' % _NA
assert _rn, 'CAN-FIRE control: the null fixture must still produce ordinary rows'


def control_reachability(sample_files=10, per_file=12):
    """The cone vs (b)'s OWN `consumers_of`, name by name, on a sample.

    ⛔ THE ASSERTION IS SUPERSET, NOT EQUALITY, and the reason is declared in
    `output_cone`: the cone adds the UDF RETURN edge. So a name (b) calls
    reachable must be in the cone (no false negatives against the committed
    walk); a name only the cone calls reachable is the return edge doing its
    job and is counted separately rather than hidden.

    ⛔ AND A NON-VACUITY CONTROL RIDES WITH IT (instrument standard 9, rule 14):
    at least one sampled name must be OUTSIDE the cone. A cone that swallowed
    every name would make "reaches an output" true by construction and every
    reachable count in this census meaningless - and it would pass a
    superset test perfectly.
    """
    agree = disagree = extra = outside = checked = 0
    for _d, _f, path in scripts()[:sample_files]:
        raw = io.open(path, encoding='utf-8', errors='replace').read()
        st = strip_pine_lines(raw)
        cone = output_cone(st)
        names = []
        for ln in st.split('\n'):
            m = B.ASSIGN.match(ln)
            if m and m.group(1) not in names:
                names.append(m.group(1))
        for name in names[:per_file]:
            checked += 1
            cons, _r = B.consumers_of(st, name)
            b_says = 'plot/alert' in cons
            in_cone = name in cone
            if b_says and not in_cone:
                disagree += 1
            elif b_says:
                agree += 1
            elif in_cone:
                extra += 1
            else:
                outside += 1
    return {'checked': checked, 'agree': agree, 'false_negatives': disagree,
            'cone_only': extra, 'outside': outside}


def control_b97():
    """(b)'s committed 97, re-derived through (b)'s OWN enumeration and walk."""
    n = 0
    for _d, _f, path in B.scripts():
        raw = io.open(path, encoding='utf-8', errors='replace').read()
        st = B.strip_pine(raw)
        for m in B.CALL.finditer(st):
            if (m.group(1) or 'input') != 'timeframe':
                continue
            cons, _r = B.consumers_of(st, B.bound_name(raw, m.start()))
            if 'request.security' in cons:
                n += 1
    return n


def main():
    w = sys.stdout.buffer.write
    rows, uses, joins, versions, if_stmts, desync = collect()
    files = scripts()

    w(b'ITEM (e) - SHORT-CIRCUIT CENSUS\n\n')
    w(('scripts read: %d   statements joined across lines: %d\n'
       % (len(files), joins)).encode())
    w(('and/or/?:/iff uses: %d   conditional operands: %d   `if` statements: %d\n'
       % (len(uses), len(rows), if_stmts)).encode())
    w(("files where (b)'s strip_pine loses a line (corrected here): %d\n\n"
       % desync).encode())

    # ---- CONTROLS ------------------------------------------------------- #
    w(b'--- CONTROL 1: the (b) census cross-check ---\n')
    got97 = control_b97()
    ok97 = (got97 == 97)
    w(('  CONTROL b-census-timeframe-into-security expected 97 got %d %s\n'
       % (got97, 'OK' if ok97 else 'FAIL')).encode())

    w(b'\n--- CONTROL 2: every engine citation, re-read at its line ---\n')
    bad = check_citations()
    okcit = not bad
    for rel, line_no, needle, got in bad:
        w(('    MISS %s:%d wanted %r got %r\n'
           % (rel, line_no, needle, got)).encode())
    w(('  CONTROL engine-citations expected %d got %d %s\n'
       % (len(CITATIONS), len(CITATIONS) - len(bad), 'OK' if okcit else 'FAIL')).encode())

    w(b'\n--- CONTROL 3: the reachability cone vs (b)\'s own consumers_of ---\n')
    rc = control_reachability()
    okr = (rc['false_negatives'] == 0 and rc['outside'] > 0)
    w(('  names checked %d   agree %d   cone-only (UDF return edge) %d   '
       'outside the cone %d\n'
       % (rc['checked'], rc['agree'], rc['cone_only'], rc['outside'])).encode())
    w(('  CONTROL cone-has-no-false-negatives expected 0 got %d %s\n'
       % (rc['false_negatives'], 'OK' if rc['false_negatives'] == 0 else 'FAIL')).encode())
    w(('  CONTROL cone-is-not-everything expected >0 got %d %s\n'
       % (rc['outside'], 'OK' if rc['outside'] > 0 else 'FAIL')).encode())

    # ---- e.3 THE FORM TABLE ------------------------------------------------ #
    w(b'\n--- e.3a  ONE ROW PER FORM ---\n')
    w(b'  form   uses  files  operands  ADM+REACH  left-decidable  folds-to-num  '
      b'PRUNED-today  may-prune  DECIDABLE-BUT-NOT-FOLDED\n')
    for form in FORMS:
        fu = [u for u in uses if u['form'] == form]
        fr = [r for r in rows if r['form'] == form]
        if not fu:
            w(('  %-5s %6d\n' % (form, 0)).encode())
            continue
        dec = [u for u in fu if u['left_kind'] != 'series']
        w(('  %-5s %5d %6d %9d %10d %15d %13d %13d %10d %25d\n'
           % (form, len(fu), len(set(u['file'] for u in fu)), len(fr),
              sum(1 for r in fr if r['admissible'] and r['reaches']),
              len(dec),
              sum(1 for u in fu if u['folds'] is not None),
              sum(1 for u in fu if u['decides'] is True),
              sum(1 for u in fu if u['decides'] is None),
              sum(1 for u in dec if u['folds'] is None))).encode())
    w(b'  (DECIDABLE-BUT-NOT-FOLDED is the gap: a test every reader calls constant\n'
      b'   that resolves to an `op` node, so both operands are still resolved.\n'
      b'   pine.js:3690 - FOLD_BINARY is `+ - * /` and NOTHING ELSE.)\n')

    w(b'\n--- e.3b  LEFT-OPERAND KIND (is the left PLAN-TIME DECIDABLE?) ---\n')
    for form in FORMS:
        fu = [u for u in uses if u['form'] == form]
        if not fu:
            continue
        c = Counter(u['left_kind'] for u in fu)
        w(('  %-5s %s\n' % (form, dict(c.most_common()))).encode())

    w(b'\n--- e.3c  CONDITIONAL-OPERAND SHAPE x LEFT KIND ---\n')
    w(b'  form  right-shape        left-kind      n   reserves-bars  reaches-output\n')
    grid = Counter()
    for r in rows:
        grid[(r['form'], r['shape'], r['left_kind'])] += 1
    for (form, shape, lk), n in sorted(grid.items(), key=lambda kv: -kv[1]):
        sub = [r for r in rows if r['form'] == form and r['shape'] == shape
               and r['left_kind'] == lk]
        w(('  %-5s %-18s %-13s %5d %14d %15d\n'
           % (form, shape, lk, n,
              sum(1 for r in sub if r['history']),
              sum(1 for r in sub if r['reaches']))).encode())

    # ---- e.2 THE THREE CASES ---------------------------------------------- #
    def named(sub, k=3):
        seen, out = set(), []
        for r in sub:
            if r['file'] in seen:
                continue
            seen.add(r['file'])
            out.append('%s:%d' % (r['file'], r['line']))
            if len(out) >= k:
                break
        return out or ['(none)']

    w(b'\n--- e.2 (A) LOOKBACK / REPAINT ---\n')
    a_all = [r for r in rows if r['history'] and r['admissible']]
    a_reach = [r for r in a_all if r['reaches']]
    a_dec = [r for r in a_reach if r['left_kind'] != 'series']
    a_prune = [r for r in a_reach if r['decides'] is True]
    a_gap = [r for r in a_dec if r['folds'] is None]
    w(('  conditional operands that RESERVE BARS               : %d\n' % len(a_all)).encode())
    w(('  ... and reach an output                              : %d\n' % len(a_reach)).encode())
    w(('  ... whose LEFT is a SERIES (correct to reserve)      : %d\n'
       % (len(a_reach) - len(a_dec))).encode())
    w(('  ... whose LEFT is plan-time decidable                : %d\n' % len(a_dec)).encode())
    w(('      of those, ALREADY PRUNED by the resolver today   : %d\n' % len(a_prune)).encode())
    w(('      of those, DECIDABLE BUT NOT FOLDED  <- THE GAP   : %d\n' % len(a_gap)).encode())
    w(('    named (series left)     : %s\n' % ', '.join(named(a_reach))).encode())
    if a_gap:
        w(('    named (THE GAP)         : %s\n' % ', '.join(named(a_gap))).encode())
        for r in a_gap[:4]:
            w(('      %s:%d  %s | right=%s\n'
               % (r['file'][:44], r['line'], r['form'], r['right'][:48])).encode())

    # ⛔⛔ (B) IS SPLIT BY FORM, AND V1 OF THIS BLOCK WAS NOT - it reported 2,030
    # `na` operands as one poisoning set. `TERNARY` (interpret.js:2191) SELECTS:
    # `isNan(t) ? NaN : (t !== 0 ? a : b)` returns the TAKEN arm, so an `na` in
    # the arm the test does not take is computed and discarded and can never
    # reach the result. `logical` (interpret.js:2157) does NOT select - it is
    # `isNan(a) || isNan(b) ? NaN : …`, so an `na` on EITHER side of `and`/`or`
    # propagates whatever the other side says. Only the second is case (B).
    w(b'\n--- e.2 (B) na POISONING ---\n')
    b_and = [r for r in rows if r['shape'] == _NA and r['form'] in (_AND, 'or')]
    b_tern = [r for r in rows if r['shape'] == _NA and r['form'] in ('?:', 'iff')]
    w(('  bare `%s` on a %s/%s operand   (interpret.js:2157 PROPAGATES) : %d\n'
       % (_NA, _AND, _OR, len(b_and))).encode())
    w(('  ... and reach an output                                     : %d\n'
       % sum(1 for r in b_and if r['reaches'])).encode())
    w(('    named : %s\n' % ', '.join(named(b_and))).encode())
    w(('  by @version (v6 short-circuits `%s`/`%s`; v5 and earlier do not): %s\n'
       % (_AND, _OR, dict(Counter(versions.get(r['file'], '?') for r in b_and)))).encode())
    w(('\n  bare `%s` on a ternary ARM  (interpret.js:2191 SELECTS)      : %d\n'
       % (_NA, len(b_tern))).encode())
    w(('  ... and reach an output                                     : %d\n'
       % sum(1 for r in b_tern if r['reaches'])).encode())
    w(b'  NOT a poisoning site: the untaken arm is computed and DISCARDED, so the\n'
      b'  `plot(cond ? value : na)` idiom already answers what Pine answers.\n')

    w(b'\n--- e.2 (C) AN UNISSUED REQUEST ---\n')
    c_all = [r for r in rows if not r['admissible']]
    c_reach = [r for r in c_all if r['reaches']]
    c_prune = [r for r in c_all if r['decides'] is True]
    c_gap = [r for r in c_all if r['left_kind'] != 'series' and r['folds'] is None]
    w(('  conditional operands carrying a %s.*               : %d\n'
       % (_REQ, len(c_all))).encode())
    w(('  ... and reach an output                              : %d\n' % len(c_reach)).encode())
    w(('  ... gate ALREADY PRUNED by the resolver today        : %d\n' % len(c_prune)).encode())
    w(('  ... gate decidable but NOT folded  <- would be issued: %d\n' % len(c_gap)).encode())
    w(('  ... gate is a SERIES (per-bar, cannot prune at plan)  : %d\n'
       % sum(1 for r in c_all if r['left_kind'] == 'series')).encode())
    w(('    named : %s\n' % ', '.join(named(c_all))).encode())
    for r in c_all[:4]:
        w(('      %s:%d  %s left=%s folds=%s\n'
           % (r['file'][:44], r['line'], r['form'], r['left_kind'], r['folds'])).encode())
    w(('  INADMISSIBLE TODAY - `pine:%s` refuses every one (41 refusals, no 42nd needed)\n'
       % _REQ).encode())

    # ---- corpus shape ------------------------------------------------------ #
    w(b'\n--- CORPUS @version (v6 is where TradingView documents short-circuit) ---\n')
    for k, n in sorted(Counter(versions.values()).items()):
        w(('  @version=%-5s %4d file(s)\n' % (k, n)).encode())

    w(b'\n--- FILES WITH THE MOST USES ---\n')
    byf = Counter(u['file'] for u in uses)
    for f, n in byf.most_common(6):
        w(('  %-58s %d\n' % (f[:58], n)).encode())
    w(('  (uses in %d of %d files)\n' % (len(byf), len(files))).encode())

    ok = ok97 and okcit and okr
    w(('\nVERDICT: controls %s\n' % ('OK' if ok else 'FAIL')).encode())
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
