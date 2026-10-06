"""Exchange Breadth V1 — prove the live identity SUCCESSOR is exactly the accepted parent + observed sessions.

Usage: python3 successor_replay_check.py TOOLS_DIR STORE_DIR OUT.json

Loads the accepted 0444 parent, resumes it (IdentityState.from_doc), observes each session listed in the
successor manifest's delta with the exact members the worker captured (ticker, vintage key, CIK, FIGI),
and requires the result to hash-equal the successor file. Also checks the parent file is unchanged.
"""
import hashlib
import json
import os
import sys

TOOLS, STORE, OUT = sys.argv[1:4]
sys.path.insert(0, os.path.join(TOOLS, "identity"))
import identity_model as im  # noqa: E402

PARENT = "/data/_audit/exch_v1/identity_v1_20261005/state/exch_identity_state_v1.json"
PARENT_SHA = "0acbe59fe1e86549a5e92e8445a2d5b1e63f189e68cbfaf0d301b775106cd8f3"
idir = os.path.join(STORE, "identity")
mans = sorted(f for f in os.listdir(idir) if f.endswith(".MANIFEST.json"))
rep = {"parent_sha256_now": hashlib.sha256(open(PARENT, "rb").read()).hexdigest()}
rep["parent_unchanged"] = rep["parent_sha256_now"] == PARENT_SHA
man = json.load(open(os.path.join(idir, mans[-1])))
doc = json.load(open(PARENT))
sessions = json.load(open("/data/_audit/exch_v1/population.json"))["sessions"]
obs = man["delta"]["observed_sessions"]
st = im.IdentityState.from_doc(doc, sessions + [d for d in obs if d > sessions[-1]])
for d in obs:
    cap = json.load(open(os.path.join(STORE, "scratch", d + ".result.json")))["capture"]
    us = cap["universes"]["us"]
    st.observe(st.pos[d], [(t, cap["member"][t][4], cap["member"][t][5], cap["member"][t][6]) for t in sorted(us)],
               "VINTAGE:" + json.load(open(os.path.join(STORE, "scratch", d + ".result.json")))["vintage"])
out = st.to_doc()
out["snapshots"] = list(doc["snapshots"]) + ["live: " + ",".join(obs)]
h = hashlib.sha256(json.dumps(out, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
fs = hashlib.sha256(open(man["state_path"], "rb").read()).hexdigest()
new = sorted(set(out["sids"]) - set(doc["sids"]))
enriched = sorted(s for s in doc["sids"] if out["sids"][s] != doc["sids"][s])
rep.update({"successor": man["state_path"], "successor_file_sha256": fs, "replayed_sha256": h,
            "replay_equals_successor": h == fs == man["state_sha256"], "observed_sessions": obs,
            "new_sids": new, "enriched_sids_count": len(enriched), "enriched_sids_sample": enriched[:15],
            "new_sid_birth_rules": {s: out["sids"][s]["evidence"][0][1] for s in new},
            "reattachments": [[s, e] for s in out["sids"] for e in out["sids"][s]["evidence"]
                              if e[0] in obs and e[1] == "REATTACH"]})
rep["pass"] = rep["parent_unchanged"] and rep["replay_equals_successor"]
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps({k: rep[k] for k in ("pass", "parent_unchanged", "replay_equals_successor", "new_sids",
                                       "enriched_sids_count", "new_sid_birth_rules")}, indent=1)[:3000])
