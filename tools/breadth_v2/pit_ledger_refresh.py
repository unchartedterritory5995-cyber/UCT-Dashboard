"""Build the final canonical PIT UCT ledger from a read-only production export.
argv: EXPORT_JSON FROZEN_LEDGER_JSON REVIEWED_REJECTIONS_JSON OUT_LEDGER OUT_REPORT
 1. source-row immutability: every session of the frozen ledger must be byte-identical in the export
 2. pit_provenance.classify over the WHOLE live history (no date-specific rules)
 3. STOP if a rejected session earlier than the newest export session is not in the owner-reviewed
    rejection record (a review record, not exclusion logic: the gate alone decides PIT)
 4. ledger = every live session the gate accepts; rejected sessions listed with reasons (gaps)
Exit 2 on STOP; nothing written except the report."""
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pit_provenance as pp
exp = json.load(open(sys.argv[1])); frz = json.load(open(sys.argv[2])); reviewed = set(json.load(open(sys.argv[3]))["reviewed"])
R = {"export": os.path.basename(sys.argv[1]), "export_sha256": hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest(),
     "frozen_ledger_sha256": hashlib.sha256(open(sys.argv[2], "rb").read()).hexdigest(),
     "source_rows_exported": len(exp), "previously_accepted": len(frz["dates"])}
mut = [d for d, e in frz["dates"].items()
       if d not in exp or any(exp[d][k] != e[k] for k in ("tickers", "sha256", "n", "created_at"))]
R["source_row_mutations"] = mut
R["backfill_exclusion_unchanged"] = sorted(d for d in exp if d < frz["live_from"]) == sorted(frz["excluded_backfilled_dates"])
C = pp.classify(exp, frz["live_from"])
newest = max(C)
rej = {d: v for d, v in C.items() if not v["pit"]}
R["rejected"] = {d: {"reasons": v["reasons"], "evidence": v["evidence"]} for d, v in rej.items()}
R["unreviewed_historical_rejections"] = sorted(d for d in rej if d < newest and d not in reviewed)
R["newest_session"] = newest; R["newest_pit"] = C[newest]["pit"]
acc = sorted(d for d, v in C.items() if v["pit"])
R.update(accepted=len(acc), first=acc[0], last=acc[-1])
stop = mut or not R["backfill_exclusion_unchanged"] or R["unreviewed_historical_rejections"]
R["gate"] = "STOP" if stop else "PASS"
json.dump(R, open(sys.argv[5], "w"), indent=1)
if stop:
    print(json.dumps(R, indent=1)); sys.exit(2)
led = {"source": frz["source"].split(";")[0] + "; re-exported read-only for the final grind",
       "live_from": frz["live_from"], "why_live_from": frz["why_live_from"],
       "excluded_backfilled_dates": frz["excluded_backfilled_dates"],
       "provenance_gate": "tools/breadth_v2cc/pit_provenance.py (predicates in its docstring)",
       "rejected_not_pit": R["rejected"],
       "late_written": {d: exp[d]["created_at"] for d in acc if exp[d]["created_at"][:10] != d},
       "dates": {d: {k: exp[d][k] for k in ("n", "sha256", "created_at", "tickers")} for d in acc}}
s = json.dumps(led, sort_keys=True)
open(sys.argv[4], "w").write(s)
R["ledger_sha256"] = hashlib.sha256(s.encode()).hexdigest()
json.dump(R, open(sys.argv[5], "w"), indent=1)
print(json.dumps({k: v for k, v in R.items() if k != "rejected"}, indent=1)); print("REJECTED", {d: [r.split(":")[0] for r in v["reasons"]] for d, v in rej.items()})
