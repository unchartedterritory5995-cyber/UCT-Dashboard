"""Roll the Notebook back, newest landing first, as a CHAIN of commits built from objects only.

    python tools/notebook_rollback_chain.py --through wave7              # from origin/master
    python tools/notebook_rollback_chain.py --through wave5 --from <rev>
    python tools/notebook_rollback_chain.py --list                        # the chain and keep-list

It never touches a worktree, an index (only a temporary GIT_INDEX_FILE) or a ref. It writes ONE
commit per step, each the parent of the next (so the result is a chain of commits on top of
`--from`), prints one JSON line per step and, last, the chain's tip to review, e.g.

    {"result": "<sha>", "tree": "<tree>", "through": "wave7", "from": "<sha>",
     "next": "git switch -c rollback/notebook-through-wave7 <sha>"}

⛔ The branch lands on master as ONE SQUASH-MERGE, so "revert the rollback" (rolling FORWARD) is
reverting that one squash. Merged as a chain instead, `git revert <result>` would undo only the
last step; the range `<from>..<result>` is what a revert would have to cover.

⛔ FAIL CLOSED on anything not measured (review round 1, 2026-09-28). The tool refuses to run when
`MEASURED_AT` is not an ancestor of `--from`, and when `MEASURED_AT..--from` holds a commit the
landing census (subject OR path) marks as Notebook work that `CHAIN` does not name. Every recorded
conflict resolution is PINNED to the conflict content it was measured on (`PINS`): a later commit
that changes the lines of a recorded conflict stops the chain instead of being resolved by a rule
written for different lines.

What "rolling back wave N" means at the measured tip (docs/notebook/wave5-rollback.md, the
procedure; rehearsed on a sandbox for every step, 2026-09-28): revert EVERY Notebook landing
newer than or equal to N, newest first, one squash at a time, because every later wave is built
on the earlier ones. At every step:

  * `docs/`, `tools/`, `scripts/` and `CLAUDE.md` stay exactly as the previous step has them
    (so as the tip has them): a rollback reverts what ships to members, never the records,
    the runbook it is following, or the operator's own instruments;
  * both schema tables stay byte-identical to the tip (`SCHEMA_FILES`): a table entry is never
    removed (wave5-rollback.md, "Rules that outlive this wave"); so do the two rails that test
    them (`SCHEMA_RAILS`);
  * a product conflict is resolved ONLY by a recorded rule (`RULES`); any other conflict STOPS
    the chain and names the file -- fail closed, never a guess.

The keep-list, by rule (never reverted): the two server H14 hotfixes (`KEPT`), the schema tables,
and, after wave 5's revert, the guard commits 8167f7aa0 and fd87271fd re-applied (tags
notebook-wave5-guard-*). 82c56dd63 is not re-applied: measured, it conflicts in five files whose
context wave 5's revert removes, and a rolled-back bundle declares schema 0 from every door,
where it is not load-bearing (wave5-rollback.md, "Why 82c56dd63 rides along").

MEASURED_AT is the tip the chain, its rules and the rehearsal were measured on.
`tests/test_notebook_rollback_chain.py` rebuilds the chain from MEASURED_AT and asserts every
step's tree equals the rehearsed one, and that no Notebook landing is missing from `CHAIN`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MEASURED_AT = "38bb9a421"
SCHEMA_FILES = ("app/src/pages/journal-2-0/lib/notebookSchema.js",
                "api/services/journal_two/notebook_schema.py")
# The two rails that test those tables stay with them: a table kept at the tip checked by a rail
# reverted to an older wave is a red rail on a correct tree (measured 2026-09-28: wave 6's revert
# brought back a rail that expects no level 2; the 8167f7aa0 pick brought back one that expects
# levels {0, 1} only).
SCHEMA_RAILS = ("app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js",
                "tests/test_notebook_schema_guard.py")
KEEP_AT_TIP = SCHEMA_FILES + SCHEMA_RAILS
KEEP_PATHS = ("docs", "CLAUDE.md", "tools", "scripts")

# Every Notebook landing on master from wave 5 to MEASURED_AT, newest first: (key, squash, what).
# A key is what --through takes. Verified one-parent squashes, each an ancestor of the next.
CHAIN = [
    ("L1c", "38bb9a421", "wave 10 L1c #228"),
    ("225", "4bba30b73", "#225 H14: the phone skip link"),
    ("L1b", "d9e887ca0", "wave 10 L1b #224"),
    ("L1a", "4f708a0d2", "wave 10 L1a #205"),
    ("204", "2ab637644", "#204 H14: every read-then-write note door takes the write lock"),
    ("203", "c6a8a9d3a", "#203 H14: depth cap, Word intake, PDF extraction budget"),
    ("wave9", "1c4b0bf74", "wave 9 #202"),
    ("201", "7e3f9e117", "#201 H14: the pane heading never moves the toolbar"),
    ("wave8", "caf6d1b9e", "wave 8 #198"),
    ("9C", "2e0598bfa", "wave 9C #197: the soak instrument"),
    ("wave7", "f883e0996", "wave 7 #196"),
    ("wave6", "271a078b6", "wave 6 #193"),
    ("wave5", "2c3ed3093", "wave 5 #186"),
]
# Server write-safety hotfixes: never reverted with the features (measured merge-clean at every
# step below them). --revert-hotfixes reverts them too (also measured merge-clean).
KEPT = {"2ab637644", "c6a8a9d3a"}
# After wave 5's revert, in this order.
GUARD_PICKS = ("8167f7aa0", "fd87271fd")

# The landing census (what counts as a Notebook landing): two independent criteria. A Notebook
# landing is a one-parent commit that changes shipped code (`app/`, `api/`) and whose SUBJECT
# names the Notebook (or wave 9C, its soak instrument) -- or whose PATHS are the Notebook's own.
# Over wave5^..MEASURED_AT both criteria select exactly CHAIN (measured 2026-09-28: 13, 13, 13 in
# common). Past MEASURED_AT, a commit EITHER criterion selects stops the tool.
NOTEBOOK_SUBJECT = re.compile(r"(?i)\bnotebook\b|^wave 9c\b")
NOTEBOOK_PATHS = re.compile(
    r"^(app/src/pages/journal-2-0/(components/notebook/|lib/offline/|lib/notebook|tabs/NotebookTab)"
    r"|api/services/journal_two/(notebook|note_|notes\.py)|api/routers/notebook_)")
# Commits a person reviewed and ruled NOT a Notebook landing although a criterion selects them:
# {full sha: why}. Empty at MEASURED_AT (the two criteria agree there).
REVIEWED_NOT_LANDINGS: dict[str, str] = {}
# `ours_drop` on `api/main.py` takes out only the wave's own router lines, so everything else in
# the hunk -- the tip's `_OPEN_READS` dependency on the journal_two mount (94926db1e, not a
# Notebook commit) included -- stays.
# Recorded resolutions for PRODUCT conflicts, {squash: {path: rule}}:
#   "delete"  the file goes (the wave added it; a later commit only touched its prose)
#   "ours"    the previous step's copy
#   ("hunks", [choice per conflict hunk], {post})  choice: "ours", "theirs", a literal
#       replacement, or ["ours_drop", <substring>...] = ours minus the lines holding them
#       (each substring must drop exactly one line); "all-ours" for every hunk.
RULES: dict[str, dict] = {
    "d9e887ca0": {
        "app/src/components/CommandPalette.jsx": ("hunks", [["ours_drop", "lib/notebookTelemetry'"]]),
        "tests/test_alert_destination.py": ("hunks", [[
            "ours_drop", "Notebook wave 10 lane 10D: the Notebook save-SLO pager",
            "read and converted at the Notebook's L1b integration",
            "so it never shipped as a literal reader", "api/services/journal_two/notebook_slo.py"]]),
    },
    "caf6d1b9e": {
        "api/main.py": ("hunks", [[
            "ours_drop", "Wave 8 seam S8-2: the share routes' own router",
            "# same pre-journal_two slot; tests/test_notebook_share_routes.py +",
            "# tests/test_main_router_order.py).", "notebook_shares_router.router",
            "Wave 8 seam S8-2: three STUB routers", "/api/j2/publish*|published* (8B)",
            "Outside /api/j2/notes/..., so mount order", "notebook_publish_router.router",
            "notebook_export_router.router", "notebook_onboarding_router.router"]]),
        "api/routers/auth.py": ("hunks", [[
            "ours_drop",
            "# Wave 8 seam S8-1: the ONE parse for every Notebook capability flag. The truthy /",
            "# falsy sets live there now; `_breadth_dc_flags` below reads the same two sets.",
            "from api.services.notebook_flags import FALSY as _FALSY, TRUTHY as _TRUTHY, flag_on"]]),
        "api/services/journal_two/public_note_payload.py": "delete",
        "tests/test_share_publish_authorization.py": "delete",
    },
    "f883e0996": {"api/main.py": ("hunks", [[
        "ours_drop", "# Wave 7 lane H (controller wiring): /api/j2/notes/{note_id}/writing-help/stream.",
        "# Mounted beside the other pre-journal_two Notebook routers; no path here can",
        "# be shadowed by journal_two's /api/j2/notes/{note_id} (different depth), but",
        "# the family is kept together and the mount is railed by name",
        "# (tests/test_main_router_order.py).", "notebook_writing_help_router.router"]])},
    "271a078b6": {"api/main.py": ("hunks", [[
        "ours_drop", "# Wave 6 (controller wiring) -- ORDER IS LOAD-BEARING: notebook_insights before",
        "# journal_two, or /api/j2/notes/tasks is answered as a note called",
        "# (lane F's report; rail tests/test_main_router_order.py).",
        "notebook_insights_router.router", "client_errors_router.router",
        "notebook_link_preview_router.router"]]),
                  "api/services/client_errors.py": "delete"},
    "8167f7aa0": {
        "app/src/pages/journal-2-0/lib/tiptap.js": ("hunks", "all-ours", {
            "import_after": ("import StarterKit from '@tiptap/starter-kit'",
                             "import { getSchema } from '@tiptap/core'"),
            "append": (
                "let editorSchemaCache = null\n"
                "/**\n"
                " * The app's REAL editor schema, built once from `buildExtensions()`. It is\n"
                " * what notebookSchema.js::declaredNotebookSchema reads to declare which note\n"
                " * types this bundle can read (X-UCT-Notebook-Schema).\n"
                " */\n"
                "export function editorSchema() {\n"
                "  if (!editorSchemaCache) editorSchemaCache = getSchema(buildExtensions())\n"
                "  return editorSchemaCache\n"
                "}\n")}),
    },
}

# Every recorded resolution is PINNED to the conflict it was measured on: sha256 (first 16 hex)
# of the conflict hunks' two sides (a hunk rule) or of the file being deleted (a delete rule),
# recorded at MEASURED_AT with `--record-pins`. A different conflict on the same path STOPS.
PINS: dict[str, dict[str, str]] = {
    "271a078b6": {
        "api/main.py": "64a4d181d834d6cc",
        "api/services/client_errors.py": "660c00227b8c0bc3",
    },
    "8167f7aa0": {
        "app/src/pages/journal-2-0/lib/tiptap.js": "af62a614d13bcc04",
    },
    "caf6d1b9e": {
        "api/main.py": "e19c020e021008a4",
        "api/routers/auth.py": "5525f10d14838f71",
        "api/services/journal_two/public_note_payload.py": "77da29e1bdb202e7",
        "tests/test_share_publish_authorization.py": "9f65da1bb6ff25e2",
    },
    "d9e887ca0": {
        "app/src/components/CommandPalette.jsx": "01c1a8f549ba6de9",
        "tests/test_alert_destination.py": "c50343b6f961eb35",
    },
    "f883e0996": {
        "api/main.py": "ca48146728a32293",
    },
}

NL = bytes([10])
HUNK = re.compile(rb"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)


class ChainStopped(Exception):
    """A conflict with no recorded rule: the chain refuses to guess."""


def _git(*a, env=None, inp=None, ok=(0,)):
    r = subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, env=env, input=inp)
    if r.returncode not in ok:
        raise RuntimeError(f"git {' '.join(a)}: rc {r.returncode}: {r.stderr.decode(errors='replace')}")
    return r


def _out(*a, **k) -> str:
    return _git(*a, **k).stdout.decode("utf-8", errors="replace")


def _blob(tree: str, path: str) -> str | None:
    return _git("rev-parse", "--verify", "-q", f"{tree}:{path}", ok=(0, 1, 128)).stdout.decode().strip() or None


def _fingerprint(merged: str, prev: str, path: str, rule) -> str:
    """What a recorded rule was measured against: the conflict hunks' two sides for a hunk rule,
    the file being deleted for a delete rule."""
    import hashlib
    if rule == "delete":
        data = _git("cat-file", "blob", f"{prev}:{path}", ok=(0, 128)).stdout
    else:
        text = _git("cat-file", "blob", f"{merged}:{path}").stdout
        data = bytes([0]).join(m.group(1) + bytes([1]) + m.group(2) for m in HUNK.finditer(text))
    return hashlib.sha256(data).hexdigest()[:16]


def _resolve_hunks(text: bytes, choices) -> bytes:
    hunks = list(HUNK.finditer(text))
    if choices == "all-ours":
        choices = ["ours"] * len(hunks)
    if len(hunks) != len(choices):
        raise ChainStopped(f"{len(hunks)} conflict hunks, the rule names {len(choices)}")
    res, pos = [], 0
    for m, c in zip(hunks, choices):
        res.append(text[pos:m.start()])
        if isinstance(c, list) and c[:1] == ["ours_drop"]:
            lines = m.group(1).splitlines(keepends=True)
            keep = [ln for ln in lines if not any(s.encode("utf-8") in ln for s in c[1:])]
            if len(lines) - len(keep) != len(c) - 1:
                raise ChainStopped(f"ours_drop removed {len(lines) - len(keep)} lines for {len(c) - 1} substrings")
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


def apply_step(prev: str, squash: str, tip: str, *, pick: bool = False, pins=None) -> dict:
    """One revert (or, `pick`, one cherry-pick) of `squash` onto `prev` -> a resolved tree."""
    base, theirs = (f"{squash}^", squash) if pick else (squash, f"{squash}^")
    r = _git("merge-tree", "--write-tree", "--name-only", "--messages", f"--merge-base={base}",
             prev, theirs, ok=(0, 1))
    lines = r.stdout.decode("utf-8", errors="replace").splitlines()
    merged, conflicts, i = lines[0], [], 1
    if r.returncode == 1:
        while i < len(lines) and lines[i].strip():
            conflicts.append(lines[i])
            i += 1
    conflicts = sorted(set(conflicts))
    fd, idx = tempfile.mkstemp(prefix="nb-rollback-idx-")
    os.close(fd)
    os.remove(idx)
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    try:
        _git("read-tree", merged, env=env)
        # KEEP_PATHS: the index's entries there are replaced wholesale by prev's.
        want = {}
        for ln in _out("ls-tree", "-r", prev, "--", *KEEP_PATHS).splitlines():
            meta, path = ln.split("\t", 1)
            mode, _kind, sha = meta.split()
            want[path] = (mode, sha)
        have = {}
        for ln in _out("ls-files", "-s", "--", *KEEP_PATHS, env=env).splitlines():
            meta, path = ln.split("\t", 1)
            mode, sha, _stage = meta.split()
            have[path] = (mode, sha)
        info = [f"0 {'0' * 40}\t{p}" for p in have if p not in want]
        info += [f"{m} {s}\t{p}" for p, (m, s) in want.items() if have.get(p) != (m, s)]
        if info:
            _git("update-index", "--index-info", env=env, inp=("\n".join(info) + "\n").encode("utf-8"))

        def put_from(tree, path):
            b = _blob(tree, path)
            if b is None:
                _git("update-index", "--force-remove", "--", path, env=env)
            else:
                mode = _out("ls-tree", tree, "--", path).split()[0]
                _git("update-index", "--add", "--cacheinfo", f"{mode},{b},{path}", env=env)

        def put_bytes(path, data):
            b = _git("hash-object", "-w", "--stdin", inp=data).stdout.decode().strip()
            _git("update-index", "--add", "--cacheinfo", f"100644,{b},{path}", env=env)

        product = [p for p in conflicts if p not in KEEP_AT_TIP
                   and not any(p == k or p.startswith(k + "/") for k in KEEP_PATHS)]
        rules = RULES.get(squash, {})
        missing = [p for p in product if p not in rules]
        if missing:
            raise ChainStopped(f"{'cherry-pick' if pick else 'revert'} {squash}: no recorded rule for "
                               f"the conflict in {', '.join(missing)}")
        for p in product:
            rule = rules[p]
            fp = _fingerprint(merged, prev, p, rule)
            if pins is not None:                       # --record-pins: collect, never enforce
                pins.setdefault(squash, {})[p] = fp
            elif PINS.get(squash, {}).get(p) != fp:
                raise ChainStopped(
                    f"{'cherry-pick' if pick else 'revert'} {squash}: the conflict in {p} is not the one "
                    f"its rule was measured on at {MEASURED_AT} (fingerprint {fp}, recorded "
                    f"{PINS.get(squash, {}).get(p)}). A later commit changed those lines: resolve by "
                    "hand (keep the newer work, take out only this landing's own lines), record the "
                    "rule and its pin, and rehearse the step (wave5-rollback.md, 'If the tool stops').")
            if rule == "delete":
                _git("update-index", "--force-remove", "--", p, env=env)
            elif rule == "ours":
                put_from(prev, p)
            else:
                post = rule[2] if len(rule) > 2 else {}
                data = _resolve_hunks(_git("cat-file", "blob", f"{merged}:{p}").stdout, rule[1])
                if post.get("import_after"):
                    anchor, line = post["import_after"]
                    if line.encode() not in data:
                        j = data.index(NL, data.index(anchor.encode())) + 1
                        data = data[:j] + line.encode() + NL + data[j:]
                if post.get("append"):
                    data = data.rstrip(NL) + NL + NL + post["append"].encode("utf-8")
                if re.search(rb"^(<<<<<<<|>>>>>>>) ", data, re.M):
                    raise ChainStopped(f"conflict markers left in {p}")
                put_bytes(p, data)
        would_change = [p for p in KEEP_AT_TIP if p in conflicts or _blob(merged, p) != _blob(prev, p)]
        for p in KEEP_AT_TIP:
            put_from(tip, p)
        tree = _out("write-tree", env=env).strip()
    finally:
        if os.path.exists(idx):
            os.remove(idx)
    return {"op": "cherry-pick" if pick else "revert", "squash": squash, "conflicts": conflicts,
            "product_conflicts": product, "schema_change_undone": would_change, "tree": tree,
            "schema_identical_to_tip": all(_blob(tree, p) == _blob(tip, p) for p in KEEP_AT_TIP)}


def plan(through: str, revert_hotfixes: bool = False) -> list[tuple[str, str, str, bool]]:
    keys = [k for k, _s, _w in CHAIN]
    if through not in keys:
        raise SystemExit(f"--through must be one of {', '.join(keys)}")
    kept = {k: s for k, s, _w in CHAIN if s in KEPT}
    if through in kept and not revert_hotfixes:
        raise ChainStopped(
            f"--through {through}: {kept[through]} is a kept server hotfix, never reverted with the "
            "features, so a rollback 'through' it would stop where the landing above it stops and "
            "leave it in place. Name the landing above or below it, or pass --revert-hotfixes to "
            "revert the hotfixes too (merge-clean, never booted).")
    steps = []
    for key, squash, what in CHAIN[: keys.index(through) + 1]:
        if squash in KEPT and not revert_hotfixes:
            continue
        steps.append((key, squash, what, False))
    if through == "wave5":
        steps += [(f"guard-{g}", g, f"re-apply guard {g}", True) for g in GUARD_PICKS]
    return steps


def notebook_landings(rng: str) -> list[dict]:
    """Every one-parent commit in `rng` (newest first) that EITHER census criterion selects:
    [{"sha", "subject", "by_subject", "by_path", "paths"}]. Merges are skipped: a Notebook landing
    is a squash."""
    out = []
    for line in _out("log", "--format=%H %P%x09%s", rng).splitlines():
        head, subject = line.split("\t", 1)
        sha, *parents = head.split()
        if len(parents) != 1:
            continue
        files = _out("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines()
        ships = any(f.startswith(("app/", "api/")) for f in files)
        by_subject = bool(ships and NOTEBOOK_SUBJECT.search(subject))
        paths = [f for f in files if NOTEBOOK_PATHS.match(f)]
        if by_subject or paths:
            out.append({"sha": sha, "subject": subject, "by_subject": by_subject,
                        "by_path": bool(paths), "paths": paths[:5]})
    return out


def check_base(start_sha: str) -> str | None:
    """Why the chain must not run from `start_sha`, or None. The reason says what to re-measure."""
    measured = _out("rev-parse", "--verify", f"{MEASURED_AT}^{{commit}}").strip()
    if _git("merge-base", "--is-ancestor", measured, start_sha, ok=(0, 1)).returncode != 0:
        return (f"{start_sha[:9]} does not contain MEASURED_AT {MEASURED_AT}: the chain and every rule "
                "were measured on a tree this base is not built on. Re-measure the chain from this base "
                "(wave5-rollback.md, 'If the tool stops') before rolling anything back.")
    named = {_out("rev-parse", f"{s}^{{commit}}").strip() for _k, s, _w in CHAIN}
    new = [c for c in notebook_landings(f"{measured}..{start_sha}")
           if c["sha"] not in named and c["sha"] not in REVIEWED_NOT_LANDINGS]
    if new:
        rows = "; ".join(
            f"{c['sha'][:9]} {c['subject'][:70]!r} (selected by "
            + " and ".join(k for k, v in (("subject", c["by_subject"]), ("path", c["by_path"])) if v)
            + (": " + ", ".join(c["paths"]) if c["paths"] else "") + ")" for c in new)
        return (f"{len(new)} commit(s) after MEASURED_AT {MEASURED_AT} look like Notebook landings the "
                f"chain does not name: {rows}. Add each landing to CHAIN newest first (or, if a person "
                "rules it is NOT one, to REVIEWED_NOT_LANDINGS with the reason), re-run from the new "
                "tip, record a rule and a pin for each conflict, rehearse the new step on a sandbox, "
                "and move MEASURED_AT.")
    return None


def run(start: str, through: str, revert_hotfixes: bool = False, emit=print, pins=None) -> dict:
    tip = _out("rev-parse", "--verify", f"{start}^{{commit}}").strip()
    why = check_base(tip)
    if why:
        raise ChainStopped(why)
    measured = _out("rev-parse", "--verify", f"{MEASURED_AT}^{{commit}}").strip()
    if tip != measured:
        n = len(_out("rev-list", f"{measured}..{tip}").split())
        emit(json.dumps({"warning": (
            f"the rules were measured at {MEASURED_AT}; this run is at {tip[:9]}, {n} commit(s) later, "
            "with no uncharted Notebook landing among them and every conflict matching its pin. The "
            "check list (step 2) and the sandbox rehearsal (step 3) are MANDATORY before this ships.")}))
    prev = tip
    for key, squash, what, pick in plan(through, revert_hotfixes):
        res = apply_step(prev, squash, tip, pick=pick, pins=pins)
        res.update(key=key, what=what)
        msg = (f"{'Re-apply' if pick else 'Revert'} {squash} ({what}) -- Notebook rollback through "
               f"{through}, built by tools/notebook_rollback_chain.py")
        res["commit"] = _out("commit-tree", res["tree"], "-p", prev, "-m", msg).strip()
        emit(json.dumps(res))
        prev = res["commit"]
    final = {"result": prev, "tree": _out("rev-parse", f"{prev}^{{tree}}").strip(), "through": through,
             "from": tip, "next": f"git switch -c rollback/notebook-through-{through} {prev}"}
    emit(json.dumps(final))
    return final


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--through", help="the oldest landing to roll back (see --list)")
    ap.add_argument("--from", dest="start", default="origin/master")
    ap.add_argument("--revert-hotfixes", action="store_true",
                    help=f"revert the kept server hotfixes {sorted(KEPT)} as well")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--record-pins", action="store_true",
                    help="run --through from MEASURED_AT with pins NOT enforced and print the pins "
                         "measured there (paste into PINS; the rail rebuilds and checks them)")
    a = ap.parse_args(argv)
    if a.record_pins:
        got: dict = {}
        run(MEASURED_AT, a.through or "wave5", a.revert_hotfixes, emit=lambda _l: None, pins=got)
        print(json.dumps(got, indent=4, sort_keys=True))
        return 0
    if a.list:
        for key, squash, what in CHAIN:
            print(f"{key:6} {squash}  {what}{'  [KEPT unless --revert-hotfixes]' if squash in KEPT else ''}")
        print(f"after wave5: re-apply {', '.join(GUARD_PICKS)}; kept paths: {', '.join(KEEP_PATHS)}; "
              f"schema tables: {', '.join(SCHEMA_FILES)}")
        return 0
    if not a.through:
        ap.error("--through is required (or --list)")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        run(a.start, a.through, a.revert_hotfixes)
    except ChainStopped as e:
        print(json.dumps({"stopped": str(e)}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
