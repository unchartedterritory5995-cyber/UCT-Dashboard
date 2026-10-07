"""Exchange Breadth V1 — build + prove the live identity-continuity state from the ACCEPTED population.

Usage: python3 build_identity_state.py OUT DATED_IDS_RLE.json

Read-only over the accepted population / ledger / reference snapshots; writes only OUT.
  1. replay every population member-session (2008-01-02..2026-09-24, the frozen history) through
     IdentityState with the key the ACCEPTED LEDGER used (snapshot tag LEDGER);
  2. apply the real later snapshots in order — B1 09-30, B2 10-01, B3 10-02 — as ENRICHMENT of the
     processed history, then append the post-freeze population sessions (09-25..10-01, whose ledger
     keys came from B3); then apply B3 AGAIN (must be idempotent);
  3. prove: no reassignment, no duplicate owner, no orphan member-session, exact ledger-key bridge,
     venue status identical through the bridge under every snapshot's keys (vs. the raw-key lookup
     that loses re-keyed names), causal truncation, the 27-name regression set and reuse cases.
"""
import collections
import hashlib
import json
import os
import sys
import time

OUT, RLE = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import identity_model as im  # noqa: E402

X = "/data/_audit/exch_v1"
VIN = "/data/breadth_v2_producer/vintages"
REFS = [("A", "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json"),
        ("B1_0930", f"{VIN}/p202609302026/inputs_p202609302026/pit_reference.json"),
        ("B2_1001", f"{VIN}/p202610012031/inputs_p202610012031/pit_reference.json"),
        ("B3_1002", f"{VIN}/p202610022300/inputs_p202610022300/pit_reference.json")]
FROZEN_END = "2026-09-24"
T0 = time.time()


def log(*a):
    print(time.strftime("%H:%M:%S"), f"+{time.time() - T0:.0f}s", *a, flush=True)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def resolve(recs, d):
    hits = [r for r in (recs or []) if not ((r.get("delisted_utc") or "")[:10] and d > r["delisted_utc"][:10])
            and not ((r.get("list_date") or "")[:10] and d < r["list_date"][:10])]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


def keyof(t, rec):
    return None if rec is None else f"{t}|{rec.get('delisted_utc') or 'active'}"


WATCH = {"FINAL": X + "/final/breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db",
         "DERIVED": X + "/final/breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db",
         "LEDGER": X + "/venue_ledger_72eef1c2.json",
         "V2C2": "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_2026-09-29.db"}
before = {k: sha(p) for k, p in WATCH.items()}
pop = json.load(open(X + "/population.json"))
S = pop["sessions"]
iend = max(i for i, d in enumerate(S) if d <= FROZEN_END)
led = json.load(open(WATCH["LEDGER"]))["rows"]
rows_by = collections.defaultdict(list)
for r in led:
    rows_by[r[0]].append((r[2], r[3], r[4]))
rle = json.load(open(RLE))
refs = {n: json.load(open(p)) for n, p in REFS}
members = [[] for _ in S]                    # (ticker, ledger key, cik, figi)
for ident, e in pop["identities"].items():
    t = e["ticker"]
    segs = rle.get(ident, [])
    k = 0
    for a, b in e["runs"]:
        for i in range(a, b + 1):
            while k < len(segs) and segs[k][1] < i:
                k += 1
            cik = figi = None
            if k < len(segs) and segs[k][0] <= i <= segs[k][1]:
                cik, figi = segs[k][2], segs[k][3]
            members[i].append((t, ident, cik, figi))
log("members built", sum(len(m) for m in members))


def status(key, d):
    hit = [s for f, t_, s in rows_by.get(key, ()) if f <= d <= t_]
    return hit[0] if len(hit) == 1 else ("NOROW" if not hit else "MULTI")


def replay(upto):
    st = im.IdentityState(S)
    for i in range(0, upto + 1):
        st.observe(i, members[i], "LEDGER")
    return st


rep = {"inputs": {"population_sha256": sha(X + "/population.json"), "dated_ids_rle_sha256": sha(RLE),
                  "refs": {n: sha(p) for n, p in REFS}, "model": im.MODEL_VERSION, "gap": im.GAP}}
st = replay(iend)
st.snapshots.append("A(LEDGER keys) through " + FROZEN_END)
idx_A = json.dumps(st.to_doc()["ticker_index"], sort_keys=True)
log("replay A done", len(st.sids))

# ── causal truncation: a state built only to an earlier cutoff assigns the same SIDs ───────────
trunc = {}
for cut in ("2012-12-31", "2019-12-31"):
    ci = max(i for i, d in enumerate(S) if d <= cut)
    t2 = replay(ci)
    diff = sum(1 for i in range(ci + 1) for (t, *_x) in members[i] if t2.sid_at(t, i) != st.sid_at(t, i))
    trunc[cut] = {"member_sessions": sum(len(members[i]) for i in range(ci + 1)), "different_sid": diff}
    log("truncate", cut, trunc[cut])
rep["causal_truncation"] = trunc

# ── apply later snapshots: enrichment of processed sessions (+ the append, for B3) ─────────────
def apply_snapshot(name, append):
    """ONE snapshot application: re-observe every processed session with this snapshot's keys
    (enrichment only), then — for the snapshot the post-freeze population was built from — append
    the new sessions with their ledger keys and enrich those too. Returns per-snapshot counts."""
    R = refs[name]
    none = moved = 0
    if append:
        for i in range(iend + 1, len(S)):
            st.observe(i, members[i], "LEDGER")
    for i in sorted(st.processed):
        d = S[i]
        mm = []
        for t, ident, cik, figi in members[i]:
            k = keyof(t, resolve(R.get(t), d))
            if k is None:
                none += 1                      # this snapshot would not make it a member at all
                continue
            moved += k != ident
            mm.append((t, k, cik, figi))
        st.observe(i, mm, name)
    return {"member_sessions_rekeyed_vs_ledger_key": moved, "member_sessions_unresolvable_under_snapshot": none}


snap_rep = {}
hist_sessions = range(0, iend + 1)
for name, _p in REFS[1:]:
    snap_rep[name] = apply_snapshot(name, append=(name == "B3_1002"))
    hist_idx = {t: [r for r in runs if r[0] <= FROZEN_END] for t, runs in st.to_doc()["ticker_index"].items()}
    snap_rep[name]["history_ticker_index_unchanged"] = json.dumps(
        {t: [[a, min(b, FROZEN_END), sid] for a, b, sid in v] for t, v in hist_idx.items() if v}, sort_keys=True) ==         json.dumps({t: [[a, min(b, FROZEN_END), sid] for a, b, sid in v] for t, v in json.loads(idx_A).items()}, sort_keys=True)
    st.snapshots.append(name + (" enrichment + append" if name == "B3_1002" else " enrichment"))
    log("apply", name, snap_rep[name])
doc1 = st.to_doc()
h1 = im.doc_hash(dict(doc1, snapshots=None))
apply_snapshot("B3_1002", append=True)                         # the SAME application again
doc2 = st.to_doc()
rep["snapshots"] = snap_rep
rep["idempotent_second_B3"] = im.doc_hash(dict(doc2, snapshots=None)) == h1

# ── invariants over EVERY population member-session ──────────────────────────────────────────
inv = collections.Counter()
ex = collections.defaultdict(list)
own = collections.defaultdict(dict)
for t, runs in st.at.items():
    for (a, b, sid), (a2, b2, s2) in zip(runs, runs[1:]):
        if a2 <= b:
            inv["overlapping_owner_runs"] += 1
for i in range(len(S)):
    for t, ident, cik, figi in members[i]:
        sid = st.sid_at(t, i)
        if sid is None:
            inv["orphan_member_session"] += 1
            continue
        lk = im.ledger_key(st, sid, i)
        if lk != ident:
            inv["bridge_key_mismatch"] += 1
            if len(ex["bridge"]) < 10:
                ex["bridge"].append([t, S[i], ident, lk, sid])
inv["sids"] = len(st.sids)
rep["invariants"] = dict(inv)
rep["invariant_examples"] = dict(ex)

# ── venue status through the bridge vs raw-key lookup, under every snapshot's keys ───────────
ven = {}
for name, _p in REFS:
    R = refs[name]
    raw_lost = bridge_diff = n = 0
    lost_names = collections.Counter()
    for i in hist_sessions:
        d = S[i]
        for t, ident, cik, figi in members[i]:
            k = keyof(t, resolve(R.get(t), d))
            if k is None:
                continue
            n += 1
            truth = status(ident, d)
            if status(k, d) != truth:
                raw_lost += 1
                lost_names[t] += 1
            lk = im.ledger_key(st, st.sid_at(t, i), i)
            if status(lk, d) != truth:
                bridge_diff += 1
    ven[name] = {"member_sessions": n, "raw_key_lookup_changes_status": raw_lost,
                 "raw_key_names": dict(lost_names), "sid_bridge_changes_status": bridge_diff}
    log("venue", name, raw_lost, bridge_diff)
rep["venue_through_bridge"] = ven

# ── the regression set + reuse cases ────────────────────────────────────────────────────────
reg = {}
for t in ("AIXC", "AMZE", "DBRG", "DOMO", "FGNX", "GBTG", "GETY", "HVII", "IPEX", "RILYN", "SBXD", "TBPH", "VRME",
          "ACCV", "ADRX", "CHWM", "FFR", "FGC", "FJDI", "GOW", "HUCK", "IVAI", "ONEN", "OPNW", "PNAQ", "RZAI", "VYLR",
          "ACI", "ABX", "IPW", "KW", "META", "AA", "GOOG", "GOOGL", "BRK.A", "BRK.B", "WMT", "PEP", "ORCL", "LIN",
          "SEG", "LEU", "UAMY", "BMNR", "BHLB", "BBT", "GOLD", "B"):
    runs = st.at.get(t, [])
    reg[t] = {"owners": [[S[a], S[b], sid] for a, b, sid in runs],
              "sids": {sid: {"tickers": doc2["sids"][sid]["tickers"], "keys": sorted({k[0] for k in doc2["sids"][sid]["keys"]}),
                             "established": doc2["sids"][sid]["established"],
                             "delisted_learned": doc2["sids"][sid]["delisted_learned"],
                             "evidence": doc2["sids"][sid]["evidence"][:4]}
                       for sid in sorted({r[2] for r in runs})}}
rep["regression"] = reg

# ── fragmentation statistics ─────────────────────────────────────────────────────────────────
key_sids = collections.defaultdict(set)
for sid, r in doc2["sids"].items():
    for k in r["keys"]:
        if k[3] == "LEDGER":
            key_sids[k[0]].add(sid)
rule = collections.Counter(r["evidence"][0][1] for r in doc2["sids"].values())
reatt = sum(1 for r in doc2["sids"].values() for e in r["evidence"] if e[1] == "REATTACH")
rep["fragmentation"] = {"frozen_keys": len(key_sids), "sids": len(doc2["sids"]),
                        "frozen_keys_by_sid_count": dict(collections.Counter(min(len(v), 5) for v in key_sids.values())),
                        "sids_spanning_2plus_frozen_keys": sum(1 for r in doc2["sids"].values()
                                                               if len({k[0] for k in r["keys"] if k[3] == "LEDGER"}) > 1),
                        "sid_birth_rule": dict(rule), "reattachments": reatt,
                        "single_observation_sids": sum(1 for r in doc2["sids"].values() if r["n_obs"] == 1)}
after = {k: sha(p) for k, p in WATCH.items()}
rep["protected_hashes"] = {"before": before, "after": after, "unchanged": before == after}
sp = os.path.join(OUT, "exch_identity_state_v1.json")
blob = json.dumps(doc1, sort_keys=True, separators=(",", ":")).encode()
open(sp, "wb").write(blob)
rep["state"] = {"path": sp, "file_sha256": hashlib.sha256(blob).hexdigest(), "doc_hash": h1,
                "sids": len(doc1["sids"]), "sessions_processed": doc1["sessions_processed"]}
json.dump(rep, open(os.path.join(OUT, "IDENTITY_BUILD_REPORT.json"), "w"), indent=1, sort_keys=True, default=str)
log("ALL DONE", json.dumps({k: rep[k] for k in ("invariants", "idempotent_second_B3", "causal_truncation")}))
