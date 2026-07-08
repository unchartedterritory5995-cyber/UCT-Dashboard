"""
Predictive hypothesis sheet — for each watchlist ticker, based on BBS data,
predict what LiveMassive should have surfaced and (if a gap is expected) which
of the six failure modes it likely falls into.

Falsification target: after the 7/7 comparison analysis runs against raw OPRA
and LiveMassive uncurated/curated, we check whether each ticker landed where
this sheet predicted it would.

Categories used:
  MATCH        BBS ticker-level direction matches watchlist side
  CONTRA       BBS says opposite direction → not a Massive bug if missing
  MIXED        50/50 flow → ambiguous

Verdict codes (in priority order):
  LEGIT_BBS_DISAGREES     BBS ticker direction contradicts WL side; miss is expected
  BELOW_FLOOR             Top contract premium < tier floor even before fragmentation
  V_OI_WEAK               V/OI < 1.0 on top contract → correctly filtered by V/OI gate
  LIKELY_CAPTURE          Clean signal, should have surfaced; if missing → real gap
  FRAGMENT_RISK           High row-count with mean premium below rescue thresholds
  SWEEP_SIDE_RISK         >70% SWEEP volume + known 69% empty-Side rate on Massive
  ROLLUP_RESCUE           Individual events below floor but total ≥ floor and V/OI OK
  MARGINAL                Everything else — hard to predict

Six failure modes (from NEXT_SESSION_PREP.md, mapped from verdicts):
  1. Worker downtime           needs timestamp cross-check, not predictable from BBS alone
  2. Q pool coverage miss      not predictable from BBS alone
  3. SWEEP Side derivation     ← SWEEP_SIDE_RISK
  4. Aggregation fragmenting   ← FRAGMENT_RISK
  5. Aggregation splitting     ← ROLLUP_RESCUE  (should now be fixed post-deploy)
  6. BBS/Massive Side disagr.  ← LEGIT_BBS_DISAGREES
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


BULL_WL = ['SNDK','METC','MRVL','BE','CAT','NFLX','TPC','ORCL','CRWD','DIS',
           'ARM','NVDA','BABA','MSFT','MU','AMD','AMAT','VRT','ISRG','WEN']
BEAR_WL = ['HPE','AAPL','AMAT','CVNA','NVDA','MU','BE','VRTX','MRVL','SNDK',
           'HOOD','CRDO','DELL','ORCL','PLTR','NET','META']


def tier_floor(mktcap: int, is_etf: bool = False) -> int:
    """Approximate Alpha Gold tier floor for a ticker by market cap band."""
    if is_etf:
        return 5_000_000  # ETF Alpha floor
    if mktcap >= 200_000_000_000:
        return 1_000_000  # mega
    if mktcap >= 10_000_000_000:
        return 750_000    # large
    return 500_000        # mid/small


def money_pct(cp: str, strike: float, spot: float):
    if not spot or spot <= 0 or strike <= 0:
        return None
    raw = (spot - strike) / strike * 100
    return raw if cp == 'CALL' else -raw


def _empty_contract():
    return {
        'prem': 0, 'vol': 0, 'oi': 0,
        'sweep_prem': 0, 'block_prem': 0,
        'sweep_count': 0, 'block_count': 0,
        'ask_prem': 0, 'bid_prem': 0, 'empty_prem': 0,
        'row_count': 0, 'spot': 0, 'mktcap': 0, 'stock_etf': '',
    }


def _empty_ticker():
    return {
        'call_prem': 0, 'put_prem': 0,
        'bull_prem': 0, 'bear_prem': 0,
        'mktcap': 0, 'spot': 0, 'is_etf': False,
    }


def load_bbs(path: str):
    by_contract = defaultdict(_empty_contract)
    by_ticker = defaultdict(_empty_ticker)
    with open(path) as f:
        for r in csv.DictReader(f):
            if r['Type'] == 'ML/':
                continue
            try:
                prem = int(r['Premium']) if r['Premium'] else 0
                if prem <= 0:
                    continue
                vol = int(r['Volume']) if r['Volume'] else 0
                oi = int(r['OI']) if r.get('OI') else 0
                strike = float(r['Strike']) if r['Strike'] else 0
                spot = float(r['Spot']) if r['Spot'] else 0
                mktcap = int(r['MktCap']) if r['MktCap'] else 0
                sym, cp, side, typ = r['Symbol'], r['CallPut'], r['Side'] or '', r['Type']
                is_etf = (r.get('StockEtf') or '').upper() == 'ETF'

                t = by_ticker[sym]
                t['spot'] = max(t['spot'], spot)
                t['mktcap'] = max(t['mktcap'], mktcap)
                t['is_etf'] = t['is_etf'] or is_etf
                if cp == 'CALL':
                    t['call_prem'] += prem
                    if side in ('A', 'AA'): t['bull_prem'] += prem
                    elif side in ('B', 'BB'): t['bear_prem'] += prem
                else:
                    t['put_prem'] += prem
                    if side in ('A', 'AA'): t['bear_prem'] += prem
                    elif side in ('B', 'BB'): t['bull_prem'] += prem

                k = (sym, cp, strike, r['ExpirationDate'])
                c = by_contract[k]
                c['prem'] += prem
                c['vol'] += vol
                c['oi'] = max(c['oi'], oi)
                c['row_count'] += 1
                c['spot'] = max(c['spot'], spot)
                c['mktcap'] = max(c['mktcap'], mktcap)
                c['stock_etf'] = r.get('StockEtf') or c['stock_etf']
                if typ == 'SWEEP':
                    c['sweep_prem'] += prem
                    c['sweep_count'] += 1
                elif typ == 'BLOCK':
                    c['block_prem'] += prem
                    c['block_count'] += 1
                if side in ('A', 'AA'): c['ask_prem'] += prem
                elif side in ('B', 'BB'): c['bid_prem'] += prem
                else: c['empty_prem'] += prem
            except (ValueError, TypeError):
                pass
    return by_ticker, by_contract


def find_best_aligned_contract(sym, wl_side, by_contract, spot):
    """Return the top-premium aligned near-ATM contract, preferring V/OI ≥ 1.0.

    Two-pass: first among V/OI ≥ 1.0 (would-qualify) contracts, then fall back
    to raw top-premium. This prevents LEAPS with 0.3x V/OI from drowning out
    real near-dated conviction signals like MSFT $390 C 7/13 (case study).
    """
    qualifiers, all_aligned = [], []
    for (s, cp, strike, exp), c in by_contract.items():
        if s != sym:
            continue
        mp = money_pct(cp, strike, spot)
        if mp is None or abs(mp) > 20:
            continue
        ask_pct = c['ask_prem'] / max(c['prem'], 1) * 100
        # bull-aligned = calls at ask OR puts at bid; bear = puts at ask OR calls at bid
        if wl_side == 'bull':
            aligned = (cp == 'CALL' and ask_pct >= 60) or (cp == 'PUT' and ask_pct <= 40)
        else:
            aligned = (cp == 'PUT' and ask_pct >= 60) or (cp == 'CALL' and ask_pct <= 40)
        if not aligned or c['prem'] < 100_000:
            continue
        entry = ((s, cp, strike, exp, mp), c)
        all_aligned.append(entry)
        voi = c['vol'] / max(c['oi'], 1) if c['oi'] > 0 else 999
        if voi >= 1.0:
            qualifiers.append(entry)

    pool = qualifiers if qualifiers else all_aligned
    if not pool:
        return None, None
    pool.sort(key=lambda e: -e[1]['prem'])
    top = pool[0]
    runner_up = None
    # If top is V/OI-weak (fallback pool) but there's a V/OI-strong runner-up
    # elsewhere in all_aligned, surface it as a warning.
    if not qualifiers and len(all_aligned) > 1:
        # No qualifiers at all — top is best available, no runner-up needed
        pass
    return top, runner_up


def classify(sym, wl_side, by_ticker, by_contract):
    """Return dict with verdict, match, top_contract, failure_mode_hint."""
    t = by_ticker[sym]
    if t['call_prem'] + t['put_prem'] == 0:
        return {'ticker': sym, 'verdict': 'NO_FLOW', 'match': None,
                'contract': None, 'failure_mode': None}

    bbs_dir = 'BULL' if t['bull_prem'] > t['bear_prem'] else \
              ('BEAR' if t['bear_prem'] > t['bull_prem'] else 'MIXED')
    match = 'MATCH' if bbs_dir == wl_side.upper() else \
            ('CONTRA' if bbs_dir != 'MIXED' else 'MIXED')

    best, _runner_up = find_best_aligned_contract(sym, wl_side, by_contract, t['spot'])
    floor = tier_floor(t['mktcap'], t['is_etf'])

    if best is None:
        if match == 'CONTRA':
            return {'ticker': sym, 'verdict': 'LEGIT_BBS_DISAGREES', 'match': match,
                    'contract': None, 'failure_mode': 'mode_6_bbs_disagreement',
                    'bbs_dir': bbs_dir, 'floor': floor}
        return {'ticker': sym, 'verdict': 'NO_ATM_ALIGNED', 'match': match,
                'contract': None, 'failure_mode': None,
                'bbs_dir': bbs_dir, 'floor': floor}

    (s, cp, strike, exp, mp), c = best
    voi = c['vol'] / max(c['oi'], 1) if c['oi'] > 0 else 999
    ask_pct = c['ask_prem'] / max(c['prem'], 1) * 100
    sw_pct = c['sweep_prem'] / max(c['prem'], 1) * 100
    row_count = c['row_count']
    prem = c['prem']

    contract_info = {
        'cp': cp, 'strike': strike, 'exp': exp, 'money_pct': round(mp, 1),
        'prem': prem, 'v_oi': round(voi, 2), 'ask_pct': round(ask_pct, 0),
        'sweep_pct': round(sw_pct, 0), 'row_count': row_count,
        'oi': c['oi'], 'vol': c['vol'],
    }

    # Priority-ordered verdict logic
    if match == 'CONTRA' and t['bear_prem'] and t['bull_prem'] and \
       max(t['bear_prem'], t['bull_prem']) / (t['bear_prem'] + t['bull_prem']) > 0.65:
        # Strong opposite signal at ticker level
        verdict, fm = 'LEGIT_BBS_DISAGREES', 'mode_6_bbs_disagreement'
    elif prem < floor and row_count >= 5 and prem * row_count / max(prem, 1) < 3:
        # Fragmented and low total (unlikely to hit rollup either)
        verdict, fm = 'BELOW_FLOOR', 'below_floor_no_rescue'
    elif prem < floor:
        # Single big-ish contract but below floor — possible fragmentation
        # producing sub-floor events; check daily rollup
        if row_count >= 3:
            verdict, fm = 'ROLLUP_RESCUE', 'mode_5_rollup_should_help'
        else:
            verdict, fm = 'BELOW_FLOOR', 'below_floor_no_rescue'
    elif voi < 1.0 and c['oi'] > 100:
        verdict, fm = 'V_OI_WEAK', 'v_oi_correctly_filtered'
    elif prem >= floor and voi >= 3 and row_count <= 3 and sw_pct < 50:
        verdict, fm = 'LIKELY_CAPTURE', None
    elif sw_pct >= 70 and row_count <= 5:
        verdict, fm = 'SWEEP_SIDE_RISK', 'mode_3_sweep_side_derivation'
    elif row_count >= 10 and prem / row_count < 200_000:
        verdict, fm = 'FRAGMENT_RISK', 'mode_4_aggregation_fragmenting'
    elif row_count >= 3 and prem / row_count < 500_000:
        verdict, fm = 'ROLLUP_RESCUE', 'mode_5_rollup_should_help'
    else:
        verdict, fm = 'MARGINAL', 'requires_case_by_case'

    return {'ticker': sym, 'verdict': verdict, 'match': match,
            'contract': contract_info, 'failure_mode': fm,
            'bbs_dir': bbs_dir, 'floor': floor,
            'ticker_total': t['call_prem'] + t['put_prem']}


def print_sheet(watchlist, wl_side, by_ticker, by_contract):
    results = [classify(sym, wl_side, by_ticker, by_contract) for sym in watchlist]

    print(f"\n{'='*118}")
    print(f"{wl_side.upper()} WATCHLIST — {len(watchlist)} tickers")
    print(f"{'='*118}")
    hdr = f"{'Sym':<6} {'BBS':<5} {'Contract':<22} {'Prem':>8} {'V/OI':>7} {'ASK%':>5} " \
          f"{'Sw%':>5} {'Rows':>5} {'Floor':>7} {'Verdict':<22}"
    print(hdr)
    print('-' * 118)
    for r in results:
        if r['verdict'] == 'NO_FLOW':
            print(f"{r['ticker']:<6} NO FLOW")
            continue
        c = r.get('contract')
        if not c:
            print(f"{r['ticker']:<6} {r.get('bbs_dir',''):<5} "
                  f"{'(no aligned ATM)':<22} {'—':>8} {'—':>7} {'—':>5} "
                  f"{'—':>5} {'—':>5} ${r.get('floor',0)/1e6:>5.1f}M {r['verdict']:<22}")
            continue
        contract_str = f"{c['cp'][0]} ${c['strike']:g} {c['exp'][:8]}"
        print(f"{r['ticker']:<6} {r['bbs_dir']:<5} {contract_str:<22} "
              f"${c['prem']/1e6:>6.2f}M {c['v_oi']:>6.1f}x {c['ask_pct']:>4.0f}% "
              f"{c['sweep_pct']:>4.0f}% {c['row_count']:>5d} ${r['floor']/1e6:>5.1f}M "
              f"{r['verdict']:<22}")

    # Buckets summary
    from collections import Counter
    verdicts = Counter(r['verdict'] for r in results)
    print(f"\nVerdict distribution: {dict(verdicts.most_common())}")

    return results


def print_investigation_plan(all_results):
    """Group tickers by verdict, present prioritized action list."""
    by_verdict = defaultdict(list)
    for wl_side, results in all_results:
        for r in results:
            by_verdict[r['verdict']].append((r, wl_side))

    print(f"\n{'='*118}")
    print("PRIORITIZED INVESTIGATION PLAN FOR 7/7 MORNING")
    print(f"{'='*118}")

    ordered = [
        ('LIKELY_CAPTURE',
         'HIGHEST PRIORITY: predicted to be captured. If missing → real gap, check downtime + Q pool.'),
        ('ROLLUP_RESCUE',
         'HIGH: rollup fix should now catch these. If still missing → fix incomplete.'),
        ('FRAGMENT_RISK',
         'HIGH: aggregation-fragmenting (mode 4). Check uncurated for many sub-floor events.'),
        ('SWEEP_SIDE_RISK',
         'MEDIUM: known SWEEP Side gap (mode 3). Confirm empty-Side pattern; deferred fix.'),
        ('V_OI_WEAK',
         'LOW: correctly filtered by V/OI gate. Skip unless investigating false negatives.'),
        ('BELOW_FLOOR',
         'LOW: below tier floor legitimately. Skip.'),
        ('LEGIT_BBS_DISAGREES',
         'SKIP: BBS Side contradicts watchlist. Not a Massive bug.'),
        ('MARGINAL',
         'CASE-BY-CASE: mixed signal, check individually.'),
        ('NO_ATM_ALIGNED',
         'CASE-BY-CASE: no aligned ATM contract, may still have OTM flow.'),
        ('NO_FLOW',
         'SKIP: no BBS activity on this ticker.'),
    ]
    for verdict, note in ordered:
        items = by_verdict.get(verdict, [])
        if not items:
            continue
        print(f"\n[{verdict}] {note}")
        for r, wl_side in items:
            c = r.get('contract')
            if c:
                print(f"  {r['ticker']} ({wl_side}): {c['cp'][0]} ${c['strike']:g} {c['exp'][:8]} "
                      f"${c['prem']/1e6:.2f}M V/OI={c['v_oi']:.1f}x ASK={c['ask_pct']:.0f}% "
                      f"SW={c['sweep_pct']:.0f}% rows={c['row_count']}")
            else:
                print(f"  {r['ticker']} ({wl_side}): {r.get('bbs_dir','?')} dir, no ATM-aligned contract")


def emit_console_probes(all_results):
    """For LIKELY_CAPTURE + ROLLUP_RESCUE, emit console commands Ravi can paste
    into the browser tomorrow morning after deploy."""
    print(f"\n{'='*118}")
    print("CONSOLE PROBES — paste into uctintelligence.com dev console after deploy")
    print(f"{'='*118}")

    key_tickers = []
    for wl_side, results in all_results:
        for r in results:
            if r['verdict'] in ('LIKELY_CAPTURE', 'ROLLUP_RESCUE', 'FRAGMENT_RISK') and r.get('contract'):
                key_tickers.append((r, wl_side))

    if not key_tickers:
        print("  (no priority tickers)")
        return

    tick_list = list({r['ticker'] for r, _ in key_tickers})
    print("\n// Step 1: ticker-level coverage check (curated)")
    print(f"const CURATED = await fetch('/api/live/massive/curated?limit=5000&date=2026-07-07').then(r=>r.json());")
    print(f"const K = {json.dumps(tick_list)};")
    print("for (const s of K) {")
    print("  const hits = CURATED.alerts.filter(a => a.ticker === s);")
    print("  const dirs = {}; for (const a of hits) dirs[a._direction||'-'] = (dirs[a._direction||'-']||0)+1;")
    print("  console.log(s, 'curated:', hits.length, dirs);")
    print("}")

    print("\n// Step 2: uncurated depth check for anything missing above")
    print("const UNC = await fetch('/api/live/massive/recent?limit=20000&min_grade=C&curated=false').then(r=>r.json());")
    print("for (const s of K) {")
    print("  const hits = UNC.alerts.filter(a => a.ticker === s);")
    print("  const withSide = hits.filter(a => a._side).length;")
    print("  console.log(s, 'uncurated:', hits.length, 'side-classified:', withSide);")
    print("}")

    print("\n// Step 3: contract-level trace for each priority contract")
    for r, wl_side in key_tickers:
        c = r['contract']
        print(f"// {r['ticker']} ({wl_side}) — {r['verdict']} — expected {c['cp'][0]} ${c['strike']:g} {c['exp']} @ ${c['prem']/1e6:.2f}M")
        print(f"console.log('{r['ticker']} {c['cp'][0]} {c['strike']}:',")
        print(f"  UNC.alerts.filter(a => a.ticker==='{r['ticker']}'")
        print(f"    && a.cp==='{c['cp'][0]}'")
        print(f"    && Math.abs(Number(a.strike) - {c['strike']}) < 0.01)")
        print(f"    .map(a => ({{prem: a._premium, side: a._side, type: a._type, ts: a.ts}})));")


def main(bbs_path: str):
    by_ticker, by_contract = load_bbs(bbs_path)
    print(f"Loaded BBS from {bbs_path}: {len(by_ticker)} tickers, {len(by_contract)} contracts")
    bull_results = print_sheet(BULL_WL, 'bull', by_ticker, by_contract)
    bear_results = print_sheet(BEAR_WL, 'bear', by_ticker, by_contract)
    all_results = [('bull', bull_results), ('bear', bear_results)]
    print_investigation_plan(all_results)
    emit_console_probes(all_results)


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'data/BBS_2026-07-07.csv'
    main(path)
