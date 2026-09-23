"""PHASE 10 — what does "UCT" mean historically in this artifact?

UCT membership = today's pinned 2,689-name watchlist ∩ names that traded on D (no type
or venue test). Measured here, from the provider grouped cache and reference map:
  - when each pinned symbol first/last appears, and how many existed in each era
  - SYMBOL REUSE: a pinned symbol whose reference history shows an earlier, different
    holder, or whose trading history has a long gap — before the handoff the artifact
    counts a DIFFERENT security under a UCT name
  - security types of the pinned list (is every member a common stock?)
  - the survivorship signature: UCT minus US on level metrics, by year
"""
import collections
import json
import os
import statistics as st

from common import GROUPED, PINNED_UCT, SCRATCH, calendar, ro, write

pin = json.load(open(PINNED_UCT))
T = pin["tickers"]
R = {"pinned": {k: pin[k] for k in pin if k != "tickers"}, "n": len(T),
     "format": {"with_dot": sorted(t for t in T if "." in t), "with_dash": sorted(t for t in T if "-" in t)}}
cal = calendar()
want = set(T) | {t.replace("-", ".") for t in T}
first, lastd, count, gaps = {}, {}, collections.Counter(), collections.defaultdict(list)
prev_idx = {}
for i, d in enumerate(cal):
    keys = json.load(open(os.path.join(GROUPED, "%s_0.json" % d)))       # RAW: as-traded symbol on D
    for k in keys:
        if k in want:
            first.setdefault(k, d); lastd[k] = d; count[k] += 1
            p = prev_idx.get(k)
            if p is not None and i - p > 60:
                gaps[k].append((cal[p], d, i - p))
            prev_idx[k] = i
seen = lambda t: t if t in first else (t.replace("-", ".") if t.replace("-", ".") in first else None)
R["never_in_raw_grouped"] = sorted(t for t in T if seen(t) is None)
def present_on(d):
    return sum(1 for t in T if seen(t) and first[seen(t)] <= d <= lastd[seen(t)])
R["present_on"] = {d: present_on(d) for d in ("2008-01-02", "2009-03-09", "2011-01-03", "2015-01-02",
                                              "2020-01-02", "2024-01-02", "2026-09-11")}
R["first_seen_by_year"] = dict(sorted(collections.Counter(
    (first[seen(t)][:4] if seen(t) else "never") for t in T).items()))
R["first_seen_at_cache_start"] = sum(1 for t in T if seen(t) and first[seen(t)] == cal[0])
R["long_gap_symbols"] = {t: g for t, g in sorted(gaps.items())}
R["long_gap_count"] = len(gaps)

# reference-map evidence of earlier holders of a pinned symbol
ref = json.load(open("/data/breadth_pit_reference.json"))
types = collections.Counter(); reused = {}
for t in T:
    recs = ref.get(t) or ref.get(t.replace("-", ".")) or []
    cur = [r for r in recs if not r.get("delisted_utc")]
    types[(cur[0].get("type") if cur else "no_active_record")] += 1
    dl = [r for r in recs if r.get("delisted_utc")]
    if dl:
        reused[t] = {"records": recs, "first_seen": first.get(seen(t)) if seen(t) else None}
R["pinned_security_types"] = dict(types.most_common())
R["symbols_with_delisted_prior_holder"] = len(reused)
R["reuse_examples"] = dict(list(sorted(reused.items()))[:40])
# how many sessions of UCT history sit BEFORE a delisted holder's end date (i.e. a
# different security counted under the UCT name)
contam = collections.Counter()
for t, v in reused.items():
    ends = [r["delisted_utc"][:10] for r in v["records"] if r.get("delisted_utc")]
    if not ends or not v["first_seen"]:
        continue
    end = max(ends)
    contam[t] = sum(1 for d in cal if v["first_seen"] <= d <= end and "2008-01-02" <= d <= "2026-09-11")
R["reuse_sessions_before_handoff"] = dict(contam.most_common(40))
R["reuse_symbols_affecting_2008_2026"] = sum(1 for v in contam.values() if v > 0)

# UCT sizes actually used (pass_session) and the survivorship signature
c = ro(SCRATCH)
sizes = collections.defaultdict(list)
for d, us in c.execute("SELECT date,universe_sizes FROM pass_session"):
    s = json.loads(us)
    sizes[d[:4]].append(s.get("uct"))
R["uct_members_used_by_year"] = {y: {"min": min(v), "max": max(v)} for y, v in sorted(sizes.items())}
sig = {}
for m in ("pct_above_50sma", "pct_above_200sma", "hi_ratio", "lo_ratio", "stage2_count", "universe_count"):
    rows = c.execute("SELECT date,universe,c FROM breadth_daily_ohlc WHERE metric=? AND universe IN ('uct','us')", (m,)).fetchall()
    by = collections.defaultdict(dict)
    for d, u, v in rows:
        by[d][u] = v
    yr = collections.defaultdict(list)
    for d, x in by.items():
        if "uct" in x and "us" in x:
            yr[d[:4]].append(x["uct"] - x["us"])
    sig[m] = {y: round(st.mean(v), 2) for y, v in sorted(yr.items())}
R["uct_minus_us_close_mean_by_year"] = sig
print(write("uct_membership.json", R))
print(json.dumps({k: R[k] for k in ("n", "format", "present_on", "first_seen_by_year", "long_gap_count",
                                    "pinned_security_types", "symbols_with_delisted_prior_holder",
                                    "reuse_symbols_affecting_2008_2026", "uct_members_used_by_year",
                                    "uct_minus_us_close_mean_by_year")}, indent=1, default=str)[:9000])
