# -*- coding: utf-8 -*-
"""item (b) — the TIME INPUT census.

Item (b)'s definition existed only as the words "time inputs" in chat and was never
committed. This census defines it by measurement, the way a1's census defined the loop
forms and a5.1's defined the reduce members — the threshold decides the scope after,
never before.

⭐ WHAT COUNTS AS TIME-SHAPED IS DECIDED BY THE DEFAULT, NOT BY THE CALL NAME. The
prompt's own list — `input.time`, `input.session`, `input.timeframe` — is where it
starts, but `input.string(defval='0930-1600')` is a session input wearing a different
name and `input.string(defval='D')` is a timeframe. The engine already knows this:
`timeframeLiteralOf` folds `input.timeframe`, `input.string` AND bare `input` when the
default is a timeframe string, and refuses all three otherwise. So the census reads
the DEFAULT's shape and classifies on that.

PER USE IT ANSWERS THREE THINGS:

  SHAPE      literal timeframe / literal session / literal timestamp / expression —
             because a default that is not a literal cannot fold at plan time at all,
             which is the (c) boundary rather than a (b) gap
  CONSUMER   what reads the bound name: a plot/alertcondition (this lane's),
             request.security (item (c)'s, routed by name and NEVER counted here), a
             time()/session comparison, a drawing path, or nothing
  CARRIER    which of the frozen 11 NODE_TYPES could hold the value — `tf` for a
             timeframe, `num` for a timestamp, `str` only where a `textop` consumes
             it. A kind with no carrier is inadmissible BY CONSTRUCTION and is
             reported as such rather than counted as an opportunity.

⛔ Comments and string literals are stripped before matching, and the stripper carries
its own control — six recorded instances in this repo of a literal-hunting check
matching its own documentation. ⚠️ Stripping strings is delicate HERE in a way it was
not for the reduce census, because a time input's whole payload IS a string literal.
So the stripper runs in two modes: `strip_pine` for finding CALL SITES, and the raw
line for reading the DEFAULT out of a call the stripped pass already located.

⭐⭐ THE CONTROL IS THE PRODUCT'S OWN ANSWER, not a number this tool also produced.
`uncharted-clouds.pine` refuses exactly **8** `pine:input-kind` lines — measured
through the shipped door and pinned BY VALUE in
`closingPassDoesNotMint.test.js` — and every one is `input.string` or `input.color`,
so Clouds holds **zero** time-shaped inputs. The census must re-derive both numbers or
it is reading something other than what the engine reads.

Usage:  python tools/pine_time_input_census.py
"""
import io
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

#: Every `input.*` spelling, so the handled/refused split is measured not assumed.
CALL = re.compile(r'\binput(?:\.([A-Za-z_]\w*))?\s*\(')

#: What `Resolver.resolveInput`'s NUMERIC set holds (pine.js). Anything else throws
#: `pine:input-kind` in a VALUE position — the position-specific folds are separate.
NUMERIC = {'input', 'int', 'float', 'bool', 'source', 'price'}

# ── the shapes a default can have ───────────────────────────────────────────
#
# ⚰️⚰️ THE FIRST VERSION OF THIS BLOCK OVER-COUNTED, AND IT IS RECORDED RATHER THAN
# QUIETLY FIXED. `TF_LIT` ended in a bare `\d+` alternative, so every one-or-two
# digit string literal read as a timeframe. Sampled against the real corpus it
# claimed `input.string("1", "  Border Width", options=["1","2","3","4"])` — a LINE
# WIDTH — and `input.string("1234567", "Days of Week")` — a DAY MASK — as timeframe
# inputs. That is this repo's own `lesson_a_sweep_that_flags_thirteen_when_two_are_
# defects`, and the number would have been quoted into a threshold decision.
#
# ⭐ THE DISCRIMINATOR IS THE KIND, THEN THE LITERAL — never the literal alone.
# `input.timeframe("60")` is a timeframe because the CALL says so. `input.string("60")`
# is not decidable from the source: the engine itself only reads it as one when a
# timeframe POSITION asks (`timeframeLiteralOf`), and this census has no position
# information. So a bare-numeric default under a non-timeframe kind is reported
# AMBIGUOUS and NOT COUNTED, with its own line in the output.

#: Unambiguous on sight: carries a unit letter — `D` `W` `1D` `12M` `240S`.
TF_UNAMBIGUOUS = re.compile(r'^["\'](\d*[SDWMsdwm])["\']$')
#: Digits only — a timeframe ONLY when the call's kind already says timeframe.
TF_NUMERIC = re.compile(r'^["\']\d{1,4}["\']$')
#: `''` — Pine's "the chart's own timeframe". A real case, not a parse failure: 23
#: of the corpus's `input.timeframe` calls state exactly this.
TF_EMPTY = re.compile(r'^["\']\s*["\']$')
#: `'0930-1600'`, `'0400-2000:1234567'` — a session, optionally with a day mask.
SESSION_LIT = re.compile(r'^["\']\d{3,4}-\d{3,4}(:[1-7]+)?["\']$')
#: `'1234567'`, `'123567'` — a DAY MASK. Time-related and NOT a timeframe; it was
#: the second false positive the sampling caught.
DAYMASK_LIT = re.compile(r'^["\'][1-7]{2,7}["\']$')
#: `timestamp(...)` or a bare epoch-looking integer.
TS_LIT = re.compile(r'^(timestamp\s*\(|\d{9,}$)')


def strip_pine(src):
    """Comments and string literals out, so a call named IN PROSE is not a use.

    ⛔ Returns a same-length string: every removed character becomes a space, so
    line/column arithmetic downstream still lands on the real source.
    """
    out = list(src)
    i, n = 0, len(src)
    in_str = None
    while i < n:
        ch = src[i]
        if in_str:
            if ch == '\\':
                out[i] = ' '
                if i + 1 < n:
                    out[i + 1] = ' '
                i += 2
                continue
            out[i] = ' '
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in '"\'':
            in_str = ch
            out[i] = ' '
            i += 1
            continue
        if ch == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        i += 1
    return ''.join(out)


def call_args(raw, open_paren):
    """The text between a call's parentheses, depth- and quote-aware."""
    depth, i, n = 0, open_paren, len(raw)
    q = None
    while i < n:
        c = raw[i]
        if q:
            if c == '\\':
                i += 2
                continue
            if c == q:
                q = None
        elif c in '"\'':
            q = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return raw[open_paren + 1:i]
        i += 1
    return raw[open_paren + 1:]


def split_args(s):
    """Top-level comma split, quote- and bracket-aware."""
    parts, buf, depth, q = [], [], 0, None
    for c in s:
        if q:
            buf.append(c)
            if c == q:
                q = None
            continue
        if c in '"\'':
            q = c
        elif c in '([':
            depth += 1
        elif c in ')]':
            depth -= 1
        if c == ',' and depth == 0:
            parts.append(''.join(buf).strip())
            buf = []
            continue
        buf.append(c)
    if buf:
        parts.append(''.join(buf).strip())
    return parts


def defval_of(argtext):
    """The `defval` a call states — named, or positional slot 0."""
    for i, a in enumerate(split_args(argtext)):
        if a.startswith('defval'):
            eq = a.find('=')
            if eq >= 0:
                return a[eq + 1:].strip()
        elif '=' not in a.split('(')[0] and i == 0:
            return a.strip()
    return None


def shape_of(defval, kind):
    """The default's shape. ⛔ `kind` is required: a bare-numeric literal is a
    timeframe under `input.timeframe` and UNDECIDABLE under `input.string`."""
    if defval is None:
        return 'none'
    d = defval.strip()
    if SESSION_LIT.match(d):
        return 'session'
    if TS_LIT.match(d):
        return 'timestamp'
    if TF_EMPTY.match(d):
        return 'timeframe-empty' if kind == 'timeframe' else 'string-other'
    # ⛔⛔ THE KIND IS ASKED FIRST, AND THIS ORDER IS LOAD-BEARING. `'15'` and `'45'`
    # are both `[1-7]{2,7}`, so a day-mask test placed ahead of this one called two
    # ordinary intraday timeframes day-masks — version 2's own residual, caught the
    # same way version 1's was: by reading the table it printed.
    if TF_NUMERIC.match(d) and kind == 'timeframe':
        return 'timeframe'
    if DAYMASK_LIT.match(d):
        return 'day-mask'
    if TF_UNAMBIGUOUS.match(d):
        return 'timeframe'
    if TF_NUMERIC.match(d):
        # ⛔ THE KIND DECIDES. See the block above: this is where the first version
        # claimed a border width as a timeframe.
        return 'numeric-string-AMBIGUOUS'
    if d.startswith(('"', "'")):
        return 'string-other'
    if re.match(r'^-?\d+(\.\d+)?$', d):
        return 'number'
    return 'expression'


#: A time input is one whose KIND says time, or whose DEFAULT is time-shaped.
TIME_KINDS = {'time', 'session', 'timeframe'}
TIME_SHAPES = {'timeframe', 'timeframe-empty', 'session', 'timestamp'}

#: ⛔ EVERY shape gets a carrier sentence — a `?` in this table is the instrument
#: declining to answer its own question, which is what b.3 exists to settle.
CARRIER = {
    'timeframe': 'tf — already a node type; `timeframeLiteralOf` already folds it',
    'timeframe-empty': "tf — `''` is Pine's CHART timeframe; `basePeriod` already "
                       'carries it, so the carrier exists and needs no literal',
    'session': 'str — ONLY where a `textop` consumes it; `assertCanonical` '
               'enforces that parentage, so a session reaching any other '
               'position has NO carrier under the frozen 11',
    'timestamp': 'num — a Unix ms integer is a number',
    'day-mask': 'str under the same textop-only rule as `session` — and it is NOT '
                'a timeframe; it was a measured false positive of version 1',
    'number': 'num — but the KIND is what made this time-shaped, not the default',
    'string-other': 'depends on the kind; a non-time string has no (b) claim',
    'numeric-string-AMBIGUOUS': 'UNDECIDABLE from source — the engine reads it as a '
                                'timeframe only when a timeframe POSITION asks '
                                '(`timeframeLiteralOf`), and this census has no '
                                'position. NOT COUNTED either way.',
    'expression': 'NONE at plan time — a non-literal default is the (c) boundary',
    'none': 'NONE — states no default; the engine already refuses this by name',
}


def bound_name(raw, start):
    """The name a call is assigned to, reading left of the call on its line."""
    line_start = raw.rfind('\n', 0, start) + 1
    head = raw[line_start:start]
    m = re.search(r'([A-Za-z_]\w*)\s*(?::=|=)\s*$', head)
    return m.group(1) if m else None


CONSUMERS = [
    ('request.security', re.compile(r'\brequest\.security\s*\(|\bsecurity\s*\(')),
    ('plot/alert', re.compile(r'\b(plot|plotshape|plotchar|plotcandle|'
                              r'alertcondition|hline|fill|bgcolor|barcolor)\s*\(')),
    ('time/session-cmp', re.compile(r'\b(time|time_close|session\.|'
                                    r'timestamp|dayofweek|hour|minute)\b')),
    ('drawing', re.compile(r'\b(line|label|box|table|polyline)\.')),
]


ASSIGN = re.compile(r'^\s*(?:var\s+|varip\s+)?(?:[A-Za-z_]\w*\s+)?'
                    r'([A-Za-z_]\w*)\s*(?::=|=)(?!=)')
#: `f_calc_mtf_ma(_src, _len, _tf, _type) =>` — a user function declaration.
UDF_DECL = re.compile(r'^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>')


def udf_params(stripped):
    """name -> [parameter names], for every user-defined function in the script."""
    out = {}
    for ln in stripped.split('\n'):
        m = UDF_DECL.match(ln)
        if m:
            ps = [p.strip().split('=')[0].strip() for p in m.group(2).split(',')]
            out[m.group(1)] = [p for p in ps if re.match(r'^[A-Za-z_]\w*$', p)]
    return out


def consumers_of(stripped, name):
    """Which reader paths this name reaches — TRANSITIVELY.

    ⚰️⚰️ THE ONE-LINE VERSION OF THIS FUNCTION REPORTED `(nothing)` FOR 82 OF 158
    `input.timeframe` USES, and that number is what exposed it: a value nothing reads
    is possible, but not for half the corpus's timeframe inputs. It only asked
    whether the input's OWN name appeared on a line with a consumer, so the entirely
    ordinary `tf = input.timeframe('D')` → `htf = tf` → `plot(…htf…)` read as unused.

    ⛔ A REACHABILITY ANSWER THAT CANNOT FOLLOW ONE ASSIGNMENT IS NOT A REACHABILITY
    ANSWER, and "admissible AND reachable" is the number the threshold turns on — so
    an under-count here argues for retiring something members use.

    It walks assignments to a fixed point: any name assigned from an expression that
    mentions a name already in the set joins the set. Bounded by the line count, so a
    cycle cannot spin.
    """
    if not name:
        return set(), {name}
    lines = stripped.split('\n')
    udfs = udf_params(stripped)
    reach = {name}
    for _ in range(len(lines)):
        grew = False
        for ln in lines:
            # ⛔⛔ ACROSS THE FUNCTION BOUNDARY FIRST. `f(…, i_ma01_tf, …)` binds the
            # value to f's PARAMETER, and f's body is where `request.security` is
            # called. Without this the walk stops at the call site and reports the
            # input as reaching a plot directly — measured on
            # `advanced-custom-multi-ma-signals…`, where `i_ma01_tf` goes to
            # `f_calc_mtf_ma(_src, _len, _tf, _type) =>` whose body is
            # `request.security(syminfo.tickerid, _tf, …)`. That is item (c)'s use,
            # and counting it as (b)'s inflates the ONE number the threshold turns on,
            # in the direction that argues for building what (c) already owns.
            for fname, params in udfs.items():
                call = re.search(r'\b%s\s*\(' % re.escape(fname), ln)
                if not call:
                    continue
                args = split_args(call_args(ln, call.end() - 1))
                for i, a in enumerate(args):
                    if i >= len(params) or params[i] in reach:
                        continue
                    if any(re.search(r'\b%s\b' % re.escape(n), a) for n in reach):
                        reach.add(params[i])
                        grew = True
            m = ASSIGN.match(ln)
            if not m:
                continue
            lhs = m.group(1)
            if lhs in reach:
                continue
            rhs = ln[m.end():]
            if any(re.search(r'\b%s\b' % re.escape(n), rhs) for n in reach):
                reach.add(lhs)
                grew = True
        if not grew:
            break
    found = set()
    for ln in lines:
        if not any(re.search(r'\b%s\b' % re.escape(n), ln) for n in reach):
            continue
        for label, pat in CONSUMERS:
            if pat.search(ln):
                found.add(label)
    return found, reach


# ── the stripper's own control ──────────────────────────────────────────────
_PROBE = '\n'.join([
    "// input.session('0930-1600') in a COMMENT is not a use",
    "x = 'input.timeframe(\"D\") inside a STRING is not a use'",
    "real = input.session('0930-1600', 'RTH')",
])
assert len(CALL.findall(strip_pine(_PROBE))) == 1, \
    'stripper control: it must see exactly the ONE real call'
assert shape_of("'0930-1600'", 'session') == 'session', 'shape control: session'
assert shape_of("'D'", 'timeframe') == 'timeframe', 'shape control: timeframe'
assert shape_of("timestamp('2024-01-01')", 'time') == 'timestamp', \
    'shape control: timestamp'
assert shape_of('14', 'int') == 'number', 'shape control: a plain number is not time'
# ⭐⭐ THE REGRESSION CONTROLS FOR VERSION 1's TWO MEASURED FALSE POSITIVES. Both of
# these were counted as timeframes and both are real lines in the corpus.
assert shape_of("'1'", 'string') == 'numeric-string-AMBIGUOUS', \
    'blind-spot control: a BORDER WIDTH under input.string is not a timeframe'
assert shape_of("'1234567'", 'string') == 'day-mask', \
    'blind-spot control: a DAY MASK is not a timeframe'
assert shape_of("'60'", 'timeframe') == 'timeframe', \
    'blind-spot control: …but the same literal IS one when the kind says so'
assert shape_of("''", 'timeframe') == 'timeframe-empty', \
    "shape control: an empty default is the CHART's timeframe, not a failure"
assert shape_of("'15'", 'timeframe') == 'timeframe', \
    'blind-spot control: 15 and 45 are [1-7]{2,7} — the KIND is asked before day-mask'
assert shape_of("'45'", 'timeframe') == 'timeframe', 'blind-spot control: 45m'
assert all(s in CARRIER for s in (
    'timeframe', 'timeframe-empty', 'session', 'timestamp', 'day-mask', 'number',
    'string-other', 'numeric-string-AMBIGUOUS', 'expression', 'none')), \
    'carrier control: every shape this census can emit must have a carrier answer'


def scripts():
    out = []
    for d in SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine') or f.endswith('.txt'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


def main():
    w = sys.stdout.buffer.write
    all_kinds = Counter()
    kind_files = defaultdict(set)
    ambiguous = Counter()
    rows = []
    clouds_nonnumeric, clouds_time = 0, 0

    files = scripts()
    for _dirname, fname, path in files:
        raw = io.open(path, encoding='utf-8', errors='replace').read()
        stripped = strip_pine(raw)
        for m in CALL.finditer(stripped):
            kind = m.group(1) or 'input'
            all_kinds[kind] += 1
            kind_files[kind].add(fname)
            argtext = call_args(raw, raw.find('(', m.start()))
            dv = defval_of(argtext)
            shape = shape_of(dv, kind)
            if shape == 'numeric-string-AMBIGUOUS':
                ambiguous[kind] += 1
            if fname == 'uncharted-clouds.pine':
                if kind not in NUMERIC:
                    clouds_nonnumeric += 1
                if kind in TIME_KINDS or shape in TIME_SHAPES:
                    clouds_time += 1
            if kind not in TIME_KINDS and shape not in TIME_SHAPES:
                continue
            name = bound_name(raw, m.start())
            cons, reach = consumers_of(stripped, name)
            rows.append({
                'file': fname, 'kind': kind, 'shape': shape, 'name': name,
                'line': raw[:m.start()].count('\n') + 1,
                'consumers': cons, 'reach': len(reach),
            })

    w(b'ITEM (b) - TIME INPUT CENSUS\n\n')
    w(('scripts read: %d\n\n' % len(files)).encode())

    w(b'--- EVERY input.* KIND, handled vs refused (VALUE position) ---\n')
    for kind, n in sorted(all_kinds.items(), key=lambda kv: -kv[1]):
        verdict = 'HANDLED -> num' if kind in NUMERIC else 'REFUSES pine:input-kind'
        # ⭐ The bare `input(` spelling is v3/v4 and is its own kind, not `input.input`.
        label = 'input (bare)' if kind == 'input' else 'input.%s' % kind
        w(('  %-16s %5d uses  %4d files   %s\n'
           % (label, n, len(kind_files[kind]), verdict)).encode())

    w(b'\n--- THE CONTROL: the product\'s own answer on Clouds ---\n')
    w(('  non-numeric input kinds : %d   (engine refuses 8 x pine:input-kind)\n'
       % clouds_nonnumeric).encode())
    w(('  time-shaped inputs      : %d   (so item (b) does not touch Clouds)\n'
       % clouds_time).encode())
    ok = (clouds_nonnumeric == 8 and clouds_time == 0)
    w(('  CONTROL %s\n' % ('OK' if ok else '*** MISMATCH - the census is not '
                           'reading what the engine reads ***')).encode())

    w(b'\n--- TIME-SHAPED USES, per kind ---\n')
    by_kind = defaultdict(list)
    for r in rows:
        by_kind[r['kind']].append(r)
    for kind in sorted(by_kind):
        rs = by_kind[kind]
        shapes = Counter(r['shape'] for r in rs)
        w(('\ninput.%s — %d uses in %d files\n'
           % (kind, len(rs), len(set(r['file'] for r in rs)))).encode())
        w(('  default shape : %s\n' % dict(shapes)).encode())
        cons = Counter()
        for r in rs:
            if not r['consumers']:
                cons['(nothing)'] += 1
            for c in r['consumers']:
                cons[c] += 1
        w(('  consumers     : %s\n' % dict(cons)).encode())
        sec = sum(1 for r in rs if 'request.security' in r['consumers'])
        w(('  -> item (c)   : %d use(s) consumed by request.security, '
           'routed there by name and NOT counted as (b)\n' % sec).encode())
        w(('  (b)-eligible  : %d\n' % (len(rs) - sec)).encode())
        # ⭐⭐ THE NUMBER THE THRESHOLD TURNS ON: not "uses", but uses whose value
        # can reach a COLUMN on this lane. A timeframe that only ever reaches a
        # drawing draws nothing here, and this lane is a screener.
        reach_plot = [r for r in rs
                      if 'plot/alert' in r['consumers']
                      and 'request.security' not in r['consumers']]
        w(('  REACHABLE (plot/alertcondition, not via security) : %d\n'
           % len(reach_plot)).encode())
        if reach_plot:
            for r in reach_plot[:6]:
                w(('      %s:%d  %s\n' % (r['file'], r['line'], r['name'])).encode())
        for shape in sorted(shapes):
            w(('  carrier[%s] : %s\n' % (shape, CARRIER.get(shape, '?'))).encode())

    w(b'\n--- NOT COUNTED: UNDECIDABLE FROM SOURCE ---\n')
    if ambiguous:
        for k, n in sorted(ambiguous.items(), key=lambda kv: -kv[1]):
            w(('  input.%-10s %4d bare-numeric default(s) — a timeframe only if a '
               'timeframe POSITION asks\n' % (k, n)).encode())
        w(b'  (version 1 counted these as timeframes; sampling found a border width\n'
          b'   and a day mask among them, so they are reported, never counted)\n')
    else:
        w(b'  (none)\n')

    w(b'\n--- TOTALS ---\n')
    w(('  time-shaped uses      : %d\n' % len(rows)).encode())
    w(('  consumed by security  : %d  (item (c)\'s)\n'
       % sum(1 for r in rows if 'request.security' in r['consumers'])).encode())
    w(('  files touched         : %d\n' % len(set(r['file'] for r in rows))).encode())
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
