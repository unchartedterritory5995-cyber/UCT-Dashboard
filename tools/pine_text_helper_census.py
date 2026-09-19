# -*- coding: utf-8 -*-
"""item (f) — the NESTED TEXT HELPER census.

A text helper is `str.tostring`, `str.format`, `str.replace_all`, `str.substring`,
`str.length`, `str.tonumber`, string `+` concatenation, and every other `str.*`.
Item (f) is the subset NESTED INSIDE ANOTHER CALL rather than standing alone — so
this counts BOTH and reports the nested set against its own denominator, because
"nested" is a claim that means nothing without the other half.

⭐⭐ WHAT THE ENGINE DOES TODAY IS READ OFF `pine.js`/`pineObjects.js`, NOT INFERRED,
and every verdict carries the file:line that decides it:

  pine.js:1264   PINE_TEXT_PREDICATE = {contains:2, startswith:2, endswith:2, length:1}
  pine.js:6703   …folded BEFORE the `str` namespace guard when both operands are
                 bind-time text -> `cNum` if both literal, else a `textop` node.
                 YIELDS A NUMBER, so nothing textual survives the fold.
  pine.js:562    NAMESPACE_GUARD.str = 'pine:builtin' — every OTHER `str.*` member
  pine.js:6731   …refused BY NAME there: "`str.format`", "`str.tostring`", …
  pine.js:5739   a bare string in a VALUE position is `pine:text-value`
  pine.js:9919   the OBJECT lane's `textNodeOf` knows `str.tostring`/`tostring` ONLY,
                 carried as `{t:'num', tree, fmt}` — the NUMBER rides and the surface
                 formats it. Not a `str` node; NO 12th NODE_TYPE.
  pine.js:9940   string `+` is `{t:'cat'}` HERE and nowhere else. ⛔ THERE IS NO TYPE
                 TEST distinguishing string `+` from numeric `+` — the POSITION does:
                 the same `binary +` node is a concatenation to `textNodeOf` and an
                 arithmetic `op` to `Resolver.resolve`.
  pine.js:10078  TEXT_SLOTS = {'text','tooltip'} — the only object slots read as text
  pine.js:10030  `nestedTextHelpers` — the engine's OWN diagnostic, and it is about a
                 nested USER FUNCTION inside a text expression, NOT a nested `str.*`
  pine.js:12864  `outputTitle`  — carries a title only when `value.type === 'string'`
  pine.js:12902  `outputMessage`— carries a message only when `value.type === 'string'`
  pine.js:11612  …else the note `pine:alert-message` (a NOTE; REFUSALS is a frozen
                 41-code table and no 42nd code is minted anywhere in this subject)
  pineObjects.js:88  OBJECT_NAMESPACES = ['line','label','box','table','linefill']
  pineObjects.js:265 …and the object pass matches only the NAMESPACE spelling, so
                 Pine's METHOD spelling `tbl.cell(…)` is invisible to it entirely.

⛔ TWO VIEWS OF EVERY FILE, AND EACH NUMBER SAYS WHICH ONE IT CAME FROM. The subject
IS string handling, so the STRIPPED view (comments and string literals blanked to
spaces, same length) finds call sites, `+` positions and nesting; the RAW view reads
an ARGUMENT — because a message that is a string literal is the thing being counted.

⚰️⚰️ THE DEFECT THIS CENSUS FOUND IN ITS PREDECESSOR. d2's committed scope says
**2 of 555** alertcondition messages are expressions. Both are
`neural-network-buy-and-sell-signals__fbbb11d0c7.pine:966,968` and NEITHER is an
expression: they are plain literals reading "…Grade A+ …". The (d) census's `shape_of`
asked `'+' not in a` over the WHOLE argument, quotes included. The shipped engine asks
the PARSER instead (`value.type === 'string'`) and carries both verbatim — measured
through the door:

    literal-containing-plus    message="Grade A+ - highest confidence"  notes=0
    genuine-concat-expr        message=null                             notes=1

So the CONTROL reproduces 555/338/149/2 UNDER D'S OWN RULE — an instrument that
cannot reproduce the number it extends is measuring something else — and prints the
string-aware number beside it.

⚰️ AND THE DEFECTS THIS CENSUS FOUND IN ITSELF, all by reading its own first table:
  1. `concat(+)` in a drawing's `text=` was scored NOT-CARRIED. `pine.js:9940` carries
     it. 995 uses were on the wrong side of the verdict.
  2. `tbl.cell(…)` / `.set_text(…)` — Pine's METHOD spelling — fell into "other". They
     are drawing text slots in Pine and are UNSEEN by this engine; both facts matter
     and neither is "other".
  3. `alert(` was the single largest "other" outer at 244 uses; it is chart-only.
  4. An `input.*` `tooltip=` is cosmetic — `resolveInput` folds the DEFVAL and never
     reads a title — so scoring it "needs a 12th node type" invented a demand.
  5. The OUTERMOST CONSUMER of a helper passed to a user function is not that
     function: it is where the function's BODY puts the parameter. Resolving one
     level (the depth `textNodeOf` itself inlines, pine.js:10038) moved 346 uses.

⛔ The stripper carries controls BOTH ways; so do the nesting scanner, the needle
(it must not match `mystr.tostring(`) and the message classifier.
⛔ The needle is built by concatenation, so this file does not contain it.

Usage:  python tools/pine_text_helper_census.py
"""
import bisect
import io
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = [
    os.path.join(ROOT, 'corpus', 'committed'),
    os.path.join(ROOT, 'tests', 'fixtures', 'pine_oos'),
    os.path.join(ROOT, 'tests', 'fixtures', 'member'),
]

# ── ONE STRIPPER, SHARED — not a fourth copy ────────────────────────────────
_spec = importlib.util.spec_from_file_location(
    'b_census', os.path.join(ROOT, 'tools', 'pine_time_input_census.py'))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)
strip_pine, call_args, split_args = B.strip_pine, B.call_args, B.split_args
consumers_of = B.consumers_of

# ⭐ built by concatenation: this file must not contain its own needle
_NS = 'st' + 'r'
_TOSTR = 'to' + 'string'
_ACOND = 'alert' + 'condition'

#: `str.<member>(` — ⛔ the lookbehind is load-bearing. `\bstr\.` matches inside
#: `mystr.tostring(` and `_str.upper(`, which are ordinary member reads on a
#: member's OWN variable. This repo has already shipped one census whose `\blog\b`
#: matched inside `math.log(...)`; the same mistake here credits the `str`
#: namespace with a name nobody wrote.
STR_CALL = re.compile(r'(?<![.\w])%s\.([A-Za-z_]\w*)\s*\(' % _NS)
#: the v4 bare spelling. ⛔ must NOT fire inside `str.tostring(`.
BARE_TOSTRING = re.compile(r'(?<![.\w])%s\s*\(' % _TOSTR)
AC_CALL = re.compile(r'(?<![.\w])%s\s*\(' % _ACOND)

#: ⭐⭐ ASK THE KIND BEFORE THE LITERAL. What a member RETURNS decides whether it
#: can be a `textop` operand at all — a question ABOUT text answered WITH a number
#: is admissible under the frozen 11; text yielded into an expression is not.
STR_RESULT = {
    # answer a question about text WITH A NUMBER
    'contains': 'number', 'startswith': 'number', 'endswith': 'number',
    'length': 'number', 'tonumber': 'number', 'pos': 'number',
    # PRODUCE text from something else
    _TOSTR: 'text', 'format': 'text', 'format_time': 'text', 'substring': 'text',
    'replace_all': 'text', 'replace': 'text', 'upper': 'text', 'lower': 'text',
    'trim': 'text', 'repeat': 'text', 'match': 'text',
    # produce a COLLECTION, which is neither
    'split': 'array',
}

#: The four the engine holds (`pine.js:1264`).
ENGINE_TEXT_PREDICATE = {'contains': 2, 'startswith': 2, 'endswith': 2, 'length': 1}
#: ⭐ What `textNodeOf` can actually READ in a text slot (pine.js:9885-10050):
#: a literal, a number, `str.tostring`/`tostring`, `+`, a ternary, a bound name,
#: a tuple part, and ONE level of user function. No other `str.*` member.
ENGINE_TEXT_READER = {_TOSTR, 'concat'}
#: `pine.js:10078`
OBJECT_TEXT_SLOTS = {'text', 'tooltip'}
#: `pineObjects.js:88`
OBJECT_NAMESPACES = ('line', 'label', 'box', 'table', 'linefill')
OUT_OF_SCOPE_NS = ('polyline',)

PLOT_CALLS = ('plot', 'plotshape', 'plotchar', 'plotcandle', 'plotbar', 'plotarrow',
              'hline', 'fill', 'bgcolor', 'barcolor')
PLACEHOLDER = re.compile(r'\{\{[^}]*\}\}')
#: `message = "…"` — a NAMED argument. THE NAME IS NOT PART OF THE VALUE, and the
#: (d) census's failure to strip it understated its own set by ~155.
NAMED = re.compile(r'^([A-Za-z_]\w*)\s*=(?!=)\s*')


# ─────────────────────────────────────────────────────────────────────────────
# argument spans — NAMED ARGUMENTS READ AS ARGUMENTS
# ─────────────────────────────────────────────────────────────────────────────
def arg_spans(raw, open_paren):
    """[(start, end)] absolute indices of each TOP-LEVEL argument of a call.

    Quote- and bracket-aware over the RAW view, because an argument's value may
    BE a string literal and that literal is part of the argument.
    """
    spans, depth, q, i, n = [], 0, None, open_paren, len(raw)
    start = None
    while i < n:
        c = raw[i]
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
        if c in '([':
            depth += 1
            if depth == 1:
                start = i + 1
            i += 1
            continue
        if c in ')]':
            depth -= 1
            if depth == 0:
                if start is not None:
                    spans.append((start, i))
                return spans
            i += 1
            continue
        if c == ',' and depth == 1:
            spans.append((start, i))
            start = i + 1
        i += 1
    if start is not None:
        spans.append((start, n))
    return spans


def slot_of(raw, spans, idx, positional_names):
    """Which ARGUMENT of a call holds index `idx`, as a slot NAME.

    ⭐ NAMED FIRST, THEN POSITIONAL — the order `outputTitle`/`outputMessage`
    (pine.js:12864, 12902) use, and the one the (d) census got wrong. A named
    argument does not consume a positional slot, so the positional counter only
    advances on unnamed arguments.
    """
    pos = 0
    for (s, e) in spans:
        text = raw[s:e]
        m = NAMED.match(text.lstrip())
        named = m.group(1) if m else None
        if s <= idx < e:
            if named:
                return named
            return positional_names[pos] if pos < len(positional_names) else '#%d' % pos
        if not named:
            pos += 1
    return None


#: Positional signatures, taken from the engine's own tables where it has one.
POSITIONAL = {
    _ACOND: ['condition', 'title', 'message'],
    'alert': ['message', 'freq'],
    'plot': ['series', 'title'],
    'plotshape': ['series', 'title'],
    'plotchar': ['series', 'title', 'char'],
    'plotarrow': ['series', 'title'],
    'hline': ['price', 'title'],
    # pineObjects.js:35 CREATE_POSITIONAL
    'line.new': ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width'],
    'label.new': ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor',
                  'size', 'textalign', 'tooltip'],
    'box.new': ['left', 'top', 'right', 'bottom', 'border_color', 'border_width',
                'border_style', 'extend', 'xloc', 'bgcolor'],
    'table.new': ['position', 'columns', 'rows', 'bgcolor', 'frame_color',
                  'frame_width', 'border_color', 'border_width'],
    'linefill.new': ['line1', 'line2', 'color'],
    # pineObjects.js:48 CELL_POSITIONAL, with the address restored in front
    'table.cell': ['table_id', 'column', 'row', 'text', 'width', 'height',
                   'text_color', 'text_halign', 'text_valign', 'bgcolor', 'tooltip',
                   'text_size'],
    'label.set_text': ['id', 'text'],
    'label.set_tooltip': ['id', 'tooltip'],
    'box.set_text': ['id', 'text'],
    'request.security': ['symbol', 'timeframe', 'expression'],
    'security': ['symbol', 'timeframe', 'expression'],
    'log.info': ['message'], 'log.warning': ['message'], 'log.error': ['message'],
}
#: The METHOD spelling drops the receiver, so the positional list loses its head.
METHOD_POSITIONAL = {
    'cell': ['column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign',
             'text_valign', 'bgcolor', 'tooltip', 'text_size'],
    'set_text': ['text'], 'set_tooltip': ['tooltip'],
}
#: Every method name `SETTER_PROPS` (pineObjects.js:60) declares, plus `cell`.
DRAW_METHODS = set(METHOD_POSITIONAL) | {
    'set_x1', 'set_y1', 'set_x2', 'set_y2', 'set_xy1', 'set_xy2', 'set_color',
    'set_width', 'set_style', 'set_extend', 'set_x', 'set_y', 'set_xy',
    'set_textcolor', 'set_size', 'set_textalign', 'set_yloc', 'set_left', 'set_top',
    'set_right', 'set_bottom', 'set_lefttop', 'set_rightbottom', 'set_bgcolor',
    'set_border_color', 'set_border_width', 'set_border_style', 'set_text_color',
    'set_text_size', 'set_position', 'set_frame_color', 'set_frame_width',
}


# ─────────────────────────────────────────────────────────────────────────────
# the nesting scanner — ONE PASS PER FILE
# ─────────────────────────────────────────────────────────────────────────────
TOKEN = re.compile(r'[A-Za-z_][A-Za-z_0-9.]*|[()\[\]]')


def scan_frames(stripped, extra_positions=()):
    """Every call site, and the CALL stack open at each site and at each
    `extra_position`.

    Returns `(sites, at)` where
      sites = [(name, open_paren_index, [enclosing (name, idx) outermost-first])]
      at    = {position: [enclosing (name, idx) outermost-first]}

    ⛔ A GROUPING PAREN IS NOT A CALL FRAME. `(a + b) * str.length(x)` nests
    `str.length` inside nothing; counting the grouping paren as a level would
    report every parenthesised arithmetic expression as a nesting depth and
    inflate the ONE number the threshold turns on.

    ⛔ ONE PASS, NOT ONE PER QUERY. The first cut re-scanned the whole file for
    every `+` in it and did not finish the corpus in fifteen minutes; a census
    nobody can run is a census nobody checks.
    """
    frames = []          # open stack: [(name_or_None, idx)]
    sites = []
    at = {}
    todo = sorted(set(extra_positions))
    ti = 0
    last_ident, last_end = None, -1
    for m in TOKEN.finditer(stripped):
        start = m.start()
        while ti < len(todo) and todo[ti] <= start:
            at[todo[ti]] = [f for f in frames if f[0] is not None]
            ti += 1
        t = m.group(0)
        if t == '(':
            # a call frame only when an identifier ends where this paren begins
            name = last_ident if last_end == start else None
            if name is not None:
                sites.append((name, start, [f for f in frames if f[0] is not None]))
            frames.append((name, start))
        elif t == '[':
            frames.append((None, start))
        elif t in ')]':
            if frames:
                frames.pop()
        else:
            last_ident, last_end = t, m.end()
            continue
        last_ident, last_end = None, -1
    while ti < len(todo):
        at[todo[ti]] = [f for f in frames if f[0] is not None]
        ti += 1
    return sites, at


def call_frames(stripped):
    return scan_frames(stripped)[0]


# ── CONTROLS for the nesting scanner, BOTH WAYS ────────────────────────────
_NEST_PROBE = '\n'.join([
    'a = %s.%s(close)' % (_NS, _TOSTR),                             # depth 0
    'label.new(bar_index, high, %s.%s(close))' % (_NS, _TOSTR),     # depth 1
    'label.new(bar_index, high, "x" + %s.%s(%s.tonumber("3")))'     # depth 1 and 2
    % (_NS, _TOSTR, _NS),
    'b = (high + low) * %s.length(syminfo.ticker)' % _NS,           # depth 0 — GROUPING
])
_probe_sites = [s for s in call_frames(_NEST_PROBE) if s[0].startswith(_NS + '.')]
assert len(_probe_sites) == 5, (
    'nesting control: the scanner must see all five calls, saw %d' % len(_probe_sites))
assert [len(s[2]) for s in _probe_sites] == [0, 1, 1, 2, 0], (
    'nesting control: depths must be 0,1,1,2,0 — got %s'
    % [len(s[2]) for s in _probe_sites])
assert _probe_sites[4][2] == [], \
    'nesting control: a GROUPING paren must not count as a call frame'
assert _probe_sites[3][2][0][0] == 'label.new', \
    'nesting control: the OUTERMOST frame of a depth-2 site is the drawing call'

# ── CONTROLS for the stripper, BOTH WAYS ───────────────────────────────────
_STRIP_PROBE = '\n'.join([
    '// %s.%s(close) in a COMMENT is not a use' % (_NS, _TOSTR),
    'x = "%s.%s(close) inside a STRING is not a use"' % (_NS, _TOSTR),
    "y = 'and %s.format(...) in a single-quoted STRING is not one either'" % _NS,
    'real = %s.%s(close)' % (_NS, _TOSTR),
])
assert len(STR_CALL.findall(_STRIP_PROBE)) == 4, \
    'stripper control: unstripped, all four must be visible — else the needle is wrong'
assert len(STR_CALL.findall(strip_pine(_STRIP_PROBE))) == 1, \
    'stripper control: exactly ONE real call must survive the strip'
# ⛔ THE NEEDLE MUST NOT MATCH A MEMBER'S OWN VARIABLE.
assert STR_CALL.findall('v = my%s.%s(c) + _%s.upper(t)' % (_NS, _TOSTR, _NS)) == [], \
    'substring control: `mystr.` / `_str.` are a member\'s own names, not the namespace'
assert STR_CALL.findall('z = %s.upper(t)' % _NS) == ['upper'], \
    'substring control: …and the real namespace is still seen'
assert BARE_TOSTRING.findall('q = %s.%s(x)' % (_NS, _TOSTR)) == [], \
    'bare-spelling control: the namespaced call must not be counted twice'
assert len(BARE_TOSTRING.findall('q = %s(x)' % _TOSTR)) == 1, \
    'bare-spelling control: …and the real v4 spelling IS seen'


# ─────────────────────────────────────────────────────────────────────────────
# d2's message classifier — BOTH RULES, so the control can reproduce the old one
# ─────────────────────────────────────────────────────────────────────────────
def message_shape_d_rule(arg):
    """d's own rule, reproduced EXACTLY so its committed 555/338/149/2 can be
    re-derived. ⚰️ `'+' not in a` is measured over the whole argument, quotes
    included — which is the defect this census found."""
    if arg is None:
        return 'absent'
    a = NAMED.sub('', arg.strip()).strip()
    if not a:
        return 'absent'
    if PLACEHOLDER.search(a):
        return 'placeholder'
    if a.startswith(('"', "'")) and a.endswith(('"', "'")) and '+' not in a:
        return 'literal'
    return 'expression'


def message_shape_string_aware(arg):
    """The PARSER's question, which is the one `outputMessage` (pine.js:12902)
    asks: is this whole argument ONE string token?

    ⭐ Asked by STRIPPING the argument: if blanking every string literal leaves
    nothing but whitespace, there is no operator and no name OUTSIDE the quotes,
    so the parse node is a `string`. `"Grade A+ …"` answers yes; `"px " +
    str.tostring(close)` answers no.
    """
    if arg is None:
        return 'absent'
    a = NAMED.sub('', arg.strip()).strip()
    if not a:
        return 'absent'
    if not a.startswith(('"', "'")):
        return 'expression'
    if strip_pine(a).strip() != '':
        return 'expression'
    return 'placeholder' if PLACEHOLDER.search(a) else 'literal'


assert message_shape_d_rule('"Grade A+ - highest"') == 'expression', \
    "d-rule control: d's own rule calls a literal containing `+` an expression"
assert message_shape_string_aware('"Grade A+ - highest"') == 'literal', \
    'string-aware control: …and the string-aware rule does not'
assert message_shape_string_aware('"px " + %s.%s(close)' % (_NS, _TOSTR)) == 'expression', \
    'string-aware control: a real concatenation IS an expression'
assert message_shape_string_aware('message = "NAMED"') == 'literal', \
    'named-argument control: the NAME is not part of the value'
assert message_shape_string_aware('"px {{close}}"') == 'placeholder', \
    'placeholder control'


# ─────────────────────────────────────────────────────────────────────────────
# per-file context: user functions, and the names that hold drawing objects
# ─────────────────────────────────────────────────────────────────────────────
#: `f(a, b) =>`, `method f(table t, int c) =>` — ⛔ BOTH SPELLINGS AND TYPED
#: PARAMETERS. ⚰️ v2 of this instrument required a bare identifier per parameter,
#: so `dash_cell(table t, int col, int row, string txt, …)` parsed to ONE parameter
#: and every helper handed to it read as unresolvable. Worse than losing them: a
#: partially-matching list MISALIGNS, and a misaligned index names the wrong slot
#: with total confidence. The last word of a parameter is its name.
UDF_DECL = re.compile(r'^(\s*)(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>')
ASSIGN = re.compile(r'^\s*(?:var\s+|varip\s+)?(?:[A-Za-z_]\w*\s+)?'
                    r'([A-Za-z_]\w*)\s*(?::=|=)(?!=)')
OBJ_TYPED_DECL = re.compile(r'(?:^|\s)(?:var\s+|varip\s+)?(%s)\s+([A-Za-z_]\w*)\s*='
                            % '|'.join(OBJECT_NAMESPACES))
OBJ_FROM_NEW = re.compile(r'([A-Za-z_]\w*)\s*(?::=|=)\s*(%s)\.new\s*\('
                          % '|'.join(OBJECT_NAMESPACES))
OBJ_FROM_ARRAY = re.compile(r'([A-Za-z_]\w*)\s*(?::=|=)\s*array\.new_(%s)\s*\('
                            % '|'.join(OBJECT_NAMESPACES))
OUTPUT_CALL = re.compile(r'(?<![.\w])(plot|plotshape|plotchar|plotcandle|plotbar|'
                         r'plotarrow|hline|%s)\s*\(' % _ACOND)
DRAW_CALL = re.compile(r'(?<![.\w])(%s|polyline)\.' % '|'.join(OBJECT_NAMESPACES))


def parse_udfs(lines, line_start):
    """name -> {'params': [...], 'lo': char index, 'hi': char index} for the BODY.

    ⛔ REACHABILITY AND CONSUMPTION ARE BOTH INTERPROCEDURAL. (b)'s one-line
    consumer test reported "(nothing)" for 82 of 158 uses; a text helper handed to
    a three-line formatting helper is the SAME shape — `f_formatVolume` in
    `uncharted-volume-v2.pine` is exactly it, and pine.js:10014 records that the
    engine had to learn to step over the call for the very same reason.
    """
    out = {}
    for i, ln in enumerate(lines):
        m = UDF_DECL.match(ln)
        if not m:
            continue
        indent = len(m.group(1))
        params = []
        for p in m.group(3).split(','):
            head = p.split('=')[0].strip()
            if not head:
                continue
            # ⛔ THE LAST WORD IS THE NAME — `string txt` is one parameter, not none.
            params.append(head.split()[-1])
        if not all(re.match(r'^[A-Za-z_]\w*$', p) for p in params):
            continue
        lo = line_start[i] + m.end()
        j = i + 1
        while j < len(lines):
            s = lines[j]
            if s.strip() and (len(s) - len(s.lstrip())) <= indent:
                break
            j += 1
        hi = line_start[j] if j < len(lines) else line_start[-1] + len(lines[-1])
        out[m.group(2)] = {'params': params, 'lo': lo, 'hi': hi}
    return out


def object_names(stripped):
    """name -> family, for every name this script binds to a drawing object."""
    out = {}
    for m in OBJ_TYPED_DECL.finditer(stripped):
        out[m.group(2)] = m.group(1)
    for m in OBJ_FROM_NEW.finditer(stripped):
        out[m.group(1)] = m.group(2)
    for m in OBJ_FROM_ARRAY.finditer(stripped):
        out[m.group(1)] = m.group(2)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# consumer classification — ORDERED BY SPECIFICITY
# ─────────────────────────────────────────────────────────────────────────────
def consumer_class(outer_name, slot, objs, udfs):
    """The FORM's consumer class.

    ⛔ MOST SPECIFIC FIRST, and the order is load-bearing:
      a name this SCRIPT declared as a function wins over anything that looks
      built-in — the shadow rule `pine.js:6690` records for `security` itself;
      then the object METHOD spelling on a name the script bound to a drawing;
      then `alertcondition`'s own slots; then the plot family; then a namespace.
    """
    if outer_name is None:
        return '(top-level)'
    if outer_name in udfs:
        return 'user-fn'
    head, _, member = outer_name.partition('.')
    if not member:
        member = head
        head = ''
    # Pine's METHOD spelling — `tbl.cell(…)`, `lbl.set_text(…)`, `.set_text(…)`
    if member in DRAW_METHODS and (head in objs or head == ''):
        fam = objs.get(head, '?')
        kind = 'text' if slot in OBJECT_TEXT_SLOTS else 'other'
        return 'method-spelling %s:%s' % (fam, kind)
    if outer_name == _ACOND:
        return 'alertcondition:%s' % (slot or '?')
    if outer_name == 'alert':
        return 'alert()'
    if outer_name in PLOT_CALLS:
        if slot == 'title':
            return 'plot:title'
        if slot in OBJECT_TEXT_SLOTS:
            return 'plot:text'
        return 'plot:other'
    ns = outer_name.split('.')[0]
    if ns in OBJECT_NAMESPACES or ns in OUT_OF_SCOPE_NS:
        return '%s.*:%s' % (ns, 'text' if slot in OBJECT_TEXT_SLOTS else 'other')
    if ns == 'input' or outer_name == 'input':
        return 'input.*:%s' % ('defval' if slot in ('defval', '#0') else 'cosmetic')
    if outer_name in ('request.security', 'security'):
        return 'request.security:%s' % (slot or '?')
    if ns == _NS or outer_name == _TOSTR:
        return 'nested-in-another-text-helper'
    if ns == 'strategy':
        return 'strategy.*'
    if ns in ('log', 'runtime'):
        return 'log.*'
    if ns in ('array', 'matrix', 'map'):
        return 'collection.*'
    if ns in ('math', 'ta', 'color', 'request', 'ticker', 'timeframe', 'syminfo'):
        return '%s.*' % ns
    return 'other-call'


# ⛔⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE.
# The census reports ZERO text helpers inside a `plot`-family call or an
# `alertcondition(` in all 328 scripts. These prove the classifier can say both,
# so the zero is a measurement rather than a blind spot.
assert consumer_class(_ACOND, 'message', {}, {}) == 'alertcondition:message', \
    'presence control: the classifier must be able to name an alert MESSAGE slot'
assert consumer_class(_ACOND, 'title', {}, {}) == 'alertcondition:title', \
    'presence control: …and an alert TITLE slot'
assert consumer_class('plot', 'title', {}, {}) == 'plot:title', \
    'presence control: …and a plot TITLE slot'
assert consumer_class('label.new', 'text', {}, {}) == 'label.*:text', \
    'presence control: …and a drawing text slot, which the corpus does write'


def table_class(cc):
    """The FORM's consumer, as the table prints it."""
    if cc.startswith('alertcondition:'):
        return 'alertcondition ' + cc.split(':', 1)[1]
    if cc.startswith('plot:'):
        return 'plot ' + cc.split(':', 1)[1]
    if cc.startswith('method-spelling '):
        fam, kind = cc.split(' ', 1)[1].split(':')
        return '%s.%s (method spelling)' % (fam, kind)
    if cc.startswith('input.*:'):
        return 'input.* ' + cc.split(':', 1)[1]
    if cc.startswith('request.security:'):
        return 'request.security ' + cc.split(':', 1)[1]
    if ':' in cc and cc.split(':')[0].rstrip('.*') in OBJECT_NAMESPACES + OUT_OF_SCOPE_NS:
        ns, kind = cc.split(':')
        return '%s %s' % (ns, kind)
    return cc


# ─────────────────────────────────────────────────────────────────────────────
# admissibility — THE FROZEN 11, AND `str` IS TEXTOP-ONLY
# ─────────────────────────────────────────────────────────────────────────────
#: ⛔ `hostAdmissible(table)` is NEVER typed into this instrument: admissibility
#: HERE is about the NODE TYPE a use would need, which `parse.js:378` freezes and
#: `parse.js:1555` enforces (`str`/`symtext` may parent nothing but a `textop`).
ADMIT = {
    'shipped-textop': (
        'ADMISSIBLE + SHIPPED — folded to a NUMBER at pine.js:6703; the text is '
        'consumed inside the fold and nothing textual survives it'),
    'shipped-presentation': (
        'ADMISSIBLE + SHIPPED — the object lane carries it as `{t:num}`/`{t:cat}` '
        '(pine.js:9919/9940); the NUMBER rides and the surface formats it. '
        'CARRIAGE, not a node type'),
    'number-not-implemented': (
        'ADMISSIBLE IN PRINCIPLE, NOT IMPLEMENTED — yields a NUMBER, so it is a '
        '`textop` over `str`/`symtext` operands and needs NO 12th node type; it is '
        'simply absent from PINE_TEXT_PREDICATE (pine.js:1264) and falls to the '
        '`str` namespace guard (pine.js:6731)'),
    'carriage-only': (
        'NOT CARRIED TODAY — a presentation FIELD takes a string ONLY '
        '(pine.js:12864/12902). Resolvable to a literal at plan time => carriage; '
        'per-bar => a tree-valued field (still no node type) or a 12th node type'),
    'text-slot-unread': (
        'NOT CARRIED TODAY — the object lane reads only `%s.%s` and `+` in a text '
        'slot (pine.js:9919/9940); anything else falls to `canonicalOf`, refuses '
        '`pine:builtin`, is swallowed into `unresolvedValues` (pine.js:9828) and '
        'the property is dropped — the CELL is dropped whole (pine.js:10478)'
        % (_NS, _TOSTR)),
    'object-method-unseen': (
        "UNSEEN — Pine's METHOD spelling. `collectObjectOps` matches only the "
        'NAMESPACE spelling (pineObjects.js:88/265), so the whole call is invisible '
        'to the object pass and the text question never arises'),
    'input-cosmetic': (
        "NOT A VALUE — an input's title/tooltip/group is never read; "
        '`Resolver.resolveInput` folds the DEFVAL and nothing else. No demand here'),
    'security-argument': (
        "ROUTED TO (c) — `securityAsNode` takes `syminfo.tickerid` and a literal "
        'timeframe only, so a computed symbol declines with `pine:request` '
        '(pine.js:6690). A `sym` field, not a `str` node'),
    'chart-only': (
        'NOT TRANSLATED — `alert()` and `log.*` are chart-/runtime-only; `alert` is '
        'noted `pine:chart-only` (a NOTE code, pine.js:8443) and `log.*` refuses '
        '`pine:builtin`. The text never reaches a column'),
    'strategy-call': (
        'REFUSED — `pine:strategy-call` (NAMESPACE_GUARD, pine.js:563). A strategy '
        'is out of scope for this lane, so its alert text is not (f)\'s'),
    'collection-argument': (
        'REFUSED — `pine:collection` (NAMESPACE_GUARD, pine.js:570). `array`/`matrix`'
        '/`map` arguments are the IR lane\'s, not (f)\'s'),
    'predicate-operand-not-bind-time': (
        '⛔ NOT FOLDED — the member IS in PINE_TEXT_PREDICATE, but `textOperandOf` '
        '(pine.js:5308) takes a string LITERAL or a `syminfo.*` field and NOTHING '
        'else, so an operand that is a CALL or an expression makes '
        '`parts.every(Boolean)` false and the call falls through to the `str` '
        'namespace guard. Measured through the door: '
        '`plot(math.pow(10, str.length(str.tostring(syminfo.mintick)) - 2))` -> '
        'ok=false, `pine:builtin — `str.length``'),
    'predicate-operand-undecidable': (
        'UNDECIDABLE FROM SOURCE — a bare NAME operand. `stringValueOf` follows a '
        'binding (pine.js:5281) and this census has no binding table, so it is '
        'REPORTED and NOT COUNTED either way — (b)\'s rule for its own ambiguous '
        'numeric-string defaults'),
    'parent-refuses-first': (
        '⛔ INADMISSIBLE IN PLACE — THE ENGINE RESOLVES OUTSIDE-IN. This node\'s own '
        'PARENT refuses before its arguments are ever read, so a foldable inner node '
        'under it never folds. `str.length(_raw)` inside `str.substring(…)` is the '
        'corpus shape: `str.substring` hits the `str` namespace guard (pine.js:6731) '
        'and throws, and `textOperandOf` (pine.js:5308) takes a literal or a '
        '`syminfo.*` field — never a nested CALL — so even a text PREDICATE parent '
        'cannot hold one'),
    'needs-12th': (
        'INADMISSIBLE — TEXT yielded into a general expression position. `str` is '
        'textop-only (parse.js:381, enforced parse.js:1555), so this needs a 12th '
        'NODE_TYPES member'),
    'collection': (
        "INADMISSIBLE — yields an ARRAY; `pine:collection` territory, not (f)'s"),
}


#: ⛔⛔ A PARENT THAT REFUSES BEFORE READING ITS ARGUMENTS. `Resolver.resolve`
#: works outside-in, so whatever these hold is never reached.
def blocks(pclass):
    if pclass is None:
        return False
    return (pclass.startswith('method-spelling')
            or pclass.startswith('request.security:')
            or pclass in ('nested-in-another-text-helper', 'alert()', 'log.*',
                          'strategy.*', 'collection.*', 'input.*:cosmetic'))


#: The verdict a POSITION forces, whatever the member's kind — because the value
#: never reaches a tree at all. ⛔ ORDERED BEFORE THE KIND TEST.
POSITION_VERDICT = {
    'input.*:cosmetic': 'input-cosmetic',
    'alert()': 'chart-only',
    'log.*': 'chart-only',
    'strategy.*': 'strategy-call',
    'collection.*': 'collection-argument',
}


#: `pine.js:1244` BUILTIN_SYMBOL_SCOPED — the only non-literal text `textOperandOf`
#: takes. ⛔ Read as a ROSTER, not as "anything under syminfo": its siblings
#: (`syminfo.mintick`, `syminfo.prefix` unwitnessed) throw their own refusal.
SYMBOL_SCOPED = ('syminfo.ticker', 'syminfo.tickerid', 'syminfo.prefix')


def operand_kind(text):
    """Is this argument BIND-TIME TEXT in `textOperandOf`'s sense?"""
    a = NAMED.sub('', (text or '').strip()).strip()
    if not a:
        return 'absent'
    if a.startswith(('"', "'")) and strip_pine(a).strip() == '':
        return 'literal'
    if a in SYMBOL_SCOPED:
        return 'symbol-scoped'
    if re.search(r'[A-Za-z_]\w*\s*\(', a):
        return 'call'
    if re.match(r'^[A-Za-z_][\w.]*$', a):
        return 'name'
    return 'expression'


assert operand_kind('"abc"') == 'literal', 'operand control: a literal'
assert operand_kind('syminfo.ticker') == 'symbol-scoped', 'operand control: symbol-scoped'
assert operand_kind('%s.%s(close)' % (_NS, _TOSTR)) == 'call', \
    'operand control: the corpus shape — an operand that is itself a call'
assert operand_kind('_raw') == 'name', 'operand control: a bare name is undecidable here'


def admissibility(member, result, cclass, slot, pclass=None, operands=()):
    """⛔ ASK THE KIND FIRST, THEN THE POSITION — but the ENGINE'S OWN ORDER first
    of all. A member that answers a question about text WITH A NUMBER is a textop
    operand wherever the engine reaches it; a member that PRODUCES text is only
    ever carried, never held; and neither matters under a parent that throws."""
    if cclass.startswith('method-spelling'):
        return 'object-method-unseen'
    if cclass.startswith('request.security:'):
        return 'security-argument'
    if cclass in POSITION_VERDICT:
        return POSITION_VERDICT[cclass]
    # ⛔⛔ THE IMMEDIATE PARENT, NOT THE OUTERMOST CONSUMER. `label.new(text =
    # str.format("{0}", str.tostring(x)))` has a drawing text slot as its outermost
    # consumer and `str.format` as its parent, and the parent is what decides.
    if blocks(pclass):
        return 'parent-refuses-first'
    if result == 'array':
        return 'collection'
    if result == 'number':
        if member not in ENGINE_TEXT_PREDICATE:
            return 'number-not-implemented'
        # ⛔⛔ THE MEMBER BEING IN THE TABLE IS NOT ENOUGH — ITS OPERANDS DECIDE.
        kinds = [operand_kind(o) for o in operands]
        if kinds and any(k in ('call', 'expression') for k in kinds):
            return 'predicate-operand-not-bind-time'
        if kinds and any(k == 'name' for k in kinds):
            return 'predicate-operand-undecidable'
        return 'shipped-textop'
    # result == 'text'
    if cclass.endswith(':text') and slot in OBJECT_TEXT_SLOTS:
        return 'shipped-presentation' if member in ENGINE_TEXT_READER else 'text-slot-unread'
    if cclass in ('plot:title', 'alertcondition:message', 'alertcondition:title'):
        return 'carriage-only'
    return 'needs-12th'


ADMISSIBLE_KINDS = {'shipped-textop', 'shipped-presentation'}
assert admissibility('concat', 'text', 'label.*:text', 'text',
                     'label.*:text') == 'shipped-presentation', \
    'defect-1 regression control: `+` in a drawing text slot IS carried (pine.js:9940)'
assert admissibility('format', 'text', 'label.*:text', 'text',
                     'label.*:text') == 'text-slot-unread', \
    'defect-1 control: …and `str.format` in the same slot is NOT'
assert admissibility(_TOSTR, 'text', 'input.*:cosmetic', 'tooltip',
                     'input.*:cosmetic') == 'input-cosmetic', \
    "defect-4 control: an input's tooltip is not a demand for a node type"
assert admissibility('length', 'number', 'other-call', '#0', 'other-call',
                     ['"abcd"']) == 'shipped-textop', \
    'kind control: a NUMBER-yielding predicate over a LITERAL folds — measured: ' \
    'plot(close * str.length("abcd")) -> formula "close * 4"'
assert admissibility('contains', 'number', 'other-call', '#0', 'other-call',
                     ['syminfo.ticker', '"/"']) == 'shipped-textop', \
    'kind control: …and over a symbol-scoped field it becomes a textop — measured: ' \
    "formula \"text_contains(syminfo('ticker'), '/') ? high : low\""
assert admissibility('tonumber', 'number', 'other-call', '#0', 'other-call',
                     ['"3"']) == 'number-not-implemented', \
    'kind control: …and a number-yielder the engine lacks needs no 12th node type'
# ⚰️⚰️ THE SECOND FALSE POSITIVE THIS CONTROL EXISTS FOR. v3 scored the corpus's
# only two "reachable" `str.length` sites ADMISSIBLE. Both read
# `str.length(str.tostring(syminfo.mintick))`, and the door answers ok=false with
# `pine:builtin — `str.length``, because `textOperandOf` takes no nested call.
assert admissibility('length', 'number', 'math.*', '#1', 'math.*',
                     ['%s.%s(syminfo.mintick)' % (_NS, _TOSTR)]) \
    == 'predicate-operand-not-bind-time', \
    'blind-spot control: a predicate whose operand is a CALL does not fold'
# ⚰️⚰️ THE FALSE POSITIVE THIS CONTROL EXISTS FOR. Every `str.length` the corpus
# nests sits inside `str.substring(…)` or `str.repeat(…)`. v2 of this instrument
# scored seven of them ADMISSIBLE AND REACHABLE — a number that would have argued
# to BUILD something the engine can never reach.
assert admissibility('length', 'number', 'label.*:text', 'text',
                     'nested-in-another-text-helper') == 'parent-refuses-first', \
    'blind-spot control: a foldable node under a refusing parent never folds'
assert admissibility(_TOSTR, 'text', 'label.*:text', 'text',
                     'nested-in-another-text-helper') == 'parent-refuses-first', \
    'blind-spot control: …and the same is true of the reader the object lane knows'


# ─────────────────────────────────────────────────────────────────────────────
# reachability — INTERPROCEDURAL, BOTH DIRECTIONS
# ─────────────────────────────────────────────────────────────────────────────
def enclosing_udf_name(udfs, idx):
    for name, u in udfs.items():
        if u['lo'] <= idx < u['hi']:
            return name
    return None


def reaches(ctx, cclass, line_no, idx):
    """'output' | 'drawing' | 'none' — following calls in BOTH directions.

    ⭐ The textual consumer answers directly when there is one. Otherwise the value
    is followed FORWARD through assignments and INTO user functions with (b)'s own
    walk, and BACKWARD out of a user-function body to that function's call sites.
    """
    if cclass.startswith(('plot', 'alertcondition')):
        return 'output'
    if cclass.split(':')[0].rstrip('.*') in OBJECT_NAMESPACES:
        return 'drawing'
    if cclass.startswith('method-spelling'):
        return 'drawing'
    stripped, lines, cache, udfs = ctx['stripped'], ctx['lines'], ctx['cons'], ctx['udfs']
    seeds = set()
    # FORWARD: the name this statement binds
    j = line_no - 1
    while j >= 0:
        m = ASSIGN.match(lines[j]) if j < len(lines) else None
        if m:
            seeds.add(m.group(1))
            break
        if j < len(lines) and lines[j].strip() and \
                (len(lines[j]) - len(lines[j].lstrip())) == 0:
            break
        j -= 1
    # BACKWARD: out of the user function this site sits in, to its call sites
    fn = enclosing_udf_name(udfs, idx)
    if fn:
        for ln in lines:
            if not re.search(r'(?<![.\w])%s\s*\(' % re.escape(fn), ln):
                continue
            if OUTPUT_CALL.search(ln):
                return 'output'
            if DRAW_CALL.search(ln):
                return 'drawing'
            m = ASSIGN.match(ln)
            if m:
                seeds.add(m.group(1))
    best = 'none'
    for name in seeds:
        if not name:
            continue
        if name not in cache:
            cache[name] = consumers_of(stripped, name)[0]
        cons = cache[name]
        if 'plot/alert' in cons:
            return 'output'
        if 'drawing' in cons:
            best = 'drawing'
    return best


# ─────────────────────────────────────────────────────────────────────────────
def scripts():
    out = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine') or f.endswith('.txt'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


def positional_for(outer_name, objs, udfs):
    if outer_name in udfs:
        return []
    head, _, member = outer_name.partition('.')
    if not member:
        member = head
        head = ''
    if member in METHOD_POSITIONAL and (head in objs or head == ''):
        return METHOD_POSITIONAL[member]
    return POSITIONAL.get(outer_name, [])


def collect():
    rows = []
    d2 = {'total': 0, 'd_rule': Counter(), 'aware': Counter(), 'aware_expr': [],
          'd_expr': []}
    via_udf = Counter()
    files = scripts()
    for _d, fname, path in files:
        raw = io.open(path, encoding='utf-8', errors='replace').read()
        st = strip_pine(raw)
        raw_lines = raw.split('\n')
        st_lines = st.split('\n')
        nl = [i for i, c in enumerate(raw) if c == '\n']
        line_start = [0] + [i + 1 for i in nl]

        def lineno(i, _nl=nl):
            return bisect.bisect_right(_nl, i) + 1

        udfs = parse_udfs(st_lines, line_start)
        objs = object_names(st)
        ctx = {'stripped': st, 'lines': st_lines, 'cons': {}, 'udfs': udfs}

        # ⭐ WHICH VIEW: `+` positions come from the STRIPPED view (so a `+` inside
        # a literal or a comment is not one); the OPERANDS are read on the RAW view
        # (so a quote character can be seen at all).
        plus_positions = [m.start() for m in re.finditer(r'\+', st)]
        # ⭐⭐ THE ONE-LEVEL USER-FUNCTION RESOLUTION, prepared before the scan so
        # it costs no extra pass: every occurrence of every parameter INSIDE its
        # own function's body is a query position, and the innermost call frame
        # there is where that parameter is actually consumed.
        param_q = {}
        for fn, u in udfs.items():
            for p in u['params']:
                for m in re.finditer(r'(?<![.\w])%s(?![\w])' % re.escape(p),
                                     st[u['lo']:u['hi']]):
                    param_q.setdefault((fn, p), []).append(u['lo'] + m.start())
        qpos = [p for v in param_q.values() for p in v]
        # ⭐ every identifier position too, so FALLBACK 2 (resolve the RETURN) costs
        # no extra pass over the file.
        ident_pos = [m.start() for m in re.finditer(r'[A-Za-z_]\w*', st)]
        sites, at = scan_frames(st, plus_positions + qpos + ident_pos)
        at2 = at

        def param_consumer(fn, pidx):
            """(class, slot) where user function `fn` puts its parameter `pidx`.
            ⛔ ONE LEVEL ONLY — the depth `textNodeOf` itself inlines
            (pine.js:10038); two would need the frame CHAIN, which the engine
            refuses by name at pine.js:10030."""
            u = udfs.get(fn)
            if not u or pidx is None or pidx >= len(u['params']):
                return None
            p = u['params'][pidx]
            for pos in param_q.get((fn, p), []):
                fr = at.get(pos) or []
                if not fr:
                    continue
                inner_name, inner_idx = fr[-1]
                if inner_name in udfs:
                    continue
                spans = arg_spans(raw, inner_idx)
                sl = slot_of(raw, spans, pos, positional_for(inner_name, objs, udfs))
                cc = consumer_class(inner_name, sl, objs, udfs)
                if cc == 'user-fn':
                    continue
                return cc, sl
            return None

        def class_at(idx, frame):
            """(class, slot) for one call frame holding `idx`."""
            name, open_idx = frame
            spans = arg_spans(raw, open_idx)
            sl = slot_of(raw, spans, idx, positional_for(name, objs, udfs))
            return consumer_class(name, sl, objs, udfs), sl

        def udf_return_consumer(line_no):
            """⭐ FALLBACK 2 — RESOLVE THE RETURN, not the parameter.
            `_text(str) => str` puts its argument nowhere; what consumes the value
            is where the CALL's result goes: `header_sym01 = _text(…)` then
            `table.cell(…, header_sym01, …)`. A parameter walk alone reports
            "unresolved" for every identity helper in the corpus."""
            m = ASSIGN.match(st_lines[line_no - 1]) if line_no <= len(st_lines) else None
            if not m:
                return None
            nm = m.group(1)
            use = re.compile(r'(?<![.\w])%s(?![\w])' % re.escape(nm))
            for li, ln in enumerate(st_lines):
                if li == line_no - 1:
                    continue
                um = use.search(ln)
                if not um:
                    continue
                pos = line_start[li] + um.start()
                fr = at2.get(pos) or []
                if not fr:
                    continue
                inner = fr[-1]
                if inner[0] in udfs:
                    continue
                cc2, sl2 = class_at(pos, inner)
                if cc2 != 'user-fn':
                    return cc2, sl2
            return None

        def classify(idx, frames, line_no):
            """(depth, class, slot, parent class, via, consuming-argument key)."""
            depth = len(frames)
            if not frames:
                return depth, '(top-level)', None, None, None, None
            cc, sl = class_at(idx, frames[0])
            pc = cc if depth == 1 else class_at(idx, frames[-1])[0]
            key = (fname, frames[0][1], sl)
            if cc != 'user-fn':
                return depth, cc, sl, pc, None, key
            # ⛔⛔ THE OUTERMOST CONSUMER OF A HELPER HANDED TO A USER FUNCTION IS
            # NOT THAT FUNCTION — it is where the function's BODY puts the
            # parameter. One level, the depth `textNodeOf` itself inlines
            # (pine.js:10038); two would need the frame CHAIN, which the engine
            # refuses BY NAME at pine.js:10030.
            pidx = None
            names = udfs[frames[0][0]]['params']
            if sl and sl.startswith('#'):
                pidx = int(sl[1:])
            elif sl in names:
                pidx = names.index(sl)
            got = param_consumer(frames[0][0], pidx)
            if not got:
                got = udf_return_consumer(line_no)
            if got:
                via_udf[got[0]] += 1
                pc2 = got[0] if depth == 1 else pc
                return depth, got[0], got[1], pc2, frames[0][0], key
            return depth, 'user-fn(unresolved)', sl, pc, frames[0][0], key

        # ── the `str.*` population ──────────────────────────────────────────
        for (name, idx, frames) in sites:
            member = None
            if name.startswith(_NS + '.'):
                member = name.split('.', 1)[1]
            elif name == _TOSTR:
                member = _TOSTR
            if member is None:
                continue
            result = STR_RESULT.get(member, 'text')
            line_no = lineno(idx)
            depth, cc, sl, pc, via, key = classify(idx, frames, line_no)
            # the helper's OWN operands, read on the RAW view
            ops_ = [raw[s:e] for (s, e) in arg_spans(raw, idx)]
            ops_ = [a for a in ops_ if not NAMED.match(a.strip())]
            rows.append({
                'file': fname, 'line': line_no, 'member': member, 'result': result,
                'depth': depth, 'slot': sl, 'cclass': cc, 'via': via, 'key': key,
                'tclass': table_class(cc), 'pclass': pc,
                'operands': [operand_kind(a) for a in ops_],
                'admit': admissibility(member, result, cc, sl, pc, ops_),
                'reach': reaches(ctx, cc, line_no, idx),
                'src': (raw_lines[line_no - 1].strip()[:110]
                        if line_no <= len(raw_lines) else ''),
            })
        # ── string `+` concatenation ────────────────────────────────────────
        for k in plus_positions:
            before = raw[:k].rstrip()
            after = raw[k + 1:].lstrip()
            lit_left = before.endswith(('"', "'"))
            lit_right = after.startswith(('"', "'"))
            helper_right = after.startswith(_NS + '.') or bool(BARE_TOSTRING.match(after))
            helper_left = False
            if before.endswith(')'):
                depth_, j = 0, len(before) - 1
                while j >= 0:
                    if before[j] == ')':
                        depth_ += 1
                    elif before[j] == '(':
                        depth_ -= 1
                        if depth_ == 0:
                            helper_left = bool(re.search(
                                r'(?<![.\w])(%s\.[A-Za-z_]\w*|%s)$' % (_NS, _TOSTR),
                                before[:j]))
                            break
                    j -= 1
            if not (lit_left or lit_right or helper_left or helper_right):
                continue
            line_no = lineno(k)
            depth, cc, sl, pc, via, key = classify(k, at.get(k, []), line_no)
            rows.append({
                'file': fname, 'line': line_no, 'member': 'concat(+)',
                'result': 'text', 'depth': depth, 'slot': sl, 'cclass': cc,
                'via': via, 'key': key, 'tclass': table_class(cc), 'pclass': pc,
                'operands': [],
                'admit': admissibility('concat', 'text', cc, sl, pc, ()),
                'reach': reaches(ctx, cc, line_no, k),
                'src': (raw_lines[line_no - 1].strip()[:110]
                        if line_no <= len(raw_lines) else ''),
            })
        # ── d2's alertcondition messages, BOTH RULES ────────────────────────
        for m in AC_CALL.finditer(st):
            d2['total'] += 1
            op = raw.find('(', m.start())
            msg, pos = None, 0
            for (s, e) in arg_spans(raw, op):
                text = raw[s:e]
                nm = NAMED.match(text.lstrip())
                if nm and nm.group(1) == 'message':
                    msg = text
                    break
                if not nm:
                    if pos == 2:
                        msg = text
                    pos += 1
            dsh = message_shape_d_rule(msg)
            ash = message_shape_string_aware(msg)
            d2['d_rule'][dsh] += 1
            d2['aware'][ash] += 1
            ln = lineno(m.start())
            if dsh == 'expression':
                d2['d_expr'].append((fname, ln, (msg or '').strip()[:70]))
            if ash == 'expression':
                d2['aware_expr'].append((fname, ln, (msg or '').strip()[:70]))
    return files, rows, d2, via_udf


def main():
    w = sys.stdout.buffer.write
    files, rows, d2, via_udf = collect()
    nested = [r for r in rows if r['depth'] >= 1]

    w(b'ITEM (f) - NESTED TEXT HELPER CENSUS\n\n')
    w(('scripts read: %d   (%s)\n'
       % (len(files), ', '.join(os.path.basename(s) for s in SOURCES))).encode())
    w(('text-helper uses, ALL: %d   NESTED (depth>=1): %d   standing alone: %d\n\n'
       % (len(rows), len(nested), len(rows) - len(nested))).encode())

    # ── THE CONTROLS ────────────────────────────────────────────────────────
    w(b'--- CONTROLS ---\n')
    ok = True

    def ctrl(name, expected, got):
        nonlocal ok
        good = (expected == got)
        ok = ok and good
        w(('CONTROL: %-52s expected %-6s got %-6s %s\n'
           % (name, expected, got, 'OK' if good else 'FAIL')).encode())

    idx = json.load(io.open(os.path.join(ROOT, 'corpus', 'index.json'),
                            encoding='utf-8'))
    ctrl('corpus/index.json::counts.committed', idx['counts']['committed'],
         len([f for f in os.listdir(SOURCES[0]) if f.endswith('.pine')]))
    ctrl('d2 alertcondition calls (alertMessageRides.test.js:10)', 555, d2['total'])
    ctrl("d2 literal messages, d's own rule", 338, d2['d_rule']['literal'])
    ctrl('d2 placeholder messages', 149, d2['d_rule']['placeholder'])
    ctrl("d2 expression messages, d's own rule", 2, d2['d_rule']['expression'])
    ctrl('d2 carryable (literal+placeholder)', 487,
         d2['d_rule']['literal'] + d2['d_rule']['placeholder'])
    # ⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE.
    ctrl('non-vacuity: nested text helpers exist at all', True, len(nested) > 0)
    ctrl('non-vacuity: a depth-2 nesting exists', True,
         any(r['depth'] >= 2 for r in nested))
    ctrl('non-vacuity: the string-aware rule CAN say expression', True,
         message_shape_string_aware('"px " + %s.%s(close)' % (_NS, _TOSTR))
         == 'expression')
    ctrl('non-vacuity: the one-level user-fn resolution fires', True,
         sum(via_udf.values()) > 0)
    ctrl('non-vacuity: some form is admissible AND reachable', True,
         any(r['admit'] in ADMISSIBLE_KINDS and r['reach'] != 'none' for r in nested))
    ctrl('non-vacuity: the parent-refuses test fires on the corpus', True,
         any(r['admit'] == 'parent-refuses-first' for r in nested))
    ctrl('non-vacuity: the predicate-operand test fires on the corpus', True,
         any(r['admit'] == 'predicate-operand-not-bind-time' for r in nested))
    # ⛔⛔ THE MEASURED ZERO, pinned. The classifier's ability to say both is
    # asserted at import (see the presence controls beside `consumer_class`), so a
    # future corpus that DOES write one will move this line rather than hide it.
    ctrl('text helpers inside an alertcondition( , ANY depth', 0,
         sum(1 for r in rows if r['cclass'].startswith('alertcondition')))
    ctrl('text helpers inside a plot-family call, ANY depth', 0,
         sum(1 for r in rows if r['cclass'].startswith('plot')))
    w(b'\n')

    # ── f.4(i) ──────────────────────────────────────────────────────────────
    w(b"--- f.4(i) THE TWO 'EXPRESSION' MESSAGES d2 NOTES ---\n")
    w(("  d's own rule      : %s\n" % dict(d2['d_rule'])).encode())
    w(('  string-aware rule : %s\n' % dict(d2['aware'])).encode())
    for f, ln, t in d2['d_expr']:
        w(('  d says EXPRESSION : %s:%d  %s\n    -> string-aware: %s\n'
           % (f, ln, t, message_shape_string_aware(t))).encode('utf-8', 'replace'))
    w(('  GENUINE expression messages in the corpus: %d\n'
       % len(d2['aware_expr'])).encode())
    for f, ln, t in d2['aware_expr'][:12]:
        w(('    %s:%d  %s\n' % (f, ln, t)).encode('utf-8', 'replace'))
    w(b'\n')

    # ── f.2 the population ─────────────────────────────────────────────────
    w(b'--- f.2 NESTING DEPTH (nested set) ---\n')
    for k, v in sorted(Counter(r['depth'] for r in nested).items()):
        w(('  depth %-3d %6d\n' % (k, v)).encode())
    w(b'\n--- f.2 RESULT KIND (nested set) ---\n')
    for k, v in Counter(r['result'] for r in nested).most_common():
        w(('  %-8s %6d\n' % (k, v)).encode())
    w(b'\n--- f.2 OUTERMOST CONSUMER (nested set) ---\n')
    for k, v in Counter(r['tclass'] for r in nested).most_common():
        w(('  %-34s %6d\n' % (k, v)).encode())
    w(('\n  of which resolved ONE LEVEL through a user function: %d\n'
       % sum(via_udf.values())).encode())
    for k, v in via_udf.most_common(8):
        w(('    via user-fn -> %-28s %5d\n' % (table_class(k), v)).encode())
    w(b'\n--- f.2 REACHES AN OUTPUT OR A DRAWING (interprocedural) ---\n')
    for k, v in Counter(r['reach'] for r in nested).most_common():
        w(('  %-10s %6d\n' % (k, v)).encode())
    w(b'\n')

    # ── f.3 THE TABLE ──────────────────────────────────────────────────────
    w(b'--- f.3 THE TABLE: one row per FORM (helper x outermost-consumer) ---\n')
    w(b'  USES = helper NODES. ARGS = distinct consuming ARGUMENTS, because\n'
      b'  `label.new(text = "x " + str.tostring(v))` is ONE demand written with TWO\n'
      b'  helper nodes, and reading USES as demands double-counts every concatenation.\n')
    w(('%-12s %-30s %5s %5s %5s %7s  %-22s %s\n'
       % ('HELPER', 'OUTERMOST CONSUMER', 'USES', 'ARGS', 'FILES', 'ADM+RCH',
          'VERDICT', 'NAMED SCRIPT')).encode())
    forms = defaultdict(list)
    for r in nested:
        forms[(r['member'], r['tclass'])].append(r)
    for (member, tclass), rs in sorted(forms.items(), key=lambda kv: -len(kv[1])):
        adm = [r for r in rs
               if r['admit'] in ADMISSIBLE_KINDS and r['reach'] != 'none']
        spec = sorted(rs, key=lambda r: (r['file'], r['line']))[0]
        w(('%-12s %-30s %5d %5d %5d %7d  %-22s %s:%d\n'
           % (member[:12], tclass[:30], len(rs),
              len(set(r['key'] for r in rs if r['key'])),
              len(set(r['file'] for r in rs)),
              len(adm), Counter(r['admit'] for r in rs).most_common(1)[0][0][:22],
              spec['file'][:44], spec['line'])).encode('utf-8', 'replace'))
    w(b'\n--- ADMISSIBILITY VERDICTS, with the pine.js line that decides each ---\n')
    for k, v in Counter(r['admit'] for r in nested).most_common():
        w(('  %-22s %6d  %s\n' % (k, v, ADMIT[k])).encode())
    w(b'\n')

    # ── f.4(ii) ────────────────────────────────────────────────────────────
    w(b'--- f.4(ii) NUMBER vs TEXT (nested set) ---\n')
    num = [r for r in nested if r['result'] == 'number']
    txt = [r for r in nested if r['result'] == 'text']
    arr = [r for r in nested if r['result'] == 'array']
    w(('  yields a NUMBER : %5d uses in %2d files  (%d shipped as a textop, '
       '%d reachable)\n'
       % (len(num), len(set(r['file'] for r in num)),
          sum(1 for r in num if r['admit'] == 'shipped-textop'),
          sum(1 for r in num
              if r['admit'] == 'shipped-textop' and r['reach'] != 'none'))).encode())
    w(('  yields TEXT     : %5d uses in %2d files  (%d carried as a presentation '
       'field, %d reachable)\n'
       % (len(txt), len(set(r['file'] for r in txt)),
          sum(1 for r in txt if r['admit'] == 'shipped-presentation'),
          sum(1 for r in txt
              if r['admit'] == 'shipped-presentation'
              and r['reach'] != 'none'))).encode())
    w(('  yields an ARRAY : %5d uses in %2d files\n'
       % (len(arr), len(set(r['file'] for r in arr)))).encode())
    w(b'\n  NUMBER-yielding members, per member:\n')
    for k, v in Counter(r['member'] for r in num).most_common():
        w(('    %-14s %5d   %s\n'
           % (k, v, 'in PINE_TEXT_PREDICATE (SHIPPED)' if k in ENGINE_TEXT_PREDICATE
              else 'NOT implemented — no 12th node type needed')).encode())
    w(b'\n  operand kinds on the NUMBER-yielding members (what decides the fold):\n')
    for k, v in Counter(o for r in num for o in r['operands']).most_common():
        w(('    %-16s %5d\n' % (k, v)).encode())
    w(b'\n  NUMBER specimens to verify through the door:\n')
    for r in [x for x in num if x['admit'] == 'shipped-textop'][:6]:
        w(('    %s:%d  %s\n' % (r['file'][:44], r['line'], r['src']))
          .encode('utf-8', 'replace'))
    w(b'\n  TEXT-carried (presentation) specimens:\n')
    for r in [x for x in txt if x['admit'] == 'shipped-presentation'][:6]:
        w(('    %s:%d  %s\n' % (r['file'][:44], r['line'], r['src']))
          .encode('utf-8', 'replace'))
    w('\n  ⛔⛔ "CARRIED" IS ABOUT THE TEXT MACHINERY, NOT ABOUT THE WHOLE CELL.\n'
      '  The text node is built; the cell still needs its NUMERIC argument to\n'
      '  resolve. Measured through the door on the named specimen\n'
      '  `4c-nyse-market-breadth-ratio__722410befd.pine`: all three cells drop with\n'
      '  `cell:text` and `unresolvedValues=3` — because the values come from\n'
      '  `request.security`, which refuses `pine:request` twice. That is item (c)\'s\n'
      '  blocker sitting under (f)\'s carriage, and reading ADM+RCH as "renders\n'
      '  today" would credit this lane with a table it does not draw.\n'
      .encode('utf-8'))

    w(b'\n--- THRESHOLD (~20 admissible-and-reachable uses) ---\n')
    for (member, tclass), rs in sorted(forms.items(), key=lambda kv: -len(kv[1])):
        adm = [r for r in rs
               if r['admit'] in ADMISSIBLE_KINDS and r['reach'] != 'none']
        args = len(set(r['key'] for r in adm if r['key']))
        w(('  %-12s %-30s adm+rch=%-5d args=%-5d %s\n'
           % (member[:12], tclass[:30], len(adm), args,
              'BUILD' if len(adm) >= 20 else 'RETIRE')).encode())
    w('\n  ⛔ EVERY ROW ABOVE 20 IS ALREADY SHIPPED, so "BUILD" there means "KEEP\n'
      '  AND DO NOT REGRESS", not "start work". The rows that would be NEW work are\n'
      '  the ones below the line, and each is named with its own number above.\n'
      .encode('utf-8'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
