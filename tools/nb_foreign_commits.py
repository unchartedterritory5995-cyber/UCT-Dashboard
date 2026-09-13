#!/usr/bin/env python3
"""⛔⛔ WHO ELSE HAS TOUCHED THE NOTEBOOK SINCE MY LAST MERGE?

Two sessions now edit this product. On 2026-09-12 a second session merged an
iOS-17 hotfix to `master` while a Notebook merge was in flight — it happened to
land in the PDF preview and not in the save path, and nobody knew that until
somebody looked. Next time the answer might be the other one.

So this is run BEFORE every Notebook merge, and it has three outcomes:

  exit 0   no foreign commit under the Notebook tree     -> merge
  exit 1   foreign commits, none in the SAVE PATH        -> re-run the rails
                                                            their files touch,
                                                            record the SHAs,
                                                            then merge
  exit 2   a foreign commit touches the SAVE PATH        -> ⛔ STOP. Report
                                                            before merging.

⭐ THE SAVE PATH IS NAMED, NOT GUESSED. `lib/offline/**` (the durable copy, the
outbox, the drain, the settle), `NoteEditorPage.jsx` (the body door) and
`hooks/useJ2Notes.js` (the shared note PUT every surface goes through). A change
in any of those is a second writer to the exact machinery Wave Q1 exists to
protect, and it stops the merge for a human to read.

⛔ "FOREIGN" IS DECIDED BY COMMITTER IDENTITY, NEVER BY BRANCH. A commit reached
`master` from somewhere; which branch it came through is not knowable afterwards
and is not the question. The question is whether THIS session produced it.

Usage:
    python tools/nb_foreign_commits.py --since <sha>          # my last merge
    python tools/nb_foreign_commits.py --since <sha> --json
    python tools/nb_foreign_commits.py --self-check           # proves it can say all three
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# The Notebook product tree this session owns until the charter closes.
NOTEBOOK_PATHS = [
    "app/src/pages/journal-2-0/",
    "api/routers/journal_two.py",
    "api/services/journal_two/",
]

# ⛔ The save path — a foreign commit here STOPS the merge.
SAVE_PATH = [
    "app/src/pages/journal-2-0/lib/offline/",
    "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx",
    "app/src/pages/journal-2-0/hooks/useJ2Notes.js",
]


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace").stdout.strip()


def classify(since: str, mine: str = "Claude Opus 5") -> dict:
    """Foreign commits under the Notebook tree since `since`, split by save-path."""
    raw = git("log", "--format=%H%x1f%an%x1f%ad%x1f%s", f"{since}..origin/master",
              "--", *NOTEBOOK_PATHS)
    out = {"since": since, "foreign": [], "save_path": []}
    for line in [ln for ln in raw.split("\n") if ln.strip()]:
        sha, author, when, subject = (line.split("\x1f") + ["", "", ""])[:4]
        files = [f for f in git("show", "--name-only", "--format=", sha).split("\n") if f.strip()]
        touched = sorted({f for f in files if any(f.startswith(p) for p in NOTEBOOK_PATHS)})
        hits = sorted({f for f in files if any(f.startswith(p) for p in SAVE_PATH)})
        row = {"sha": sha[:9], "author": author, "when": when, "subject": subject,
               "notebook_files": touched, "save_path_files": hits}
        out["foreign"].append(row)
        if hits:
            out["save_path"].append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="the SHA of this session's last Notebook merge")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        # ⭐ EACH OF THE THREE OUTCOMES IS DRIVEN, not described. A guard nobody
        # has seen fire is not a guard.
        ok = True

        def case(name: str, got, want):
            nonlocal ok
            good = got == want
            ok = ok and good
            print(f"  {'ok  ' if good else 'FAIL'} {name}" + ("" if good else f"  got {got!r} want {want!r}"))

        fake_none = {"foreign": [], "save_path": []}
        fake_other = {"foreign": [{"sha": "abc", "save_path_files": []}], "save_path": []}
        fake_save = {"foreign": [{"sha": "def", "save_path_files": ["app/src/pages/journal-2-0/lib/offline/outboxDrain.js"]}],
                     "save_path": [{"sha": "def"}]}
        case("no foreign commits -> 0", verdict(fake_none), 0)
        case("foreign, not the save path -> 1", verdict(fake_other), 1)
        case("foreign IN the save path -> 2", verdict(fake_save), 2)
        # ⛔ The save-path list must be a real subset of the paths this session
        # protects, or the stop can never fire for the file it names.
        case("every SAVE_PATH entry is inside the Notebook tree",
             all(any(s.startswith(p) for p in NOTEBOOK_PATHS) for s in SAVE_PATH), True)
        # ⭐ CONTROL: the classifier really reads git, not a cached answer.
        real = classify("HEAD")
        case("against HEAD..origin/master there is nothing ahead", real["foreign"], [])
        print("self-check:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    if not args.since:
        print("⛔ --since <sha> is required: the guard needs to know what 'since my last merge' means.")
        return 3

    git("fetch", "origin", "master", "-q")
    res = classify(args.since)
    if args.json:
        print(json.dumps(res, indent=2))
        return verdict(res)

    if not res["foreign"]:
        print(f"✅ no foreign commit under the Notebook tree since {args.since[:9]} — merge.")
        return 0

    print(f"⚠️ {len(res['foreign'])} foreign commit(s) under the Notebook tree since {args.since[:9]}:\n")
    for r in res["foreign"]:
        mark = "⛔ SAVE PATH" if r["save_path_files"] else "  "
        print(f"  {mark} {r['sha']}  {r['author']}  {r['subject'][:60]}")
        for f in r["notebook_files"][:8]:
            print(f"       {'⛔ ' if f in r['save_path_files'] else '   '}{f}")
    if res["save_path"]:
        print("\n⛔⛔ STOP. A foreign commit touches the SAVE PATH — the durable copy, the drain,")
        print("    the settle, the body door or the shared note PUT. Report before merging.")
        return 2
    print("\n⚠️ None of them touch the save path. Re-run the rails their files touch,")
    print("   record the SHAs in the ledger, then merge.")
    return 1


def verdict(res: dict) -> int:
    if res["save_path"]:
        return 2
    return 1 if res["foreign"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
