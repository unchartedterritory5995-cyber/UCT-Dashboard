"""The independent account of what a SCRIPT the assistant wrote should compute and draw (value cases, lane "script").

`grade_script(case_id, source, run, chart)` holds one script's run (from `script_lane.run`) to plain calculations
written from the request's words: every plotted column against a reading of the rule, and what is DRAWN (a table's
numbers and words, labels on the right bars, lines at the right levels, boxes around the right bars) against the
same kind of calculation. It also lists what the script draws that the request did not name.

⛔ Written from the REQUEST'S WORDS, never from an answer. Plain loops: nothing here imports the engine. The bars
are the ones the lane ran the script on, handed in; this module computes its own numbers from them.
"""
import datetime as _dt
import re

# ── the chart being graded: bound by `bind`, read by every rule below ──
B = []
N = 0
C = []
L = []          # noqa: E741
V = []
H = []
SYM = {}
T = []
LAST = -1
_LINES = []


def bind(chart):
    """Point the rules at the bars a script was run on: {bars: [...], others: {SPY: [...], ...}}."""
    global B, N, C, L, V, H, SYM, T, LAST          # noqa: PLW0603 -- one chart is graded at a time
    B = chart['bars']
    N = len(B)
    C = [b['c'] for b in B]
    L = [b['l'] for b in B]          # noqa: E741
    V = [b['v'] for b in B]
    H = [b['h'] for b in B]
    SYM = chart.get('others') or {}
    T = [str(b['t'])[:10] for b in B]
    LAST = N - 1


def _say(line):
    _LINES.append(line)


def best(cols, want, label, flag=False, exact=False):
    """`exact`: a bar where the rule holds NOTHING must hold nothing in the column too (the words said "plot nothing",
    "only while"); without it only the bars where the rule has a value are compared."""
    rows = []
    for k, col in cols.items():
        cmp = list(range(N)) if exact else [i for i in range(N) if want[i] is not None]
        if flag:
            diff = sum(1 for i in cmp if bool(col[i]) != bool(want[i]))
        elif exact:
            diff = sum(1 for i in cmp if (col[i] is None) != (want[i] is None) or (want[i] is not None and abs(col[i] - want[i]) > 1e-9))
        else:
            diff = sum(1 for i in cmp if col[i] is None or abs(col[i] - want[i]) > 1e-9)
        rows.append((diff, len(cmp), k))
    if not rows:
        # ⚰️ 2026-11-23: a script that runs and plots NOTHING (the engine refused its one plot by name) crashed here
        # with "list index out of range". No column is a wrong answer, said in words, never an exception.
        _say(f"  CHECK  {label}: the script plotted no column to compare")
        return False
    rows.sort()
    diff, n, k = rows[0]
    _say(f"  {'RIGHT' if diff == 0 else 'CHECK'}  {label}: column {k!r}, {diff} of {n} bars differ; yes/positive in the rule on {sum(1 for x in want if x)} bars")
    return diff == 0


def rule_h03():
    dist = lambda k: k > 0 and C[k] <= C[k - 1] * (1 - 0.002) and V[k] > V[k - 1]  # noqa: E731
    want = []
    for i in range(N):
        if i < 25:
            want.append(None); continue
        want.append(float(sum(1 for k in range(i - 24, i + 1) if dist(k) and not any(C[j] >= 1.05 * C[k] for j in range(k + 1, i + 1)))))
    return [('live distribution days (last 25 with this bar, dropped at 5% or more)', want)]


def rule_h05():
    out = []
    for same_bar in (True, False):
        ft, live, start = [], False, None
        for i in range(N):
            if i < 59:
                ft.append(None); continue
            hc = max(C[i - 59:i + 1]); ended = False
            if live and L[i] < L[start]:
                live, ended = False, True
            if not live and (same_bar or not ended) and C[i] > C[i - 1] and C[i] <= 0.95 * hc:
                live, start = True, i
            ft.append(1.0 if (live and i - start + 1 >= 4 and C[i] >= 1.0125 * C[i - 1] and V[i] > V[i - 1]) else 0.0)
        out.append((f"follow-through ({'a new attempt may start on the bar the old one ends' if same_bar else 'not on that bar'})", ft))
    return out




def _sma(x, n):
    out = [None] * N
    for i in range(n - 1, N):
        w = x[i - n + 1:i + 1]
        out[i] = sum(w) / n if all(v is not None for v in w) else None
    return out


def _atr_variants(n):
    tr = [H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(N)]
    rma = [None] * N                                     # Wilder smoothing seeded with the mean of the first n true ranges
    rma[n - 1] = sum(tr[:n]) / n
    for i in range(n, N):
        rma[i] = (rma[i - 1] * (n - 1) + tr[i]) / n
    wilder = [None] * N                                  # the first true range is bar 1's
    wilder[n] = sum(tr[1:n + 1]) / n
    for i in range(n + 1, N):
        wilder[i] = (wilder[i - 1] * (n - 1) + tr[i]) / n
    return [('smoothed, seeded with the first n true ranges', rma), ('smoothed, first true range at bar 1', wilder), ('simple average of true range', _sma(tr, n))]


def rule_i01():
    return [(f'ATR 14 as a percent of the close ({name})', [None if a[i] is None else a[i] / C[i] * 100 for i in range(N)]) for name, a in _atr_variants(14)]


def rule_i02():
    m = _sma(V, 50)
    return [('volume over its 50 bar average', [None if m[i] is None or not m[i] else V[i] / m[i] for i in range(N)]),
            ('volume over the average of the 50 bars before', [None if i < 50 else V[i] / (sum(V[i - 50:i]) / 50) for i in range(N)])]


def rule_i03():
    dist = lambda k: k > 0 and C[k] <= C[k - 1] * (1 - 0.002) and V[k] > V[k - 1]  # noqa: E731
    return [('distribution days in the last 25 with this bar', [None if i < 25 else float(sum(1 for k in range(i - 24, i + 1) if dist(k))) for i in range(N)]),
            ('distribution days in the 25 before this bar', [None if i < 26 else float(sum(1 for k in range(i - 25, i) if dist(k))) for i in range(N)])]


def rule_i04():
    return [('the 50 bar simple average of the close', _sma(C, 50))]


def rule_i05():
    out = []
    for n in (10, 21, 50):
        m = _sma(C, n)
        out.append((f'percent the close is above its {n} bar average', [None if m[i] is None else (C[i] / m[i] - 1) * 100 for i in range(N)]))
    return out


def rule_i06():
    return [('highest close of the last 252 bars with this bar', [None if i < 251 else max(C[i - 251:i + 1]) for i in range(N)])]




def _weeks():
    """Daily bars grouped into Monday-start weeks: (week index of each bar, per-week high/low/close, is-last-bar-of-week)."""
    keys = []
    for b in B:
        d = _dt.date.fromisoformat(str(b['t'])[:10])
        keys.append(d - _dt.timedelta(days=d.weekday()))
    wk, order = [], []
    for k in keys:
        if not order or order[-1] != k:
            order.append(k)
        wk.append(len(order) - 1)
    n = len(order)
    hi = [max(H[i] for i in range(N) if wk[i] == w) for w in range(n)] if n < 5000 else []
    lo = [min(L[i] for i in range(N) if wk[i] == w) for w in range(n)]
    cl = [[C[i] for i in range(N) if wk[i] == w][-1] for w in range(n)]
    last = [i == N - 1 or wk[i + 1] != wk[i] for i in range(N)]
    return wk, hi, lo, cl, last


def _readings(per_week_value, back):
    """The readings of "the weekly series, `back` weeks back" on each daily bar. per_week_value(w) -> value of COMPLETED week w."""
    wk, _hi, _lo, _cl, last = _weeks()
    out = {}
    for name in ('the last COMPLETED week, all week', 'as TradingView draws history (the finished week only on its last bar)', 'this week counted from its first bar'):
        col = []
        for i in range(N):
            if name.startswith('the last COMPLETED'):
                w = wk[i] - 1 - back
            elif name.startswith('as TradingView'):
                w = (wk[i] if last[i] else wk[i] - 1) - back
            else:
                w = wk[i] - back
            v = per_week_value(w) if w >= 0 else None
            col.append(v)
        out[name] = col
    return out


def rule_j01():
    _wk, hi, lo, _cl, _last = _weeks()
    # "last week's high": the week before this one. As a weekly series that is `high[1]` read this week, or `high` of the last completed week.
    out = []
    for name, col in _readings(lambda w: hi[w], 0).items():
        out.append((f"last week's high ({name})", col, 'high'))
    for name, col in _readings(lambda w: hi[w], 1).items():
        out.append((f"the weekly high one week back ({name})", col, 'high'))
    for name, col in _readings(lambda w: lo[w], 0).items():
        out.append((f"last week's low ({name})", col, 'low'))
    for name, col in _readings(lambda w: lo[w], 1).items():
        out.append((f"the weekly low one week back ({name})", col, 'low'))
    return out


def rule_j06():
    _wk, _hi, _lo, cl, _last = _weeks()
    out = []
    w_sma = lambda w: (sum(cl[w - 9:w + 1]) / 10 if w >= 9 else None)  # noqa: E731
    for name, col in _readings(w_sma, 0).items():
        out.append((f'10 week average ({name})', col, 'week'))
    # months
    mk, order = [], []
    for b in B:
        k = str(b['t'])[:7]
        if not order or order[-1] != k:
            order.append(k)
        mk.append(len(order) - 1)
    m_cl = [[C[i] for i in range(N) if mk[i] == m][-1] for m in range(len(order))]
    m_last = [i == N - 1 or mk[i + 1] != mk[i] for i in range(N)]
    m_sma = lambda m: (sum(m_cl[m - 9:m + 1]) / 10 if m >= 9 else None)  # noqa: E731
    for name, pick in (('the last COMPLETED month, all month', lambda i: mk[i] - 1), ('the finished month only on its last bar', lambda i: mk[i] if m_last[i] else mk[i] - 1)):
        col = [m_sma(pick(i)) if pick(i) >= 0 else None for i in range(N)]
        out.append((f'10 month average ({name})', col, 'month'))
    return out


def rule_j02():
    _wk, _hi, _lo, cl, _last = _weeks()
    sma = lambda w: (sum(cl[w - 9:w + 1]) / 10 if w >= 9 else None)  # noqa: E731
    return [(f'10 week average of the weekly close ({name})', col, 'sma') for name, col in _readings(sma, 0).items()]


def rule_j03():
    _wk, hi, _lo, _cl, _last = _weeks()
    top = lambda w: (max(hi[w - 3:w + 1]) if w >= 3 else None)  # noqa: E731
    return [(f'highest weekly high of 4 weeks ({name})', col, 'top') for name, col in _readings(top, 0).items()]




def _sc(sym, f='c'):
    return [b[f] for b in SYM[sym]] if sym in SYM else [None] * N


def _ema(x, n, seed='sma'):
    out = [None] * N
    first = next((i for i in range(N) if x[i] is not None), None)
    if first is None:
        return out
    a = 2 / (n + 1)
    if seed == 'first':
        out[first] = x[first]
        start = first + 1
    else:
        if first + n > N or any(v is None for v in x[first:first + n]):
            return out
        out[first + n - 1] = sum(x[first:first + n]) / n
        start = first + n
    for i in range(start, N):
        out[i] = None if x[i] is None or out[i - 1] is None else a * x[i] + (1 - a) * out[i - 1]
    return out


def _above50(sym):
    c = _sc(sym)
    m = _sma(c, 50)
    return [None if m[i] is None else (1.0 if c[i] > m[i] else 0.0) for i in range(N)]


def rule_k02():
    c, v = _sc('SPY'), _sc('SPY', 'v')
    dist = lambda k: k > 0 and c[k] <= c[k - 1] * (1 - 0.002) and v[k] > v[k - 1]  # noqa: E731
    return [("SPY's distribution days in the last 25 with this bar", [None if i < 25 else float(sum(1 for k in range(i - 24, i + 1) if dist(k))) for i in range(N)]),
            ("SPY's distribution days in the 25 before this bar", [None if i < 26 else float(sum(1 for k in range(i - 25, i) if dist(k))) for i in range(N)])]


def rule_k03():
    s = _sc('SPY')
    ratio = [C[i] / s[i] for i in range(N)]
    out = [('close over SPY close', ratio, 'ratio')]
    for seed in ('sma', 'first'):
        e = _ema(ratio, 21, seed)
        out.append((f'21 bar exponential average of the ratio (starts as the {"simple average of 21" if seed == "sma" else "first value"})', e, 'ema'))
    return out


def rule_k04():
    a, b = _above50('SPY'), _above50('QQQ')
    return [('1 when SPY and QQQ both close above their own 50 bar average', [None if a[i] is None or b[i] is None else (1.0 if a[i] and b[i] else 0.0) for i in range(N)])]


def rule_k05():
    s = _sc('SPY')
    beat = lambda k: k > 0 and (C[k] / C[k - 1] - 1) > (s[k] / s[k - 1] - 1)  # noqa: E731
    return [('days of the last 20 (with this bar) on which the stock out-gained SPY', [None if i < 20 else float(sum(1 for k in range(i - 19, i + 1) if beat(k))) for i in range(N)]),
            ('the same count, written as a percent of 20', [None if i < 20 else sum(1 for k in range(i - 19, i + 1) if beat(k)) / 20 * 100 for i in range(N)])]


def rule_k06():
    s = _sc('SPY')
    pct = [None if i < 63 else (C[i] / C[i - 63] - 1) * 100 - (s[i] / s[i - 63] - 1) * 100 for i in range(N)]
    return [('63 bar percent change minus SPY\'s', pct), ('the same as a fraction', [None if v is None else v / 100 for v in pct])]


KINDS = [('plot', r'(?<![.\w])plot\s*\('), ('plotshape', r'(?<![.\w])plotshape\s*\('), ('plotchar', r'(?<![.\w])plotchar\s*\('),
         ('table', r'\btable\.new\s*\('), ('label', r'\blabel\.new\s*\('), ('line', r'\bline\.new\s*\('), ('box', r'\bbox\.new\s*\('),
         ('background', r'(?<![.\w])bgcolor\s*\('), ('bar colour', r'(?<![.\w])barcolor\s*\('), ('fill', r'(?<![.\w])fill\s*\('),
         ('alert condition', r'(?<![.\w])alertcondition\s*\(')]
def _num_tokens(text):
    """Every number written in a piece of drawn text, with how many decimals it is written to."""
    out = []
    for m in re.findall(r'-?\d[\d,]*\.?\d*', text or ''):
        m = m.rstrip('.')
        clean = m.replace(',', '')
        if clean in ('', '-'):
            continue
        out.append((float(clean), len(clean.split('.')[1]) if '.' in clean else 0))
    return out


def _shows(texts, v):
    """The drawn text that writes the value v (to the decimals that text uses), or None."""
    for t in texts:
        for n, d in _num_tokens(t):
            if d >= 1 and abs(n - v) <= 0.5 * 10 ** -d + 1e-9:
                return t
    for t in texts:                                       # a whole number only when nothing with decimals says it
        for n, d in _num_tokens(t):
            if d == 0 and abs(n - v) < 1e-9:
                return t
    return None


def _cross_up_dates():
    m = _sma(C, 50)
    return [T[i] for i in range(1, N) if m[i] is not None and m[i - 1] is not None and C[i] > m[i] and C[i - 1] <= m[i - 1]]


def _new_high_dates():
    strict = [T[i] for i in range(251, N) if C[i] > max(C[i - 251:i])]
    return strict


def _run_counts():
    """A run of closes each above the close 4 bars earlier, counted 1 to 9 and starting again at 1 after 9; 0 where
    the run is broken (and on the first four bars, which have no close 4 bars earlier)."""
    out, n = [], 0
    for i in range(N):
        up = i >= 4 and C[i] > C[i - 4]
        n = (1 if n >= 9 else n + 1) if up else 0
        out.append(n)
    return out


# ── ROUND 17: what a script must show for nine requests whose honest answer needs an array, a loop over one, a
#    `while`, a `switch`, a drawing deleted or read back, or `barstate`. Written from the WORDS, before any answer. ──

def _swings(x, k, high):
    """The bars whose value is strictly beyond the k bars before it AND the k bars after it. Such a bar is only KNOWN
    k bars later (the bars after it have to exist)."""
    out = []
    for i in range(k, N - k):
        around = [x[j] for j in range(i - k, i + k + 1) if j != i]
        if all(x[i] > v for v in around) if high else all(x[i] < v for v in around):
            out.append(i)
    return out


def rule_cap01():
    """How many bars back the most recent close ABOVE this bar's close was (1 = the bar before), looking back at most
    250 bars; NOTHING when no close in reach is higher."""
    col = []
    for i in range(N):
        k = next((k for k in range(1, min(250, i) + 1) if C[i - k] > C[i]), None)
        col.append(None if k is None else float(k))
    return [('bars back to the most recent higher close, nothing when there is none in 250', col, None, 'exact')]


def rule_cap02():
    """A choice of SMA, EMA or WMA with SMA the default: what is drawn before the member touches the setting is the
    plain 20 bar average of the close."""
    return [('the 20 bar simple average of the close (the default choice)', _sma(C, 20))]


def rule_cap03():
    """The average of the last 5 swing highs KNOWN on each bar (a swing high at bar p is known at p + 3). Before five
    are known the words ask for nothing in particular, so those bars are not compared."""
    known_at = [(p + 3, H[p]) for p in _swings(H, 3, True)]
    col, seen, j = [], [], 0
    for i in range(N):
        while j < len(known_at) and known_at[j][0] <= i:
            seen.append(known_at[j][1])
            j += 1
        col.append(sum(seen[-5:]) / 5 if len(seen) >= 5 else None)
    return [('the average of the last 5 swing highs known on each bar', col)]


def rule_cap07():
    """The 10 bar average ONLY while the close is above the 50 bar average; nothing on every other bar (the bars
    before the 50 bar average exists included)."""
    fast, slow = _sma(C, 10), _sma(C, 50)
    col = [fast[i] if (slow[i] is not None and fast[i] is not None and C[i] > slow[i]) else None for i in range(N)]
    return [('the 10 bar average while the close is above the 50 bar average, nothing otherwise', col, None, 'exact')]


def rule_cap09():
    """The average volume of the last 10 UP days (a close above the prior close) up to and including each bar; the down
    days in between are skipped. Before ten up days exist those bars are not compared."""
    ups, col = [], []
    for i in range(N):
        if i > 0 and C[i] > C[i - 1]:
            ups.append(V[i])
        col.append(sum(ups[-10:]) / 10 if len(ups) >= 10 else None)
    return [('the average volume of the last 10 up days', col)]


# ── a company's own figures, from its filings (2026-11-22: rules first; pending until the engine serves them) ──
# A script reads a figure with `request.financial(syminfo.tickerid, "<ID>", "<FQ|TTM>")`. UCT answers from company
# filings, each figure dated by the day its filing became public. The built company below is the same on every run.

#: the session of the first report, and the sessions from each report to the next, year after year: three quarterly
#: reports and a later annual one, as companies file (so a quarter is NEVER a fixed number of bars)
FIRST_FILING = 40
FILING_GAPS = (58, 61, 60, 73)
#: `na` on a bar where a figure is known but did not step (a read with gaps on); never equal to a value
NA = float('nan')


def _iso_plus(day, days):
    return (_dt.date.fromisoformat(day) + _dt.timedelta(days=days)).isoformat()


def filings_doc(days):
    """The built company's figures on these session days (ISO strings), in the shape the financial door serves:
    {fields: {'<ID>:<PERIOD>': {state, knownFrom, points: [{knownFrom, v, staleFrom}]}}}. Four reports a year,
    unevenly spaced. On purpose: one quarter's revenue EQUALS the same quarter a year before (growth exactly 0) and one
    equals the quarter before; one quarter loses money; the share count is first reported two reports late; the
    cash-flow figure is UNKNOWN for one report (a gap); one report is dated on a Saturday (it lands on Monday)."""
    state = {'s': 20261122}

    def rnd():
        state['s'] = (state['s'] * 1664525 + 1013904223) % 4294967296
        return state['s'] / 4294967296
    at = [FIRST_FILING]
    while at[-1] + FILING_GAPS[(len(at) - 1) % 4] + 6 < len(days):
        at.append(at[-1] + FILING_GAPS[(len(at) - 1) % 4] + int(rnd() * 13) - 6)     # up to six sessions early or late
    known = [days[i] for i in at]
    monday = next(k for k in range(8, len(at)) if _dt.date.fromisoformat(known[k]).weekday() == 0)
    known[monday] = _iso_plus(known[monday], -2)                    # public on the Saturday: read from Monday's bar
    rev, eps, equity, shares, fcf = [], [], [], [], []
    base, book, count = 8.0e8, 2.4e9, 2.5e8
    for k in range(len(at)):
        base *= 1.02 + (rnd() - 0.35) * 0.05
        r = round(base * (1.00, 0.92, 0.97, 1.18)[k % 4], -5)
        margin = -0.04 if k == 7 else 0.08 + rnd() * 0.07
        count = round(count * (1 - 0.004 * rnd()), -4)
        book = round(book + r * margin * 0.6, -5)
        rev.append(r)
        eps.append(round(r * margin / count, 2))
        equity.append(book)
        shares.append(count)
        fcf.append(round(r * (margin + 0.02 + (rnd() - 0.5) * 0.03), -5))
    rev[9] = rev[5]                                                 # the same quarter a year before, to the dollar
    rev[12] = rev[11]                                               # the quarter before, to the dollar

    def field(values, first=0):
        pts = [{'knownFrom': known[k], 'v': values[k], 'staleFrom': None if values[k] is None else _iso_plus(known[k], 500)}
               for k in range(first, len(at))]
        return {'state': 'ok', 'knownFrom': pts[0]['knownFrom'], 'points': pts}

    def trailing(q):
        return [None if k < 3 else round(sum(q[k - 3:k + 1]), 2) for k in range(len(q))]
    fcf_ttm = trailing(fcf)
    fcf_ttm[6] = None                                               # the newest filing did not yield it: UNKNOWN
    return {'schema': 'uct.pine-financial/v1', 'family': 'financial', 'familyState': 'ok', 'state': 'ready', 'refreshedAt': 1,
            'fields': {'TOTAL_REVENUE:FQ': field(rev), 'TOTAL_REVENUE:TTM': field(trailing(rev), 3),
                       'EARNINGS_PER_SHARE_DILUTED:FQ': field(eps), 'EARNINGS_PER_SHARE_DILUTED:TTM': field(trailing(eps), 3),
                       'TOTAL_EQUITY:FQ': field(equity), 'TOTAL_SHARES_OUTSTANDING:FQ': field(shares, 2),
                       'FREE_CASH_FLOW:TTM': field(fcf_ttm, 3)}}


def placed(field, days, gaps=False):
    """One figure on daily bars, bar by bar: the value, `None` where UCT holds no current figure (WITHHELD), or `NA`
    (a read with gaps on, on a bar where the figure did not step).
      * a figure is read from the first bar on or after the day its filing became public (never its period end);
      * carried until the next one (gaps off); with gaps on it is read on its own bar only;
      * a bar is withheld when no figure is public yet, when the newest filing left the figure unknown, or when the
        figure in force has gone stale; and every bar BEFORE the last such bar is withheld too (an older value is
        never carried across a hole)."""
    pts, n = field['points'], len(days)
    landed = [-1] * n
    for k, p in enumerate(pts):
        i = next((j for j in range(n) if days[j] >= p['knownFrom']), n)
        if i < n:
            landed[i] = k
    vals, cur, last = [None] * n, -1, -1
    for i in range(n):
        stepped = landed[i] >= 0 and (i > 0 or pts[landed[i]]['knownFrom'] >= days[0])
        if landed[i] >= 0:
            cur = landed[i]
        p = pts[cur] if cur >= 0 else None
        has = p is not None and p['v'] is not None
        if p is None or ((stepped and not has) if gaps else not has) or (not gaps and p.get('staleFrom') and days[i] >= p['staleFrom']):
            last = i
            continue
        vals[i] = NA if (gaps and not stepped) else p['v']
    for i in range(last + 1):
        vals[i] = None
    return vals


def _reports(field):
    """The figure report by report: [(the bar it is read from, its value)], the unknown ones left out."""
    out = []
    for p in field['points']:
        i = next((j for j in range(N) if T[j] >= p['knownFrom']), None)
        if i is not None and p['v'] is not None:
            out.append((i, p['v']))
    return out


def _fig(key):
    return filings_doc(T)['fields'][key]


def _growth(back, percent):
    """Revenue of the newest quarter against the quarter `back` REPORTS before it, on every bar from that report on;
    nothing before there are that many reports. Reports are counted, never bars."""
    reports, col, k = _reports(_fig('TOTAL_REVENUE:FQ')), [None] * N, -1
    for i in range(N):
        while k + 1 < len(reports) and reports[k + 1][0] <= i:
            k += 1
        if k >= back and reports[k - back][1]:
            col[i] = (reports[k][1] / reports[k - back][1] - 1) * (100.0 if percent else 1.0)
    return col


def rule_fund01():
    """ "Quarterly revenue growth" reads two honest ways, and either is right: the newest quarter against the SAME
    QUARTER A YEAR BEFORE (four reports back), or against the QUARTER BEFORE (one report back). In percent or as a
    fraction. What it may not be: a number of BARS back (63 or 252 bars is not a report), or a value on a bar before
    there are enough reports."""
    return [('quarterly revenue against the same quarter a year before (4 reports back), in percent', _growth(4, True), None, 'exact'),
            ('quarterly revenue against the same quarter a year before (4 reports back), as a fraction', _growth(4, False), None, 'exact'),
            ('quarterly revenue against the quarter before (1 report back), in percent', _growth(1, True), None, 'exact'),
            ('quarterly revenue against the quarter before (1 report back), as a fraction', _growth(1, False), None, 'exact')]


def rule_fund02():
    """Diluted earnings per share over the trailing twelve months, as filed: a step on each filing's bar, carried
    until the next, and nothing before the first trailing figure is public."""
    return [('diluted EPS, trailing twelve months, from the bar each filing became public', placed(_fig('EARNINGS_PER_SHARE_DILUTED:TTM'), T), None, 'exact')]


def _per_share(key):
    top, count = placed(_fig(key), T), placed(_fig('TOTAL_SHARES_OUTSTANDING:FQ'), T)
    return [top[i] / count[i] if (top[i] is not None and count[i]) else None for i in range(N)]


def rule_fund03():
    """Free cash flow of the trailing twelve months over the shares outstanding. Nothing wherever EITHER figure is
    withheld: before the share count is first reported, and through the report that left the cash flow unknown (an
    older cash flow is never carried across it)."""
    return [('trailing free cash flow over shares outstanding, nothing where either is withheld', _per_share('FREE_CASH_FLOW:TTM'), None, 'exact')]


def rule_fund04():
    """Book value per share, computed from what the filings hold: total equity over shares outstanding, both of the
    newest quarter. Nothing before the share count is first reported."""
    return [('total equity over shares outstanding, nothing before both are reported', _per_share('TOTAL_EQUITY:FQ'), None, 'exact')]


def _gap_boxes(keep):
    """A gap bar g: its low is above the prior bar's high. The box runs from the prior high (bottom) to that low (top),
    from g to the first later bar whose low drops below the top (the newest bar while none has). The `keep` newest."""
    out = []
    for g in range(1, N):
        if L[g] > H[g - 1]:
            end = next((j for j in range(g + 1, N) if L[j] < L[g]), LAST)
            out.append((T[g], T[end], L[g], H[g - 1]))
    return out[-keep:]


def drawn_rules(sid):
    """{numbers: [(what, [values any of which is right])], words: [(what, must, must_not)], labels: (what, dates, text or None),
    numbers_on_bars: (what, {day: the whole number written on that bar})}"""
    if sid == 'table-format-01':                             # a table with yesterday's high and yesterday's low (a daily chart)
        return {'numbers': [("yesterday's high", [H[LAST - 1]]), ("yesterday's low", [L[LAST - 1]])]}
    if sid == 'intraday-04':
        # today's bars: the newest bar and every bar before it back to the last overnight gap (the stamps are unix
        # seconds on a 5 minute chart; two bars of one session are minutes apart, two sessions are hours apart)
        first = LAST
        while first > 0 and B[first]['t'] - B[first - 1]['t'] < 6 * 3600:
            first -= 1
        low = min(b['l'] for b in B[first:LAST + 1])
        return {'numbers': [("today's low so far, on the newest bar", [low]),
                            ('the dollars lost on 100 shares bought at the latest price with the stop at that low', [(C[LAST] - low) * 100])]}
    if sid == 'count-on-bars-01':
        counts = _run_counts()
        return {'numbers_on_bars': ('the count written on each bar of a run (1 to 9, starting again at 1 after 9)',
                                    {T[i]: counts[i] for i in range(N) if counts[i] > 0})}
    if sid == 'i01':
        v = _atr_variants(14)
        # corrected on review 11-22: "show its latest value" asks for the latest value of the PERCENT only. The ATR in
        # dollars beside it was learned from the first answer (the rule learning from the door), and is not asked.
        return {'numbers': [('ATR as a percent of the close on the newest bar', [a[LAST] / C[LAST] * 100 for _n, a in v if a[LAST] is not None])]}
    if sid == 'i02':
        return {'numbers': [('volume over its 50 bar average on the newest bar', [V[LAST] / (sum(V[LAST - 49:LAST + 1]) / 50)])]}
    if sid == 'i03':
        dist = lambda k: k > 0 and C[k] <= C[k - 1] * (1 - 0.002) and V[k] > V[k - 1]  # noqa: E731
        n = sum(1 for k in range(LAST - 24, LAST + 1) if dist(k))
        return {'numbers': [('distribution days in the last 25 on the newest bar', [float(n)])],
                'words': [('the status for that count', 'under pressure' if n >= 5 else 'normal', 'normal' if n >= 5 else 'under pressure')]}
    if sid == 'i04':
        return {'labels': ('a label on each bar whose close crosses above the 50 bar average', _cross_up_dates(), 'Cross')}
    if sid == 'cap-04':                                          # a line at each of the last 3 swing lows, the oldest removed
        known = [p for p in _swings(L, 3, False) if p + 3 <= LAST]
        return {'level_lines_exact': ('a horizontal line at each of the last 3 swing lows, from its swing bar to the right edge, and no other line',
                                      [(T[p], L[p]) for p in known[-3:]])}
    if sid == 'cap-05':                                          # a line from the lowest low of 60 bars to the close, and its rise
        k = min(range(LAST - 59, LAST + 1), key=lambda i: (L[i], -i))
        return {'segments': [('from the lowest low of the last 60 bars to the newest close', T[k], L[k], T[LAST], C[LAST])],
                'labels_at': [('the end of the line, showing how many dollars it rises', T[LAST], C[LAST] - L[k])]}
    if sid == 'cap-06':                                          # ONE label, on the latest bar, with the percent from the 50 bar average
        return {'labels_at': [('the latest bar, showing the percent the close is from its 50 bar average', T[LAST], (C[LAST] / _sma(C, 50)[LAST] - 1) * 100)],
                'only_labels': 1}
    if sid == 'cap-08':                                          # a box on each gap up until a later low drops into it; the 10 newest
        return {'boxes_exact': [(f'the gap up of {left}', left, right, top, bottom) for left, right, top, bottom in _gap_boxes(10)],
                'only_boxes': 10}
    if sid == 'weekly-plot-01':
        # the line is held by value in RULES (every honest reading of a weekly average on a daily bar); the labels are
        # held to the line the script itself plots: on exactly the bars where the close crosses above THAT line
        return {'labels_cross_own': ('a label on each bar where the close crosses above the plotted 10 week average', 'Cross')}
    if sid == 'i05':
        out = []
        for n in (10, 21, 50):
            out.append((f'percent above the {n} bar average on the newest bar', [(C[LAST] / (sum(C[LAST - n + 1:LAST + 1]) / n) - 1) * 100]))
        return {'numbers': out}
    if sid == 'i06':
        return {'labels': ('a label on each new 252 bar closing high, showing the close', _new_high_dates(), 'close')}
    if sid == 'l01':
        return {'levels': [('the highest high of the last 252 bars', max(H[LAST - 251:LAST + 1]))]}
    if sid == 'l02':
        return {'boxes_exact': [('the high and low of the last 20 bars', T[LAST - 19], T[LAST], max(H[LAST - 19:LAST + 1]), min(L[LAST - 19:LAST + 1]))]}
    if sid == 'l03':
        k = min(range(LAST - 59, LAST + 1), key=lambda i: (L[i], -i))          # the lowest low of the last 60; the newest of a tie
        return {'segments': [('from the lowest low of the last 60 bars to the newest close', T[k], L[k], T[LAST], C[LAST])]}
    if sid == 'l04':
        inside = [i for i in range(1, N) if H[i] < H[i - 1] and L[i] > L[i - 1]]
        return {'boxes_on': ('a box on every inside bar, from its high to its low', [(T[i], H[i], L[i]) for i in inside])}
    if sid == 'l05':
        return {'levels': [("the prior bar's high", H[LAST - 1]), ("the prior bar's low", L[LAST - 1])]}
    if sid == 'l06':
        hi = max(range(LAST - 99, LAST + 1), key=lambda i: (H[i], i))
        lo = min(range(LAST - 99, LAST + 1), key=lambda i: (L[i], -i))
        return {'labels_at': [('the highest high of the last 100 bars', T[hi], H[hi]), ('the lowest low of the last 100 bars', T[lo], L[lo])]}
    if sid == 'k01':
        return {'named_rows': [(f'{sym} against its own 50 bar average', sym.lower(), 'above' if _above50(sym)[LAST] else 'below') for sym in ('SPY', 'QQQ', 'IWM')]}
    if sid == 'k04':
        on = bool(_above50('SPY')[LAST] and _above50('QQQ')[LAST])
        return {'words': [('the regime on the newest bar', 'risk on' if on else 'risk off', 'risk off' if on else 'risk on')]}
    if sid == 'j06':
        wk, _hi, _lo, cl, _last = _weeks()
        newest = _dt.date.fromisoformat(T[LAST])
        w = wk[LAST]
        w_stands = sum(cl[w - 9:w + 1]) / 10                       # the average as it stands on the newest bar
        week_is_whole = newest.weekday() == 4                      # the newest bar is its week's Friday
        w_done = w_stands if week_is_whole else sum(cl[w - 10:w]) / 10
        months, order = [], []
        for t in T:
            k = t[:7]
            if not order or order[-1] != k:
                order.append(k)
            months.append(len(order) - 1)
        m_cl = [[C[i] for i in range(N) if months[i] == m][-1] for m in range(len(order))]
        m = months[LAST]
        m_stands = sum(m_cl[m - 9:m + 1]) / 10
        following = newest + _dt.timedelta(days=3 if newest.weekday() == 4 else 1)          # the next weekday
        month_is_whole = following.month != newest.month           # the newest bar is its month's last weekday
        m_done = m_stands if month_is_whole else sum(m_cl[m - 10:m]) / 10
        word = lambda v: 'above' if C[LAST] > v else 'below'  # noqa: E731
        return {'numbers': [('the 10 week average (as it stands, or of the last finished week)', [w_stands, w_done]),
                            ('the 10 month average (as it stands, or of the last finished month)', [m_stands, m_done])],
                'rows_any': [('close against the 10 week average', [(w_stands, word(w_stands)), (w_done, word(w_done))]),
                             ('close against the 10 month average', [(m_stands, word(m_stands)), (m_done, word(m_done))])]}
    return None


def check_drawn(sid, s):
    """Hold the drawn text to the hand rule. Returns True (right), False (something differs) or None (nothing to check)."""
    drawn = s.get('drawn') or {}
    tables, labels = drawn.get('tables') or [], drawn.get('labels') or []
    if drawn.get('error'):
        _say(f"  DRAWN: could not be read ({drawn['error']})")
    cells = [c for t in tables for row in t['grid'] for c in row if c]
    lines, boxes = drawn.get('lines') or [], drawn.get('boxes') or []
    if lines or boxes:
        _say(f"  drawn: {len(lines)} line(s), {len(boxes)} box(es)")
    _say(f"  drawn ({drawn.get('via')}): {len(tables)} table(s), {len(labels)} label(s)" + (f"; runtime keys {drawn.get('runtimeKeys')}" if drawn.get('via') == 'runtime' else ''))
    for t in tables:
        _say(f"    table at {t['position']}: {t['grid']}")
    rules = drawn_rules(sid)
    if rules is None:
        if tables or labels or lines or boxes:
            _say('  DRAWN TEXT NOT VALUE-CHECKED (no hand rule for what this id draws)')
        return None
    good = True
    for what, values in rules.get('numbers', []):
        hit = next((c for v in values for c in [_shows(cells, v)] if c), None)
        _say(f"  {'RIGHT' if hit else 'CHECK'}  table says {what}: {('in ' + repr(hit)) if hit else 'NOT FOUND; by hand ' + ', '.join(f'{v:.4f}' for v in values)}")
        good = good and bool(hit)
    low = [c.lower() for c in cells]
    for what, must, must_not in rules.get('words', []):
        ok = any(must in c for c in low) and not any(must_not in c for c in low)
        _say(f"  {'RIGHT' if ok else 'CHECK'}  table says {what}: expected {must!r}, never {must_not!r}")
        good = good and ok
    for what, readings in rules.get('rows_any', []):                # a row that shows ONE honest reading and says its word
        hit = None
        for value, word in readings:
            row = next((r for t in tables for r in t['grid'] if _shows([c for c in r if c], value)), None)
            if row and any(word in (c or '').lower() for c in row) and not any(('above' if word == 'below' else 'below') in (c or '').lower() for c in row):
                hit = (value, word, row)
                break
        _say(f"  {'RIGHT' if hit else 'CHECK'}  table row for {what}: " + (f'{hit[1].upper()} beside {hit[0]:.2f}; row {hit[2]}' if hit else
             'no row shows ' + ' or '.join(f'{v:.2f} ({w.upper()})' for v, w in readings) + f'; tables {[t["grid"] for t in tables]}'))
        good = good and bool(hit)
    for what, value, word in rules.get('rows', []):
        row = next((r for t in tables for r in t['grid'] if _shows([c for c in r if c], value)), None)
        ok = bool(row) and any(word in (c or '').lower() for c in row) and not any(('above' if word == 'below' else 'below') in (c or '').lower() for c in row)
        _say(f"  {'RIGHT' if ok else 'CHECK'}  table row for {what}: expected {word.upper()} beside {value:.2f}; row {row}")
        good = good and ok
    day = lambda v: str(v)[:10]  # noqa: E731
    near = lambda a, b: a is not None and abs(a - b) <= 1e-6 * max(1.0, abs(b))  # noqa: E731
    cols = s.get('columns') or {}
    for what, level in rules.get('levels', []):
        as_line = [l for l in lines if near(l['y1'], level) and near(l['y2'], level) and (day(l['x2']) == T[LAST] or l.get('extend') in ('right', 'both'))]
        as_plot = [k for k, c in cols.items() if near(c[LAST], level)]
        ok = bool(as_line or as_plot)
        how = (f'a drawn line, {day(as_line[-1]["x1"])} to {day(as_line[-1]["x2"])}, extend {as_line[-1].get("extend")}' if as_line else f'a plotted line (column {as_plot[0]!r}) on the newest bar' if as_plot else f'NOT FOUND; by hand {level:.4f}; lines end at {[round(l["y2"], 4) for l in lines[-4:]]}')
        _say(f"  {'RIGHT' if ok else 'CHECK'}  a level at {what} ({level:.4f}): {how}")
        good = good and ok
    for what, left, right, top, bottom in rules.get('boxes_exact', []):
        hit = [b for b in boxes if day(b['left']) == left and day(b['right']) == right and near(b['top'], top) and near(b['bottom'], bottom)]
        _say(f"  {'RIGHT' if hit else 'CHECK'}  a box around {what}: by hand {left} to {right}, {bottom:.4f} to {top:.4f}" + ('' if hit else f'; drawn {[(day(b["left"]), day(b["right"]), round(b["bottom"], 4), round(b["top"], 4)) for b in boxes[-3:]]}'))
        good = good and bool(hit)
    for what, x1, y1, x2, y2 in rules.get('segments', []):
        hit = [l for l in lines if {(day(l['x1']), round(l['y1'], 6)), (day(l['x2']), round(l['y2'], 6))} == {(x1, round(y1, 6)), (x2, round(y2, 6))}]
        _say(f"  {'RIGHT' if hit else 'CHECK'}  a line {what}: by hand ({x1}, {y1:.4f}) to ({x2}, {y2:.4f})" + ('' if hit else f'; drawn {[(day(l["x1"]), round(l["y1"], 4), day(l["x2"]), round(l["y2"], 4)) for l in lines[-3:]]}'))
        good = good and bool(hit)
    if 'level_lines_exact' in rules:
        what, want = rules['level_lines_exact']
        flat = [l for l in lines if near(l['y1'], l['y2'])]
        got = sorted((day(l['x1']), round(l['y1'], 6)) for l in flat)
        exp = sorted((d, round(v, 6)) for d, v in want)
        reach = bool(flat) and all(day(l['x2']) == T[LAST] or l.get('extend') in ('right', 'both') for l in flat)
        ok = got == exp and len(flat) == len(lines) and reach
        _say(f"  {'RIGHT' if ok else 'CHECK'}  {what}: by hand {[(d, round(v, 4)) for d, v in exp]}" + ('' if ok else
             f'; drawn {len(lines)} line(s), level ones {[(d, round(v, 4)) for d, v in got][-5:]}' + ('' if reach else '; not all reach the right edge')))
        good = good and ok
    for kind, drawn_list, name in (('only_labels', labels, 'label'), ('only_boxes', boxes, 'box')):
        if kind in rules:
            ok = len(drawn_list) == rules[kind]
            _say(f"  {'RIGHT' if ok else 'CHECK'}  {rules[kind]} {name}(s) on the chart and no more: {len(drawn_list)} drawn")
            good = good and ok
    if 'boxes_on' in rules:
        what, want = rules['boxes_on']
        got = sorted((day(b['left']), round(b['top'], 6), round(b['bottom'], 6)) for b in boxes)
        exp = sorted((d, round(t, 6), round(b, 6)) for d, t, b in want)
        kept = exp[-len(got):] if got else []
        if got == exp:
            verdict, note = True, f'all {len(exp)} bars'
        elif got and got == kept:
            verdict, note = True, f'the newest {len(got)} of {len(exp)} bars (older boxes are not kept on the chart)'
        else:
            verdict, note = False, f'{len(got)} drawn against {len(exp)} by hand; only drawn {sorted(set(got) - set(exp))[:3]}; only by hand (within the kept span) {sorted(set(kept) - set(got))[:3]}'
        _say(f"  {'RIGHT' if verdict else 'CHECK'}  {what}: {note}")
        good = good and verdict
    for what, when, value in rules.get('labels_at', []):
        on_bar = [l for l in labels if day(l['x']) == when]
        hit = [l for l in on_bar if _shows([l['text']], value)]
        _say(f"  {'RIGHT' if hit else 'CHECK'}  a label at {what}: by hand on {when} showing {value:.2f}" + ('' if hit else f'; labels on that bar {[l["text"] for l in on_bar]}; all labels {[(day(l["x"]), l["text"]) for l in labels[-4:]]}'))
        good = good and bool(hit)
    for what, name, word in rules.get('named_rows', []):
        row = next((r for t in tables for r in t['grid'] if any(name in (c or '').lower() for c in r)), None)
        other = 'above' if word == 'below' else 'below'
        ok = bool(row) and any(word in (c or '').lower() for c in row) and not any(other in (c or '').lower() for c in row)
        _say(f"  {'RIGHT' if ok else 'CHECK'}  table row for {what}: expected {word.upper()}; row {row}")
        good = good and ok
    if 'numbers_on_bars' in rules:
        what, want = rules['numbers_on_bars']
        days = sorted(want)
        # (a) one LABEL per bar, each showing its own bar's number (the newest ones, when the chart keeps only those)
        got = sorted(str(l['x'])[:10] for l in labels)
        kept = days[-len(got):] if got else []
        where = bool(got) and got in (days, kept)
        off = [l for l in labels if not _shows([l['text'] or ''], float(want.get(str(l['x'])[:10], float('nan'))))]
        by_labels = where and not off
        # (b) one MARK per number: a fixed text that IS the number, on exactly the bars of that number
        marks, cols = s.get('marks') or {}, s.get('columns') or {}
        on = lambda key: {T[i] for i, v in enumerate(cols.get(key) or []) if v}  # noqa: E731
        missing = [v for v in sorted(set(want.values()))
                   if not any(str(m.get('text') or '').strip() == str(v) and on(k) == {d for d, x in want.items() if x == v} for k, m in marks.items())]
        by_marks = bool(marks) and not missing
        if by_labels:
            note = f'a label on {"all " + str(len(days)) if got == days else "the newest " + str(len(got)) + " of " + str(len(days))} bars, each showing its number'
        elif by_marks:
            note = f'{len(set(want.values()))} marks, each a fixed number on exactly its bars'
        elif labels:
            note = (f'{len(got)} label(s) against {len(days)} bars by hand' + ('' if where else '; NOT on the bars of the run')
                    + (f'; {len(off)} show another number, e.g. {off[0]}' if off else ''))
        elif marks:
            note = (f'no label; the marks write {sorted(set(str(m.get("text")) for m in marks.values()))}: '
                    f'no mark is the number {missing[0]} on exactly its bars' + (f' ({len(missing)} of {len(set(want.values()))} numbers have none)' if len(missing) > 1 else ''))
        else:
            note = 'nothing is written on the bars: no label and no mark'
        _say(f"  {'RIGHT' if by_labels or by_marks else 'CHECK'}  {what}: {note}")
        good = good and (by_labels or by_marks)
    if 'labels_cross_own' in rules:
        what, text = rules['labels_cross_own']
        got = sorted(str(l['x'])[:10] for l in labels)
        hit = None
        for key, col in cols.items():
            crosses = [T[i] for i in range(1, N) if col[i] is not None and col[i - 1] is not None and C[i] > col[i] and C[i - 1] <= col[i - 1]]
            if len(crosses) >= 5 and got and got in (crosses, crosses[-len(got):]):
                hit = (key, len(crosses))
                break
        words_ok = bool(labels) and all((l['text'] or '').strip() == text for l in labels)
        _say(f"  {'RIGHT' if hit else 'CHECK'}  {what}: " + (f'{len(got)} label(s), the crosses of column {hit[0]!r} ({hit[1]} by hand from that column)' if hit else
             f'{len(got)} label(s) that are the crosses of NO plotted column; columns {sorted(cols)}'))
        _say(f"  {'RIGHT' if words_ok else 'CHECK'}  every label reads {text!r}")
        good = good and bool(hit) and words_ok
    if 'labels' in rules:
        what, dates, text = rules['labels']
        got = sorted(str(l['x'])[:10] for l in labels)
        kept = dates[-len(got):] if got else []
        if got == dates:
            verdict, note = True, f'all {len(dates)} bars'
        elif got and got == kept:
            verdict, note = True, f'the newest {len(got)} of {len(dates)} bars (older labels are not kept on the chart)'
        else:
            verdict = False
            note = f'{len(got)} drawn against {len(dates)} by hand; only drawn {sorted(set(got) - set(dates))[:4]}; only by hand (within the kept span) {sorted(set(kept) - set(got))[:4]}'
        _say(f"  {'RIGHT' if verdict else 'CHECK'}  {what}: {note}")
        good = good and verdict
        if text == 'Cross':
            ok = all((l['text'] or '').strip() == 'Cross' for l in labels) and bool(labels)
            _say(f"  {'RIGHT' if ok else 'CHECK'}  every label reads 'Cross'")
            good = good and ok
        elif text == 'close':
            by_day = {T[i]: C[i] for i in range(N)}
            bad = [l for l in labels if not _shows([l['text']], by_day.get(str(l['x'])[:10], float('nan')))]
            _say(f"  {'RIGHT' if labels and not bad else 'CHECK'}  every label shows its bar's close ({len(labels) - len(bad)} of {len(labels)})" + (f"; e.g. {bad[0]}" if bad else ''))
            good = good and bool(labels) and not bad
    return good


RULES = {'h03': rule_h03, 'h05': rule_h05, 'i01': rule_i01, 'i02': rule_i02, 'i03': rule_i03, 'i04': rule_i04, 'i05': rule_i05, 'i06': rule_i06,
         'j01': rule_j01, 'j02': rule_j02, 'j03': rule_j03, 'j06': rule_j06,
         'k02': rule_k02, 'k03': rule_k03, 'k04': rule_k04, 'k05': rule_k05, 'k06': rule_k06,
         'weekly-plot-01': rule_j02,
         'cap-01': rule_cap01, 'cap-02': rule_cap02, 'cap-03': rule_cap03, 'cap-07': rule_cap07, 'cap-09': rule_cap09,
         'fund-01': rule_fund01, 'fund-02': rule_fund02, 'fund-03': rule_fund03, 'fund-04': rule_fund04}                     # a script that PLOTS the 10 week average of the weekly close: the same readings
#: what each request ASKED to see; anything else the script draws is listed as not asked for
ASKED = {'h03': {'plot'}, 'h05': {'plotshape'}, 'i01': {'plot', 'table'}, 'i02': {'plot', 'table'}, 'i03': {'plot', 'table'},
         'i04': {'plot', 'label'}, 'i05': {'plot', 'table'}, 'i06': {'plot', 'label'}, 'weekly-plot-01': {'plot', 'label'},
         'j01': {'plot'}, 'j02': {'plot'}, 'j03': {'plot'}, 'j04': {'plot'}, 'j05': {'plot'}, 'j06': {'table'},
         'l01': {'line', 'plot'}, 'l02': {'box'}, 'l03': {'line'}, 'l04': {'box'}, 'l05': {'line', 'plot'}, 'l06': {'label'},
         'table-format-01': {'table'},
         'count-on-bars-01': {'label', 'plotchar', 'plotshape'}, 'intraday-04': {'table'},
         'k01': {'table'}, 'k02': {'plot'}, 'k03': {'plot', 'background'}, 'k04': {'plot', 'table'}, 'k05': {'plot'}, 'k06': {'plot'}}
#: ids whose column rules are DIFFERENT columns that must all be there, not readings of one
ASKED.update({'cap-01': {'plot'}, 'cap-02': {'plot'}, 'cap-03': {'plot'}, 'cap-04': {'line'}, 'cap-05': {'line', 'label'},
              'cap-06': {'label'}, 'cap-07': {'plot'}, 'cap-08': {'box'}, 'cap-09': {'plot'}})
ASKED.update({'fund-01': {'plot'}, 'fund-02': {'plot'}, 'fund-03': {'plot'}, 'fund-04': {'plot'}})
NEED_ALL = {'i05'}


def has_rule(case_id):
    return case_id in RULES or drawn_rules_known(case_id)


def drawn_rules_known(case_id):
    return case_id in {'table-format-01', 'weekly-plot-01', 'cap-04', 'cap-05', 'cap-06', 'cap-08', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'j06', 'k01', 'k04', 'l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'count-on-bars-01', 'intraday-04'}


def code_of(source):
    """The script's code, never its comments."""
    return '\n'.join(line.split('//')[0] for line in source.splitlines())


def draws(source):
    """What kinds of thing the script draws, with a fully transparent plot (there for alerts) counted apart."""
    code = code_of(source)
    drawn = {name: len(re.findall(rx, code)) for name, rx in KINDS}
    hidden = 0
    for m in re.finditer(r'(?<![.\w])plot\s*\(', code):
        depth, i = 1, m.end()
        while i < len(code) and depth:
            depth += {'(': 1, ')': -1}.get(code[i], 0)
            i += 1
        if re.search(r'color\s*=\s*color\.new\s*\([^()]*,\s*100\s*\)', code[m.end():i]):
            hidden += 1
    if hidden:
        drawn['plot'] = drawn.get('plot', 0) - hidden
        drawn['hidden plot'] = hidden
    return {k: v for k, v in drawn.items() if v}


def grade_script(case_id, source, run, chart):
    """{'verdict': 'right' | 'wrong' | 'no rule' | 'did not run', 'lines': [...], 'not_asked_for': {...}}"""
    del _LINES[:]
    if not run or not run.get('ok'):
        return {'verdict': 'did not run', 'lines': [str((run or {}).get('reason') or 'the engine did not build this script')], 'not_asked_for': {}}
    if not has_rule(case_id):
        return {'verdict': 'no rule', 'lines': [], 'not_asked_for': {}}
    bind(chart)
    right_all = True
    if run.get('errors'):
        right_all = False
        _say(f"the run reported errors: {run['errors']}")
    plots_any = bool(re.search(r'(?<![.\w])plot(shape|char)?\s*\(', code_of(source)))
    variants = RULES[case_id]() if case_id in RULES and plots_any else []
    groups = [v[2] if len(v) > 2 else None for v in variants]
    right = [best(run['columns'], v[1], v[0], flag=(len(v) > 3 and v[3] == 'flag'), exact=(len(v) > 3 and v[3] == 'exact')) for v in variants]
    if any(g is not None for g in groups):                # grouped readings: every group needs one that is right
        if not all(any(r for r, g in zip(right, groups) if g == name) for name in set(groups)):
            right_all = False
    elif variants and not (all(right) if case_id in NEED_ALL else any(right)):
        right_all = False
    drawn = draws(source)
    extra = {k: v for k, v in drawn.items() if k not in ASKED.get(case_id, set()) and k != 'hidden plot'}
    checked = check_drawn(case_id, run)
    if checked is False:
        right_all = False
    if not variants and checked is None:
        return {'verdict': 'no rule', 'lines': list(_LINES), 'not_asked_for': extra}
    return {'verdict': 'right' if right_all else 'wrong', 'lines': list(_LINES), 'not_asked_for': extra}
