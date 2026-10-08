"""Build the final canonical PIT UCT ledger from a read-only production export.
argv: EXPORT_JSON FROZEN_LEDGER_JSON REVIEWED_REJECTIONS_JSON OUT_LEDGER OUT_REPORT
 1. source-row immutability: every ACCEPTED session of the previous ledger must be byte-identical
    in the export (a CARRIED entry is not a source row — its session's own row was rejected)
 2. pit_provenance.classify over the WHOLE live history (no date-specific rules)
 3. ledger = every live session the gate accepts
 4. ⭐ (owner, 2026-10-08) a REJECTED session is CARRIED, never a gap: its membership is the
    nearest earlier ACCEPTED session's list — fixed before the session traded, so it carries no
    hindsight, and it is exactly the collector's own legitimate fallback (a list identical to the
    previous session's, written on time — see pit_provenance). The entry says so
    (`carried_from`, `carried_reasons`). Before this, a failed 4:15 capture (03-24, 08-31, 09-23)
    blanked every UCT breadth reading for a session the market traded.
 5. a rejection no longer STOPS the producer (that withheld the session too — another blank day);
    it is recorded in the report (`carried`). A MUTATED accepted source row still STOPS.
Exit 2 on STOP; nothing written except the report."""
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pit_provenance as pp


def carry(exp: dict, accepted: list, rejected: list) -> dict:
    """{rejected session: ledger entry carried from the nearest earlier accepted session}."""
    out = {}
    acc = sorted(accepted)
    for d in sorted(rejected):
        prev = [a for a in acc if a < d]
        if not prev:
            continue                      # nothing earlier to carry from: stays out
        src = prev[-1]
        e = {k: exp[src][k] for k in ("n", "sha256", "created_at", "tickers")}
        e["carried_from"] = src
        out[d] = e
    return out


def main(argv):
    exp = json.load(open(argv[1])); frz = json.load(open(argv[2])); reviewed = set(json.load(open(argv[3]))["reviewed"])
    R = {"export": os.path.basename(argv[1]), "export_sha256": hashlib.sha256(open(argv[1], "rb").read()).hexdigest(),
         "frozen_ledger_sha256": hashlib.sha256(open(argv[2], "rb").read()).hexdigest(),
         "source_rows_exported": len(exp), "previously_accepted": len(frz["dates"])}
    mut = [d for d, e in frz["dates"].items()
           if not e.get("carried_from")
           and (d not in exp or any(exp[d][k] != e[k] for k in ("tickers", "sha256", "n", "created_at")))]
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
    carried = carry(exp, acc, list(rej))
    for d, e in carried.items():
        e["carried_reasons"] = [r.split(":")[0] for r in rej[d]["reasons"]]
    R["carried"] = {d: e["carried_from"] for d, e in carried.items()}
    stop = mut or not R["backfill_exclusion_unchanged"]
    R["gate"] = "STOP" if stop else "PASS"
    json.dump(R, open(argv[5], "w"), indent=1)
    if stop:
        print(json.dumps(R, indent=1)); return 2
    dates = {d: {k: exp[d][k] for k in ("n", "sha256", "created_at", "tickers")} for d in acc}
    dates.update(carried)
    led = {"source": frz["source"].split(";")[0] + "; re-exported read-only for the final grind",
           "live_from": frz["live_from"], "why_live_from": frz["why_live_from"],
           "excluded_backfilled_dates": frz["excluded_backfilled_dates"],
           "provenance_gate": "tools/breadth_v2cc/pit_provenance.py (predicates in its docstring)",
           "rejected_not_pit": R["rejected"],
           "carried": R["carried"],
           "late_written": {d: exp[d]["created_at"] for d in acc if exp[d]["created_at"][:10] != d},
           "dates": dates}
    s = json.dumps(led, sort_keys=True)
    open(argv[4], "w").write(s)
    R["ledger_sha256"] = hashlib.sha256(s.encode()).hexdigest()
    json.dump(R, open(argv[5], "w"), indent=1)
    print(json.dumps({k: v for k, v in R.items() if k != "rejected"}, indent=1))
    print("REJECTED->CARRIED", R["carried"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
