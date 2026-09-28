"""R1 rollback rehearsal: the cumulative newest-first revert chain, OBJECTS ONLY.

Each step reverts one Notebook landing's squash onto the previous step's commit with
`git merge-tree --write-tree --merge-base=<squash> <prev> <squash>^` (a revert expressed as a
three-way merge), applies the RECORDED resolution rules below, restores the never-revert set,
and writes a scratch commit with `git commit-tree`. No worktree, no index but a temp
GIT_INDEX_FILE, no ref is moved. Prints one JSON object per step.

    python chain.py            # the chain, JSON lines on stdout
    python chain.py --show N   # print the unresolved conflict hunks of step N (1-based)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10s1"
TIP = "38bb9a421"
SCHEMA_FILES = ("app/src/pages/journal-2-0/lib/notebookSchema.js",
                "api/services/journal_two/notebook_schema.py")
GUARD_COMMITS = ("8167f7aa0", "fd87271fd", "82c56dd63")   # tags notebook-wave5-guard-*
# 82c56dd63's cherry-pick onto the fully rolled-back tree conflicts in five files whose
# context is wave-5 code the revert removed (D3 adoption, the content guard). A hand-merge of
# only "ours" leaves OWN_READ / keepRefusedWords / lowerStamp referenced and undefined (a
# ReferenceError on editor mount). The full rollback declares 0 from every door, where the
# commit is not load-bearing (wave5-rollback.md, "Why 82c56dd63 rides along"), so it is
# MEASURED and recorded, never applied, in this chain.
MEASURE_ONLY = {"82c56dd63"}

# Newest first: (label, squash). VERIFIED against `git log` on 2026-09-28 (all one-parent,
# all ancestors of origin/master 38bb9a421). #225 and #201 are Notebook landings the
# controller's list did not name; they sit inside the chain by ancestry.
STEPS = [
    ("L1c #228", "38bb9a421"), ("#225 skip-link H14", "4bba30b73"), ("L1b #224", "d9e887ca0"),
    ("L1a #205", "4f708a0d2"), ("#204 write-lock H14", "2ab637644"),
    ("#203 depth-cap H14", "c6a8a9d3a"), ("wave 9 #202", "1c4b0bf74"),
    ("#201 toolbar H14", "7e3f9e117"), ("wave 8 #198", "caf6d1b9e"), ("9C soak #197", "2e0598bfa"),
    ("wave 7 #196", "f883e0996"), ("wave 6 #193", "271a078b6"), ("wave 5 #186", "2c3ed3093"),
]

# R-DOCS: a rollback reverts PRODUCT, never records. Every path under these prefixes is kept
# exactly as the step's parent has it (so, by induction, as the tip has it).
KEEP_PREFIXES = ("docs/", "CLAUDE.md", "tools/", "scripts/")
KEEP_PATHSPECS = ["docs", "CLAUDE.md", "tools", "scripts"]

# Recorded resolutions for PRODUCT conflicts: {squash: {path: rule}}.
#   "delete"        -> the file goes (the wave added it; a later commit only touched its prose)
#   ("hunks", [...]) -> per conflict hunk, in order: "ours" (current), "theirs" (pre-wave),
#                      or a literal replacement string
RULES: dict[str, dict[str, object]] = {}
RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")
if os.path.exists(RULES_PATH):
    RULES = json.load(open(RULES_PATH, encoding="utf-8"))


def git(*a, env=None, inp=None, ok=(0,)):
    r = subprocess.run(["git", "-C", REPO, *a], capture_output=True, env=env, input=inp)
    if r.returncode not in ok:
        raise RuntimeError(f"git {a}: rc {r.returncode}: {r.stderr.decode(errors='replace')}")
    return r


def out(*a, **k) -> str:
    return git(*a, **k).stdout.decode("utf-8", errors="replace")


def blob(tree: str, path: str) -> str | None:
    r = git("rev-parse", "--verify", "-q", f"{tree}:{path}", ok=(0, 1, 128))
    return r.stdout.decode().strip() or None


def mode_of(tree: str, path: str) -> str:
    return out("ls-tree", tree, "--", path).split()[0]


NL = bytes([10])
HUNK = re.compile(rb"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)


def resolve_hunks(text: bytes, choices: list) -> bytes:
    hunks = list(HUNK.finditer(text))
    if len(hunks) != len(choices):
        raise RuntimeError(f"{len(hunks)} hunks, {len(choices)} choices")
    res, pos = [], 0
    for m, c in zip(hunks, choices):
        res.append(text[pos:m.start()])
        if isinstance(c, list) and c and c[0] == "ours_drop":
            # the current side, minus every line containing one of the named substrings
            keep = [ln for ln in m.group(1).splitlines(keepends=True)
                    if not any(s.encode("utf-8") in ln for s in c[1:])]
            dropped = m.group(1).count(b"\n") - len(keep)
            if dropped != c[1:].__len__() and not os.environ.get("R1RB_LOOSE"):
                raise RuntimeError(f"ours_drop dropped {dropped} lines for {len(c) - 1} substrings")
            res.append(b"".join(keep))
        elif c == "ours":
            res.append(m.group(1))
        elif c == "theirs":
            res.append(m.group(2))
        else:
            res.append(c.encode("utf-8"))
        pos = m.end()
    res.append(text[pos:])
    return b"".join(res)


def step(prev: str, squash: str, show: bool = False, pick: bool = False) -> dict:
    base, theirs = (f"{squash}^", squash) if pick else (squash, f"{squash}^")
    r = git("merge-tree", "--write-tree", "--name-only", "--messages", f"--merge-base={base}",
            prev, theirs, ok=(0, 1))
    lines = r.stdout.decode("utf-8", errors="replace").splitlines()
    merged = lines[0]
    conflicts, i = [], 1
    if r.returncode == 1:
        while i < len(lines) and lines[i].strip():
            conflicts.append(lines[i])
            i += 1
    msgs = [l for l in lines[i:] if l.startswith("CONFLICT")]
    conflicts = sorted(set(conflicts))
    idx = tempfile.mktemp(prefix="r1rb-idx-")
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    git("read-tree", merged, env=env)

    def put(path, data=None, from_tree=None):
        if from_tree is not None:
            b = blob(from_tree, path)
            if b is None:
                git("update-index", "--force-remove", "--", path, env=env)
                return
            git("update-index", "--add", "--cacheinfo", f"{mode_of(from_tree, path)},{b},{path}", env=env)
            return
        b = git("hash-object", "-w", "--stdin", inp=data).stdout.decode().strip()
        git("update-index", "--add", "--cacheinfo", f"100644,{b},{path}", env=env)

    # R-DOCS, applied to every path under a kept prefix (not just conflicts): the index's
    # docs/ + CLAUDE.md entries are replaced wholesale by prev's, in ONE --index-info call.
    kp = KEEP_PATHSPECS

    def entries(text):
        d = {}
        for ln in text.splitlines():
            meta, path = ln.split("\t", 1)
            f = meta.split()
            d[path] = (f[0], f[2] if len(f) == 3 and len(f[2]) == 40 else f[1])
        return d
    e_prev = entries(out("ls-tree", "-r", prev, "--", *kp))
    e_idx = {}
    for ln in out("ls-files", "-s", "--", *kp, env=env).splitlines():
        meta, path = ln.split("\t", 1)
        mode, sha, _stage = meta.split()
        e_idx[path] = (mode, sha)
    kept_docs = sorted(p for p in set(e_prev) | set(e_idx) if e_prev.get(p) != e_idx.get(p))
    info = [f"0 {'0' * 40}\t{p}" for p in e_idx if p not in e_prev]
    info += [f"{m} {s}\t{p}" for p, (m, s) in e_prev.items() if e_idx.get(p) != (m, s)]
    if info:
        git("update-index", "--index-info", env=env, inp=("\n".join(info) + "\n").encode("utf-8"))
    product_conflicts = [p for p in conflicts if not p.startswith(KEEP_PREFIXES)]
    rules = RULES.get(squash, {})
    unresolved, applied = [], {}
    for p in product_conflicts:
        rule = rules.get(p)
        if rule is None:
            unresolved.append(p)
            if show:
                text = git("cat-file", "blob", f"{merged}:{p}", ok=(0, 128)).stdout
                print(f"===== {p}")
                for n, m in enumerate(HUNK.finditer(text)):
                    print(f"--- hunk {n}: OURS (current)\n{m.group(1).decode(errors='replace')}"
                          f"--- THEIRS (pre-wave)\n{m.group(2).decode(errors='replace')}")
                if not HUNK.search(text):
                    print("(no markers: modify/delete)")
            continue
        if rule == "delete":
            git("update-index", "--force-remove", "--", p, env=env)
        elif rule == "ours":
            put(p, from_tree=prev)
        else:
            kind, choices = rule[0], rule[1]
            post = rule[2] if len(rule) > 2 else {}
            text = git("cat-file", "blob", f"{merged}:{p}").stdout
            if choices == "all-ours":
                choices = ["ours"] * len(list(HUNK.finditer(text)))
            data = resolve_hunks(text, choices)
            if post.get("import_after"):
                anchor, line = post["import_after"]
                if line.encode() not in data:
                    i = data.index(anchor.encode())
                    j = data.index(NL, i) + 1
                    data = data[:j] + line.encode() + NL + data[j:]
            if post.get("append"):
                data = data.rstrip(NL) + NL + NL + post["append"].encode("utf-8")
            put(p, data)
        applied[p] = rule if isinstance(rule, str) else ("hunks:" + (rule[1] if isinstance(rule[1], str) else ",".join(c if isinstance(c, str) and c in ("ours", "theirs") else "custom" for c in rule[1])) + ("+post" if len(rule) > 2 else ""))
    # The never-revert rule: both schema tables stay exactly as the TIP has them.
    schema_restored = []
    for p in SCHEMA_FILES:
        pre = git("ls-files", "-s", "--", p, env=env).stdout.decode().split()
        if not pre or pre[1] != blob(TIP, p):
            put(p, from_tree=TIP)
            schema_restored.append(p)
    tree = git("write-tree", env=env, ok=(0, 128)).stdout.decode().strip()
    raw_schema = [p for p in SCHEMA_FILES if p in conflicts or blob(merged, p) != blob(prev, p)]
    os.remove(idx)
    res = {"squash": squash, "merge_tree_rc": r.returncode, "conflicts": conflicts, "messages": msgs,
           "docs_kept": len(kept_docs), "product_conflicts": product_conflicts,
           "resolutions": applied, "unresolved": unresolved, "schema_restored_from_tip": schema_restored, "revert_would_change_schema": raw_schema,
           "tree": tree}
    return res


def markers_in(tree: str, paths: list[str]) -> list[str]:
    bad = []
    for p in paths:
        b = git("cat-file", "blob", f"{tree}:{p}", ok=(0, 128)).stdout
        if re.search(rb"^(<<<<<<<|>>>>>>>) ", b, re.M):
            bad.append(p)
    return bad


def dangling(prev: str, tree: str) -> list[str]:
    """Imports in `tree` of a module this step DELETED (objects-only lint; the boot and the
    vite build are the real check). Python: the dotted path; JS: `/<basename>'` style specifiers."""
    deleted = out("diff", "--name-only", "--no-renames", "--diff-filter=D", prev, tree).splitlines()
    py = [p[:-3].replace("/", ".") for p in deleted if p.endswith(".py") and not p.startswith(KEEP_PREFIXES)]
    js = sorted({re.sub(r"\.(jsx?|mjs|tsx?)$", "", p.rsplit("/", 1)[-1]) for p in deleted
                 if re.search(r"\.(jsx?|mjs)$", p) and p.startswith("app/src/")
                 and not re.search(r"\.test\.", p)})
    hits = []
    for pats, spec, fmt in ((py, "*.py", lambda s: re.escape(s) + r"\b"),
                            (js, "app/src/*", lambda s: r"/" + re.escape(s) + r"(\.jsx?)?['\"]")):
        if not pats:
            continue
        pf = tempfile.mktemp(prefix="r1rb-pat-")
        with open(pf, "w", encoding="utf-8") as fh:
            fh.write("\n".join(fmt(s) for s in pats) + "\n")
        r = git("grep", "-n", "-E", "-f", pf, tree, "--", spec, ok=(0, 1))
        os.remove(pf)
        for ln in r.stdout.decode("utf-8", errors="replace").splitlines():
            if spec.endswith(".py") or re.search(r"\b(import|from|require)\b", ln):
                hits.append(ln.split(":", 1)[1][:220])
    return hits


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    show_n = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--show" else None
    prev = TIP
    skip = set(filter(None, os.environ.get("R1RB_SKIP", "").split(",")))
    plan = [(str(n), label, sq, False) for n, (label, sq) in enumerate(STEPS, 1) if sq not in skip]
    plan += [(f"13{c}", f"re-apply guard {g}", g, True) for c, g in zip("abc", GUARD_COMMITS)]
    for n, label, squash, pick in plan:
        res = step(prev, squash, show=(show_n == n), pick=pick)
        res["n"], res["label"], res["op"] = n, label, ("cherry-pick" if pick else "revert")
        if squash in MEASURE_ONLY:
            # Measured, never applied: the chain does not advance past it (see MEASURE_ONLY).
            res["measure_only"] = True
            print(json.dumps(res))
            continue
        if res["unresolved"]:
            print(json.dumps(res))
            print(json.dumps({"stopped_at": n, "why": "unresolved product conflicts"}))
            return 1
        left = markers_in(res["tree"], res["product_conflicts"])
        if left:
            raise RuntimeError(f"step {n}: conflict markers left in {left}")
        res["schema_identical_to_tip"] = all(blob(res["tree"], p) == blob(TIP, p) for p in SCHEMA_FILES)
        res["dangling_imports"] = dangling(prev, res["tree"])
        c = out("commit-tree", res["tree"], "-p", prev, "-m",
                f"r1rb scratch step {n}: {res['op']} {squash} ({label})").strip()
        res["commit"] = c
        print(json.dumps(res))
        prev = c
    return 0


if __name__ == "__main__":
    sys.exit(main())
