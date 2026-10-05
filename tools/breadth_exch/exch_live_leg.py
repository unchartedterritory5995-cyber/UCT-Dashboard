"""Exchange Breadth V1 — THE LIVE LEG (orchestrator). Run through launch.py (pinned overlay).

argv: --store DIR [--mode append|proof] [--substitute JSON] [--pin-vintage TAG] [--through DATE]
      [--max-sessions N] --code-commit SHA [--crash-at BOUNDARY (proof stores only)]

For every completed trading session after the frozen history (in order, no holes):
  OWNER VINTAGE   live_core.owner_vintage — the vintage the US V2 producer published the session from,
                  hash-verified in the exchange vintage archive; refusal STOPS the append
  WORKER          live_session_worker.py (one process per vintage): exchange-pin preflight, membership
                  via identity_model.Bridge (≤ ledger end) or live venue evidence (after), compute twice
  VALIDATE        independently of the engine: membership vs raw ledger rows / raw evidence, partitions,
                  adv+dec+unch == directional, exchange lists == US lists restricted, persisted == captured,
                  US rows == the US V2 producer's published rows for the session (except `unchanged`)
  IDENTITY        sessions after the accepted identity state's horizon are observed into a versioned
                  SUCCESSOR state (the 0444 parent is never written)
  DERIVED         AD / MCO / MCS continued from the frozen boundary state (live_core.derive_step)
  COMMIT          one atomic transaction per session; the completion marker is written last
Writes ONLY under --store. Reads the producer's state/canonical stores immutable. Publishes nothing.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "identity"))
import identity_model as im         # noqa: E402
import live_core as lc              # noqa: E402

X = "/data/_audit/exch_v1"
PARENTS = {
    "historical": (X + "/final/breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db",
                   "e65b2af0779d5ff8cdce8668f866f0889e070207a260e88a64cd9d38c37462a0"),
    "derived": (X + "/final/breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db",
                "f9ed6966dfd7d6d5459761f06f8224cfc1f1807e42a9f088279bc8b164634d86"),
    "ledger": (X + "/venue_ledger_72eef1c2.json", "4ccf140fecd30ed4a4a54d9ca2ad3f6dfb92cb53f02bb8e4054df1bf19b40d63"),
    "identity_state": (X + "/identity_v1_20261005/state/exch_identity_state_v1.json",
                       "0acbe59fe1e86549a5e92e8445a2d5b1e63f189e68cbfaf0d301b775106cd8f3"),
}
ARCHIVE = X + "/live_v1/vintage_archive"
PROD = "/data/breadth_v2_producer"
PINS = os.path.join(HERE, "pinned", "breadth_exch_live_pins.json")
# ⛔ The ONLY owner-vintage substitutions ever accepted: an owner-approved, hash-pinned file. Changing the file
# without changing this pin (i.e. without a reviewed code change) refuses every run.
EXCEPTIONS = os.path.join(HERE, "pinned", "breadth_exch_owner_vintage_exceptions.json")
EXCEPTIONS_SHA256 = "3ddf3ac75675eccdae78b3c95ddaaa0a3a835f97aed2c3734c7eede8e5141f91"
LAUNCH = X + "/code_grind_eff3eca45b2f/tools/breadth_v2cc/launch.py"
FROZEN_END, NYSE_START, NASDAQ_START = "2026-09-24", "2009-06-11", "2008-01-02"
EX = (("nyse", "NYSE", NYSE_START), ("nasdaq", "NASDAQ", NASDAQ_START))

ap = argparse.ArgumentParser()
ap.add_argument("--store", required=True)
ap.add_argument("--mode", default="append", choices=("append", "proof"))
ap.add_argument("--substitute", default="{}")
ap.add_argument("--pin-vintage", default=None)
ap.add_argument("--through", default=None)
ap.add_argument("--max-sessions", type=int, default=0)
ap.add_argument("--code-commit", default="unrecorded")    # argv, not env: launch.py re-execs with PID 1's env
ap.add_argument("--crash-at", default=None)               # crash-test hook (proof stores only)
A = ap.parse_args()
SUB = json.loads(A.substitute)
if A.mode == "append" and (SUB or A.pin_vintage):
    raise SystemExit("substitution / pinned vintage are PROOF-only diagnostics — refusing in append mode")
CRASH = A.crash_at
if CRASH and A.mode != "proof":
    raise SystemExit("--crash-at is a proof-store test hook — refusing in append mode")


def crash(point):
    if CRASH == point:
        print("CRASH HOOK", point, flush=True)
        os._exit(97)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


os.makedirs(A.store, exist_ok=True)
lock = open(os.path.join(A.store, ".lock"), "w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
for name, (p, want) in PARENTS.items():
    if lc.sha_file(p) != want:
        raise SystemExit(f"PARENT HASH MISMATCH {name}")
if lc.sha_file(EXCEPTIONS) != EXCEPTIONS_SHA256:
    raise SystemExit("EXCEPTION_FILE_UNPINNED: the owner-vintage exceptions file does not match its reviewed pin")
EXC = lc.validate_exceptions(json.load(open(EXCEPTIONS)))
STORE = lc.Store(os.path.join(A.store, "exch_live_candidate_v1.db" if A.mode == "append" else "exch_live_PROOF.db"))
code_commit = A.code_commit
STORE.init_lineage({"mode": A.mode, "historical_sha256": PARENTS["historical"][1], "derived_sha256": PARENTS["derived"][1],
                    "ledger_sha256": PARENTS["ledger"][1], "identity_parent_sha256": PARENTS["identity_state"][1],
                    "pins_sha256": lc.sha_file(PINS), "owner_vintage_exceptions_sha256": EXCEPTIONS_SHA256,
                    "code_commit": code_commit, "frozen_end": FROZEN_END,
                    "nyse_start": NYSE_START, "nasdaq_start": NASDAQ_START,
                    "substitution": json.dumps(SUB, sort_keys=True), "pinned_vintage": A.pin_vintage or "",
                    "authority": "NOT member-authoritative" + ("" if A.mode == "append" else " — PROOF STORE, NOT A CANDIDATE")})

# ── producer records (immutable reads) ─────────────────────────────────────────────────────────
ps = sqlite3.connect(f"file:{PROD}/state.db?immutable=1", uri=True)
PSESS = {d: (s, v, p) for d, s, v, p in ps.execute("SELECT date, state, vintage, pub_id FROM session")}
pc = sqlite3.connect(f"file:{PROD}/v2_live.db?immutable=1", uri=True)
PPUB = {d: (p, json.loads(pr)) for d, p, pr in pc.execute("SELECT date, pub_id, provenance FROM v2_session")}
PROWS = {}
for u, d, m, o, h, l, c, s in pc.execute("SELECT universe, date, metric, o, h, l, c, source FROM v2_row WHERE universe='us'"):
    PROWS[(d, m)] = (o, h, l, c, s)

# ── archive every READY producer vintage before the producer can prune it ──────────────────
READY = [r[0] for r in ps.execute("SELECT tag FROM vintage WHERE state='ready'")]
ARCHIVAL = lc.archive_vintages(os.path.join(PROD, "vintages"), READY, ARCHIVE, code_commit=A.code_commit)

# ── frozen boundary: ledger end, derived trend state (must reproduce every frozen value) ─────
LDOC = json.load(open(PARENTS["ledger"][0]))
LEDGER_END = max(r[3] for r in LDOC["rows"])
hc = sqlite3.connect(f"file:{PARENTS['historical'][0]}?immutable=1", uri=True)
dc = sqlite3.connect(f"file:{PARENTS['derived'][0]}?immutable=1", uri=True)
frozen_der = {}
for s_, d, v in dc.execute("SELECT series, date, value FROM derived_series"):
    frozen_der[(s_, d)] = v
BOUNDARY = {}
for u, X_, start in EX:
    vals_ = {}
    for d, m, v in hc.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND "
                              "metric IN ('advancing','declining') AND date>=?", (u, start)):
        vals_.setdefault(d, {})[m] = v
    stt = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
    for d in sorted(vals_):
        stt, out = lc.derive_step(stt, vals_[d].get("advancing"), vals_[d].get("declining"))
        for k in ("AD", "MCO", "MCS"):
            if out[k] != frozen_der.get((f"{X_}:{k}", d)):
                raise SystemExit(f"BOUNDARY FOLD DOES NOT REPRODUCE FROZEN {X_}:{k} {d}")
    BOUNDARY[X_] = stt

# ── the session plan ─────────────────────────────────────────────────────────────────────────
sys.path.insert(0, "/app")
from api.services import breadth_calendar as bcal  # noqa: E402  (overlaid pinned calendar)
from zoneinfo import ZoneInfo  # noqa: E402
today_et = dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo("America/New_York")).date()
plan, d = [], dt.date.fromisoformat(FROZEN_END) + dt.timedelta(days=1)
while d < today_et:
    if bcal.is_trading_day(d.isoformat()):
        plan.append(d.isoformat())
    d += dt.timedelta(days=1)
if A.through:
    plan = [x for x in plan if x <= A.through]
done_ = STORE.completed()
if done_ != plan[:len(done_)]:
    raise SystemExit(f"STORE SEQUENCE CORRUPT: {done_} is not a prefix of the plan")
todo = plan[len(done_):]
if A.max_sessions:
    todo = todo[:A.max_sessions]

# identity: the accepted parent (never written) or this store's latest successor
idir = os.path.join(A.store, "identity")
os.makedirs(idir, exist_ok=True)
pop_sessions = json.load(open(X + "/population.json"))["sessions"]
chain = sorted(f for f in os.listdir(idir) if f.startswith("state_") and f.endswith(".json") and "MANIFEST" not in f)
cur_path = os.path.join(idir, chain[-1]) if chain else PARENTS["identity_state"][0]
cur_doc = json.load(open(cur_path))
HORIZON = cur_doc["sessions_processed"][1]
id_sessions = pop_sessions + [x for x in plan if x > pop_sessions[-1]]
IDS = im.IdentityState.from_doc(cur_doc, id_sessions)
id_changed, id_delta = False, {"new_sids": [], "observed_sessions": []}
ROWS_BY = {}
for r in LDOC["rows"]:
    ROWS_BY.setdefault(r[0], []).append((r[2], r[3], r[4]))


def own_status_ledger(t, d, doc):
    """Independent of identity_model.Bridge: raw ticker_index + raw ledger rows."""
    runs = [r for r in doc["ticker_index"].get(t, ()) if r[0] <= d]
    if not runs:
        return "absent"
    sid = runs[-1][2]
    keys = {k[0] for k in doc["sids"][sid]["keys"] if k[3] == "LEDGER" and k[0].rsplit("|", 1)[0] == t} & set(ROWS_BY)
    cov = [s for k in keys for f, tt, s in ROWS_BY[k] if f <= d <= tt]
    return cov[0] if len(cov) == 1 else "CONFLICT" if cov else ("UNRESOLVED" if keys else "absent")


def own_classify(dated_class, tape):
    """An independent restatement of the accepted rule table (breadth_venue_ledger docstring)."""
    tc = None if tape is None else "UTP" if tape == 3 else "CTA" if tape in (1, 2) else "UNKNOWN"
    if tc == "UNKNOWN" or dated_class == "CONFLICT":
        return "CONFLICT"
    if dated_class == "NYSE":
        return "NASDAQ" if tc == "UTP" else "NYSE"
    if dated_class == "NASDAQ":
        return "UNRESOLVED" if tc == "CTA" else "NASDAQ"
    if dated_class == "OTHER":
        return "NASDAQ" if tc == "UTP" else "OTHER"
    return "NASDAQ" if tc == "UTP" else "UNRESOLVED"


def priors_for(d):
    prev_live = [x for x in plan if x < d][-9:]
    prev_hist = [r[0] for r in hc.execute("SELECT DISTINCT date FROM breadth_daily_ohlc WHERE date<=? ORDER BY date DESC "
                                          "LIMIT 9", (FROZEN_END,))]
    rows = []
    for x in sorted(set(prev_live) | set(prev_hist))[-9:]:
        src = hc if x <= FROZEN_END else STORE.c
        rows += src.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=? AND "
                            "metric IN ('up_4pct_today','down_4pct_today') AND universe IN ('us','nyse','nasdaq')",
                            (x,)).fetchall()
    return [list(r) for r in rows]


status = {"mode": A.mode, "plan": plan, "completed_before": done_, "appended": [], "refused": None,
          "proof_findings": {}, "vintage_archival": ARCHIVAL, "started_utc": now()}
for D in todo:
    # ── owner vintage (first-containing) ──
    try:
        if A.pin_vintage or D in SUB:
            tag = A.pin_vintage or SUB[D]
            ip = f"{ARCHIVE}/{tag}/inputs_{tag}"
            V = {"session": D, "tag": tag, "inputs_dir": ip, "grouped_dir": f"{ARCHIVE}/{tag}/grouped_{tag}",
                 "pub_id": (PSESS.get(D) or (None, None, ""))[2] or "", "owner_vintage_of_record": (PSESS.get(D) or (None, None))[1],
                 "PROOF_SUBSTITUTION": True, "input_manifest_sha256": lc.sha_file(ip + "/INPUT_MANIFEST.json"),
                 "reference_sha256": lc.sha_file(ip + "/pit_reference.json")}
        else:
            try:
                V = lc.owner_vintage(D, PSESS, PPUB, ARCHIVE)
                V = dict(V, owner_vintage_of_record=V["tag"], declared_exception=None)
            except lc.Refused as e0:
                if e0.reason != "OWNER_VINTAGE_MISSING":
                    raise
                # NOT a fallback: only an owner-approved, hash-pinned declaration for THIS session can proceed;
                # any undeclared session re-raises OWNER_VINTAGE_MISSING
                V = lc.declared_substitute(D, PSESS, PPUB, ARCHIVE, EXC)
        last = json.load(open(os.path.join(V["inputs_dir"], "INPUT_MANIFEST.json")))["last_session"]
        if D > last:                       # a vintage never "contains" a session after its own last session
            raise lc.Refused("VINTAGE_DOES_NOT_CONTAIN_SESSION", {"session": D, "vintage": V["tag"], "last_session": last})
        archive_inputs = V["inputs_dir"]
        remap = lc.build_remap(ARCHIVE, V["tag"], os.path.join(os.path.dirname(ARCHIVE), "remap"))
        V = dict(V, inputs_dir=remap["remap_inputs_dir"], grouped_dir=remap["grouped_dir"],
                 archive_inputs_dir=archive_inputs, remap=remap)
    except lc.Refused as e:
        status["refused"] = {"session": D, "reason": e.reason, "detail": e.detail}
        break
    # ── worker ──
    sd = os.path.join(A.store, "scratch")
    os.makedirs(sd, exist_ok=True)
    spec = {"session": D, "vintage": V, "tools_dir": HERE, "pins_path": PINS, "ledger": PARENTS["ledger"][0],
            "ledger_end": LEDGER_END, "identity_doc": cur_path, "evidence_dir": os.path.join(A.store, "evidence"),
            "nyse_start": NYSE_START, "nasdaq_start": NASDAQ_START, "priors": priors_for(D),
            "scratch": os.path.join(sd, D), "out": os.path.join(sd, D + ".result.json")}
    sp = os.path.join(sd, D + ".spec.json")
    json.dump(spec, open(sp, "w"), sort_keys=True)
    if os.path.exists(spec["out"]):
        os.remove(spec["out"])
    subprocess.run([sys.executable, LAUNCH, os.path.join(HERE, "live_session_worker.py"), sp],
                   cwd=os.path.dirname(LAUNCH), stdout=open(os.path.join(sd, D + ".log"), "w"), stderr=subprocess.STDOUT)
    R = json.load(open(spec["out"])) if os.path.exists(spec["out"]) else {"refused": "NO_OUTPUT"}
    if R.get("refused"):
        status["refused"] = {"session": D, "reason": "WORKER_" + R["refused"], "detail": R}
        break
    teq = lc.tables_equivalent(V["archive_inputs_dir"], V["inputs_dir"], V["remap"]["replaced_path"])
    if any(v.startswith("DIFFERENT") for v in teq.values()):
        status["refused"] = {"session": D, "reason": "REMAP_TABLES_DIFFER", "detail": teq}
        break
    crash("after_evidence")
    # ── independent validation ──
    cap, rows = R["capture"], [tuple(r) for r in R["rows"]]
    us, ny, na = (set(cap["universes"].get(u, [])) for u in ("us", "nyse", "nasdaq"))
    probs = []
    if ny & na or not ny <= us or not na <= us:
        probs.append("partition")
    ev = {r[1]: r for r in R["evidence_rows"]}
    for t in us:
        sid, key, st, src, rawkey, cik, figi = cap["member"][t]
        own = own_status_ledger(t, D, cur_doc) if D <= LEDGER_END else (
            own_classify(ev[t][3], ev[t][5]) if t in ev else "UNRESOLVED")
        if own != st:
            probs.append(f"status {t} {st}!={own}")
        if (t in ny) != (st == "NYSE" and D >= NYSE_START) or (t in na) != (st == "NASDAQ"):
            probs.append(f"membership {t}")
    vals = {(u, m): (o, h, l, c, s) for u, d_, m, o, h, l, c, s in rows}
    for u, mem in (("us", us), ("nyse", ny), ("nasdaq", na)):
        cl = cap["close"].get(u)
        if cl is None:
            probs.append(f"no close capture {u}")
            continue
        x, L = cl["values"], {k: set(v) for k, v in cl["lists"].items()}
        if x["advancing"] + x["declining"] + x["unchanged"] != x["_directional"]:
            probs.append(f"adv+dec+unc {u}")
        if L["advancing"] & L["declining"] or L["advancing"] & L["unchanged"] or L["declining"] & L["unchanged"]:
            probs.append(f"lists overlap {u}")
        for m in ("advancing", "declining", "unchanged", "universe_count"):
            if vals.get((u, m), (None,) * 4)[3] != x[m]:
                probs.append(f"persisted != captured {u}.{m}")
            if u != "us" and L[m] != set(cap["close"]["us"]["lists"][m]) & mem:
                probs.append(f"exchange list != us restricted {u}.{m}")
    if any(cap["member"][t][2] in ("CONFLICT", "UNRESOLVED", "OTHER", "absent") for t in ny | na):
        probs.append("non-exchange status admitted")
    if probs:
        status["refused"] = {"session": D, "reason": "VALIDATION", "detail": probs[:30]}
        break
    us_par = {"exact": 0, "mismatch": [], "missing": 0}
    for (u, m), v in vals.items():
        if u != "us" or m == "unchanged":
            continue
        pv = PROWS.get((D, m))
        if pv is None:
            us_par["missing"] += 1
        elif pv == v:
            us_par["exact"] += 1
        else:
            us_par["mismatch"].append([m, v, pv])
    if us_par["mismatch"] or us_par["missing"]:
        if A.mode == "append":
            status["refused"] = {"session": D, "reason": "US_PARITY", "detail": us_par}
            break
    status["proof_findings"].setdefault(D, {})["us_parity"] = us_par
    crash("after_membership")
    # ── identity: observe sessions beyond the identity horizon into the successor ──
    sids = {t: cap["member"][t][0] for t in us}
    if D > HORIZON:
        before = set(IDS.sids)
        got = IDS.observe(IDS.pos[D], [(t, cap["member"][t][4], cap["member"][t][5], cap["member"][t][6])
                                       for t in sorted(us)], "VINTAGE:" + V["tag"])
        sids.update(got)
        id_changed = True
        id_delta["observed_sessions"].append(D)
        id_delta["new_sids"] += sorted(set(IDS.sids) - before)
    # ── derived continuation from the frozen boundary state ──
    derived, trend = [], []
    for u, X_, start in EX:
        prev = STORE.last_state(X_, BOUNDARY[X_])
        new, out = lc.derive_step(prev, vals.get((u, "advancing"), (None,) * 4)[3],
                                  vals.get((u, "declining"), (None,) * 4)[3])
        derived += [(f"{X_}:{k}", D, out[k]) for k in ("AD", "MCO", "MCS") if out[k] is not None]
        trend.append((X_, D, new["ad"], new["ema_fast"], new["ema_slow"], new["valid_obs"], new["mcs"]))
    membership = [(D, t, sids.get(t), cap["member"][t][2], cap["member"][t][3], cap["member"][t][1]) for t in sorted(us)]
    evrows = [(r[0], r[1], sids.get(r[1]), r[3], r[4], r[5], r[6], r[7], r[8]) for r in R["evidence_rows"]]
    payload = {"rows": rows, "counts": cap["counts"], "membership": membership, "evidence": evrows, "derived": derived,
               "trend": trend, "vintage": V["owner_vintage_of_record"] or V["tag"], "compute_vintage": V["tag"],
               "vintage_exception": json.dumps(V.get("declared_exception") or (
                   {"PROOF_SUBSTITUTION": True} if V.get("PROOF_SUBSTITUTION") else None), sort_keys=True)
               if (V.get("declared_exception") or V.get("PROOF_SUBSTITUTION")) else "",
               "input_manifest_sha256": V["input_manifest_sha256"],
               "reference_sha256": V["reference_sha256"], "us_v2_pub_id": V.get("pub_id") or "",
               "venue_source": "ledger" if D <= LEDGER_END else "live_evidence",
               "rows_sha256": lc.rows_sha(rows), "membership_sha256": lc.rows_sha(membership),
               "derived_sha256": lc.rows_sha(derived + trend),
               "identity_state_sha256": "pending" if D > HORIZON else lc.sha_file(cur_path),
               "provenance": {"vintage": V, "remap_tables": teq, "preflight": R["preflight"], "evidence": cap.get("evidence"), "us_parity": us_par},
               "completed_at": now()}
    try:
        STORE.commit_session(D, plan[len(STORE.completed())], payload, crash=crash if CRASH else None)
    except lc.Refused as e:
        status["refused"] = {"session": D, "reason": e.reason, "detail": e.detail}
        break
    status["appended"].append(D)

# ── identity successor (versioned; the parent is never written) ─────────────────────────────
if id_changed:
    doc = IDS.to_doc()
    doc["snapshots"] = list(cur_doc["snapshots"]) + ["live: " + ",".join(id_delta["observed_sessions"])]
    blob = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    h = hashlib.sha256(blob).hexdigest()
    path = os.path.join(idir, f"state_{doc['sessions_processed'][1]}_{h[:12]}.json")
    open(path, "wb").write(blob)
    man = {"parent_path": cur_path, "parent_sha256": lc.sha_file(cur_path), "state_path": path, "state_sha256": h,
           "delta": id_delta, "sids": len(doc["sids"]), "written_utc": now()}
    json.dump(man, open(path[:-5] + ".MANIFEST.json", "w"), indent=1, sort_keys=True)
    STORE.c.execute("UPDATE live_session SET identity_state_sha256=? WHERE identity_state_sha256='pending'", (h,))
    status["identity_successor"] = man

# ── freshness / currentness ──────────────────────────────────────────────────────────────────
comp = STORE.completed()
latest_pub = max((d for d, v in PSESS.items() if v[0] == "CURRENT"), default=None)
expected = plan[-1] if plan else None
evd = os.path.join(A.store, "evidence", "dated")
last_prov = STORE.c.execute("SELECT provenance, completed_at FROM live_session ORDER BY seq DESC LIMIT 1").fetchone()
refused = (status["refused"] or {}).get("reason")
status.update({"finished_utc": now(), "completed": comp, "logical_sha256": STORE.logical_sha256(),
               "currentness": {"latest_completed_market_session_expected": expected,
                               "latest_us_v2_published": latest_pub, "latest_in_candidate": comp[-1] if comp else None,
                               "latest_venue_evidence_session": max([LEDGER_END] + ([f[:10] for f in os.listdir(evd)]
                                                                                     if os.path.isdir(evd) else [])),
                               "latest_vintage_used": {"owner_of_record": json.loads(last_prov[0])["vintage"].get(
                                   "owner_vintage_of_record"), "compute": json.loads(last_prov[0])["vintage"]["tag"]}
                               if last_prov else None,
                               "declared_vintage_exceptions_used": [r[0] for r in STORE.c.execute(
                                   "SELECT date FROM live_session WHERE vintage_exception != '' ORDER BY seq")],
                               "last_successful_append_utc": last_prov[1] if last_prov else None,
                               "state": "CURRENT" if comp and comp[-1] == expected else
                                        "WAITING_FOR_US_V2" if refused == "NOT_YET_PUBLISHED" and comp and comp[-1] == latest_pub
                                        else "STALE" + (f" ({refused})" if refused else "")}})
json.dump(status, open(os.path.join(A.store, "STATUS.json"), "w"), indent=1, sort_keys=True, default=str)
print(json.dumps({k: status[k] for k in ("appended", "refused", "currentness", "logical_sha256")}, default=str)[:3000])
