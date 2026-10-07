"""Lane ROLLBACK, 2026-10-06. Where the chain stops at a base it was not measured on. Walks every
step from the base named on the command line, resolving any conflict that has no rule (or whose
rule no longer fits) as "ours" ONLY SO THE WALK CAN CONTINUE, and prints each one: NEW (no rule)
or PIN-CHANGED (a recorded conflict whose lines moved). The hunks of each are written under
conflicts-<base>/ beside this script. ⚠️ The "ours" stand-in is not a ruling, and a stand-in at
one step can change what the steps below it meet: this is a map of the work, not a resolution.
Read-only on the repository (objects only). Run from the repo root:
    python docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/conflict_map.py 0ae75faf37
"""
import sys, json, importlib.util, os
spec = importlib.util.spec_from_file_location("ch", "tools/notebook_rollback_chain.py")
ch = importlib.util.module_from_spec(spec); spec.loader.exec_module(ch)
start = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "conflicts-" + start.replace("/", "-")); os.makedirs(out, exist_ok=True)
tip = ch._out("rev-parse", "--verify", f"{start}^{{commit}}").strip()
prev = tip
orig = ch._resolve_hunks
def lenient(text, choices):
    try: return orig(text, choices)
    except ch.ChainStopped as e:
        print("   HUNK-RULE MISMATCH:", e); return orig(text, "all-ours")
ch._resolve_hunks = lenient
for key, squash, what, pick in ch.plan("wave5"):
    base, theirs = (f"{squash}^", squash) if pick else (squash, f"{squash}^")
    r = ch._git("merge-tree", "--write-tree", "--name-only", "--messages", f"--merge-base={base}", prev, theirs, ok=(0, 1))
    lines = r.stdout.decode("utf-8", "replace").splitlines(); merged = lines[0]
    msgs = "\n".join(lines)
    pins = {}
    added = []
    while True:
        try:
            res = ch.apply_step(prev, squash, tip, pick=pick, pins=pins); break
        except ch.ChainStopped as e:
            msg = str(e)
            if "no recorded rule" not in msg: print("STOP", key, msg[:300]); sys.exit()
            for p in msg.split("conflict in ")[1].split(", "):
                ch.RULES.setdefault(squash, {})[p] = "ours"; added.append(p)
    for p in res["product_conflicts"]:
        fp = pins.get(squash, {}).get(p); old = ch.PINS.get(squash, {}).get(p)
        new = p in added
        if new or fp != old:
            blob = ch._git("cat-file", "blob", f"{merged}:{p}", ok=(0, 128)).stdout
            hunks = list(ch.HUNK.finditer(blob))
            kind = [l for l in lines if p in l and "CONFLICT" in l]
            print(key, squash, "NEW" if new else "PIN-CHANGED", p, "hunks", len(hunks), [ (len(m.group(1).splitlines()), len(m.group(2).splitlines())) for m in hunks], kind[:1])
            with open(os.path.join(out, f"{key}--{p.replace('/', '__')}.txt"), "wb") as f:
                for m in hunks: f.write(b"<<<<<<< OURS(prev)\n" + m.group(1) + b"=======\n" + m.group(2) + b">>>>>>> THEIRS(pre-landing)\n\n")
    prev = ch._out("commit-tree", res["tree"], "-p", prev, "-m", "x").strip()
