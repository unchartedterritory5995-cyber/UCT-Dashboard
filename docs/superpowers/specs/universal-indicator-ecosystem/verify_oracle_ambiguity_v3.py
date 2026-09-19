"""Local self-check for OWNER_VENDOR_CAPTURE_PACKET_V3.md's oracle script.

⛔⛔⛔ SUPERSEDED 2026-09-05 — see verify_oracle_ambiguity_v3_1.py. This
script's `candLower_formula = max(min(w0,w1), min(w2,w3))` is WRONG in
general: checked only against the one planted ordering below, where it gives
the right answer (3.0) by coincidence of which pairing was chosen. A real
permutation/duplicate/random property test — the kind external review asked
for and this script did not run — finds it wrong on 8/24 distinct
permutations, all 14 tested duplicate cases, and 626/2000 random trials
(~31%). Kept verbatim as the historical record of the mistake, per this
program's own append-only-correction convention; do not copy this formula.

⛔⛔ THIS SCRIPT PROVES NOTHING ABOUT TRADINGVIEW. It reimplements, in plain
Python, the exact candidate-A/candidate-B arithmetic the Pine oracle plots for
each of the four disputed functions, over the exact same planted 25-bar
repeating driver, and asserts each pair produces DIFFERENT numbers at the
probe row (phase == 24). That is the entire claim: the EXPERIMENT
discriminates. Whether TradingView's actual `ta.rising`/`ta.median`/
`ta.percentrank`/`ta.bbw` output matches candidate A, candidate B, or neither
is a question only a real TradingView run can answer — this script cannot
and does not answer it.

Run: python verify_oracle_ambiguity_v3.py
Expected: every DISCRIMINATES line prints True; the script exits 0 via the
asserts if any of the four ever stopped discriminating (e.g. from a future
edit to the planted values).

Candidate derivations, cross-checked against this repo's own prior research
before writing this script (see PHASE_ONE_PLAN.md / OWNER_VENDOR_CAPTURE_PACKET_V3.md
for the full citation trail — commits 968209bfe and 0950cff9f,
closedTable.json::_functions_excluded):

  rising:      candidate A = running-maximum (v5/v6 RETURNS clause)
               candidate B = strict monotone over length+1 samples (v3/v4 DESCRIPTION)
  median:      candidate lower  = the lower of the two middle order statistics
               candidate mean   = the mean of the two middle order statistics
               (computed by explicit min/max/sum arithmetic only — never by
               calling another disputed vendor built-in as the reference)
  percentrank: candidate A = 100 * count(prior L <= current) / L
               candidate B = 100 * (count(prior L <= current) + 1) / (L + 1)
               (candidate B models "the current bar joins the sample," which
               trivially satisfies its own <= current comparison)
  bbw:         candidate ratio   = (2 * mult * stdev) / sma
               candidate percent = candidate ratio * 100
"""

N = 100
raw = [0.0] * N
for i in range(N):
    p = i % 25
    if p == 24:
        raw[i] = 6.0
    elif p == 23:
        raw[i] = 3.0
    elif p == 22:
        raw[i] = 5.0
    elif p == 21:
        raw[i] = 1.0
    elif p == 20:
        raw[i] = 9.0
    else:
        raw[i] = 10.0 + p

# First occurrence of phase==24; raw[5..24] are already fully defined, so the
# 20-bar bbw window needs no second cycle.
i = 24
assert i % 25 == 24
print(f"probe bar i={i}, phase={i % 25}")
print("raw[i-4..i] =", [raw[i - k] for k in range(4, -1, -1)])

cur = raw[i]
b1, b2, b3, b4 = raw[i - 1], raw[i - 2], raw[i - 3], raw[i - 4]
print(f"\ncurrent={cur} b1(1-back)={b1} b2={b2} b3={b3} b4={b4}")

print("\n=== ta.rising(raw,3) candidates ===")
candA_runmax = cur > max(b1, b2, b3)
candB_monotone = (b3 < b2) and (b2 < b1) and (b1 < cur)
print(f"Candidate A (running-max: cur > max(b1,b2,b3)={max(b1,b2,b3)}): {candA_runmax}")
print(f"Candidate B (monotone: b3<b2<b1<cur, i.e. {b3}<{b2}<{b1}<{cur}): {candB_monotone}")
print(f"DISCRIMINATES: {candA_runmax != candB_monotone}")
assert candA_runmax != candB_monotone, "rising candidates no longer discriminate"
assert candA_runmax is True and candB_monotone is False, "rising candidate values drifted from the documented derivation"

print("\n=== ta.median(raw,4) candidates (explicit min/max arithmetic, no vendor-builtin reference) ===")
window4 = sorted([cur, b1, b2, b3])
print(f"window sorted (reference only): {window4}")
w0, w1, w2, w3 = cur, b1, b2, b3
candLower = max(min(w0, w1), min(w2, w3))
sum_all = w0 + w1 + w2 + w3
max_all = max(max(w0, w1), max(w2, w3))
min_all = min(min(w0, w1), min(w2, w3))
candMean = (sum_all - max_all - min_all) / 2
print(f"Candidate lower-middle = max(min({w0},{w1}),min({w2},{w3})) = {candLower}")
print(f"Candidate mean-of-middles = ({sum_all}-{max_all}-{min_all})/2 = {candMean}")
print(f"Cross-check vs sorted-list reference: lower={window4[1] == candLower} mean={((window4[1]+window4[2])/2) == candMean}")
print(f"DISCRIMINATES: {candLower != candMean}")
assert window4[1] == candLower, "median lower-middle arithmetic formula disagrees with the sorted-list reference"
assert (window4[1] + window4[2]) / 2 == candMean, "median mean-of-middles arithmetic formula disagrees with the sorted-list reference"
assert candLower != candMean, "median candidates no longer discriminate"
assert candLower == 3.0 and candMean == 4.0, "median candidate values drifted from the documented derivation"

print("\n=== ta.percentrank(raw,4) candidates ===")
priors4 = [b1, b2, b3, b4]
print(f"priors (close[1..4] equivalent) = {priors4}")
count_le = sum(1 for v in priors4 if v <= cur)
print(f"count of priors <= current({cur}): {count_le}")
candA_overL = 100.0 * count_le / 4
candB_overLplus1 = 100.0 * (count_le + 1) / 5
print(f"Candidate A (/L=4, current bar NOT in the sample): 100*{count_le}/4 = {candA_overL}")
print(f"Candidate B (/(L+1)=5, current bar IN the sample, count+1={count_le+1}): 100*{count_le+1}/5 = {candB_overLplus1}")
print(f"DISCRIMINATES: {candA_overL != candB_overLplus1}")
naive_alt = 100.0 * count_le / 5
print(f"(sanity only, NOT candidate B: same numerator over L+1 = 100*{count_le}/5 = {naive_alt})")
assert candA_overL != candB_overLplus1, "percentrank candidates no longer discriminate"
assert candA_overL == 75.0 and candB_overLplus1 == 80.0, "percentrank candidate values drifted from the documented derivation"
assert naive_alt == 60.0 and naive_alt not in (candA_overL, candB_overLplus1), "the naive same-numerator alternative should be a third, distinct number"

print("\n=== ta.bbw(raw,20,2) candidates ===")
window20 = raw[i - 19:i + 1]
assert len(window20) == 20
print(f"window20 = {window20}")
mean20 = sum(window20) / 20
popvar = sum((x - mean20) ** 2 for x in window20) / 20
popstd = popvar ** 0.5
mult = 2.0
candRatio = (2 * mult * popstd) / mean20
candPercent = candRatio * 100.0
print(f"sma(20)={mean20}  population stdev(20)={popstd}")
print(f"Candidate ratio: (2*{mult}*{popstd})/{mean20} = {candRatio}")
print(f"Candidate percent (x100): {candPercent}")
print(f"DISCRIMINATES (order of magnitude): ratio={candRatio:.6f} vs percent={candPercent:.6f}")
assert abs(candPercent - candRatio * 100.0) < 1e-9, "bbw candidate-percent must be exactly candidate-ratio * 100"
assert candRatio < 10 and candPercent > 100, "bbw candidates should differ by roughly two orders of magnitude"

print("\nALL FOUR ORACLE PROBES CONFIRMED DISCRIMINATING at phase==24. See module docstring for what this does and does not prove.")
