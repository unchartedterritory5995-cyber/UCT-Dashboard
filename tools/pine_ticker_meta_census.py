"""ITEM (h) — the `ticker_meta` store, the `syminfo.*` corpus demand, and `BF.B`.

READ-ONLY. No network, no server, no vendor call, no write outside stdout.

WHAT THIS MEASURES
  PART 2  every `syminfo.<field>` the measured corpus reads: uses, files, whether
          the value the ENGINE serves for it comes THROUGH the `ticker_meta`
          store, and whether the read reaches an output (interprocedurally).
  PART 3  the dotted-class-ticker (`BF.B` / `BRK.B`) seam, as a set of CHECKED
          source facts rather than a narrated chain.

INSTRUMENT RULES THIS FILE HOLDS ITSELF TO
  1. Comments and string literals are STRIPPED before matching, and every needle
     is built by CONCATENATION so this file cannot match its own source. A
     control proves the file contains zero matches of its own needle.
  2. The stripper carries controls BOTH WAYS — it still sees a real read, and it
     does NOT see one written in a comment or inside a string literal.
  3. Named arguments are read as arguments (inherited: the reachability walk uses
     `pine_time_input_census.consumers_of`, whose UDF hop splits real argument
     lists rather than positional text).
  4. REACHABILITY IS INTERPROCEDURAL where it is claimed — the same walk, through
     assignments to a fixed point AND across user-function parameter binding.
  5. THE CONTROL REPRODUCES A COMMITTED NUMBER AND EXITS NON-ZERO IF IT CANNOT:
     item (b)'s **97** `input.timeframe` uses consumed by `request.security`,
     re-derived by (b)'s OWN walk over (b)'s own file roster.
     ⛔ There is no committed `syminfo.*` count this tool can reproduce. The one
     that exists — `docs/pine/SESSION-STATE.md` line 1378, "161 corpus files,
     comments stripped" — was taken over a corpus that has since grown to 266
     committed files, so it is a number about a DIFFERENT population. It is
     printed beside ours as a drift record, NOT asserted. The `syminfo.*` figures
     this tool prints are therefore a NEW BASELINE, not a reproduction, and the
     report says so in those words.
  6. AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE —
     the `opts.symbols` supplier scan carries a positive control (it must find the
     one READER it knows exists before its zero-suppliers answer counts).
  7. READING THE CALL SITE IS NOT READING THE REQUEST. Every PART 3 line below is
     a fact about SOURCE TEXT at a named file:line, verified by this tool on each
     run. Nothing here claims what a vendor returns; the vendor half of the
     reproduction is printed as UNVERIFIED with the exact command that would
     settle it.

Usage:  python tools/pine_ticker_meta_census.py
Exit:   0 when every control passes, 1 otherwise.
"""
import importlib.util
import io
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ⭐ THE CENSUS POPULATION IS THE MEASURED CORPUS PLUS THE MEMBER FIXTURES.
# `tests/fixtures/pine_oos` is deliberately NOT in it — it is the out-of-sample
# holdout, and folding it into a demand count is how a holdout stops being one.
# The CONTROL below uses item (b)'s own roster instead, read off (b)'s module.
CENSUS_SOURCES = [
    os.path.join(ROOT, 'corpus', 'committed'),
    os.path.join(ROOT, 'tests', 'fixtures', 'member'),
]


def _load_b():
    """Item (b)'s census module — imported, never re-typed.

    ⛔ ONE STRIPPER AND ONE REACHABILITY WALK FOR THE WHOLE PROGRAM. A second copy
    here would be a second authority over *what counts as a use* and over *what a
    value reaches*, and the two would drift in the quietest possible direction:
    this tool would report a demand number item (b) and item (c) disagree with,
    with nothing red anywhere. `pine_security_census.py` imports it for exactly
    this reason; this file follows that precedent rather than inventing a third.
    """
    path = os.path.join(ROOT, 'tools', 'pine_time_input_census.py')
    spec = importlib.util.spec_from_file_location('_b_census', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _load_b()

# ── needles, built by CONCATENATION so this file never matches itself ────────
_NS = 'sym' + 'info'
FIELD = re.compile(r'\b%s\.([A-Za-z_]\w*)' % _NS)
#: the `str.*` predicates that make a symbol-scoped read into a screen condition
TEXT_PRED = re.compile(r'\bstr\.(contains|startswith|endswith|length|tostring)\s*\(')


# ── the stripper's controls, BOTH WAYS, on THIS tool's needle ───────────────
def _stripper_controls():
    """Returns [(name, expected, got)] — the stripper must see the real read and
    must NOT see the two decoys. A stripper proved only in the positive direction
    is a stripper that has never been shown it can decline."""
    q = '"'
    probe = '\n'.join([
        '// %s.mintick named in a COMMENT is not a read' % _NS,
        'x = %s%s.prefix inside a STRING is not a read%s' % (q, _NS, q),
        'real = %s.ticker' % _NS,
        'two  = %s.tickerid' % _NS,
    ])
    seen = FIELD.findall(B.strip_pine(probe))
    out = [
        ('stripper sees the real reads', 2, len(seen)),
        ('stripper declines the comment', 0, seen.count('mintick')),
        ('stripper declines the string', 0, seen.count('prefix')),
    ]
    # ⭐ AND THE INSTRUMENT MUST NOT BE ITS OWN SUBJECT. Every needle above is
    # assembled at runtime, so the literal never appears in this file's bytes.
    own = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    out.append(('this file contains 0 of its own needle', 0, len(FIELD.findall(own))))
    return out


# ── PART 1 / PART 3: facts about SOURCE TEXT, checked on every run ──────────
#: (label, path, 1-based line, substring that must be on that line)
#  ⛔ A CITATION THAT IS NOT CHECKED IS A CITATION THAT ROTS. Each row below is
#  re-read from disk on every run; a moved line fails the control rather than
#  quietly pointing the reader at the wrong code.
CITATIONS = [
    ('store: disk cache dir',
     'api/services/ticker_meta.py', 22, 'ticker_meta_cache'),
    ('store: 24h TTL',
     'api/services/ticker_meta.py', 21, '_TTL = 86400'),
    ('store: freshness is the FILE MTIME, not a row field',
     'api/services/ticker_meta.py', 32, 'os.path.getmtime(p)'),
    ('writer: _base_meta normalises with upper/strip ONLY',
     'api/services/ticker_meta.py', 183, '(ticker or "").upper().strip()'),
    ('writer: an all-null answer is NOT persisted',
     'api/services/ticker_meta.py', 249, 'if any(data.values()):'),
    ('reader: the HTTP door the chart calls',
     'api/routers/ticker_meta.py', 12, '/api/ticker-meta/'),
    ('reader: the chart hook projects `exchange`',
     'app/src/hooks/useTickerMeta.js', 86, 'exchange: j?.exchange ?? null'),
    ('reader: the chart builds the symbol OBJECT from it',
     'app/src/components/StockChart.jsx', 3000, 'exchange: (tickerMeta && tickerMeta.exchange)'),
    ('bind: the object reaches the fold',
     'app/src/components/StockChart.jsx', 10754, 'symbol: symbolMeta'),
    ('bind: ticker is served UNGATED, exchange gates the other two',
     'app/src/components/chart/engine/ast/bind.js', 151, "out['" + _NS + ".ticker'] = ticker"),
    ('bind: tickerid is ASSEMBLED from the witnessed prefix',
     'app/src/components/chart/engine/ast/bind.js', 156, '${pine}:${ticker}'),
    ('BF.B: the app-canonical form is dot -> HYPHEN',
     'api/services/groups.py', 61, '.replace(".", "-")'),
    ('BF.B: the vendor boundary is hyphen -> DOT',
     'api/services/massive.py', 54, '.replace("-", ".")'),
    ('BF.B: the symbol box upper-cases and nothing else',
     'app/src/components/chart/SymbolSearch.jsx', 184, "(ticker || '').trim().toUpperCase()"),
    ('BF.B: a typed miss is still offered as a destination',
     'app/src/components/chart/SymbolSearch.jsx', 149, '_typed: true'),
]

#: `ticker_meta` must NOT reference either share-class normaliser — that absence
#  is the defect, so it is measured rather than asserted, and the same scan is
#  shown finding the names where they DO live (its own positive control).
ABSENT_IN_TICKER_META = ['normalize_sym', '_share_class_alias']
PRESENT_ELSEWHERE = [
    ('normalize_sym', 'api/services/groups.py'),
    ('_share_class_alias', 'api/services/ticker_search_index.py'),
]


def _line(path, n):
    try:
        with io.open(os.path.join(ROOT, path), encoding='utf-8', errors='replace') as fh:
            for i, ln in enumerate(fh, 1):
                if i == n:
                    return ln
    except Exception:
        return None
    return None


def check_citations():
    out = []
    for label, path, n, needle in CITATIONS:
        ln = _line(path, n)
        out.append((label, '%s:%d' % (path, n), needle in (ln or '')))
    return out


# ── the `opts.symbols` absence, with its positive control ───────────────────
#  ⛔ THE CLAIM IS NARROW ON PURPOSE. This scan can say "no file under app/src
#  writes a `symbols` key into an interpret options object". It CANNOT say what a
#  running chart passes — that would be reading the call site and reporting the
#  request. The report words it as the former.
SYM_OPT_READ = re.compile(r'opts\s*&&\s*opts\.symbols|opts\.symbols')
SYM_OPT_WRITE = re.compile(r'\bsymbols\s*:')


def scan_symbol_opts():
    readers, writers = [], []
    base = os.path.join(ROOT, 'app', 'src')
    for dirpath, _dirs, fnames in os.walk(base):
        for fn in fnames:
            if not fn.endswith(('.js', '.jsx')):
                continue
            if '.test.' in fn:
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT).replace('\\', '/')
            try:
                txt = io.open(p, encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            # ⛔⛔ THE FILE MUST BE ONE THAT ACTUALLY CALLS `interpret`, AND THIS
            # CLAUSE IS HERE BECAUSE ITS ABSENCE MADE THIS TOOL REPORT A SUPPLIER
            # THAT DOES NOT EXIST. Version 1 counted any `symbols:` key inside
            # `chart/engine/` and scored `ast/pcf.js:927` — which is
            # `PCF_VOCABULARY.symbols`, the TC2000 reader's OPERATOR PUNCTUATION
            # list, not an interpret option and not a series map. A scan that
            # cannot tell an options object from an unrelated key of the same
            # name is not evidence about the seam it claims to measure
            # (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
            calls_interpret = 'interpret(' in txt
            for i, ln in enumerate(txt.split('\n'), 1):
                if ln.lstrip().startswith(('//', '*')):
                    continue
                if SYM_OPT_READ.search(ln):
                    readers.append('%s:%d' % (rel, i))
                if SYM_OPT_WRITE.search(ln) and calls_interpret:
                    writers.append('%s:%d' % (rel, i))
    return readers, writers


# ── PART 2: the corpus census ───────────────────────────────────────────────
#: WHERE THE ENGINE GETS ITS ANSWER FOR EACH SERVED FIELD — traced, not assumed.
#  Read off `bind.js::symbolConstantsWith` (lines 146-160) and the chain the
#  CITATIONS above check: `symbol.ticker` is the chart's own symbol STRING, which
#  never passes through the `ticker_meta` store; `symbol.exchange` is
#  `tickerMeta.exchange`, which does.
THROUGH_STORE = {
    'ticker': 'no  - symbol string',
    'tickerid': 'YES - exchange half',
    'prefix': 'YES - exchange',
}


def scripts():
    out = []
    for d in CENSUS_SOURCES:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.pine'):
                out.append((os.path.basename(d), f, os.path.join(d, f)))
    return out


def field_status(scope):
    """Each field's engine status, READ off the manifests rather than typed.

    `unserved` and `pending_measurement` come from `symbolScope.json`; the served
    roster comes from `pine.js::BUILTIN_SYMBOL_SCOPED`. A field in none of them is
    reported as `unlisted`, which is a different answer from `refused` and the
    difference is the point — an unlisted name falls through a namespace default
    nobody has ruled on.
    """
    served = set()
    pine = os.path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine', 'ast', 'pine.js')
    try:
        txt = io.open(pine, encoding='utf-8', errors='replace').read()
        blk = re.search(r'BUILTIN_SYMBOL_SCOPED\s*=\s*Object\.freeze\(\{(.*?)\}\)', txt, re.S)
        if blk:
            served = set(FIELD.findall(blk.group(1)))
    except Exception:
        pass
    unserved = {k for k in (scope.get('unserved') or {}) if not k.startswith('_')}
    pending = {k for k in (scope.get('pending_measurement') or {}) if not k.startswith('_')}

    def of(f):
        if f in served:
            return 'folds (pending)' if f in pending else 'folds'
        if f in unserved:
            return 'refused by name'
        return 'unlisted'
    return of, served, unserved, pending


def census():
    files = scripts()
    uses = Counter()
    in_files = defaultdict(set)
    reaching = defaultdict(set)      # field -> files where it reaches an output
    witness = {}                     # field -> a NAMED script
    for _d, fname, path_ in files:
        raw = io.open(path_, encoding='utf-8', errors='replace').read()
        st = B.strip_pine(raw)
        lines = st.split('\n')
        hits = FIELD.findall(st)
        if not hits:
            continue
        for f in hits:
            uses[f] += 1
            in_files[f].add(fname)
        for f in set(hits):
            # ⭐ INTERPROCEDURAL, AND THE DIRECT CASE FIRST. A read written inside
            # the output call itself (`plot(str.length(<ns>.ticker))`) is bound to
            # no name at all, so a name-only walk would score it as unreached.
            needle = re.compile(r'\b%s\.%s\b' % (_NS, re.escape(f)))
            reached = False
            for ln in lines:
                if not needle.search(ln):
                    continue
                for label, pat in B.CONSUMERS:
                    if pat.search(ln):
                        reached = True
                        break
                if reached:
                    break
                m = B.ASSIGN.match(ln)
                if m:
                    cons, _r = B.consumers_of(st, m.group(1))
                    if cons:
                        reached = True
                        break
            if reached:
                reaching[f].add(fname)
            witness.setdefault(f, fname)
    return files, uses, in_files, reaching, witness


def text_predicate_uses():
    """How many symbol-scoped reads sit inside a `str.*` predicate — the shape the
    bind-time fold exists to decide. Line-scoped, and SAID to be line-scoped."""
    n = 0
    for _d, _f, path_ in scripts():
        st = B.strip_pine(io.open(path_, encoding='utf-8', errors='replace').read())
        for ln in st.split('\n'):
            if FIELD.search(ln) and TEXT_PRED.search(ln):
                n += 1
    return n


def control_97():
    """Item (b)'s committed 97, re-derived by (b)'s OWN walk over (b)'s OWN roster."""
    n = 0
    for _d, _fname, path_ in B.scripts():
        raw = io.open(path_, encoding='utf-8', errors='replace').read()
        st = B.strip_pine(raw)
        for m in B.CALL.finditer(st):
            if (m.group(1) or 'input') != 'timeframe':
                continue
            name = B.bound_name(raw, m.start())
            cons, _reach = B.consumers_of(st, name)
            if 'request.security' in cons:
                n += 1
    return n


def main():
    w = sys.stdout.buffer.write
    ok = True

    def control(name, expected, got):
        nonlocal ok
        good = (expected == got)
        ok = ok and good
        w(('CONTROL: %-56s expected %-5s got %-5s %s\n'
           % (name, expected, got, 'OK' if good else 'FAIL')).encode())

    import json
    scope_path = os.path.join(ROOT, 'app', 'src', 'components', 'chart',
                              'engine', 'ast', 'symbolScope.json')
    scope = json.load(io.open(scope_path, encoding='utf-8'))
    status_of, served, unserved, pending = field_status(scope)

    files, uses, in_files, reaching, witness = census()

    w(b'ITEM (h) - ticker_meta / syminfo.* / BF.B CENSUS\n\n')
    w(('scripts read: %d  (%s)\n\n'
       % (len(files), ', '.join(os.path.relpath(d, ROOT).replace('\\', '/')
                                for d in CENSUS_SOURCES))).encode())

    w(b'--- CONTROLS ---\n')
    for label, exp, got in _stripper_controls():
        control(label, exp, got)
    control('item (b) committed: input.timeframe -> request.security', 97, control_97())
    for label, where, good in check_citations():
        control('citation %s' % where, True, good)
    tm = io.open(os.path.join(ROOT, 'api', 'services', 'ticker_meta.py'),
                 encoding='utf-8', errors='replace').read()
    for nm in ABSENT_IN_TICKER_META:
        control('ticker_meta.py mentions %s' % nm, 0, tm.count(nm))
    for nm, path in PRESENT_ELSEWHERE:   # the same scan, shown able to find one
        found = io.open(os.path.join(ROOT, path), encoding='utf-8',
                        errors='replace').read().count(nm) > 0
        control('positive control: %s exists in %s' % (nm, os.path.basename(path)),
                True, found)
    readers, writers = scan_symbol_opts()
    control('opts.symbols READERS under app/src (positive control)', 1, len(readers))
    # ⛔ THE SUPPLIER ANSWER IS ZERO, SO THE SCANNER MUST FIRST BE SHOWN FIRING.
    # Nothing in the tree supplies one, so the positive control is a synthetic
    # line: an absence measured by a regex nobody has watched match is not an
    # absence, it is an untested regex.
    control('supplier regex can fire (synthetic probe)', True,
            bool(SYM_OPT_WRITE.search('interpret(t, bars, i, b, s, { tf, symbols: map })')))
    control('opts.symbols SUPPLIERS in a file that calls interpret', 0, len(writers))
    # the served roster must be exactly the three the fold can emit
    control('BUILTIN_SYMBOL_SCOPED members', 3, len(served))
    w(b'\n')

    w(b'--- THE FIELDS THE CORPUS READS (NEW BASELINE - not a reproduction) ---\n')
    w(b'  field          uses  files  reaches-output  through ticker_meta      engine status        a named script\n')
    for f in sorted(uses, key=lambda k: (-uses[k], k)):
        w(('  %-13s %5d %6d %15d  %-22s %-20s %s\n'
           % (f, uses[f], len(in_files[f]), len(reaching[f]),
              THROUGH_STORE.get(f, 'n/a - never resolves'),
              status_of(f), witness[f][:44])).encode())
    w(('\n  total reads: %d across %d files\n'
       % (sum(uses.values()), len(set().union(*in_files.values()) if in_files else set()))).encode())
    w(('  reads inside a str.* predicate (the fold\'s own shape): %d lines\n'
       % text_predicate_uses()).encode())
    w(b'\n  DRIFT RECORD, NOT A CONTROL: docs/pine/SESSION-STATE.md:1378 reports\n'
      b'  tickerid 70/26, ticker 53/13, mintick 31/20 over "161 corpus files". The\n'
      b'  committed corpus is 266 files today (corpus/index.json::counts.committed),\n'
      b'  so that number is about a different population and is NOT asserted here.\n\n')

    w(b'--- WHERE THE ENGINE GETS EACH SERVED FIELD ---\n')
    w(b'  ticker    <- the chart symbol STRING  (StockChart.jsx:3000 `ticker: sym`)\n'
      b'               ticker_meta is NOT in this path.\n'
      b'  prefix    <- tickerMeta.exchange -> symbolScope.json::confirmed\n'
      b'  tickerid  <- `prefix + ":" + ticker`, assembled (bind.js:156)\n'
      b'  everything else: refused by name at the door, so no store is consulted.\n\n')

    w(b'--- THE opts.symbols SEAM (absence, with its control above) ---\n')
    w(('  readers   : %s\n' % (', '.join(readers) or '(none)')).encode())
    w(('  suppliers : %s\n' % (', '.join(writers) or '(none)')).encode())
    w(b'  Reading: no file under app/src writes a `symbols` key into an interpret\n'
      b'  options object, so nothing in the browser lane supplies a foreign series.\n'
      b'  !! THIS IS A STATEMENT ABOUT THE SOURCE, NOT ABOUT A RUN. It does not\n'
      b'  claim what a live chart passes; that would need the request itself.\n\n')

    w(b'--- BF.B: THE CHECKED FACTS (the vendor half is UNVERIFIED, see report) ---\n')
    w(b'  1. SymbolSearch.jsx:184 upper-cases the typed symbol and nothing else,\n'
      b'     and :149 offers an unmatched typed query as a destination, so a dotted\n'
      b'     spelling can become the chart symbol verbatim.\n'
      b'  2. groups.py:61 `normalize_sym` is the app-canonical dot->hyphen form and\n'
      b'     names charting as a consumer; ticker_meta.py:183 does not call it, and\n'
      b'     mentions neither share-class normaliser (control above).\n'
      b'  3. massive.py:54 `to_polygon_symbol` maps hyphen->dot at ONE vendor\n'
      b'     boundary, so two spellings are alive in this system by design.\n'
      b'  4. ticker_meta.py:249 does not persist an all-null answer, so a spelling\n'
      b'     no provider answers for is re-fetched on every request, uncached.\n'
      b'  5. bind.js:151/156 - a null exchange leaves prefix and tickerid unemitted,\n'
      b'     so both refuse with symbolScope.json::pending_measurement\'s sentence.\n')

    w(b'\n')
    w(('RESULT: %s\n' % ('all controls OK' if ok else '*** A CONTROL FAILED ***')).encode())
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
