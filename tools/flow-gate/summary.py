"""Union summary from the sampler files, WITHOUT stopping the sampler.

READ-ONLY. Opens both files for reading only, touches no network, and cannot
perturb the sampler or the service. Safe to run at any time, including mid-session.

Run:  python C:\\Users\\Patrick\\flow-gate-sampler\\summary.py
"""
import collections
import json
import os

D = os.path.dirname(os.path.abspath(__file__))
UNION = os.path.join(D, "rolls_union.jsonl")
RAW = os.path.join(D, "captures.jsonl")

# A generation is FULLY OBSERVED only if we witnessed its boot. `generation`
# increments on a detected restart, so every gen >= 1 began with a restart this
# sampler saw. Generation 0 is whatever process was already running when the
# sampler attached, so its catch-up rows are just the served [-5:] window of a
# process whose start we never saw -- NOT a count of its lifetime. Applying
# "exactly one catch-up" to gen 0 would raise a guaranteed false alarm.
BASELINE_GEN = 0


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    return out


rows = read_jsonl(UNION)
caps = read_jsonl(RAW)

ok_caps = [c for c in caps if not c.get("error")]
err_caps = [c for c in caps if c.get("error")]
last_et = caps[-1].get("at_et") if caps else None
warm_false = [c for c in ok_caps if (c.get("health") or {}).get("warm") is False]

by = collections.Counter((r["generation"], r["kind"]) for r in rows)
gens = sorted({r["generation"] for r in rows})
st = [r for r in rows if r["kind"] == "steady_state_roll"]
obs = sorted(r["observed_s"] for r in st if r.get("observed_s") is not None)

print("captures ok=%d errors=%d  last capture ET=%s" % (len(ok_caps), len(err_caps), last_et))
print("union rows=%d  generations=%s" % (len(rows), gens))
for (g, k), n in sorted(by.items()):
    tag = "  (pre-deploy baseline, boot NOT observed)" if g == BASELINE_GEN else ""
    print("   gen %d  %-18s %d%s" % (g, k, n, tag))

if obs:
    over = sum(1 for x in obs if x >= 60)
    print("steady observed_s: n=%d min=%s med=%s max=%s  (>=60s: %d)"
          % (len(obs), obs[0], obs[len(obs) // 2], obs[-1], over))
    print("pass2_skipped: %d/%d"
          % (sum(1 for r in st if r.get("pass2_skipped")), len(st)))
else:
    print("steady observed_s: NONE YET")

# ALL ROLLS, regardless of classification. On a BLIND ledger (the unfixed
# classifier, where every roll lands in rolls_startup) the timing fields are
# still there -- observed_s / prepare_ms / handoff_ms / pass2_skipped are
# recorded identically for both kinds. Most of the gate's PASS criteria are
# TIMING, not classification, so a blind night still yields the performance
# distribution; only "exactly one catch-up" needs the fix. Reporting steady-only
# would have printed "NONE YET" while the data sat in the file unanalysed.
all_obs = sorted(r["observed_s"] for r in rows if r.get("observed_s") is not None)
if all_obs:
    print("ALL rolls observed_s: n=%d min=%s med=%s max=%s  (>=60s: %d)"
          % (len(all_obs), all_obs[0], all_obs[len(all_obs) // 2], all_obs[-1],
             sum(1 for x in all_obs if x >= 60)))
    hoff = sorted(r["handoff_ms"] for r in rows if r.get("handoff_ms") is not None)
    if hoff:
        print("ALL rolls handoff_ms:  n=%d min=%s med=%s max=%s"
              % (len(hoff), hoff[0], hoff[len(hoff) // 2], hoff[-1]))
    print("ALL rolls pass2_skipped: %d/%d"
          % (sum(1 for r in rows if r.get("pass2_skipped")), len(rows)))

# --- the primary criterion -----------------------------------------------------
print("--- catchup check (>1 per FULLY OBSERVED generation, no restart, is a FAIL) ---")
for g in gens:
    c = by.get((g, "startup_catchup"), 0)
    if g == BASELINE_GEN:
        print("gen %d: startup_catchup=%d  BASELINE - criterion does not apply "
              "(sampler attached mid-life)" % (g, c))
    elif c == 1:
        print("gen %d: startup_catchup=%d  OK" % (g, c))
    elif c == 0:
        print("gen %d: startup_catchup=%d  (no boot roll recorded yet)" % (g, c))
    else:
        print("gen %d: startup_catchup=%d  *** FAIL: >1 catchup in one generation ***" % (g, c))

# --- C2: attribute a slow roll to CONTENTION vs THE PREPARER --------------------
# observed_s runs from the detector's sighting to first-paint publication, so a
# roll that spent time DECLINED (the build lock held by a member request or the
# search warm lane -- there is a ~90s precedent) carries that wait inside it.
# High observed_s + declined jumping  = lock contention.
# High observed_s + declined flat     = the preparer itself losing the race.
# Two different problems with two different fixes; do not conflate them.
slow = [r for r in rows if (r.get("observed_s") or 0) > 30]   # ALL kinds, not steady-only
print("--- slow-roll attribution (observed_s > 30s): %d roll(s) ---" % len(slow))


def declined_at(ts):
    """`prepare.declined` from the last ok capture at or before ts."""
    best = None
    for c in ok_caps:
        if c.get("at", 0) <= ts:
            best = ((c.get("health") or {}).get("prepare") or {}).get("declined")
        else:
            break
    return best


for r in slow:
    t = r.get("first_seen_at", 0)
    before = declined_at(t - (r.get("observed_s") or 0) - 60)
    after = declined_at(t)
    if before is None or after is None:
        verdict = "declined delta UNKNOWN (capture window missing)"
    else:
        delta = after - before
        verdict = ("declined +%d -> LOCK CONTENTION" % delta if delta > 0
                   else "declined +0 -> THE PREPARER ITSELF")
    print("   v=%s observed_s=%s prepare_ms=%s  %s"
          % (r.get("version"), r.get("observed_s"), r.get("prepare_ms"), verdict))

# --- Member-load proxy for the STALE-VALID decision -----------------------------
# There is NO server counter for "a member fell to the raw tape" -- that is a
# CLIENT decision (it asks for parts, gets nothing or times out, and falls back),
# so the server never sees it. The closest signals the server DOES keep are in
# stats_process_local, which the sampler stores in full on every capture:
#   requests      part-requests served
#   cache_hits    served straight from a warm part  (the good path)
#   stale_served  a PREVIOUS generation's part was served under lock contention
#   declined_busy lock held AND nothing cached -> server returned None -> the
#                 client has no choice but the raw tape. THE CLOSEST PROXY.
# Differencing these across the session bounds how many loads land in the
# post-roll window. It is a PROXY, not the number: a cold version with a free
# lock BUILDS, and if that build outruns the client's timeout the member falls
# back anyway and nothing server-side records it.
def _spl(c):
    return ((c.get("health") or {}).get("stats_process_local") or {})


print("--- member-load proxy (for the stale-valid decision) ---")
_first = _last = None
for c in ok_caps:
    st_ = _spl(c)
    if st_.get("requests") is not None:
        if _first is None or st_["requests"] < (_spl(_last).get("requests") or 0):
            _first = c          # counters reset on restart -> start a new window
        _last = c
if _first and _last:
    a, b = _spl(_first), _spl(_last)
    d = {k: (b.get(k) or 0) - (a.get(k) or 0)
         for k in ("requests", "cache_hits", "stale_served", "declined_busy",
                   "builds", "build_failures")}
    tot = d["requests"]
    print("   window %s -> %s" % (_first.get("at_et"), _last.get("at_et")))
    for k, v in d.items():
        pct = ("  (%.1f%% of requests)" % (100.0 * v / tot)) if tot and k != "requests" else ""
        print("   %-14s +%d%s" % (k, v, pct))
    if tot:
        cold = tot - d["cache_hits"]
        print("   NOT a warm cache hit: %d of %d (%.1f%%) <- upper bound on the "
              "post-roll population" % (cold, tot, 100.0 * cold / tot))
else:
    print("   no counter data yet")

# --- Post-roll vs cold-filter, the split that actually sizes stale-valid --------
# ⛔ "38.1% not-warm" ON ITS OWN DOES NOT SIZE THE DECISION. In a quiet window
# nothing is rolling, so a not-warm serve is a COLD FILTER (an uncommon
# source/days/date combination nobody has asked for yet) -- a different
# population, which stale-valid would not help at all. The number that decides
# stale-valid is not-warm DURING the window just after a version change.
# stats_process_local is process-wide and NOT per-version, so the split is made
# on the sampler side: bucket each capture INTERVAL by whether current_version
# moved during it.
# ⚠️ CONFOUND, stated rather than hidden: a 60 s interval containing a roll also
# contains ordinary steady traffic, so the post-roll bucket is an UPPER BOUND.
# Intervals with no version change are clean cold-filter. At ~1 roll/min during
# RTH most intervals contain a roll, which shrinks the clean half -- read the
# stable-version bucket as the reliable one and the rolled bucket as a ceiling.
print("--- post-roll vs cold-filter (the stale-valid split) ---")
_buckets = {"version ROLLED in interval": [0, 0, 0], "version STABLE": [0, 0, 0]}
_prev = None
for c in ok_caps:
    st_ = _spl(c)
    h_ = c.get("health") or {}
    if st_.get("requests") is None:
        continue
    if _prev is not None:
        pst, ph = _spl(_prev), (_prev.get("health") or {})
        dr = (st_.get("requests") or 0) - (pst.get("requests") or 0)
        dh = (st_.get("cache_hits") or 0) - (pst.get("cache_hits") or 0)
        if dr >= 0 and dh >= 0:          # skip counter resets (restart)
            key = ("version ROLLED in interval"
                   if h_.get("current_version") != ph.get("current_version")
                   else "version STABLE")
            b = _buckets[key]
            b[0] += dr
            b[1] += dh
            b[2] += 1
    _prev = c
for k, (req, hit, n) in _buckets.items():
    cold = req - hit
    pct = ("%.1f%%" % (100.0 * cold / req)) if req else "n/a"
    print("   %-26s intervals=%-4d requests=%-5d not-warm=%-5d (%s)"
          % (k, n, req, cold, pct))
print("   ^ stale-valid is sized by the ROLLED row (an upper bound); the STABLE")
print("     row is cold-filter misses, which stale-valid would not help.")

# --- C1: the pattern that reads healthiest during total failure -----------------
# If db.data_signature() raises, _current_version() FAILS OPEN and returns the raw
# minute bucket with no gate at all -- so the version advances every single minute
# and the roll distribution looks flawless while SQLite is unreadable.
# The tell is GAPLESSNESS: a working signature gate SKIPS quiet minutes (today's
# real rolls were 453, 456, 457, 458, 459 -- gaps at 454/455). A long perfectly
# consecutive run means nothing is being gated.
# N = 30: during peak RTH a genuinely busy tape can change every minute for a
# while, so a shorter run is not evidence. 30 consecutive gapless minutes with a
# corroborating health signal is.
N_GAPLESS = 30
vers = sorted({r["version"] for r in rows})
run = best = 1 if vers else 0
for a, b in zip(vers, vers[1:]):
    run = run + 1 if b == a + 1 else 1
    best = max(best, run)
print("--- fail-open check ---")
print("longest gapless version run=%d (N=%d)  warm=False captures=%d  errors=%d"
      % (best, N_GAPLESS, len(warm_false), len(err_caps)))
if best >= N_GAPLESS and (warm_false or len(err_caps) > len(ok_caps) * 0.1):
    print("*** POSSIBLE FAIL-OPEN: the version is advancing every minute with no")
    print("*** gaps AND health is degraded. data_signature() may be raising, in")
    print("*** which case _current_version() returns an UNGATED bucket and this")
    print("*** distribution is an artifact, not a measurement. Check warm/errors")
    print("*** before calling any of this a PASS.")
elif best >= N_GAPLESS:
    print("(gapless run is long but health is clean - most likely just a busy tape)")
