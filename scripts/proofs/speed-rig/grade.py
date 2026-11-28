"""The speed rig's GRADER: every switch of a sweep against the owner's objective (2026-11-27: every chart, every
switch, the full correct chart in ONE paint, close to 30 ms always).

Ported from the owner-PC grader (C:/uct-runs/rth-20261130/bin/jump_grade.py, 2026-11-27): the per-switch rules are
that file's, unchanged, so a cloud sweep and a PC sweep grade alike. Per switch, from the rig's per-frame samples
(<pass>.jump.json) and its pass record (<pass>.json):
  WRONG_CHART     the header names the new symbol while the chart paints another (either direction), or a chart of the
                  board still paints the previous symbol after its partner shows the new one
  SHORT_PAINT     a frame leaves the visible span part-empty (logical 'from' < -2) while more history arrives later
  VISIBLE_CHANGE  any change after the first paint: time shift, zoom, price rescale/shift (> 1%), bars replaced, reflow
  LONE_CHART      the board's charts show the new symbol more than 2 frames (34 ms) apart, or one never does
  STALE           the final newest bar is older than expected (below)
  OVER_30MS       the full frame (the last visible change, else the first paint) later than 30 ms after the key
What changed from the PC copy, and why:
  * STALE's expectation. The PC copy pins the 2026-11-27 half day. Here it is --expect-day / --expect-intraday when
    given, else DERIVED from the sweep: the freshest daily bar any D chart of the sweep showed, and per intraday
    timeframe the freshest bar of that timeframe minus two bars (labelled "derived" in the summary).
  * REUSED TICKERS (2026-11-28): the plan hands out never-used tickers first, then names past the ledger's reuse window
    (plan.REUSE_AFTER_DAYS); the rig records them (freshTickers.reused). Their switches are graded in their own row,
    'TICKERS reused', beside 'TICKERS never-used', at the top of the table: a reused name's browser is cold, its server
    side may be warm, so only the never-used row is the fully cold number. Only a pass's FIRST switch to one of its
    planned tickers counts there; every other switch naming a symbol (the board's fixed symbol, a tab revisit, the
    second timeframe press on one ticker, a record with no plan) is 'TICKERS revisit/fixed'.
  * The summary: per pass, then per BOARD (zoom x board, arrows and typed together), p50 / p100 of the full frame,
    with every label the rig recorded (runner, CPU, Chrome, Cloudflare colo, production commit, isolation).
  * --compare <dir>: grade another sweep (the owner-PC run) with the SAME rules and print both side by side.

    python scripts/proofs/speed-rig/grade.py <dir> [--compare <pc dir>] [--expect-day=YYYY-MM-DD] [--md <file>]
    python scripts/proofs/speed-rig/grade.py --self-check
Writes <dir>/grade.json and <dir>/summary.json (and --md). Standard library only.
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ORDER = ['WRONG_CHART', 'BLANK', 'SHORT_PAINT', 'VISIBLE_CHANGE', 'LONE_CHART', 'STALE', 'OVER_30MS']
INTRA_MIN = {'1': 1, '5': 5, '15': 15, '30': 30, '45': 45, '60': 60, '120': 120, '240': 240}


def tf_paints(tf, sp):
    """(F6) Does a frame whose smallest gap between its newest bars is `sp` seconds (rig.mjs --pattern=tf samples it per
    frame) show timeframe `tf`? None: not sampled / unknown, so the frame cannot be told apart."""
    if sp is None or tf is None:
        return None
    t = str(tf).upper()
    if t in INTRA_MIN:
        return abs(sp - INTRA_MIN[t] * 60) < 1
    if t in ('D', '1D'):
        return abs(sp - 86400) < 1
    if t in ('W', '1W'):
        return abs(sp - 7 * 86400) < 1
    if t in ('M', '1M'):
        return 28 * 86400 - 1 <= sp <= 31 * 86400 + 1
    return None


def day(t):
    if t is None:
        return None
    if isinstance(t, str):
        return t[:10]
    if isinstance(t, dict) and 'year' in t:
        return f"{t['year']}-{t['month']:02d}-{t['day']:02d}"
    return None


def load_pass(d: str, name: str):
    rec = json.load(open(os.path.join(d, name + '.json'), encoding='utf-8'))
    raw = json.load(open(os.path.join(d, name + '.jump.json'), encoding='utf-8'))
    return rec, raw


def chart_tfs(rec: dict, root: str) -> dict:
    tfs = {}
    bf = (rec.get('board') or {}).get('file')
    cands = [bf] if bf else []
    if bf:
        cands += [os.path.join(root, bf), os.path.join(root, 'scripts/proofs/speed-rig/boards', os.path.basename(bf))]
    hit = next((c for c in cands if c and os.path.exists(c)), None)
    if hit:
        bj = json.load(open(hit, encoding='utf-8'))
        charts = [w for w in bj.get('widgets', []) if w.get('type') == 'chart']
        for k, w in enumerate(charts[:2]):
            tfs['flip-chart' if k == 0 else 'flip-chart-2'] = str((w.get('opts') or {}).get('tf') or 'D')
    else:
        tfs = {'flip-chart': str(rec.get('tf') or 'D'), 'flip-chart-2': rec.get('tf2') or None}
    return tfs


def expectations(passes: list, opts: dict) -> dict:
    """What STALE compares against: given, else derived from the freshest bars the sweep itself saw."""
    best_d, best_i = None, {}
    for _name, rec, raw, tfs in passes:
        for p in raw:
            if not p['frames']:
                continue
            last = p['frames'][-1]['c']
            for cid, x in last.items():
                nb = (x or {}).get('nb')
                if not nb:
                    continue
                # (F7) a timeframe press's chart is at the timeframe pressed, not the board's
                tf = str((p.get('tf') if p.get('dir') == 'tf' and cid == 'flip-chart' and p.get('tf') else tfs.get(cid)) or 'D').upper()
                t = nb[0]
                if isinstance(t, (int, float)) and tf in INTRA_MIN:
                    best_i[tf] = max(best_i.get(tf, t), t)
                elif tf in ('D', '1D') and day(t):
                    best_d = max(best_d or day(t), day(t))
    exp_day = opts.get('expect-day') or best_d or datetime.now(timezone.utc).strftime('%Y-%m-%d')
    exp_d = datetime.strptime(exp_day, '%Y-%m-%d')
    out = {'day': exp_day, 'week': (exp_d - timedelta(days=exp_d.weekday())).strftime('%Y-%m-%d'), 'month': exp_d.strftime('%Y-%m-01'),
           'dayHow': 'given' if opts.get('expect-day') else ('derived' if best_d else 'today'),
           'intraday': {tf: t - 2 * INTRA_MIN[tf] * 60 for tf, t in best_i.items()}, 'intradayHow': 'derived'}
    if opts.get('expect-intraday'):
        v = float(opts['expect-intraday'])
        out['intraday'] = {tf: v for tf in INTRA_MIN}
        out['intradayHow'] = 'given'
    return out


def stale(nb_time, tf, exp) -> bool:
    if nb_time is None:
        return True
    tf = str(tf or 'D').upper()
    if isinstance(nb_time, (int, float)):
        want = exp['intraday'].get(tf)
        return want is not None and nb_time < want
    d = day(nb_time)
    if tf in ('W', '1W'):
        return d < exp['week']
    if tf in ('M', '1M'):
        return d < exp['month']
    return d < exp['day']


def _first_word(h) -> str:
    """The symbol a sampled header names: its first word, exactly (a prefix pair, old AAPL / target AA, is two symbols)."""
    w = str(h or '').upper().split()
    return w[0] if w else ''


def _names_other(h, sym) -> bool:
    """A sampled header naming a symbol, not `sym`."""
    return bool(_first_word(h)) and bool(sym) and _first_word(h) != str(sym).upper()


def _skip_old_ticks(post: list, cid: str, k0, base: dict | None, p: dict):
    """The first post-key frame that is not the previous symbol's own price tick (see grade_switch), or None."""
    if k0 is None or not base or not base.get('hs') or not base.get('nb'):
        return k0
    tgt = str(p.get('sym') or '').upper()
    names = lambda h, sym: bool(sym) and _first_word(h) == sym  # noqa: E731
    if names(base['hs'], tgt):
        return k0
    hdr = next((f['c'][cid] for f in post if names(f['c'][cid].get('hs'), tgt) and f['c'][cid].get('nb')), None)
    for k in range(k0, len(post)):
        x = post[k]['c'][cid]
        if not x.get('nb') or json.dumps(x['nb']) == json.dumps(base['nb']):
            continue
        tick = (x.get('hs') == base['hs'] and json.dumps(x['nb'][0]) == json.dumps(base['nb'][0]) and x.get('ni') == base.get('ni')
                and x.get('lr') == base.get('lr') and not (hdr and x['nb'][1] == hdr['nb'][1]))
        if not tick:
            return k
    return None


def grade_switch(p: dict, rec: dict, tfs: dict, exp: dict) -> dict:
    """One switch, by the PC grader's rules (verbatim but for STALE's expectation)."""
    key = p['key']
    frames = p['frames']
    ids = [cid for cid in ('flip-chart', 'flip-chart-2') if any(cid in f['c'] for f in frames)]
    flags, detail, shown = set(), {}, {}
    for cid in ids:
        pre = [f['c'][cid] for f in frames if f['t'] < key and f['c'].get(cid) and f['c'][cid].get('nb')]
        post = [f for f in frames if f['t'] >= key and f['c'].get(cid)]
        # (2026-11-28) BLANK: the chart had bars before the key and a frame after it shows none (a blank chart was
        # never flagged: frames with no newest bar were skipped). Any such frame fails the switch.
        had = any(x.get('nb') for x in pre)
        blank = [f for f in post if f['c'].get(cid) is not None and not f['c'][cid].get('nb')] if had else []
        if blank:
            flags.add('BLANK')
            blank_at = (round(blank[0]['t'] - key), round(blank[-1]['t'] - key))
        else:
            blank_at = None
        # (2026-11-28, COV-zo-wm-typed presses 0 and 3, COV-zo-m1-typed 0, COV-date-D-typed 1) NO FRAME BEFORE THE KEY: the
        # sampler's first frame (+8-17 ms) still showed the PREVIOUS symbol (OSIS, BOKF, FSLY, NOW), and with no base it was
        # read as the new chart's first paint: "a short paint at 17 ms" (OSIS's 349 months) that was the old chart, "a stale
        # 1m paint" that was FSLY's. A first frame whose sampled header names another symbol than the target is the base.
        if not pre and post and post[0]['c'][cid].get('nb') and _names_other(post[0]['c'][cid].get('hs'), p.get('sym')):
            pre = [post[0]['c'][cid]]
        base = json.dumps(pre[-1]['nb']) if pre else None
        k0 = next((k for k, f in enumerate(post) if f['c'][cid].get('nb') and json.dumps(f['c'][cid]['nb']) != base), None)
        # (2026-11-28, COV-def-wm-typed press 3) A TICK ON THE OLD CHART IS NOT THE NEW PAINT. `nb` is [time, close], so the
        # previous symbol's live price moving its developing bar (HELE's month 34.57 -> 37.71 at 199 ms, header still HELE,
        # the same 601 rows and view) read as the new chart shown, then as "old header over new candles" and LONE_CHART,
        # while both charts switched together at 4035 ms. A frame is that tick when the header still names the old symbol
        # and the newest bar's time, the row count and the view are the pre-key frame's, and its close is not the close the
        # chart shows once the header names the target (that would be the new bars under a late header: WRONG_CHART stands).
        tfpress = p.get('dir') == 'tf' and cid == 'flip-chart' and p.get('tf')
        sampled = tfpress and any(f['c'][cid].get('sp') is not None for f in post)
        if sampled:
            # (F6/F8) a timeframe press keeps its header: the new chart is the first frame AT THE TIMEFRAME PRESSED (a tick on
            # the old timeframe's chart, or the old chart itself still on screen, is not it); _skip_old_ticks reads headers
            k0 = next((k for k, f in enumerate(post) if f['c'][cid].get('nb') and tf_paints(p['tf'], f['c'][cid].get('sp'))), None)
            if k0 is None:
                flags.add('WRONG_CHART')   # the pressed timeframe never painted within the probe
        else:
            k0 = _skip_old_ticks(post, cid, k0, pre[-1] if pre else None, p)
        if k0 is None:
            detail[cid] = {'shown': None, 'blank': blank_at}
            continue
        s = post[k0]['c'][cid]
        shown[cid] = post[k0]['t'] - key
        fin = post[-1]['c'][cid]
        bars_first = (s.get('ni') or 0) + 1
        bars_final = (fin.get('ni') or 0) + 1
        for f in post[k0:]:
            x = f['c'][cid]
            if x.get('lr') and x['lr'][0] < -2 and bars_final > 1.2 * ((x.get('ni') or 0) + 1):
                flags.add('SHORT_PAINT')
                break
        changes = []
        last = s
        for f in post[k0 + 1:]:
            x = f['c'][cid]
            dt = round(f['t'] - post[k0]['t'])
            if x.get('lr') and last.get('lr') and x.get('ni') is not None and last.get('ni') is not None:
                r1 = (x['lr'][0] - x['ni'], x['lr'][1] - x['ni'])
                r0 = (last['lr'][0] - last['ni'], last['lr'][1] - last['ni'])
                w0, w1 = r0[1] - r0[0], r1[1] - r1[0]
                if abs(w1 - w0) > max(1, 0.02 * w0):
                    changes.append(('zoom', dt, round(w1 - w0, 1)))
                elif abs(r1[1] - r0[1]) > 0.5:
                    changes.append(('time-shift', dt, round(r1[1] - r0[1], 1)))
            if x.get('nb') and last.get('nb') and json.dumps(x['nb'][0]) != json.dumps(last['nb'][0]):
                changes.append(('bars-replaced', dt, None))
            if x.get('ni') is not None and last.get('ni') is not None and x['ni'] != last['ni']:
                changes.append(('history-changed', dt, x['ni'] - last['ni']))
            if (x.get('y0') is not None and last.get('y0') is not None and x.get('y1') is not None and last.get('y1') is not None
                    and x.get('nb') and last.get('nb') and x['nb'][1] == last['nb'][1]):
                sp0, sp1 = abs(last['y1'] - last['y0']), abs(x['y1'] - x['y0'])
                ph = (x.get('r') or [0, 0, 0, 400])[3] or 400
                if sp0 > 0 and abs(sp1 - sp0) / sp0 > 0.01:
                    changes.append(('price-rescale', dt, round(100 * (sp1 - sp0) / sp0, 1)))
                elif abs(x['y0'] - last['y0']) > 0.01 * ph:
                    changes.append(('price-shift', dt, round(x['y0'] - last['y0'])))
            if x.get('r') and last.get('r') and any(abs(a - b) > 1 for a, b in zip(x['r'], last['r'])):
                changes.append(('pane-reflow', dt, None))
            last = x
        if any(c[0] != 'history-changed' for c in changes):
            flags.add('VISIBLE_CHANGE')
        hs_pre = next((f['c'][cid].get('hs') for f in reversed([f for f in frames if f['t'] < key and f['c'].get(cid)]) if f['c'][cid].get('hs')), None)
        tgt = str(p.get('sym') or '').upper()
        same = lambda h, sym: bool(sym) and _first_word(h) == str(sym).upper()  # noqa: E731  (exact: AA is not AAPL)
        wrong = []
        # (F6) the symbol-header rules do not read a timeframe press (one symbol before and after); its own rule is below
        if any(f['c'][cid].get('hs') for f in post) and not tfpress:
            for j2, f in enumerate(post[:k0]):
                if same(f['c'][cid].get('hs'), tgt) and not (hs_pre and same(hs_pre, tgt)):
                    wrong.append({'kind': 'new-header-over-old-candles', 'frame': j2, 'dt': round(f['t'] - key)})
            for j2, f in enumerate(post[k0:]):
                h = f['c'][cid].get('hs')
                if h and not same(h, tgt) and hs_pre and same(h, str(hs_pre).upper().split()[0]):
                    wrong.append({'kind': 'old-header-over-new-candles', 'frame': k0 + j2, 'dt': round(f['t'] - key)})
        if wrong:
            flags.add('WRONG_CHART')
        if sampled:
            for j2, f in enumerate(post[k0 + 1:]):
                if tf_paints(p['tf'], f['c'][cid].get('sp')) is False:
                    wrong.append({'kind': 'other-tf-after-the-press-painted', 'frame': k0 + 1 + j2, 'dt': round(f['t'] - key), 'sp': f['c'][cid].get('sp')})
                    flags.add('WRONG_CHART')
                    break
        ctf = p.get('tf') if (p.get('dir') == 'tf' and cid == 'flip-chart' and p.get('tf')) else tfs.get(cid)   # a timeframe press (--pattern=tf): its own tf
        if stale(fin.get('nb', [None])[0] if fin.get('nb') else None, ctf, exp):
            flags.add('STALE')
        vis = [c for c in changes if c[0] != 'history-changed']
        full = (vis[-1][1] + shown[cid]) if vis else shown[cid]
        detail[cid] = {'wrong': wrong[:6], 'headerBefore': hs_pre, 'shown': round(shown[cid]), 'full': round(full), 'barsFirst': bars_first,
                       'barsFinal': bars_final, 'lrFromFirst': s.get('lr', [None])[0] if s.get('lr') else None, 'changes': changes[:8],
                       'tf': tfs.get(cid), 'newest': fin.get('nb', [None])[0] if fin.get('nb') else None}
    fulls = [c.get('full') for c in detail.values() if c.get('full') is not None]
    never = [cid for cid, c in detail.items() if c.get('shown') is None]
    sw_full = max(fulls) if fulls else None
    if p.get('dir') == 'tab':
        fl_rec = next((f for f in rec.get('flips', []) if f.get('i') == p['i'] and f.get('dir') == 'tab'), None)
        ck = (fl_rec or {}).get('click') or {}
        sw_full = ck.get('paint', sw_full)
        detail = {'board': {'click->next frame': ck.get('frame'), 'click->after paint': ck.get('paint'), 'charts drawn': ck.get('cv'), 'task': ck.get('task')}}
        ids = []
    if sw_full is None or (never and p.get('dir') != 'tab') or (sw_full is not None and sw_full > 30):
        flags.add('OVER_30MS')
    if len(ids) == 2:
        a, b = shown.get(ids[0]), shown.get(ids[1])
        if a is None or b is None or abs(a - b) > 34:
            flags.add('LONE_CHART')
            if a is not None or b is not None:
                flags.add('WRONG_CHART')
    rec_fl = next((f for f in rec.get('flips', []) if f.get('i') == p['i'] and f.get('dir') == p.get('dir')), {}) or {}
    return {'press': p['i'], 'dir': p.get('dir'), 'sym': p.get('sym'), 'flags': sorted(flags), 'full': sw_full,
            'warm': (rec_fl.get('warm') or {}).get('state'), 'typing': rec_fl.get('typing'), 'focus': (rec_fl.get('focus') or {}).get('pass'), 'charts': detail}


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(q * len(xs)))] if q < 1 else xs[-1]


def ticker_class(sym, planned: set, reused: set, first: set):
    """Which TICKERS row a switch counts in (2026-11-28, #3014 review): 'never-used' / 'reused' ONLY for the FIRST switch
    to one of the pass's planned tickers (freshTickers.list + typed); every other switch that names a symbol (the board's
    fixed start symbol, a tab revisit, the 2nd.. timeframe press on one ticker, a record with no plan) is
    'revisit/fixed': it is not a cold ticker, whatever the ledger says. None for a switch that names no symbol."""
    if not sym:
        return None
    s = str(sym).upper()
    if s not in planned or s in first:
        return 'revisit/fixed'
    first.add(s)
    return 'reused' if s in reused else 'never-used'


def board_of(name: str) -> str:
    """COV-<zoom>-<board>-<pattern> -> '<zoom> <board>' (arrows and typed together); the others by their own name."""
    m = re.match(r'COV-(def|zo)-([^-]+)-(arrows|typed)$', name)
    if m:
        return f'{m.group(1)} {m.group(2)}'
    m = re.match(r'COV-(def|zo)-tabs$', name)
    if m:
        return f'{m.group(1)} tabs'
    return name.replace('COV-', '')


def grade_dir(d: str, opts: dict, root: str = '.') -> dict:
    names = sorted(os.path.basename(p)[:-len('.jump.json')] for p in glob.glob(os.path.join(d, '*.jump.json')))
    passes, problems = [], []
    for n in names:
        if not os.path.exists(os.path.join(d, n + '.json')):
            continue
        try:
            rec, raw = load_pass(d, n)
        except (OSError, ValueError) as e:
            problems.append(f'{n}: unreadable ({e})')
            continue
        passes.append((n, rec, raw, chart_tfs(rec, root)))
    exp = expectations(passes, opts)
    results, by, labels = [], {}, {}
    for n, rec, raw, tfs in passes:
        ft = rec.get('freshTickers') or {}
        planned = {str(x).upper() for x in (ft.get('list') or []) + (ft.get('typed') or [])}
        reused = {str(x).upper() for x in (ft.get('reused') or [])}
        first = set()
        for p in sorted(raw, key=lambda q: q.get('key') or 0):
            r = grade_switch(p, rec, tfs, exp)
            r['pass'] = n
            r['tickers'] = ticker_class(r.get('sym'), planned, reused, first)
            results.append(r)
        for k in ('labels', 'labelsEnd'):
            lb = rec.get(k) or {}
            for f in ('runner', 'cpu', 'cores', 'chrome', 'colo', 'apiCommit', 'webBuild', 'isolate', 'os'):
                if lb.get(f) is not None:
                    labels.setdefault(f, set()).add(str(lb[f]))
        if rec.get('inconclusive'):
            problems.append(f"{n}: INCONCLUSIVE ({str(rec.get('error') or '')[:160]})")
    # every pass record, even one without a jump file (a pass stopped before its first switch)
    for p in glob.glob(os.path.join(d, 'COV-*.json')):
        n = os.path.basename(p)[:-5]
        if '.' in n or n in names:
            continue
        try:
            rec = json.load(open(p, encoding='utf-8'))
            problems.append(f"{n}: no switches recorded{(' (' + str(rec.get('error') or '')[:160] + ')') if rec.get('error') else ''}")
        except (OSError, ValueError):
            problems.append(f'{n}: unreadable')
    for r in results:
        tk = [] if r.get('tickers') is None else ['TICKERS ' + r['tickers']]
        for key in (r['pass'], 'BOARD ' + board_of(r['pass']), *tk):
            g = by.setdefault(key, {'n': 0, 'fail': 0, 'flags': {}, 'full': [], 'warm': {}, 'focusFail': 0})
            g['n'] += 1
            g['fail'] += 1 if r['flags'] else 0
            for fl in r['flags']:
                g['flags'][fl] = g['flags'].get(fl, 0) + 1
            if r.get('full') is not None:
                g['full'].append(r['full'])
            if r.get('warm'):
                g['warm'][r['warm']] = g['warm'].get(r['warm'], 0) + 1
            if r.get('focus') is False:
                g['focusFail'] += 1
    # the lane runner's per-pass record: wall time of the sweep, exit codes, a deploy that landed mid-pass
    hs = []
    for p in glob.glob(os.path.join(d, '*.health.json')):
        try:
            hs.append(json.load(open(p, encoding='utf-8')))
        except (OSError, ValueError):
            pass
    run = None
    if hs:
        t0 = min(h['before']['at'] for h in hs if (h.get('before') or {}).get('at'))
        t1 = max(h['after']['at'] for h in hs if (h.get('after') or {}).get('at'))
        wall = (datetime.fromisoformat(t1) - datetime.fromisoformat(t0)).total_seconds()
        run = {'from': t0, 'to': t1, 'wallSeconds': round(wall), 'passSeconds': sorted(h.get('seconds') for h in hs),
               'exits': {str(k): sum(1 for h in hs if h.get('exit') == k) for k in sorted({h.get('exit') for h in hs}, key=str)},
               'sessions': sorted({h.get('session') for h in hs}), 'deployDuring': sorted(h['pass'] for h in hs if h.get('deployDuring'))}
        for h in hs:
            if h.get('exit') not in (0, None):
                problems.append(f"{h['pass']}: exit {h.get('exit')}")
    rows = {k: {'switches': g['n'], 'failed': g['fail'], 'flags': g['flags'], 'p50': pct(g['full'], 0.5), 'p100': pct(g['full'], 1),
                'warm': g['warm'], 'focusFail': g['focusFail']} for k, g in by.items()}
    return {'dir': d, 'run': run, 'passes': len(passes), 'switches': len(results), 'failedSwitches': sum(1 for r in results if r['flags']),
            'expect': exp, 'labels': {k: sorted(v) for k, v in labels.items()}, 'rows': rows, 'problems': problems, 'results': results}


def table(g: dict, cmp: dict | None = None, title: str = 'sweep') -> str:
    lb = g['labels']
    out = [f"### {title}: {g['passes']} passes, {g['switches']} switches, {g['failedSwitches']} failed",
           '',
           f"runner {', '.join(lb.get('runner', ['?']))} | CPU {', '.join(lb.get('cpu', ['?']))} x{', '.join(lb.get('cores', ['?']))} | "
           f"Chrome {', '.join(lb.get('chrome', ['?']))} | Cloudflare colo {', '.join(lb.get('colo', ['?']))} | "
           f"production api {', '.join(lb.get('apiCommit', ['?']))} web {', '.join(lb.get('webBuild', ['?']))} | isolation {', '.join(lb.get('isolate', ['account (PC rig)']))}",
           '',
           f"STALE judged against: day {g['expect']['day']} ({g['expect']['dayHow']}), intraday {g['expect']['intradayHow']}",
           '']
    if g.get('run'):
        r = g['run']
        out[2:2] = [f"wall {r['wallSeconds']} s ({r['from']} to {r['to']}), {len(r['passSeconds'])} passes of {r['passSeconds'][0]}-{r['passSeconds'][-1]} s; "
                    f"exits {r['exits']}; session {', '.join(map(str, r['sessions']))}"
                    + (f"; A DEPLOY LANDED DURING {', '.join(r['deployDuring'])}" if r['deployDuring'] else ''), '']
    head = '| board / pass | switches | FAILED | ' + ' | '.join(ORDER) + ' | full p50 | full p100 |' + (' PC p50 | PC p100 | PC FAILED |' if cmp else '')
    out += [head, '|' + '---|' * (len(ORDER) + 5 + (3 if cmp else 0))]
    keys = sorted(g['rows'], key=lambda k: (0 if k.startswith('TICKERS ') else 1 if k.startswith('BOARD ') else 2, k))
    for k in keys:
        r = g['rows'][k]
        line = f"| {k} | {r['switches']} | {r['failed']} | " + ' | '.join(str(r['flags'].get(o, 0)) for o in ORDER) + f" | {r['p50']} | {r['p100']} |"
        if cmp:
            c = cmp['rows'].get(k)
            line += f" {c['p50'] if c else '-'} | {c['p100'] if c else '-'} | {c['failed'] if c else '-'} |"
        out.append(line)
    if g['problems']:
        out += ['', 'Problems:'] + [f'- {p}' for p in g['problems']]
    return '\n'.join(out)


def self_check() -> None:
    """Synthetic switches the rules must tell apart: a clean one-paint switch, a late one, and a switch whose chart
    rescales after its first paint. A grader that passed (or failed) all three would hold nothing."""
    def fr(t, sym, close, ni=999, lr=(899, 999), y0=100.0):
        return {'t': t, 'c': {'flip-chart': {'hs': sym, 'lr': list(lr), 'nb': ['2026-11-27', close], 'ni': ni, 'y0': y0, 'y1': y0 - 3, 'r': [0, 0, 400, 300]}}}
    exp = {'day': '2026-11-27', 'week': '2026-11-23', 'month': '2026-11-01', 'intraday': {}, 'dayHow': 'given', 'intradayHow': 'given'}
    tfs = {'flip-chart': 'D'}
    clean = {'i': 0, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1012, 'BBB', 20), fr(1029, 'BBB', 20)]}
    late = {'i': 1, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1080, 'BBB', 20)]}
    jumpy = {'i': 2, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1012, 'BBB', 20), fr(1029, 'BBB', 20, y0=150.0)]}
    old = {'i': 3, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), {'t': 1012, 'c': {'flip-chart': {**fr(1012, 'BBB', 20)['c']['flip-chart'], 'nb': ['2026-11-20', 20]}}}]}
    # the old chart's own price ticking before the late switch (a tick, not a paint), and the mirror the rule must keep: the
    # new bars under the late header (same rows and view, but the close is the target's): WRONG_CHART
    tick = {'i': 4, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1012, 'AAA', 11), fr(1080, 'BBB', 20, ni=500, lr=(400, 500))]}
    lag = {'i': 5, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1012, 'AAA', 20), fr(1029, 'BBB', 20)]}
    # ...and a frame whose view moved is never a tick, whatever its close (the new bars framed under the late header)
    moved = {'i': 6, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), fr(1012, 'AAA', 15, lr=(500, 999)), fr(1029, 'BBB', 20, lr=(500, 999))]}
    # no frame before the key: the first sampled frame still shows the old symbol (the base), the new one paints late
    nopre = {'i': 7, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(1012, 'AAA', 10, ni=349, lr=(-438, 352)), fr(1080, 'BBB', 20)]}
    # a prefix pair (old AAPL, target AA): both rules still apply (the header's first word is compared exactly)
    pnopre = {'i': 8, 'dir': 'ArrowDown', 'sym': 'AA', 'key': 1000, 'frames': [fr(1012, 'AAPL', 10, ni=349, lr=(-438, 352)), fr(1080, 'AA', 20)]}
    ptick = {'i': 9, 'dir': 'ArrowDown', 'sym': 'AA', 'key': 1000, 'frames': [fr(990, 'AAPL', 10), fr(1012, 'AAPL', 11), fr(1080, 'AA', 20, ni=500, lr=(400, 500))]}
    g = [grade_switch(p, {'flips': []}, tfs, exp) for p in (clean, late, jumpy, old, tick, lag, moved, nopre, pnopre, ptick)]
    assert 'SHORT_PAINT' not in g[8]['flags'] and g[8]['full'] == 80, g[8]
    assert g[9]['full'] == 80 and not g[9]['charts']['flip-chart']['wrong'], g[9]
    # (review of #2990) the WRONG_CHART rule names symbols exactly too, in both directions: the new AA header over the old
    # AAPL candles, and the old AAPL header over the new AA candles
    newhdr = {'i': 12, 'dir': 'ArrowDown', 'sym': 'AA', 'key': 1000, 'frames': [fr(990, 'AAPL', 10), fr(1012, 'AA', 10), fr(1080, 'AA', 20, ni=500, lr=(400, 500))]}
    oldhdr = {'i': 13, 'dir': 'ArrowDown', 'sym': 'AA', 'key': 1000, 'frames': [fr(990, 'AAPL', 10), fr(1012, 'AAPL', 20), fr(1029, 'AA', 20)]}
    gn, go = (grade_switch(x, {'flips': []}, tfs, exp) for x in (newhdr, oldhdr))
    assert 'WRONG_CHART' in gn['flags'] and gn['charts']['flip-chart']['wrong'][0]['kind'] == 'new-header-over-old-candles', gn
    assert 'WRONG_CHART' in go['flags'] and go['charts']['flip-chart']['wrong'][0]['kind'] == 'old-header-over-new-candles', go
    assert g[7]['flags'] == ['OVER_30MS'] and g[7]['full'] == 80, g[7]
    assert 'WRONG_CHART' in g[6]['flags'] and g[6]['charts']['flip-chart']['shown'] == 12, g[6]
    assert g[4]['flags'] == ['OVER_30MS'] and g[4]['full'] == 80 and not g[4]['charts']['flip-chart']['wrong'], g[4]
    assert 'WRONG_CHART' in g[5]['flags'] and g[5]['full'] == 12, g[5]
    assert g[0]['flags'] == [] and g[0]['full'] == 12, g[0]
    assert g[1]['flags'] == ['OVER_30MS'] and g[1]['full'] == 80, g[1]
    assert 'VISIBLE_CHANGE' in g[2]['flags'] and g[2]['full'] == 29, g[2]
    assert g[3]['flags'] == ['STALE'], g[3]
    # (F6/F8) timeframe presses: the old 1m chart (and a tick on it) is not the 5m paint; a frame back at 1m after the 5m paint
    # is a wrong chart; a press that never paints its timeframe is one too
    def tfr(t, close, sp, ni=999):
        f = fr(t, 'AAA', close, ni=ni)
        f['c']['flip-chart'].update({'nb': [1795784340, close], 'sp': sp})
        return f
    tfok = {'i': 20, 'dir': 'tf', 'tf': '5', 'sym': 'AAA', 'key': 1000, 'frames': [tfr(1015, 10, 60), tfr(1030, 11, 60), tfr(1272, 10, 300, ni=600)]}
    tfback = {'i': 21, 'dir': 'tf', 'tf': '5', 'sym': 'AAA', 'key': 1000, 'frames': [tfr(1015, 10, 60), tfr(1029, 10, 300, ni=600), tfr(1050, 10, 60)]}
    tfnever = {'i': 22, 'dir': 'tf', 'tf': '5', 'sym': 'AAA', 'key': 1000, 'frames': [tfr(1015, 10, 60), tfr(1030, 11, 60)]}
    tg = [grade_switch(x, {'flips': []}, tfs, {**exp, 'intraday': {'5': 0, '1': 0}}) for x in (tfok, tfback, tfnever)]
    assert tg[0]['charts']['flip-chart']['shown'] == 272 and 'WRONG_CHART' not in tg[0]['flags'] and 'VISIBLE_CHANGE' not in tg[0]['flags'], tg[0]
    assert 'WRONG_CHART' in tg[1]['flags'] and tg[1]['charts']['flip-chart']['wrong'][0]['kind'] == 'other-tf-after-the-press-painted', tg[1]
    assert 'WRONG_CHART' in tg[2]['flags'], tg[2]
    assert tf_paints('240', 14400) and not tf_paints('240', 3600) and tf_paints('M', 30 * 86400) and tf_paints('5', None) is None
    # (F7) STALE on a timeframe press is judged at its own timeframe
    e7 = expectations([('x', {}, [{'dir': 'tf', 'tf': '45', 'frames': [{'c': {'flip-chart': {'nb': [5000, 1]}}}]}], {'flip-chart': 'D'})], {})
    assert '45' in e7['intraday'], e7
    # BLANK: the chart had bars, then a frame after the key shows none (both under the old header and at the target)
    def bl(t, sym):
        f = fr(t, sym, 0)
        f['c']['flip-chart']['nb'] = None
        return f
    blank1 = {'i': 30, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), bl(1012, 'AAA'), fr(1029, 'BBB', 20)]}
    blank2 = {'i': 31, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [fr(990, 'AAA', 10), bl(1012, 'BBB'), bl(1180, 'BBB'), fr(1260, 'BBB', 20)]}
    nobars = {'i': 32, 'dir': 'ArrowDown', 'sym': 'BBB', 'key': 1000, 'frames': [bl(990, 'AAA'), fr(1012, 'BBB', 20)]}
    gb = [grade_switch(x, {'flips': []}, tfs, exp) for x in (blank1, blank2, nobars)]
    assert 'BLANK' in gb[0]['flags'] and 'BLANK' in gb[1]['flags'], gb[:2]
    assert 'BLANK' not in gb[2]['flags'], gb[2]   # a chart that never had bars before the key is the first paint's case
    assert 'BLANK' not in g[0]['flags']
    assert pct([5, 1, 9, 3], 0.5) == 5 and pct([5, 1, 9, 3], 1) == 9 and pct([], 1) is None
    assert board_of('COV-zo-m5h1-typed') == 'zo m5h1' and board_of('COV-def-tabs') == 'def tabs' and board_of('COV-MEM50') == 'MEM50'
    # the ticker rows: only the FIRST switch to a PLANNED ticker is never-used / reused; a second switch to it, an
    # unplanned symbol (the board's SPY) and a record with no plan count as revisit/fixed
    fs = set()
    assert [ticker_class(x, {'AAA', 'BBB'}, {'BBB'}, fs) for x in ('AAA', 'BBB', 'AAA', 'SPY', None)] == ['never-used', 'reused', 'revisit/fixed', 'revisit/fixed', None]
    assert ticker_class('AAA', set(), set(), set()) == 'revisit/fixed'
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        again = {**late, 'i': 9, 'key': 5000, 'frames': [{**f, 't': f['t'] + 4000} for f in late['frames']]}
        for name, sws, ftk in (('COV-def-dd-arrows', [clean], {'list': ['BBB'], 'reused': ['BBB']}),
                               ('COV-def-dd-typed', [late, again], {'list': ['BBB'], 'reused': []}),
                               ('COV-def-dd-old', [late], {})):
            json.dump({'flips': [], 'freshTickers': ftk, 'tf': 'D'}, open(os.path.join(td, name + '.json'), 'w'))
            json.dump(sws, open(os.path.join(td, name + '.jump.json'), 'w'))
        gd = grade_dir(td, {'expect-day': '2026-11-27'})
        ru, nu, rv = (gd['rows'].get('TICKERS ' + k) for k in ('reused', 'never-used', 'revisit/fixed'))
        assert ru and nu and rv and ru['switches'] == 1 and ru['p100'] == 12 and nu['switches'] == 1 and rv['switches'] == 2, gd['rows']
        assert table(gd).index('TICKERS never-used') < table(gd).index('BOARD def dd'), 'the ticker split is not at the top of the table'
    print('grade self-check: ok (reused / never-used split; clean / late / visible change / stale / old-chart tick / late header / no pre-key frame / prefix pair / timeframe presses told apart)')


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    flags = {a for a in sys.argv[1:] if a.startswith('--') and '=' not in a}
    if '--self-check' in flags:
        self_check()
        return 0
    if not args:
        print(__doc__)
        return 1
    d = args[0]
    pos = sys.argv[1:]
    cmp_dir = pos[pos.index('--compare') + 1] if '--compare' in pos else opts.get('compare')
    md = pos[pos.index('--md') + 1] if '--md' in pos else opts.get('md')
    g = grade_dir(d, opts)
    c = grade_dir(cmp_dir, opts) if cmp_dir else None
    text = table(g, c, 'cloud sweep' if cmp_dir else 'sweep')
    if c:
        text += '\n\n' + table(c, None, f'compared: {cmp_dir}')
    print(text)
    json.dump(g['results'], open(os.path.join(d, 'grade.json'), 'w', encoding='utf-8'), indent=1, default=str)
    json.dump({k: v for k, v in g.items() if k != 'results'}, open(os.path.join(d, 'summary.json'), 'w', encoding='utf-8'), indent=1, default=str)
    if md:
        open(md, 'w', encoding='utf-8').write(text + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
