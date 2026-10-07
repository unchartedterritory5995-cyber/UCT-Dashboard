"""Exchange Breadth V1 — full artifact validation, part B (ledger evidence, no-lookahead, lineage).

Read-only over /data/_audit/exch_v1 (population, dated/, tape_probes.jsonl, the 0444 ledger, the frozen
and live pit_reference). Writes ONLY into OUT.
Usage: python3 valB.py OUT SCRIPTS_DIR
"""
import collections
import gzip
import hashlib
import json
import os
import subprocess
import sys
import time

OUT, SCR = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
X = "/data/_audit/exch_v1"
LED = X + "/venue_ledger_72eef1c2.json"
POP = X + "/population.json"
P1 = X + "/code_p1_d580df7fd222"
REF_FROZEN = "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json"
REF_LIVE = "/data/breadth_v2_producer/vintages/p202610022300/inputs_p202610022300/pit_reference.json"
T0 = time.time()
sys.path.insert(0, X + "/code_grind_eff3eca45b2f/tools/breadth_v2cc")
import breadth_venue_ledger as vl  # noqa: E402


def log(*a):
    print(time.strftime("%H:%M:%S"), f"+{time.time() - T0:.0f}s", *a, flush=True)


def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p + ".tmp", "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
    os.replace(p + ".tmp", p)
    log("wrote", p)


LDOC = json.load(open(LED))
pop = json.load(open(POP))
S = pop["sessions"]
pos = {d: i for i, d in enumerate(S)}
res = {}

# ═════════════════════════════════════════════════════════════════════════════════════════
# 1. CORPUS + the 50/51 → 51/51 discrepancy: run BOTH checker versions against the exact ledger
# ═════════════════════════════════════════════════════════════════════════════════════════
orig = os.path.join(SCR, "check_ledger_ORIGINAL_2026-10-03T2125Z.py")
# the code_p1_d580df7fd222 directory name is md5(acquire+ledger+check_ledger, CR stripped)[:12] at
# ship time (22:06Z): proves the ORIGINAL checker is the one that ran at 22:20Z
blob = b"".join(open(p, "rb").read() for p in (P1 + "/acquire_tape_and_build.py", P1 + "/breadth_venue_ledger.py", orig))
res["p1_dirname_md5_reproduces_with_original_checker"] = hashlib.md5(blob.replace(b"\r", b"")).hexdigest()[:12] == "d580df7fd222"
blob2 = b"".join(open(p, "rb").read() for p in (P1 + "/acquire_tape_and_build.py", P1 + "/breadth_venue_ledger.py", P1 + "/check_ledger.py"))
res["p1_dirname_md5_with_current_checker"] = hashlib.md5(blob2.replace(b"\r", b"")).hexdigest()[:12]
res["checker_sha256"] = {"original": hashlib.sha256(open(orig, "rb").read()).hexdigest(),
                         "current_on_runner": hashlib.sha256(open(P1 + "/check_ledger.py", "rb").read()).hexdigest()}
for tag, script in (("original", orig), ("current", P1 + "/check_ledger.py")):
    d = os.path.join(OUT, "checker_" + tag)
    os.makedirs(d, exist_ok=True)
    for fn, src in (("population.json", POP), ("venue_ledger.json", LED)):
        if not os.path.exists(os.path.join(d, fn)):
            os.symlink(src, os.path.join(d, fn))
    # the checker imports breadth_venue_ledger from its own directory: run a copy beside the exact module
    run_dir = os.path.join(d, "code")
    os.makedirs(run_dir, exist_ok=True)
    for fn, src in (("check_ledger.py", script), ("breadth_venue_ledger.py", P1 + "/breadth_venue_ledger.py")):
        open(os.path.join(run_dir, fn), "wb").write(open(src, "rb").read())
    p = subprocess.run([sys.executable, os.path.join(run_dir, "check_ledger.py"), d, P1 + "/exchange_transfer_corpus.json"],
                       capture_output=True, text=True)
    rep = json.load(open(os.path.join(d, "ledger_report.json")))
    res["checker_" + tag] = {"stdout": p.stdout.strip(), "stderr": p.stderr.strip()[-500:],
                             "corpus_pass": rep["corpus_pass"], "corpus_total": rep["corpus_total"],
                             "missing": rep["member_sessions_without_ledger_row"],
                             "fails": [c for c in rep["corpus"] if not c["pass"]]}
# what -963703 is: Σ member sessions − Σ ledger-row spans (spans include in-stretch NON-member sessions)
spans = sum(pos[r[3]] - pos[r[2]] + 1 for r in LDOC["rows"])
members = sum(b - a + 1 for e in pop["identities"].values() for a, b in e["runs"])
res["minus_963703_decomposition"] = {"member_sessions": members, "ledger_row_span_sessions": spans,
                                     "difference": members - spans,
                                     "explanation": "original checker: missing = member sessions − sessions spanned by ledger rows; "
                                                    "rows deliberately span non-trading gaps inside a dated stretch, so the "
                                                    "difference is negative and is NOT a coverage measure"}
# NVA facts behind the single original-checker failure
nva = [i for i in pop["identities"] if i.startswith("NVA|")][0]
mem = sorted(i for a, b in pop["identities"][nva]["runs"] for i in range(a, b + 1))
eff = pos["2026-06-17"]
res["NVA"] = {"identity": nva, "rows": [r[:7] for r in LDOC["rows"] if r[0] == nva],
              "previous_calendar_session": S[eff - 1], "previous_calendar_session_is_member": (eff - 1) in mem,
              "previous_member_session": S[max(i for i in mem if i < eff)],
              "non_member_sessions_before_effective": [S[i] for i in range(max(i for i in mem if i < eff) + 1, eff)]}
dump("B01_corpus_and_checker.json", res)

# independent corpus evaluation with an OWN lookup over raw rows
rows_by = collections.defaultdict(list)
for r in LDOC["rows"]:
    rows_by[r[0]].append((r[2], r[3], r[4]))


def own_status(ident, d):
    hit = [s for f, t, s in rows_by.get(ident, ()) if f <= d <= t]
    return hit[0] if len(hit) == 1 else ("NOROW" if not hit else "MULTI")


corpus = json.load(open(P1 + "/exchange_transfer_corpus.json"))
ind = []
for c in corpus:
    ids = [c["identity"]] if c.get("identity") else [i for i in pop["identities"] if i.split("|")[0] == c["ticker"]]
    for ident in ids:
        mem = sorted(i for a, b in pop["identities"][ident]["runs"] for i in range(a, b + 1))
        before = [i for i in mem if i < pos[c["effective"]]]
        if not before:
            continue
        b_, a_ = own_status(ident, S[before[-1]]), own_status(ident, c["effective"])
        if pos[c["effective"]] in mem or a_ != "NOROW":
            ind.append({"ticker": c["ticker"], "identity": ident, "effective": c["effective"],
                        "expected": [c["before"], c["after"]], "got": [b_, a_],
                        "prev_member_session": S[before[-1]], "effective_is_member": pos[c["effective"]] in mem,
                        "pass": [b_, a_] == [c["before"], c["after"]]})
            break
res2 = {"independent_corpus_pass": sum(x["pass"] for x in ind), "independent_corpus_total": len(corpus),
        "evaluated": len(ind), "cases": ind}
dump("B02_corpus_independent.json", res2)
log("corpus", res["checker_original"]["stdout"], "|", res["checker_current"]["stdout"], "| independent",
    res2["independent_corpus_pass"], "/", len(corpus))

# ═════════════════════════════════════════════════════════════════════════════════════════
# 2. EVIDENCE: reload dated states + probes exactly as the build did; rebuild the ledger; truncation
# ═════════════════════════════════════════════════════════════════════════════════════════
members_by_day = [[] for _ in S]
for ident, e in pop["identities"].items():
    for a, b in e["runs"]:
        for i in range(a, b + 1):
            members_by_day[i].append(ident)
states = {ident: [] for ident in pop["identities"]}
lineage = collections.defaultdict(lambda: collections.defaultdict(set))   # ident -> {"cik","figi","sfigi","type"} -> set
xnys_by_day, xnas_by_day = [], []
for i, d in enumerate(S):
    with gzip.open(os.path.join(X, "dated", f"{d}.json.gz"), "rt") as fh:
        dated = json.load(fh)
    venues, info = {}, {}
    for mic, rows in dated.items():
        for r in rows:
            venues.setdefault(r[0], set()).add(mic)
            info.setdefault(r[0], []).append(r)
    xnys_by_day.append(len(dated.get("XNYS", [])))
    xnas_by_day.append(sum(len(dated.get(m, [])) for m in ("XNAS", "XNGS", "XNMS", "XNCM")))
    for ident in members_by_day[i]:
        t = pop["identities"][ident]["ticker"]
        states[ident].append((i, vl.dated_class(venues.get(t, ()))))
        for r in info.get(t, ()):
            if r[2]:
                lineage[ident]["cik"].add(r[2])
            if len(r) > 3 and r[3]:
                lineage[ident]["figi"].add(r[3])
            if len(r) > 1 and r[1]:
                lineage[ident]["type"].add(r[1])
    if i % 500 == 0:
        log("states", d)
probes = {}
for line in open(X + "/tape_probes.jsonl"):
    p = json.loads(line)
    probes[(p[0], p[1])] = p[3]
log("probes", len(probes))


def build(cut=None):
    rows = []
    for ident in sorted(states):
        st = [(i, s) for i, s in states[ident] if cut is None or i <= cut]
        if not st:
            continue
        idx = [i for i, _ in st]
        sess = [S[i] for i in idx]
        ta = {k: probes[(ident, g)] for k, g in enumerate(idx) if (ident, g) in probes and (cut is None or g <= cut)}
        rows += [c.row() for c in vl.segment(ident, pop["identities"][ident]["ticker"], sess, [s for _, s in st], ta)]
    return rows


full = build()
rb = {"rebuilt_rows": len(full), "rebuilt_content_sha256": vl.ledger_hash(full),
      "matches_72eef1c2": vl.ledger_hash(full) == LDOC["sha256"]}
# evidence audit: every NYSE member-session has a dated XNYS listing that session; every NASDAQ one has
# either a dated Nasdaq listing or a UTP tape class for its segment; OTHER never on a Nasdaq/NYSE dated day
L = vl.Ledger(LDOC["rows"])
aud = collections.Counter()
aud_ex = collections.defaultdict(list)
for ident, st in states.items():
    for i, (dc, mic) in st:
        s, m = L.status_on(ident, S[i])
        k = f"{s}|dated:{dc}"
        aud[k] += 1
        bad = (s == "NYSE" and dc != "NYSE") or (s == "OTHER" and dc != "OTHER")
        if bad and len(aud_ex[k]) < 10:
            aud_ex[k].append([ident, S[i]])
rb["status_vs_dated_class_member_sessions"] = dict(aud)
rb["violations_NYSE_without_dated_XNYS_or_OTHER_without_dated_other"] = {k: v for k, v in aud_ex.items()}
rb["dated_counts_per_session_2008_2010"] = {S[i]: [xnys_by_day[i], xnas_by_day[i]] for i in range(len(S)) if S[i] < "2011"}
dump("B03_ledger_rebuild_and_evidence.json", rb)
log("rebuild", rb["matches_72eef1c2"])

# truncation (no-lookahead): a ledger built only from evidence up to CUT must agree with the full ledger
# on every member session ≤ CUT
fullL = L
trunc = {}
for cut_d in ("2009-06-10", "2010-12-31", "2013-12-31", "2017-12-29", "2021-12-31", "2025-06-30"):
    cut = max(i for i, d in enumerate(S) if d <= cut_d)
    tl = vl.Ledger(build(cut))
    diff = collections.Counter()
    ex = []
    n = 0
    for ident, st in states.items():
        for i, _ in st:
            if i > cut:
                break
            n += 1
            a, b = fullL.status_on(ident, S[i])[0], tl.status_on(ident, S[i])[0]
            if a != b:
                diff[f"{a}->{b}"] += 1
                if len(ex) < 25:
                    ex.append([ident, S[i], a, b])
    trunc[cut_d] = {"member_sessions_checked": n, "differences": dict(diff), "n_diff": sum(diff.values()), "examples": ex}
    log("truncate", cut_d, n, dict(diff))
dump("B04_truncation_no_lookahead.json", trunc)

# ═════════════════════════════════════════════════════════════════════════════════════════
# 3. LATER METADATA: identity assignment under the LATER reference snapshot (live 2026-10-02 vintage)
# ═════════════════════════════════════════════════════════════════════════════════════════
rf = json.load(open(REF_FROZEN))
rl = json.load(open(REF_LIVE))


def resolve(recs, d):
    if not recs:
        return None
    hits = [r for r in recs if not ((r.get("list_date") or "")[:10] and d < r["list_date"][:10])
            and not ((r.get("delisted_utc") or "")[:10] and d > r["delisted_utc"][:10])]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


changed_t = [t for t in set(rf) | set(rl) if rf.get(t) != rl.get(t)]
meta = {"tickers_frozen": len(rf), "tickers_live": len(rl), "tickers_with_changed_records": len(changed_t)}
diff = collections.Counter()
ex = []
pop_t = collections.defaultdict(list)
for ident, e in pop["identities"].items():
    pop_t[e["ticker"]].append(ident)
for t in changed_t:
    for ident in pop_t.get(t, ()):
        for a, b in pop["identities"][ident]["runs"]:
            for i in range(a, b + 1):
                if S[i] > "2026-09-24":
                    continue
                r1, r2 = resolve(rf.get(t), S[i]), resolve(rl.get(t), S[i])
                i1 = f"{t}|{(r1 or {}).get('delisted_utc') or 'active'}" if r1 else None
                i2 = f"{t}|{(r2 or {}).get('delisted_utc') or 'active'}" if r2 else None
                ok_member = r2 is not None and r2.get("type") in ("CS", "ADRC")
                if i1 != i2 or not ok_member:
                    diff["identity_changed" if i1 != i2 else "membership_changed"] += 1
                    if len(ex) < 25:
                        ex.append([t, S[i], i1, i2, (r2 or {}).get("type")])
                else:
                    diff["same"] += 1
meta["member_sessions_of_changed_tickers"] = dict(diff)
meta["examples"] = ex
dump("B05_later_metadata.json", meta)
log("later metadata", dict(diff))

# ═════════════════════════════════════════════════════════════════════════════════════════
# 4. LINEAGE: CIK / FIGI stability per identity (dated list rows on member sessions)
# ═════════════════════════════════════════════════════════════════════════════════════════
lin = {"identities_with_dated_rows": len(lineage)}
multi = {k: [] for k in ("cik", "figi")}
for ident, dct in lineage.items():
    for k in ("cik", "figi"):
        if len(dct[k]) > 1:
            multi[k].append([ident, sorted(dct[k]), [r[2:5] for r in LDOC["rows"] if r[0] == ident]])
lin["identities_multi_cik"] = len(multi["cik"])
lin["identities_multi_figi"] = len(multi["figi"])
lin["multi_cik_examples"] = multi["cik"][:40]
lin["multi_figi_examples"] = multi["figi"][:40]
# does a CIK change coincide with a venue change inside one identity? (would signal two securities merged)
co = 0
for ident, ciks, rows in multi["cik"]:
    if len({r[2] for r in rows}) > 1:
        co += 1
lin["multi_cik_identities_with_venue_change"] = co
# CIKs shared by >1 identity of the SAME ticker = genuine reuse vs continuation
by_t = collections.defaultdict(list)
for ident in pop["identities"]:
    by_t[ident.split("|")[0]].append(ident)
reuse = []
for t, ids in by_t.items():
    if len(ids) > 1:
        reuse.append({"ticker": t, "identities": {i: {"cik": sorted(lineage[i]["cik"]), "figi": sorted(lineage[i]["figi"]),
                                                      "member_span": [S[pop["identities"][i]["runs"][0][0]], S[pop["identities"][i]["runs"][-1][1]]],
                                                      "ledger": [r[2:5] for r in LDOC["rows"] if r[0] == i]} for i in ids}})
lin["reused_tickers"] = reuse
dump("B06_lineage.json", lin)
log("lineage", lin["identities_multi_cik"], lin["identities_multi_figi"], co)
log("ALL DONE")
