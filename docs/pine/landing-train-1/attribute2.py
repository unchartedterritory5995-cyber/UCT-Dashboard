import json, os, re, collections
S = os.path.dirname(os.path.abspath(__file__))
HELD = os.path.join(os.environ['LOCALAPPDATA'], 'uct-vendor-batch', 'runs')
cap = {}
for root, _, files in os.walk(HELD):
    for f in files:
        if f.endswith('.json'):
            cap.setdefault(f[:-5], os.path.join(root, f))
ROOT = r'C:/Users/Patrick/uct-worktrees/train-1/tests/fixtures/vendor'
for root, _, files in os.walk(ROOT):
    for f in files:
        if f.endswith('.json'):
            cap.setdefault(f[:-5], os.path.join(root, f))
PREFIX = [
    ('vw-ternary-arm-legacy-', 'legacy semantics'),
    ('vw-fn-history-in-if-', 'legacy semantics B3 (v2/v3 CARRY)'),
    ('vw-fn-history-in-tern-', 'legacy semantics B3 (ternary)'),
    ('vw-cs2-bool-na-v1-', 'legacy semantics (v1/v3 bool-na)'),
    ('vw-cs2-bool-na-v3-', 'legacy semantics (v1/v3 bool-na)'),
    ('vw-cs1-bool-na-v2-', 'engine 56-v2 (bool-na v2)'),
    ('vw-cs1-bool-na-v4-', 'engine 56-v2 (bool-na v4)'),
    ('vw-cs1-bool-na-v5-', 'engine 56-v2 (bool-na v5)'),
    ('vw-cs2-rising-falling-na-', 'engine 56-v2 (rising/falling)'),
    ('vw-cs2-array-', 'legacy semantics B7'),
    ('vw-array-na-', 'legacy semantics B7'),
    ('vw-cbc-', 'CBC-FMT'),
    ('vw-wse-calc-bars', 'CBC-FMT'),
    ('vw-cs1-calc-bars', 'CBC-FMT'),
    ('vw-cs2-label-format', 'CBC-FMT'),
    ('vw-cs2-holed-highestbars-', 'engine HL'),
    ('vw-cs2-holed-highest-', 'engine HL'),
    ('vw-cs1-stoch-p2-', 'engine 57'),
    ('vw-cs1-rci-p1-', 'engine 57'),
    ('vw-cs2-stoch-', 'engine 57'),
    ('vw-cs2-highestbars-computed-', 'engine 56-v2 (S10 ties)'),
    ('vw-cs1-ties-', 'engine 56-v2 (S4-2 ties)'),
    ('vw-cs2-ties-', 'engine 56-v2 (S4-2 ties)'),
    ('vw-cs1-transp-', 'colour-reader + #1330 review'),
    ('vw-rt6-runtime-colour-', 'colour-reader + #1330 review'),
    ('vw-ytc-bar46-decompose-', 'legacy semantics B3 (ytc witness)'),
    ('vw-deadband-ticks-', 'CBC-FMT (str.tostring label text)'),
]
NAMED = {
    'trend-targets-algoalpha-rddt-1d-2026-11-15': '#1374 (stamps on the runtime document)',
    'squeeze-momentum-indicator-lazybear-rddt-1d-2026-11-14': 'colour-reader (B4 iff)',
    'bbtrend-rddt-1d-2026-11-14': 'colour-reader (B4 subject-less switch)',
    'aroon-rddt-1d-2026-11-14': 'engine 56-v2 (S4-2 newest tie)',
    'connors-rsi-rddt-1d-2026-11-14': 'engine 56-v2 (A2 percentrank)',
    'rank-correlation-index-rddt-1d-2026-11-14': 'engine 57 (rci)',
    'rci-ribbon-rddt-1d-2026-11-14': 'engine 57 (rci)',
    'rsi-divergence-indicator-rddt-1d-2026-11-14': 'engine 56-v2 (S4-1 pivots)',
    'stochastic-rsi-rddt-1d-2026-11-14': 'engine 57 (stoch S6)',
    'supertrend-0c4115d2-rddt-1d-2026-11-14': 'engine 57 (supertrend)',
    'ytc-swing-highs-lows-rddt-1d-2026-11-14': 'colour-reader + #1330 review',
    'ytc-swing-highs-lows-no-mbb-rddt-1d-2026-11-14': 'colour-reader + #1330 review',
    'dot-dynamics-rddt-1d-2026-11-15': 'colour-reader + #1330 review (S11 D)',
    'flying-buddha-inside-bars-indicator-v1-by-justunclel-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 transp)',
    'fvg-trend-rddt-1d-2026-09-27': 'colour-reader + #1330 review (RT6 runtime colour)',
    'atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03': 'ta.rma summation (train-owned) / engine 57',
    'stoch-k-14-2026-09-06': 'engine 57 (stoch)',
    'moving-average-adx-rddt-1d-2026-11-14': 'ta.rma summation (train-owned)',
    'moving-average-colored-emasma-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1-v3 palette)',
    'simple-moving-averages-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1-v3 palette)',
    'triple-moving-averages-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1-v3 palette)',
    'elliot-wave-oscillator-lazybear-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1 palette)',
    'elliott-wave-oscillator-47b47d10-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 palette)',
    'ichimoku2c-rddt-1d-2026-11-13': 'colour-reader + #1330 review (no-pragma palette)',
    'mamona-candles-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1 plotshape)',
    'pin-bar-indicator-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v2 plotshape)',
    'engulfing-candles-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 plotshape)',
    'doji-signals-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v2 plotshape)',
    'candles-rddt-1d-2026-11-14': 'colour-reader + #1330 review (no-pragma plotshape/plotchar)',
    'rsi-chart-bars-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    'rsi-divergence-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    '4-colour-macd-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    'cci-coded-obv-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    'cog-double-channel-lazybear-rddt-1d-2026-11-14': 'colour-reader + #1330 review',
    'linear-regression-channel-96b3e699-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v2 palette)',
    'accumulationdistribution-volume-adv-ci8dh-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 default 35 + opacity fold)',
    'accdist-macd-rddt-1d-2026-11-14': 'engine 56-v2 (S4-4 float-order floor)',
    'accdist-macd-spy-1d-2026-11-14': 'engine 56-v2 (S4-4 float-order floor)',
    'swing-highs-lows-rddt-1d-2026-11-14': 'engine 56-v2 (S4-1 pivots)',
    'trade-archer-on-balance-volume-moving-averages-v1-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v1-v3 transp default)',
    'tutorial-rsiwings-priceswings-for-find-pyramiding-entries-with-higher-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 colours)',
    'ict-implied-fair-value-gap-ifvg-luxalgo-rddt-1d-2026-11-14': 'legacy semantics B5 (v4 box defaults) + colours',
    'long_tail__09-signal-follow-through-ledger-spy-1d-2026-11-15': 'legacy semantics B7 (array.median)',
    'mid_engagement__20-mann-kendall-trend-significance-rddt-1d-2026-11-15': 'ta.rma summation (train-owned)',
    'mid_engagement__20-mann-kendall-trend-significance-spy-1d-2026-11-15': 'ta.rma summation (train-owned)',
    'one-sided-gaussian-support-resistance-rate-loxx-rddt-1d-2026-11-14': 'engine HL (ta.highest / lowest FINITE)',
    'smart-money-volume-index-algoalpha-rddt-1d-2026-11-14': 'colour-reader + #1330 review',
    'pivot-high-low-points-rddt-1d-2026-11-14': 'engine 56-v2 (S4-2 newest tie)',
    'pivot-high-low-points-spy-1d-2026-11-14': 'engine 56-v2 (S4-2 newest tie)',
    # (filled in from reading each capture's source, 2026-11-16)
    'linear-regression-channel-8b555890-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v6 default transp + str.tostring)',
    'non-repainting-swing-highlow-signals-rddt-1d-2026-11-14': 'engine 56-v2 (S4-1 pivots + colour-reader)',
    'money-flow-index-rddt-1d-2026-11-15': 'colour-reader + #1330 review (S11 A: var colour)',
    'vw-cs2-v6-computed-ties-rddt-1d-2026-11-15': 'engine 56-v2 (S10 ties)',
    'cm-enhanced-ichimoku-cloud-v5-rddt-1d-2026-11-13': 'colour-reader + #1330 review (v1-v3 default transp)',
    'cm-rsi-2-strat-low-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    'cm-stochastic-mtf-rddt-1d-2026-11-13': 'engine 57 (stoch) + colours',
    'cm-stochastic-mtf-spy-1d-2026-11-13': 'engine 57 (stoch) + colours',
    'cm-ultimate-rsi-mtf-rddt-1d-2026-11-13': 'engine 57 (rsi via rma) + colours',
    'cm-ultimate-rsi-mtf-spy-1d-2026-11-13': 'engine 57 (rsi via rma) + colours',
    'rsi-bands-lazybear-rddt-1d-2026-11-13': 'colour-reader (B4 iff)',
    'twiggs-money-flow-lazybear-rddt-1d-2026-11-13': 'colour-reader (B4 iff)',
    'wavetrend-with-crosses-lazybear-rddt-1d-2026-11-13': 'colour-reader + #1330 review',
    'accumulationdistribution-with-markers-rddt-1d-2026-11-14': 'engine 56-v2 (A3 bool-na) + colours',
    'average-true-range-trailing-stops-strategy-by-sylvain-vervoort-rddt-1d-2026-11-14': 'engine 56-v2 (A1 nz) + colour-reader (B4 iff)',
    'bollingers-bands-fibonacci-ratios-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v2 default transp)',
    'cm-donchian-channels-modified-rddt-1d-2026-11-14': 'colour-reader + #1330 review',
    'fibonacci-retracement-lines-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 default transp)',
    'fikira-pivots-fibonacci-retracement-3-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v4 colours + offset invariant)',
    'fikira-pivots-fibonacci-retracement-3-spy-1d-2026-11-14': 'colour-reader + #1330 review (v4 colours + offset invariant)',
    'macd-trend-heatmap-by-chartart-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v2 default transp)',
    'uptrick-volatility-weighted-cloud-rddt-1d-2026-11-14': 'engine 56-v2 (A2 percentrank, bands from bar 100)',
    'uptrick-volume-weighted-bands-rddt-1d-2026-11-14': 'colour-reader (color.new over a rule; W2 colourNewOverRule)',
    'bill-williams-awesome-oscillator-ao-rddt-1d-2026-11-14': 'colour-reader (B4 iff)',
    'on-balance-volume-macd-acceleratorawesome-oscillator-pivdiv-3-rddt-1d-2026-11-14': 'engine 56-v2 (S4-1 pivots, left-na)',
    'quantnomad-pivot-points-alerts-rddt-1d-2026-11-14': 'colour-reader + #1330 review (v3 default transp)',
    'inside-bar-setup-rddt-1d-2026-11-15': 'colour-reader + #1330 review (S11 A: var barcolors)',
}


def attribute(f):
    cid = os.path.basename(f)[:-5]
    for p, lab in PREFIX:
        if cid.startswith(p):
            return lab
    return NAMED.get(cid, 'UNATTRIBUTED (' + cid + ')')


for set_ in ('fix', 'held'):
    for lane in ('0', '1'):
        before = {r['file']: r['verdict'] for r in json.load(open(os.path.join(S, 'before', f'{set_}-{lane}', 'verdicts.json'), encoding='utf-8'))['results']}
        after = {r['file']: r['verdict'] for r in json.load(open(os.path.join(S, 'after', f'{set_}-{lane}', 'verdicts.json'), encoding='utf-8'))['results']}
        moved = [k for k in after if after[k] != before.get(k, after[k])]
        by = collections.Counter()
        unattr = []
        for k in moved:
            lab = attribute(k)
            by[(before.get(k, '-'), after[k], lab)] += 1
            if lab.startswith('UNATTRIBUTED'):
                unattr.append((k, before.get(k, '-'), after[k]))
        print(f'\n=== {set_}-{lane}  total moves {len(moved)}; UNATTRIBUTED {len(unattr)}')
        for (b, a, lab), n in sorted(by.items()):
            print(f'  {n:3d}  {b:12s} -> {a:12s}  {lab}')
        for k, b, a in unattr[:40]:
            print(f'    !! {b:12s} -> {a:12s}  {os.path.basename(k)[:-5]}')
