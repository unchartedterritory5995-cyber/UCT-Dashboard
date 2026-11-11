"""The rules side of the review: every criterion, and every open decision, as data the review page can show.

    python build_rules.py <repo worktree> <data folder>      writes <data folder>/rules.json and decisions.json

Run AFTER build_data.py (it reads the question files in the data folder to count how many questions teach each rule).

rules.json      {"<card>:<criterion id>": {setup, s: statement, st: status, oq: [decision ids], rec, opts, ev, basis, hr}}
decisions.json  [{id, title, part, blocks: [markdown paragraphs], rules: [{k, setup, s, st}], nrules, nq}]
"""
import glob
import json
import os
import re
import sys

REPO = os.path.abspath(sys.argv[1])
DATA = os.path.abspath(sys.argv[2])

DID = re.compile(r"D-\d{3}")


def main():
    rules, by_decision = {}, {}
    for f in sorted(glob.glob(os.path.join(REPO, "docs", "study", "setups", "criteria", "*.json"))):
        card = os.path.splitext(os.path.basename(f))[0]
        try:
            d = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for c in d.get("criteria", []):
            oq = DID.findall(json.dumps(c.get("owner_question") or ""))
            r = {"setup": d.get("name") or card, "s": c.get("statement") or "", "st": c.get("status") or "", "oq": oq}
            if c.get("recommended") is not None:
                r["rec"] = c["recommended"]
            if c.get("options"):
                r["opts"] = [{"v": o.get("value"), "b": o.get("basis")} for o in c["options"]]
            if c.get("evidence"):
                r["ev"] = c["evidence"]
            if c.get("basis"):
                r["basis"] = c["basis"]
            if c.get("house_rule"):
                r["hr"] = c["house_rule"] if isinstance(c["house_rule"], str) else json.dumps(c["house_rule"], ensure_ascii=False)
            key = card + ":" + c["id"]
            rules[key] = r
            for dec in oq:
                by_decision.setdefault(dec, []).append(key)

    # how many questions teach each rule
    qn = {}
    for f in glob.glob(os.path.join(DATA, "track-*.json")):
        for unit in json.load(open(f, encoding="utf-8")).values():
            card = os.path.splitext(os.path.basename(unit.get("card") or ""))[0]
            for q in unit["questions"]:
                if card and q.get("criterion"):
                    k = card + ":" + q["criterion"]
                    qn[k] = qn.get(k, 0) + 1
    for k, n in qn.items():
        if k in rules:
            rules[k]["nq"] = n

    # the decisions register
    text = open(os.path.join(REPO, "docs", "study", "setups", "DECISIONS.md"), encoding="utf-8").read().splitlines()
    decs, cur, part, group = [], None, "", ""
    for line in text:
        m = re.match(r"^## Part ([ABC])\b", line)
        if m:
            part, group, cur = m.group(1), "", None
            continue
        if line.startswith("## "):
            cur = None
            continue
        m = re.match(r"^#{3,4} (D-\d{3})\.\s*(.*)$", line)
        if m:
            cur = {"id": m.group(1), "title": m.group(2).strip(), "part": part, "group": group, "lines": []}
            decs.append(cur)
            continue
        m = re.match(r"^### (\d{2}) (.+)$", line)   # Part B: a setup heading groups the decisions under it
        if m:
            group, cur = m.group(2).strip(), None
            continue
        if cur is not None and line.strip() != "---":
            cur["lines"].append(line)
    out = []
    for d in decs:
        body = "\n".join(d.pop("lines")).strip()
        d["blocks"] = [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]
        keys = by_decision.get(d["id"], [])
        d["rules"] = [{"k": k, "setup": rules[k]["setup"], "s": rules[k]["s"], "st": rules[k]["st"]} for k in keys]
        d["nrules"] = len(keys)
        d["nq"] = sum(rules[k].get("nq", 0) for k in keys)
        out.append(d)
    with open(os.path.join(DATA, "rules.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rules, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "decisions.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    openn = sum(1 for d in out if d["part"] in ("A", "B"))
    print(f"{len(rules)} rules, {len(out)} decisions ({openn} open), {sum(1 for r in rules.values() if r.get('nq'))} rules taught by at least one question")


main()
