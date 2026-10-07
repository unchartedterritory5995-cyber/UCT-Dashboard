"""Exchange Breadth V1 — live identity gate, Phase 1/2 census (read-only).

Usage: python3 census.py OUT

1. RE-KEY CENSUS: every population ticker whose `ticker|delisted_utc` key differs between the frozen
   reference (A, inputs_v20260924f) and each later producer snapshot (09-30, 10-01, 10-02), with
   both records, member sessions affected, ledger history and dated-list CIK/FIGI evidence.
2. IDENTIFIER INVENTORY: over every population member-session, the dated venue lists' CIK,
   composite FIGI and share-class FIGI — coverage by year, stability per frozen identity, sharing
   across simultaneously listed tickers (share classes / ADRs), behaviour across exchange transfers,
   renames (one FIGI under consecutive tickers) and ticker reuse (one ticker, sequential FIGIs).
"""
import collections
import gzip
import hashlib
import json
import os
import sys
import time

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
X = "/data/_audit/exch_v1"
POP = X + "/population.json"
LED = X + "/venue_ledger_72eef1c2.json"
VIN = "/data/breadth_v2_producer/vintages"
REFS = {"A_frozen_20260924f": "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json",
        "B1_p202609302026": f"{VIN}/p202609302026/inputs_p202609302026/pit_reference.json",
        "B2_p202610012031": f"{VIN}/p202610012031/inputs_p202610012031/pit_reference.json",
        "B3_p202610022300": f"{VIN}/p202610022300/inputs_p202610022300/pit_reference.json"}
T0 = time.time()


def log(*a):
    print(time.strftime("%H:%M:%S"), f"+{time.time() - T0:.0f}s", *a, flush=True)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def dump(n, o):
    json.dump(o, open(os.path.join(OUT, n), "w"), indent=1, sort_keys=True, default=str)
    log("wrote", n)


def resolve(recs, d):
    hits = [r for r in (recs or []) if not ((r.get("delisted_utc") or "")[:10] and d > r["delisted_utc"][:10])
            and not ((r.get("list_date") or "")[:10] and d < r["list_date"][:10])]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


def key(t, rec):
    return f"{t}|{(rec or {}).get('delisted_utc') or 'active'}"


pop = json.load(open(POP))
S = pop["sessions"]
pos = {d: i for i, d in enumerate(S)}
led = json.load(open(LED))["rows"]
rows_by = collections.defaultdict(list)
for r in led:
    rows_by[r[0]].append(r[:7])
refs = {k: json.load(open(p)) for k, p in REFS.items()}
by_t = collections.defaultdict(list)
for ident, e in pop["identities"].items():
    by_t[e["ticker"]].append(ident)

# ── 1. re-key census: for each snapshot B, member sessions whose key under B != key under A ────
rekey = {}
for bname in [k for k in REFS if k != "A_frozen_20260924f"]:
    A, B = refs["A_frozen_20260924f"], refs[bname]
    changed = sorted(t for t in set(A) | set(B) if A.get(t) != B.get(t))
    hits = {}
    for t in changed:
        for ident in by_t.get(t, ()):
            for a, b in pop["identities"][ident]["runs"]:
                for i in range(a, b + 1):
                    d = S[i]
                    ka, kb = key(t, resolve(A.get(t), d)), key(t, resolve(B.get(t), d))
                    ra, rb = resolve(A.get(t), d), resolve(B.get(t), d)
                    if ka != kb or (ra is None) != (rb is None):
                        h = hits.setdefault(t, {"pairs": collections.Counter(), "sessions_le_0924": 0, "sessions_after": 0})
                        h["pairs"][f"{ka if ra else None} -> {kb if rb else None}"] += 1
                        h["sessions_le_0924" if d <= "2026-09-24" else "sessions_after"] += 1
    rekey[bname] = {"snapshot_sha256": sha(REFS[bname]), "tickers_with_changed_records": len(changed),
                    "tickers_rekeyed_on_member_sessions": len(hits),
                    "member_sessions_rekeyed_le_0924": sum(h["sessions_le_0924"] for h in hits.values()),
                    "names": {t: {"pairs": dict(h["pairs"]), "sessions_le_0924": h["sessions_le_0924"],
                                  "sessions_after_0924": h["sessions_after"],
                                  "records_A": A.get(t), "records_B": B.get(t)} for t, h in sorted(hits.items())},
                    "changed_record_kinds": dict(collections.Counter(
                        ("added" if t not in A else "removed" if t not in B else
                         "delisted_added" if len(A[t]) == len(B[t]) and any((ra.get("delisted_utc") is None) and rb.get("delisted_utc")
                                                                             for ra, rb in zip(A[t], B[t])) else
                         "record_added" if len(B[t]) > len(A[t]) else "other") for t in changed))}
    log(bname, rekey[bname]["tickers_rekeyed_on_member_sessions"], rekey[bname]["member_sessions_rekeyed_le_0924"])
dump("I01_rekey_by_snapshot.json", rekey)
focus = sorted(set(rekey["B3_p202610022300"]["names"]) | {"ACI", "AA", "ABX", "KW", "IPW", "WMT", "PEP", "ORCL", "LIN",
                                                            "BRK.A", "BRK.B", "GOOG", "GOOGL", "META", "FB", "BABA",
                                                            "TSM", "SHEL", "RDS.A", "RDS.B", "UA", "UAA", "FOX", "FOXA"})

# ── 2. one pass over the dated lists ────────────────────────────────────────────────────────
members_by_day = [[] for _ in S]
for ident, e in pop["identities"].items():
    for a, b in e["runs"]:
        for i in range(a, b + 1):
            members_by_day[i].append(ident)
rle = collections.defaultdict(list)          # ident -> [[i0, i1, cik, figi, sfigi, mic]]
cov = collections.defaultdict(collections.Counter)
figi_multi_ticker_days = collections.Counter()
cik_multi_ticker_days = collections.Counter()
figi_ex = []
cik_ex = []
focus_daily = collections.defaultdict(list)
for i, d in enumerate(S):
    with gzip.open(os.path.join(X, "dated", f"{d}.json.gz"), "rt") as fh:
        dated = json.load(fh)
    info = {}
    for mic, rows in dated.items():
        for r in rows:
            info.setdefault(r[0], (r[2], r[3] if len(r) > 3 else None, r[4] if len(r) > 4 else None, mic))
    y = d[:4]
    fig_t = collections.defaultdict(set)
    cik_t = collections.defaultdict(set)
    for ident in members_by_day[i]:
        t = pop["identities"][ident]["ticker"]
        cik, figi, sfigi, mic = info.get(t, (None, None, None, None))
        cov[y]["member_sessions"] += 1
        cov[y]["in_dated_list"] += mic is not None
        cov[y]["cik"] += bool(cik)
        cov[y]["figi"] += bool(figi)
        cov[y]["sfigi"] += bool(sfigi)
        if figi:
            fig_t[figi].add(t)
        if cik:
            cik_t[cik].add(t)
        seg = (cik, figi, sfigi, mic)
        L = rle[ident]
        if L and L[-1][1] == i - 1 and tuple(L[-1][2:]) == seg:
            L[-1][1] = i
        else:
            L.append([i, i, *seg])
        if t in focus:
            focus_daily[t].append((d, ident, cik, figi, sfigi, mic))
    for f, ts in fig_t.items():
        if len(ts) > 1:
            figi_multi_ticker_days[y] += 1
            if len(figi_ex) < 40:
                figi_ex.append([d, f, sorted(ts)])
    for c_, ts in cik_t.items():
        if len(ts) > 1:
            cik_multi_ticker_days[y] += 1
            if len(cik_ex) < 40:
                cik_ex.append([d, c_, sorted(ts)])
    if i % 500 == 0:
        log("dated", d)

# ── 3. identifier semantics per frozen identity ─────────────────────────────────────────────
def changes(L, k):
    """sequence of distinct non-null values in time order (run-length), and flip-backs"""
    seq = []
    for seg in L:
        v = seg[k]
        if v and (not seq or seq[-1] != v):
            seq.append(v)
    return seq


stab = {"cik": collections.Counter(), "figi": collections.Counter(), "sfigi": collections.Counter()}
flip = collections.Counter()
figi_change_with_cik_same = figi_change_with_cik_change = 0
figi_change_examples = []
for ident, L in rle.items():
    for k, col in (("cik", 2), ("figi", 3), ("sfigi", 4)):
        seq = changes(L, col)
        n = len(set(seq))
        stab[k]["0" if n == 0 else "1" if n == 1 else ">1"] += 1
        if len(seq) != len(set(seq)):
            flip[k] += 1
    fseq = [(seg[0], seg[3], seg[2]) for seg in L if seg[3]]
    for (i0, f0, c0), (i1, f1, c1) in zip(fseq, fseq[1:]):
        if f0 != f1:
            if c0 and c1 and c0 == c1:
                figi_change_with_cik_same += 1
            else:
                figi_change_with_cik_change += 1
            if len(figi_change_examples) < 40:
                figi_change_examples.append([ident, S[i0], f0, c0, S[i1], f1, c1])
# exchange transfers: FIGI on either side of every ledger venue change (NYSE<->NASDAQ)
tr = collections.Counter()
tr_ex = []
for ident, rows in rows_by.items():
    rows = sorted(rows, key=lambda r: r[2])
    for a, b in zip(rows, rows[1:]):
        if {a[4], b[4]} == {"NYSE", "NASDAQ"}:
            L = rle.get(ident, [])
            fa = [s[3] for s in L if s[0] <= pos[a[3]] <= s[1]]
            fb = [s[3] for s in L if s[0] <= pos[b[2]] <= s[1]]
            fa, fb = (fa[0] if fa else None), (fb[0] if fb else None)
            k = "both_null" if not fa and not fb else "one_null" if not (fa and fb) else "same" if fa == fb else "different"
            tr[k] += 1
            if len(tr_ex) < 25:
                tr_ex.append([ident, a[3], a[4], fa, b[2], b[4], fb])
# renames: a composite FIGI that appears under two different tickers on non-overlapping consecutive spans
figi_tickers = collections.defaultdict(set)
for ident, L in rle.items():
    for s in L:
        if s[3]:
            figi_tickers[s[3]].add(pop["identities"][ident]["ticker"])
renames = {f: sorted(ts) for f, ts in figi_tickers.items() if len(ts) > 1}
inv = {"coverage_by_year": {y: dict(c) for y, c in sorted(cov.items())},
       "stability_per_frozen_identity": {k: dict(v) for k, v in stab.items()},
       "identities_with_flip_back": dict(flip),
       "figi_changes_cik_same": figi_change_with_cik_same, "figi_changes_cik_changed_or_null": figi_change_with_cik_change,
       "figi_change_examples": figi_change_examples,
       "same_day_figi_shared_by_2plus_tickers_by_year": dict(figi_multi_ticker_days), "figi_shared_examples": figi_ex,
       "same_day_cik_shared_by_2plus_tickers_by_year": dict(cik_multi_ticker_days), "cik_shared_examples": cik_ex,
       "nyse_nasdaq_transfers_figi": dict(tr), "transfer_examples": tr_ex,
       "figis_seen_under_2plus_tickers": len(renames), "rename_examples": dict(list(sorted(renames.items()))[:40])}
dump("I02_identifier_inventory.json", inv)
foc = {}
for t in focus:
    days = focus_daily.get(t, [])
    segs = []
    for d, ident, cik, figi, sfigi, mic in days:
        if segs and segs[-1]["ident"] == ident and (segs[-1]["cik"], segs[-1]["figi"], segs[-1]["sfigi"], segs[-1]["mic"]) == (cik, figi, sfigi, mic):
            segs[-1]["to"] = d
            segs[-1]["n"] += 1
        else:
            segs.append({"from": d, "to": d, "n": 1, "ident": ident, "cik": cik, "figi": figi, "sfigi": sfigi, "mic": mic})
    foc[t] = {"identities": by_t.get(t, []), "segments": segs,
              "ledger": {i: rows_by.get(i, []) for i in by_t.get(t, [])},
              "records": {k: refs[k].get(t) for k in refs}}
dump("I03_focus_tickers.json", foc)
json.dump({i: L for i, L in rle.items()}, open(os.path.join(OUT, "I04_dated_ids_rle.json"), "w"), separators=(",", ":"))
log("ALL DONE")
