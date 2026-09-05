"""Local self-check for OWNER_VENDOR_CAPTURE_PACKET_V3_1.md's oracle script.

⛔⛔ SUPERSEDES verify_oracle_ambiguity_v3.py — that script's median-lower-
middle formula (`max(min(w0,w1), min(w2,w3))`) was WRONG in general. It was
checked ONLY against the single planted ordering (6,3,5,1), where it happens
to give the correct answer (3.0) by coincidence of which pairing was chosen.
A full permutation/duplicate/random property test — run for THIS revision,
after external review asked "verify mathematically... including duplicates,"
not "re-check the one case already shown" — found it wrong on 8/24 distinct
permutations, 14/14 tested duplicate cases, and 626/2000 random trials (~31%).
That is exactly the failure shape this whole program's evidence discipline
exists to catch: a formula that passed its ONLY prior check not because it was
correct, but because that check was blind to the axis that would have found
the bug (`lesson_a_corpus_is_blind_beside_what_it_measures`). Kept as a
historical record — not deleted — with this note at its own top.

⛔⛔ THIS SCRIPT PROVES NOTHING ABOUT TRADINGVIEW. It reimplements, in plain
Python, the exact candidate-A/candidate-B arithmetic the Pine oracle plots for
each of the four disputed functions, over the exact same planted 25-bar
repeating driver, and asserts each pair produces DIFFERENT numbers at the
probe row (phase == 24). For three of the four (rising, percentrank, bbw) that
is the entire claim. For median specifically, this script ALSO property-tests
the lower-middle helper formula itself against many orderings (not just the
one planted at phase==24), because "does this arithmetic compute a lower-
middle-of-four AT ALL" is a claim independent of any one probe row, and the
previous version's failure to test that independently is exactly what let its
bug through. Whether TradingView's actual `ta.rising`/`ta.median`/
`ta.percentrank`/`ta.bbw` output matches candidate A, candidate B, or neither
is a question only a real TradingView run can answer — this script cannot and
does not answer it.

Run: python verify_oracle_ambiguity_v3_1.py
Expected: every DISCRIMINATES line prints True; the median helper property
test reports 0 failures across permutations, duplicates, and random trials;
the script exits 0 via its asserts if any of this ever regresses.
"""

import itertools
import random


# ─── 1. The median lower-middle helper, proven general BEFORE it is trusted ──

def median_lower_middle(a, b, c, d):
    """The corrected formula (owner-supplied, verified here): the 2nd-smallest
    of four values via a min/max sorting-network fragment, NOT via sorting.

    loAB/hiAB and loCD/hiCD each hold {a,b} and {c,d} sorted into a low/high
    pair. The GLOBAL lower-middle is then max(loAB, loCD) sitting BELOW
    min(hiAB, hiCD) -- taking min(max(loAB,loCD), min(hiAB,hiCD)) is what
    correctly resolves which of those two candidates is actually the 2nd-
    smallest overall, for ANY pairing and ANY ordering of the four inputs.
    """
    loAB, hiAB = min(a, b), max(a, b)
    loCD, hiCD = min(c, d), max(c, d)
    return min(max(loAB, loCD), min(hiAB, hiCD))


def _truth_lower_middle(a, b, c, d):
    return sorted([a, b, c, d])[1]


def _property_test_median_lower_middle():
    """Proves median_lower_middle is order-independent and correct, NOT just
    correct for one planted ordering. This is the exact test the superseded
    script skipped -- run in full before this formula reaches the Pine script
    that will actually be sent to the owner."""
    failures = []

    # (a) every permutation of 4 distinct values
    distinct = [1, 3, 5, 6]
    for perm in itertools.permutations(distinct):
        got = median_lower_middle(*perm)
        want = _truth_lower_middle(*perm)
        if got != want:
            failures.append(("permutation", perm, got, want))

    # (b) every permutation of several duplicate-bearing quadruples
    dup_cases = [
        (1, 1, 5, 6), (1, 5, 5, 6), (1, 3, 3, 6), (1, 3, 6, 6),
        (2, 2, 2, 6), (2, 2, 6, 6), (5, 5, 5, 5), (1, 1, 1, 6), (1, 6, 6, 6),
    ]
    for case in dup_cases:
        for perm in set(itertools.permutations(case)):
            got = median_lower_middle(*perm)
            want = _truth_lower_middle(*perm)
            if got != want:
                failures.append(("duplicate", perm, got, want))

    # (c) random property trial: floats, negatives, occasional forced dupes
    random.seed(42)
    for _ in range(2000):
        vals = [round(random.uniform(-50, 50), 3) for _ in range(4)]
        if random.random() < 0.3:
            vals[random.randint(0, 3)] = vals[random.randint(0, 3)]
        got = median_lower_middle(*vals)
        want = _truth_lower_middle(*vals)
        if got != want:
            failures.append(("random", tuple(vals), got, want))

    return failures


print("=== PROPERTY TEST: median_lower_middle (permutations + duplicates + 2000 random trials) ===")
failures = _property_test_median_lower_middle()
if failures:
    print(f"FAILED {len(failures)} case(s):")
    for kind, case, got, want in failures[:10]:
        print(f"  [{kind}] input={case} got={got} want={want}")
    raise AssertionError(
        f"median_lower_middle is NOT order-independent -- {len(failures)} failures. "
        "Do not use this formula in the Pine script until this prints zero."
    )
print("0 failures across 24 permutations + duplicate cases + 2000 random trials. "
      "median_lower_middle is confirmed order-independent before use.")


# ─── 2. The oracle's actual probe check, at phase == 24 ─────────────────────

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

i = 24
assert i % 25 == 24
print(f"\nprobe bar i={i}, phase={i % 25}")
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
assert candA_runmax != candB_monotone
assert candA_runmax is True and candB_monotone is False

print("\n=== ta.median(raw,4) candidates (median_lower_middle, proven general above; sum-max-min for the mean) ===")
window4 = sorted([cur, b1, b2, b3])
w0, w1, w2, w3 = cur, b1, b2, b3
candLower = median_lower_middle(w0, w1, w2, w3)
sum_all = w0 + w1 + w2 + w3
max_all = max(max(w0, w1), max(w2, w3))
min_all = min(min(w0, w1), min(w2, w3))
candMean = (sum_all - max_all - min_all) / 2
print(f"window sorted (reference only): {window4}")
print(f"Candidate lower-middle (proven-general formula) = {candLower}")
print(f"Candidate mean-of-middles = ({sum_all}-{max_all}-{min_all})/2 = {candMean}")
print(f"Cross-check vs sorted-list reference: lower={window4[1] == candLower} mean={((window4[1]+window4[2])/2) == candMean}")
print(f"DISCRIMINATES: {candLower != candMean}")
assert window4[1] == candLower
assert (window4[1] + window4[2]) / 2 == candMean
assert candLower != candMean
assert candLower == 3.0 and candMean == 4.0

print("\n=== ta.percentrank(raw,4) candidates ===")
priors4 = [b1, b2, b3, b4]
count_le = sum(1 for v in priors4 if v <= cur)
candA_overL = 100.0 * count_le / 4
candB_overLplus1 = 100.0 * (count_le + 1) / 5
print(f"priors (close[1..4] equivalent) = {priors4}")
print(f"Candidate A (/L=4, current NOT in sample): 100*{count_le}/4 = {candA_overL}")
print(f"Candidate B (/(L+1)=5, current IN sample, count+1={count_le+1}): 100*{count_le+1}/5 = {candB_overLplus1}")
print(f"DISCRIMINATES: {candA_overL != candB_overLplus1}")
naive_alt = 100.0 * count_le / 5
print(f"(sanity only, NOT candidate B: 100*{count_le}/5 = {naive_alt})")
assert candA_overL != candB_overLplus1
assert candA_overL == 75.0 and candB_overLplus1 == 80.0
assert naive_alt == 60.0 and naive_alt not in (candA_overL, candB_overLplus1)

print("\n=== ta.bbw(raw,20,2) candidates ===")
window20 = raw[i - 19:i + 1]
assert len(window20) == 20
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
assert abs(candPercent - candRatio * 100.0) < 1e-9
assert candRatio < 10 and candPercent > 100

print("\nALL FOUR ORACLE PROBES CONFIRMED DISCRIMINATING at phase==24, and the median "
      "helper formula is confirmed order-independent (not just correct-by-coincidence "
      "for this one probe). See module docstring for what this does and does not prove.")
