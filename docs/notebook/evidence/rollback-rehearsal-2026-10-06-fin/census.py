"""Lane ROLLBACK, 2026-10-06. The tool's own census (`notebook_landings`) over the ranges named on
the command line, one JSON file per range beside this script: every selected commit the chain
neither names nor has reviewed, the Notebook-set files it touches (`sel`), and which of those sit
under a Notebook-owned prefix (`owned`). Read-only. Run from the repo root:
    python docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/census.py f473d00b3..5ecf9ef390 5ecf9ef390..0ae75faf37
"""
import sys, os, json, importlib.util
spec = importlib.util.spec_from_file_location("ch", "tools/notebook_rollback_chain.py")
ch = importlib.util.module_from_spec(spec); spec.loader.exec_module(ch)
own = ("app/src/pages/journal-2-0/", "api/services/journal_two/", "api/routers/notebook_", "api/routers/journal_two.py", "api/routers/note_sync.py", "api/services/notebook_", "tests/test_notebook", "tests/test_journal_two")
for rng in sys.argv[1:]:
    ls = ch.notebook_landings(rng)
    named = {ch._out("rev-parse", f"{s}^{{commit}}").strip() for _k, s, _w in ch.CHAIN}
    new = [c for c in ls if c["sha"] not in named and c["sha"] not in ch.REVIEWED_NOT_LANDINGS]
    print(rng, "selected", len(ls), "uncharted", len(new), "by_subject", sum(c["by_subject"] for c in new))
    out = []
    for c in new:
        files = ch._out("diff-tree", "--no-commit-id", "--name-only", "-r", c["sha"]).splitlines()
        nb = ch.notebook_files()
        sel = [f for f in files if f in nb]
        c["sel"] = sel; c["owned"] = [f for f in sel if f.startswith(own)]; c["nfiles"] = len(files)
        out.append(c)
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "census-" + rng.replace("..", "_").replace("/", "-") + ".json"), "w", newline=chr(10)), indent=1)
    print(" touching notebook-owned:", sum(1 for c in out if c["owned"]))
print("nbfiles", len(ch.notebook_files()))
