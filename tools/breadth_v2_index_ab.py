"""THE EQUIVALENCE PROOF FOR THE INDEX FIX, with the universe HELD CONSTANT.

⛔⛔ The golden smoke came back 52/110 exact, and every delta pointed the same way: the
run's universes are SMALLER than the oracle's (uct by 12-17 names, us by 1). The
artifact's own `pass_meta` says `uct_universe_date: 2026-09-18`, while the accepted
matrix was built on `2026-09-17`. That is a plausible story, and a plausible story is
not a proof — it could equally be the index fix quietly changing results.

⭐ So run BOTH implementations against the SAME pinned universe, in the SAME process,
minutes apart. The universe is captured once and frozen for both legs, so membership
drift cannot move either side. If the two artifacts agree row for row, the index fix is
result-neutral and every remaining delta against the oracle belongs to the input.
"""
import json, os, sqlite3, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

ORACLE = os.path.join(REPO, "tests", "fixtures", "breadth_v2_golden_matrix.json")
A_NEW = "/data/_audit/v2_ab_new.db"      # the index fix
B_OLD = "/data/_audit/v2_ab_old.db"      # the pre-fix full scan
REPORT = "/data/_audit/v2_index_ab_report.json"

from api.services import breadth_combined_pass as cp
from api.services import breadth_wick_recon as wr
from api.services import breadth_history_recon as _recon

NEW_IMPL = wr.session_eod_closes


def OLD_IMPL(conn, day_ts, tickers=None):
    """The pre-fix formulation, verbatim: one filtered full SCAN of `ohlcv`."""
    want = set(tickers) if tickers is not None else None
    out = {}
    try:
        for t, c in conn.execute(
                "SELECT ticker, c FROM ohlcv WHERE tf='D' AND ts=?", (day_ts,)):
            if c is None or (want is not None and t not in want):
                continue
            try:
                v = float(c)
            except (TypeError, ValueError):
                continue
            if v > 0.0:
                out[t] = v
    except Exception:                                  # noqa: BLE001
        return {}
    return out


# ---- PIN THE UNIVERSE. Both legs must see byte-identical membership. -------------
_real_resolve = _recon._resolve_universe
PINNED_TICKERS, PINNED_DATE = _real_resolve()
PINNED_TICKERS = list(PINNED_TICKERS)
print("PINNED uct universe: %d names, date=%s" % (len(PINNED_TICKERS), PINNED_DATE),
      flush=True)
_recon._resolve_universe = lambda: (PINNED_TICKERS, PINNED_DATE)

# `reference_map()` drives the PIT universes; pin it the same way.
from api.services import breadth_pit_frame as bpf
_real_refmap = bpf.reference_map
PINNED_REFMAP = _real_refmap()
print("PINNED reference_map: %d records" % len(PINNED_REFMAP), flush=True)
bpf.reference_map = lambda: PINNED_REFMAP

oracle = json.load(open(ORACLE))
DATES = sorted(oracle)

for path in (A_NEW, B_OLD):
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except OSError:
            pass

timings = {"new": {}, "old": {}}
for label, impl, art in (("new", NEW_IMPL, A_NEW), ("old", OLD_IMPL, B_OLD)):
    wr.session_eod_closes = impl
    print("\n=== LEG %s -> %s ===" % (label.upper(), art), flush=True)
    for D in DATES:
        unis = cp.ALL_UNIVERSES if D >= "2011-01-03" else ("uct", "us")
        t0 = time.time()
        cp.run(art, D, D, universes=unis, progress_every=1)
        timings[label][D] = round(time.time() - t0, 2)
        print("  %s %s %.1fs" % (label, D, timings[label][D]), flush=True)
wr.session_eod_closes = NEW_IMPL

# ---- compare row for row --------------------------------------------------------
def rows(path):
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True).cursor()
    return {(u, d, m): (o, h, l, cc) for u, d, m, o, h, l, cc in c.execute(
        "SELECT universe,date,metric,o,h,l,c FROM breadth_daily_ohlc")}

new, old = rows(A_NEW), rows(B_OLD)
only_new = sorted(set(new) - set(old))
only_old = sorted(set(old) - set(new))
diff = [(k, old[k], new[k]) for k in sorted(set(new) & set(old)) if old[k] != new[k]]

print("\n" + "=" * 78)
print("INDEX-FIX A/B, UNIVERSE PINNED")
print("  rows new / old        : %d / %d" % (len(new), len(old)))
print("  keys only in new      : %d" % len(only_new))
print("  keys only in old      : %d" % len(only_old))
print("  rows differing        : %d" % len(diff))
for k, o, n in diff[:25]:
    print("    DIFF", k, "old=", o, "new=", n)
neutral = not diff and not only_new and not only_old
print("  VERDICT               :",
      "INDEX FIX IS RESULT-NEUTRAL" if neutral else "INDEX FIX CHANGES RESULTS")

tn = sum(timings["new"].values()) / len(DATES)
to = sum(timings["old"].values()) / len(DATES)
print("  mean s/session new    : %.1f" % tn)
print("  mean s/session old    : %.1f" % to)
print("  speedup               : %.2fx  (%.1f s/session saved)" % (to / tn, to - tn))
print("=" * 78, flush=True)

json.dump({"neutral": neutral, "rows_new": len(new), "rows_old": len(old),
           "only_new": [list(k) for k in only_new],
           "only_old": [list(k) for k in only_old],
           "diffs": [[list(k), o, n] for k, o, n in diff],
           "timings": timings, "mean_new": tn, "mean_old": to,
           "pinned_uct_universe_date": PINNED_DATE,
           "pinned_uct_count": len(PINNED_TICKERS),
           "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
          open(REPORT, "w"), indent=1)
print("report ->", REPORT, flush=True)
sys.exit(0 if neutral else 1)
