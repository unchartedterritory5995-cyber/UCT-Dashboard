"""Task 10.8 -- the ready-made widgets as immutable revision files, and the hash rail (W10-R5).

`api/services/journal_two/widget_engine/shelf/` holds one file per revision, `<slug>.r<N>.json`, and
`MANIFEST.json` with the canonical-JSON SHA-256 of each. A released revision never changes: the
manifest hash is checked when `shelf` is imported (a broken shelf fails the boot, never a member's
card), and `test_released_revisions_never_change` compares this tree against `origin/master`'s
manifest so an edited or removed released revision reds here.

Everything that writes, writes into `tmp_path`; the real shelf directory is only ever read.
"""
from __future__ import annotations

import contextlib
import copy
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import shelf, sources

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "shelf_wave8.json"
MANIFEST_REL = "api/services/journal_two/widget_engine/shelf/MANIFEST.json"
OLD_SHELF_REL = "api/services/journal_two/widget_engine/shelf.json"
FETCH = "git fetch origin master"
_FILE_RE = re.compile(r"(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.r(?P<rev>[1-9][0-9]*)\.json")


def _manifest() -> dict:
    return json.loads(shelf.MANIFEST_PATH.read_text(encoding="utf-8"))


def _revision_files() -> list[Path]:
    return sorted(p for p in shelf.SHELF_DIR.iterdir() if p.is_file() and p != shelf.MANIFEST_PATH)


@contextlib.contextmanager
def planted(tmp_path: Path, revisions: list[dict], *, new_ids: tuple[str, ...] = ()):
    """A copy of the real shelf with `revisions` added (each a full revision dict), loaded as THE
    shelf for the block, then the real shelf reloaded. The tmp manifest is rewritten wholesale: it
    is a throwaway copy, never a tracked file."""
    d = tmp_path / "shelf"
    shutil.copytree(shelf.SHELF_DIR, d, ignore=shutil.ignore_patterns("__pycache__"))
    man = json.loads((d / "MANIFEST.json").read_text(encoding="utf-8"))
    for r in revisions:
        name = f"{r['id'][len(shelf.ID_PREFIX):]}.r{r['rev']}.json"
        (d / name).write_text(json.dumps(r, indent=2), encoding="utf-8")
        man["files"].append({"file": name, "sha256": shelf.canonical_hash(r)})
    man["order"].extend(new_ids)
    (d / "MANIFEST.json").write_text(json.dumps(man, indent=2), encoding="utf-8")
    shelf.load(d)
    try:
        yield d
    finally:
        shelf.load()


def rev2_of(shelf_id: str, **plan_changes) -> dict:
    """Revision 2 of a real example: revision 1 with `plan_changes` merged into its plan."""
    r1 = shelf.revision(shelf_id, 1)
    assert r1 is not None, shelf_id
    p = copy.deepcopy(r1["plan"])
    p.update(plan_changes)
    return {"id": shelf_id, "rev": 2, "name": r1["name"], "description": r1["description"],
            "keywords": list(r1["keywords"]), "plan": p}


# -- the manifest and the files ----------------------------------------------------------------------

def test_manifest_hashes_match_files():
    man = _manifest()
    assert man["version"] == 1 and len(man["files"]) >= 23            # non-vacuity: 23 wave 8 rows
    for entry in man["files"]:
        obj = json.loads((shelf.SHELF_DIR / entry["file"]).read_text(encoding="utf-8"))
        assert shelf.canonical_hash(obj) == entry["sha256"], entry["file"]
        assert re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), entry["file"]


def test_every_file_listed_and_every_entry_exists():
    listed = [e["file"] for e in _manifest()["files"]]
    on_disk = [p.name for p in _revision_files()]
    assert on_disk, "the shelf directory holds no revision files"
    assert len(listed) == len(set(listed)), "a file is listed twice"
    assert sorted(listed) == sorted(on_disk)
    assert shelf.MANIFEST_PATH.is_file() and not (shelf.SHELF_DIR.parent / "shelf.json").exists()


def test_revisions_contiguous_from_one():
    revs: dict[str, list[int]] = {}
    for p in _revision_files():
        m = _FILE_RE.fullmatch(p.name)
        assert m, p.name
        revs.setdefault(m["slug"], []).append(int(m["rev"]))
    assert len(revs) == 26                                  # 23 wave 8 ids + 3 new (Task 10.13)
    for slug, rs in revs.items():
        assert sorted(rs) == list(range(1, len(rs) + 1)), slug
    order = _manifest()["order"]
    assert len(order) == len(set(order)) and set(order) == {shelf.ID_PREFIX + s for s in revs}


def test_file_name_id_rev_agree():
    for p in _revision_files():
        m = _FILE_RE.fullmatch(p.name)
        obj = json.loads(p.read_text(encoding="utf-8"))
        assert list(obj) == ["id", "rev", "name", "description", "keywords", "plan"], p.name
        assert obj["id"] == shelf.ID_PREFIX + m["slug"] and obj["rev"] == int(m["rev"]), p.name
        assert shelf.revision(obj["id"], obj["rev"])["name"] == obj["name"]


def test_canonical_hash_ignores_line_endings(tmp_path):
    src = (shelf.SHELF_DIR / "win-rate.r1.json").read_text(encoding="utf-8")
    lf = src.replace("\r\n", "\n")
    crlf = lf.replace("\n", "\r\n")
    assert "\r\n" in crlf and "\r" not in lf                       # the two copies really differ
    (tmp_path / "lf.json").write_bytes(lf.encode("utf-8"))
    (tmp_path / "crlf.json").write_bytes(crlf.encode("utf-8"))
    a = json.loads((tmp_path / "lf.json").read_bytes().decode("utf-8"))
    b = json.loads((tmp_path / "crlf.json").read_bytes().decode("utf-8"))
    assert shelf.canonical_hash(a) == shelf.canonical_hash(b)
    b["name"] += "!"                                              # control: content still moves it
    assert shelf.canonical_hash(a) != shelf.canonical_hash(b)


# -- released revisions never change (the rail against origin/master) --------------------------------

def released_violations(released: dict, local: dict, base: dict | None) -> list[str]:
    """What this tree did to revisions `released` (origin/master's manifest) already published.

    `base` is the manifest at merge-base(HEAD, origin/master), or None when the base had none. A
    released file missing here because master released it AFTER this branch's base is the world
    moving, not a violation (merge master). A released file whose hash differs here, where this
    branch's copy is still the base's copy, was changed on master, not by this branch."""
    mine = {e["file"]: e["sha256"] for e in local["files"]}
    at_base = {e["file"]: e["sha256"] for e in (base or {}).get("files", [])}
    out = []
    for e in released["files"]:
        f, sha = e["file"], e["sha256"]
        if f in mine:
            if mine[f] != sha and at_base.get(f) != mine[f]:
                out.append(f"{f}: changed after release")
        elif f in at_base:
            out.append(f"{f}: removed after release")
    return out


def test_released_violations_sees_a_changed_or_removed_revision():
    local = {"files": [{"file": "a.r1.json", "sha256": "1" * 64}, {"file": "b.r1.json", "sha256": "2" * 64}]}
    assert released_violations(local, local, local) == []                       # identical: clean
    edited = {"files": [{"file": "a.r1.json", "sha256": "9" * 64}, local["files"][1]]}
    assert released_violations(local, edited, local) == ["a.r1.json: changed after release"]
    assert released_violations(local, {"files": [local["files"][1]]}, local) == [
        "a.r1.json: removed after release"]
    # the world moving is not a violation: master released c after this branch's base ...
    ahead = {"files": local["files"] + [{"file": "c.r1.json", "sha256": "3" * 64}]}
    assert released_violations(ahead, local, local) == []
    assert released_violations(ahead, local, None) == []
    # ... and master editing a revision this branch never touched is master's, not this branch's
    assert released_violations(edited, local, local) == []


def _git(*args: str) -> subprocess.CompletedProcess:
    exe = shutil.which("git")
    if exe is None:
        pytest.fail(f"git is not on PATH, so released revisions cannot be checked; install git and run `{FETCH}`")
    return subprocess.run([exe, "-C", str(REPO), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def _show(ref: str, rel: str) -> str | None:
    if _git("cat-file", "-e", f"{ref}:{rel}").returncode != 0:
        return None
    r = _git("show", f"{ref}:{rel}")
    if r.returncode != 0:
        pytest.fail(f"git could not read {ref}:{rel} ({r.stderr.strip()}); run `{FETCH}`")
    return r.stdout


def test_released_revisions_never_change():
    head = _git("rev-parse", "--verify", "--quiet", "origin/master^{commit}")
    if head.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", head.stdout.strip()):
        pytest.fail(f"origin/master cannot be read here, so released revisions are unchecked; run `{FETCH}`")
    # non-vacuity: git reads origin/master's tree (an absent manifest below means absent, not broken)
    if _git("cat-file", "-e", "origin/master:api").returncode != 0:
        pytest.fail(f"origin/master's tree cannot be read; run `{FETCH}`")
    released = _show("origin/master", MANIFEST_REL)
    if released is None:
        # the shelf.json era: nothing is released as a revision file yet, so the rail is the
        # conversion rail (`test_r1_files_match_wave8_shelf`). If master still carries the wave 8
        # file, the history fixture must be that file.
        old = _show("origin/master", OLD_SHELF_REL)
        if old is not None:
            assert json.loads(old) == json.loads(FIXTURE.read_text(encoding="utf-8"))
        return
    base_sha = _git("merge-base", "HEAD", "origin/master")
    if base_sha.returncode != 0:
        pytest.fail(f"no merge-base with origin/master ({base_sha.stderr.strip()}); run `{FETCH}`")
    base = _show(base_sha.stdout.strip(), MANIFEST_REL)
    bad = released_violations(json.loads(released), _manifest(), json.loads(base) if base else None)
    assert bad == [], bad


# -- each committed revision is still the bytes it was added with (works before any merge) ----------

SHELF_REL = "api/services/journal_two/widget_engine/shelf"


def add_commit_violations(entries: list[dict], added, local) -> list[str]:
    """`added(file)` is the revision as its add commit stored it (None: not committed yet, ignored);
    `local(file)` is the working-tree revision. Both must hash to the manifest entry."""
    out = []
    for e in entries:
        first = added(e["file"])
        if first is None:
            continue
        if shelf.canonical_hash(first) != e["sha256"]:
            out.append(f"{e['file']}: differs from its add commit")
        elif shelf.canonical_hash(local(e["file"])) != e["sha256"]:
            out.append(f"{e['file']}: working tree differs from its add commit")
    return out


def test_add_commit_rail_sees_an_edit_after_add():
    r1 = shelf.revision("shelf:win-rate", 1)
    first = {"id": r1["id"], "rev": 1, "name": "Win rate", "description": "d", "keywords": [], "plan": {}}
    edited = dict(first, name="Win Rate")
    entry = [{"file": "win-rate.r1.json", "sha256": shelf.canonical_hash(first)}]
    assert add_commit_violations(entry, lambda f: first, lambda f: first) == []      # clean
    # edited after its add commit AND the manifest hash moved with it: still red
    moved = [{"file": "win-rate.r1.json", "sha256": shelf.canonical_hash(edited)}]
    assert add_commit_violations(moved, lambda f: first, lambda f: edited) == [
        "win-rate.r1.json: differs from its add commit"]
    # edited in the working tree only
    assert add_commit_violations(entry, lambda f: first, lambda f: edited) == [
        "win-rate.r1.json: working tree differs from its add commit"]
    assert add_commit_violations(entry, lambda f: None, lambda f: edited) == []      # not committed


UNSHALLOW = "git fetch --unshallow"


def _git_at(repo: Path, *args: str) -> subprocess.CompletedProcess:
    exe = shutil.which("git")
    if exe is None:
        pytest.fail("git is not on PATH, so committed revisions cannot be checked; install git")
    return subprocess.run([exe, "-C", str(repo), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def _ok(r: subprocess.CompletedProcess, what: str) -> str:
    if r.returncode != 0:
        pytest.fail(f"git failed: {what} ({r.stderr.strip()})")
    return r.stdout


def _shallow_boundaries(repo: Path) -> tuple[bool, set[str]]:
    """`(is_shallow, the shallow file's commits)` (ruling W10-R40: shallow alone is not a failure)."""
    shallow = _ok(_git_at(repo, "rev-parse", "--is-shallow-repository"), "is-shallow").strip() == "true"
    path = Path(_ok(_git_at(repo, "rev-parse", "--git-path", "shallow"), "git-path shallow").strip())
    if not path.is_absolute():
        path = repo / path
    shas = set(path.read_text(encoding="utf-8").split()) if path.is_file() else set()
    return shallow, shas


def _add_commit(repo: Path, rel: str) -> tuple[str, str]:
    """`(sha, path then)` of the commit that ADDED `rel`, following RENAMES only (Task 10.13).

    `git log --follow` also follows a copy: a new revision file is a near-copy of the revision before
    it (`equity-curve.r2.json` was reported as `C075` of `equity-curve.r1.json`), so --follow handed
    back r1's add commit and the rail called every new revision "edited". Here a commit that adds the
    path is followed back only when, in that same commit, git reports it as `R` (renamed: the old
    path is gone). A copy or a plain add is the add commit.

    The OLDEST add of the path is its add commit (fix round 1, M-6): a revision deleted and re-added
    with different bytes has a newer add commit that agrees with the working tree, and reading the
    newest one would call that rewrite clean."""
    path, start = rel, "HEAD"
    for _ in range(100):                                   # a rename chain, never a loop
        out = _ok(_git_at(repo, "log", "--diff-filter=A", "--format=%H", start, "--", path),
                  f"log {path}").split()
        if not out or not all(re.fullmatch(r"[0-9a-f]{40}", x) for x in out):
            pytest.fail(f"git could not find the commit that added {path}: {out!r}")
        sha = out[-1]                                      # newest first: the last is the first add
        status = _ok(_git_at(repo, "diff-tree", "-r", "-M", "--name-status", "--no-commit-id", sha),
                     f"diff-tree {sha}").splitlines()
        renamed = [l.split("	") for l in status if l.startswith("R") and l.split("	")[-1] == path]
        if not renamed:
            return sha, path
        path, start = renamed[0][1], sha
    pytest.fail(f"{rel}: more than 100 renames")


def add_commit_revisions(repo: Path, rel_dir: str, names: list[str]) -> tuple[dict, list[str]]:
    """For each committed file `rel_dir/<name>`: the revision its ADD commit stored, following
    renames (never copies: `_add_commit`; read at the path it had then). Returns
    `({name: obj}, problems)`; a file whose add commit is a shallow boundary is a problem (its real
    add commit is not here), never a silent pass. Uncommitted files are left out. Git errors fail
    the test."""
    tracked = {Path(p).name for p in
               _ok(_git_at(repo, "ls-files", "--", rel_dir), "ls-files").splitlines() if p.strip()}
    shallow, boundaries = _shallow_boundaries(repo)
    out, problems = {}, []
    for name in names:
        if name not in tracked:
            continue
        rel = f"{rel_dir}/{name}"
        sha, then = _add_commit(repo, rel)
        if sha in boundaries or (shallow and not _ok(
                _git_at(repo, "rev-list", "--parents", "-n", "1", sha), "parents").split()[1:]):
            problems.append(f"{name}: its add commit {sha[:10]} is a shallow boundary, so the "
                            f"real add commit is not here; run `{UNSHALLOW}`")
            continue
        out[name] = json.loads(_ok(_git_at(repo, "show", f"{sha}:{then}"), f"show {sha}:{then}"))
    return out, problems


#: Task 10.13: 23 wave 8 revision 1s, six revision 2s and three new revision 1s.
SHELF_FILES = 32


def append_only_violations(first: dict, local: dict) -> list[str]:
    """What `local` (the manifest now) did to `first` (the manifest as its add commit stored it):
    every first entry must still be there, in the same place with the same hash, new entries only
    after them; every first id keeps its relative order."""
    out = []
    old, new = first["files"], local["files"]
    if new[:len(old)] != old:
        out.append("files: an entry was edited, removed or moved; only append new entries")
    kept = [i for i in local["order"] if i in set(first["order"])]
    if kept != first["order"]:
        out.append("order: a released id was removed or moved")
    return out


def test_append_only_violations_sees_an_edit_a_removal_and_a_move():
    first = {"files": [{"file": "a.r1.json", "sha256": "1" * 64}, {"file": "b.r1.json", "sha256": "2" * 64}],
             "order": ["shelf:a", "shelf:b"]}
    grown = copy.deepcopy(first)
    grown["files"].append({"file": "a.r2.json", "sha256": "3" * 64})
    grown["order"].insert(1, "shelf:c")
    assert append_only_violations(first, grown) == []                       # appended: clean
    edited = copy.deepcopy(grown)
    edited["files"][0]["sha256"] = "9" * 64
    assert append_only_violations(first, edited) == [
        "files: an entry was edited, removed or moved; only append new entries"]
    removed = copy.deepcopy(grown)
    del removed["files"][1]
    assert append_only_violations(first, removed) != []
    moved = copy.deepcopy(grown)
    moved["files"].insert(0, moved["files"].pop())                          # a new entry put first
    assert append_only_violations(first, moved) != []
    swapped = copy.deepcopy(grown)
    swapped["order"] = ["shelf:b", "shelf:c", "shelf:a"]
    assert append_only_violations(first, swapped) == ["order: a released id was removed or moved"]


def test_manifest_append_only_and_hashes():
    man = _manifest()
    assert len(man["files"]) == len(_revision_files()) == SHELF_FILES
    for entry in man["files"]:                                              # the hash rail, all 32
        obj = json.loads((shelf.SHELF_DIR / entry["file"]).read_text(encoding="utf-8"))
        assert shelf.canonical_hash(obj) == entry["sha256"], entry["file"]
    first, problems = add_commit_revisions(REPO, SHELF_REL, ["MANIFEST.json"])
    assert problems == [], problems
    assert "MANIFEST.json" in first, "the manifest's add commit is missing (non-vacuity)"
    assert len(first["MANIFEST.json"]["files"]) == 23                        # Task 10.8's manifest
    assert append_only_violations(first["MANIFEST.json"], man) == []
    # each committed revision file is its add commit's bytes: `test_revisions_match_their_add_commit`


def test_revisions_match_their_add_commit():
    entries = _manifest()["files"]
    first, problems = add_commit_revisions(REPO, SHELF_REL, [e["file"] for e in entries] + ["MANIFEST.json"])
    assert problems == [], problems
    assert len(first) >= 23, "the committed shelf is missing (non-vacuity: 23 revisions)"

    def local(name: str):
        return json.loads((shelf.SHELF_DIR / name).read_text(encoding="utf-8"))

    bad = add_commit_violations(entries, first.get, local)
    assert bad == [], bad


def _repo(path: Path) -> Path:
    path.mkdir()
    _ok(_git_at(path, "init", "-q", "-b", "main"), "init")
    for k, v in (("user.name", "t"), ("user.email", "t@example.test"), ("core.autocrlf", "false")):
        _ok(_git_at(path, "config", k, v), "config")
    return path


def _commit(repo: Path, msg: str) -> None:
    _ok(_git_at(repo, "add", "-A"), "add")
    _ok(_git_at(repo, "commit", "-q", "-m", msg), "commit")


def test_add_commit_rail_follows_renames_and_refuses_shallow_boundaries(tmp_path, monkeypatch):
    rev = lambda name: {"id": "shelf:x", "rev": 1, "name": name, "description": "d",
                        "keywords": [], "plan": {}}
    src = _repo(tmp_path / "src")
    for i in range(2):                                             # history older than the add
        (src / f"base{i}.txt").write_text(str(i), encoding="utf-8")
        _commit(src, f"base {i}")
    d = src / "shelf"
    d.mkdir()
    (d / "old.r1.json").write_text(json.dumps(rev("first")), encoding="utf-8")
    _commit(src, "add")
    (d / "old.r1.json").write_text(json.dumps(rev("edited")), encoding="utf-8")
    _commit(src, "edit before the rename")
    (d / "old.r1.json").rename(d / "x.r1.json")
    _commit(src, "rename")
    (src / "other.txt").write_text("x", encoding="utf-8")
    _commit(src, "unrelated")
    entry = [{"file": "x.r1.json", "sha256": shelf.canonical_hash(rev("edited"))}]
    local = lambda f: json.loads((d / f).read_text(encoding="utf-8"))

    # the rename is followed back to the add commit, so the pre-rename edit is caught
    first, problems = add_commit_revisions(src, "shelf", ["x.r1.json", "uncommitted.r1.json"])
    assert problems == [] and first["x.r1.json"]["name"] == "first"
    assert add_commit_violations(entry, first.get, local) == ["x.r1.json: differs from its add commit"]
    # control: a file added once and never edited is clean in the same repo
    clean = [{"file": "x.r1.json", "sha256": shelf.canonical_hash(rev("first"))}]
    assert add_commit_violations(clean, first.get, lambda f: rev("first")) == []

    # a shallow clone whose boundary is the commit that appears to add the file: red, never a pass
    shallow = tmp_path / "shallow"
    _ok(_git_at(tmp_path, "clone", "-q", "--depth", "1", (src.as_uri()), str(shallow)), "clone")
    _, problems = add_commit_revisions(shallow, "shelf", ["x.r1.json"])
    assert len(problems) == 1 and UNSHALLOW in problems[0], problems
    # each leg of the boundary test on its own: the shallow file's list, then "shallow + no parents"
    real = _shallow_boundaries(shallow)
    assert real[0] is True and real[1]
    for only in ((False, real[1]), (True, set())):
        monkeypatch.setattr(sys.modules[__name__], "_shallow_boundaries", lambda repo, o=only: o)
        _, problems = add_commit_revisions(shallow, "shelf", ["x.r1.json"])
        assert len(problems) == 1 and UNSHALLOW in problems[0], (only, problems)
    monkeypatch.undo()
    # ... and so is one cut at the edit (the add commit is out of reach) ...
    cut = tmp_path / "cut"
    _ok(_git_at(tmp_path, "clone", "-q", "--depth", "3", (src.as_uri()), str(cut)), "clone")
    _, problems = add_commit_revisions(cut, "shelf", ["x.r1.json"])
    assert len(problems) == 1 and UNSHALLOW in problems[0], problems
    # ... while a shallow clone whose boundary is OLDER than the add commit is fine (W10-R40)
    deep = tmp_path / "deep"
    _ok(_git_at(tmp_path, "clone", "-q", "--depth", "5", (src.as_uri()), str(deep)), "clone")
    assert _shallow_boundaries(deep)[0] is True
    first, problems = add_commit_revisions(deep, "shelf", ["x.r1.json"])
    assert problems == [] and first["x.r1.json"]["name"] == "first"


def test_add_commit_rail_sees_a_revision_deleted_and_re_added(tmp_path):
    """Fix round 1, M-6: delete a committed revision, re-add it with other bytes in a later commit,
    and the rail compares against the FIRST add, so the rewrite reds."""
    rev = lambda name: {"id": "shelf:x", "rev": 1, "name": name, "description": "d",
                        "keywords": [], "plan": {}}
    src = _repo(tmp_path / "src")
    d = src / "shelf"
    d.mkdir()
    (d / "x.r1.json").write_text(json.dumps(rev("first")), encoding="utf-8")
    _commit(src, "add")
    (d / "x.r1.json").unlink()
    _commit(src, "delete")
    (d / "x.r1.json").write_text(json.dumps(rev("rewritten")), encoding="utf-8")
    _commit(src, "re-add")
    first, problems = add_commit_revisions(src, "shelf", ["x.r1.json"])
    assert problems == [] and first["x.r1.json"]["name"] == "first"
    entry = [{"file": "x.r1.json", "sha256": shelf.canonical_hash(rev("rewritten"))}]
    local = lambda f: json.loads((d / f).read_text(encoding="utf-8"))
    assert add_commit_violations(entry, first.get, local) == ["x.r1.json: differs from its add commit"]
    # control: a file added once and never touched again is clean
    (d / "y.r1.json").write_text(json.dumps(rev("y")), encoding="utf-8")
    _commit(src, "add y")
    first, _ = add_commit_revisions(src, "shelf", ["y.r1.json"])
    clean = [{"file": "y.r1.json", "sha256": shelf.canonical_hash(rev("y"))}]
    assert add_commit_violations(clean, first.get, local) == []


def test_add_commit_rail_never_follows_a_copy(tmp_path):
    """Task 10.13: a new revision is a near-copy of the one before it, and the old one stays. Its add
    commit is its own, never the old file's (git's --follow reported `C` and followed it)."""
    rev = lambda n, name: {"id": "shelf:x", "rev": n, "name": name, "description": "the same words",
                           "keywords": ["a", "b", "c"], "plan": {"v": 1, "source": "closed_trades"}}
    src = _repo(tmp_path / "src")
    d = src / "shelf"
    d.mkdir()
    (d / "x.r1.json").write_text(json.dumps(rev(1, "first"), indent=2), encoding="utf-8")
    _commit(src, "add r1")
    (d / "x.r2.json").write_text(json.dumps(rev(2, "second"), indent=2), encoding="utf-8")
    _commit(src, "add r2")
    # non-vacuity: git itself calls the new file a copy of the old one
    cp = _ok(_git_at(src, "log", "--follow", "--name-status", "--format=", "-1", "--", "shelf/x.r2.json"),
             "log --follow")
    assert cp.startswith("C"), cp
    first, problems = add_commit_revisions(src, "shelf", ["x.r1.json", "x.r2.json"])
    assert problems == []
    assert (first["x.r1.json"]["name"], first["x.r2.json"]["name"]) == ("first", "second")
    entries = [{"file": f, "sha256": shelf.canonical_hash(first[f])} for f in first]
    local = lambda f: json.loads((d / f).read_text(encoding="utf-8"))
    assert add_commit_violations(entries, first.get, local) == []


# -- revision 1 is the wave 8 shelf, unchanged --------------------------------------------------------

def test_r1_files_match_wave8_shelf():
    old = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert old["version"] == 1 and len(old["examples"]) == 23
    wave8 = [e["id"] for e in old["examples"]]
    assert [i for i in _manifest()["order"] if i in set(wave8)] == wave8   # new ids slot in between
    for e in old["examples"]:
        r1 = json.loads((shelf.SHELF_DIR / f"{e['id'][len(shelf.ID_PREFIX):]}.r1.json")
                        .read_text(encoding="utf-8"))
        for k in ("name", "description", "keywords"):
            assert r1[k] == e[k], (e["id"], k)
        assert (wplan.validate_plan(copy.deepcopy(r1["plan"]), sources.CATALOG)
                == wplan.validate_plan(copy.deepcopy(e["plan"]), sources.CATALOG)), e["id"]
        assert shelf.revision(e["id"], 1)["plan"] == wplan.validate_plan(copy.deepcopy(e["plan"]),
                                                                        sources.CATALOG)


# -- a broken shelf fails the load ---------------------------------------------------------------------

def _copy(tmp_path: Path) -> Path:
    d = tmp_path / "shelf"
    shutil.copytree(shelf.SHELF_DIR, d, ignore=shutil.ignore_patterns("__pycache__"))
    return d


def test_broken_file_fails_load(tmp_path):
    d = _copy(tmp_path)
    shelf.load(d)                                                 # control: the copy loads
    shelf.load()
    f = d / "win-rate.r1.json"
    raw = f.read_bytes()
    i = raw.index(b"Win rate")
    f.write_bytes(raw[:i] + b"Win Rate" + raw[i + len(b"Win rate"):])   # one byte edited
    with pytest.raises(shelf.ShelfError, match=r"win-rate\.r1\.json"):
        shelf.load(d)
    assert shelf.revision("shelf:win-rate", 1)["name"] == "Win rate"    # the real shelf stands


def test_broken_shelf_shapes_fail_load(tmp_path):
    d = _copy(tmp_path)
    man_path = d / "MANIFEST.json"
    man = json.loads(man_path.read_text(encoding="utf-8"))

    def write(m):
        man_path.write_text(json.dumps(m), encoding="utf-8")

    (d / "stray.r1.json").write_text("{}", encoding="utf-8")       # a file nobody listed
    with pytest.raises(shelf.ShelfError, match="stray.r1.json"):
        shelf.load(d)
    (d / "stray.r1.json").unlink()
    m = copy.deepcopy(man)
    m["files"].append(dict(m["files"][0]))                         # one entry listed twice
    write(m)
    with pytest.raises(shelf.ShelfError, match="listed twice"):
        shelf.load(d)
    m = copy.deepcopy(man)
    m["files"].append({"file": "gone.r1.json", "sha256": "0" * 64})  # an entry with no file
    write(m)
    with pytest.raises(shelf.ShelfError, match="gone.r1.json"):
        shelf.load(d)
    m = copy.deepcopy(man)
    m["order"] = m["order"][1:]                                     # an id the order forgets
    write(m)
    with pytest.raises(shelf.ShelfError, match="order"):
        shelf.load(d)
    # a gap: revision 3 with no revision 2
    r3 = rev2_of("shelf:win-rate")
    r3["rev"] = 3
    (d / "win-rate.r3.json").write_text(json.dumps(r3), encoding="utf-8")
    m = copy.deepcopy(man)
    m["files"].append({"file": "win-rate.r3.json", "sha256": shelf.canonical_hash(r3)})
    write(m)
    with pytest.raises(shelf.ShelfError, match="contiguous"):
        shelf.load(d)
    # a file whose name and rev disagree
    (d / "win-rate.r3.json").rename(d / "win-rate.r2.json")
    m["files"][-1]["file"] = "win-rate.r2.json"
    write(m)
    with pytest.raises(shelf.ShelfError, match=r"win-rate\.r2\.json"):
        shelf.load(d)
    # a plan that does not validate (hash updated, so only the plan is wrong)
    bad = rev2_of("shelf:win-rate", measures=[{"key": "no_such_measure"}])
    (d / "win-rate.r2.json").write_text(json.dumps(bad), encoding="utf-8")
    m["files"][-1]["sha256"] = shelf.canonical_hash(bad)
    write(m)
    with pytest.raises(shelf.ShelfError, match="shelf:win-rate"):
        shelf.load(d)
    write(man)
    (d / "win-rate.r2.json").unlink()
    shelf.load(d)                                                   # control: restored, it loads
    shelf.load()


def test_planted_revision_two_is_served_and_pinned(tmp_path):
    r2 = rev2_of("shelf:win-rate", range={"token": "last_30d"})
    with planted(tmp_path, [r2]):
        assert shelf.latest_rev("shelf:win-rate") == 2
        assert shelf.example("shelf:win-rate")["rev"] == 2
        assert shelf.revision("shelf:win-rate", 1)["plan"]["range"] == {"token": "last_90d"}
        assert shelf.revision("shelf:win-rate", 2)["plan"]["range"] == {"token": "last_30d"}
        assert shelf.revision("shelf:win-rate", 3) is None
    assert shelf.latest_rev("shelf:win-rate") == 1                  # the real shelf is back
