"""Check that the `path:line` citations in markdown files point at real lines (FB-A3).

  python tools/doc_citation_resolver.py docs/terminal-research/COMPLETION-LEDGER.md
  python tools/doc_citation_resolver.py --rev origin/master a.md b.md
  python tools/doc_citation_resolver.py --self-check      # prove the check can fail

What it reads: every backticked span that is exactly a citation, such as `app/x.js:12`,
`app/x.js:12-34` or `app/x.js:12,40`. Text inside fenced code blocks is skipped, and so is
anything that looks like a URL or a placeholder (`*`, `<`, `{`).

How a citation is resolved, at a git revision (HEAD by default), never the working tree:
  1. relative to the repo root;
  2. relative to the markdown file's own folder, then each folder above it up to the root
     (so `12-decisions/x.md:3` written inside `docs/terminal-research/` resolves);
  3. otherwise, by path suffix over every file at that revision (so a bare `TerminalShell.jsx:225`
     resolves when exactly one file ends that way). Two or more suffix matches are reported as
     ambiguous unless every match contains the cited lines.

A citation is broken when no file matches (missing) or the cited line is past the end of the
file, below 1, or a range runs backwards (out of range).

Exit 0 clean, 1 at least one broken citation, 2 the check could not run (never a silent "clean").
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

# The whole backtick span must be a citation: a path with a file extension, a colon, then line
# numbers. The extension must start with a letter so `127.0.0.1:8000` is not a citation.
CITE_RE = re.compile(
    r"^(?P<path>[^\s`:]+\.[A-Za-z][A-Za-z0-9]*):(?P<lines>\d+(?:\s*[-–]\s*\d+)?"
    r"(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)$"
)
SPAN_RE = re.compile(r"`([^`\n]+)`")
FENCE_RE = re.compile(r"^\s*(```|~~~)")

SELF_CHECK_FIXTURE = """# self-check fixture: this file MUST fail

A good citation that resolves: `CLAUDE.md:1`.
A missing file: `tools/no_such_file_for_the_self_check.py:1`.
A line past the end: `CLAUDE.md:99999999`.

```
`inside/a/fence.py:1` is skipped
```
"""


@dataclass
class Citation:
    source: str          # the markdown file it was found in
    source_line: int     # line number in that markdown file
    raw: str             # the text inside the backticks
    path: str            # the cited path as written
    ranges: list = field(default_factory=list)   # [(start, end), ...]


@dataclass
class Finding:
    citation: Citation
    status: str          # ok | missing | out-of-range | ambiguous
    resolved: list = field(default_factory=list)
    detail: str = ""


def parse_ranges(text: str) -> list:
    out = []
    for part in text.split(","):
        part = part.strip()
        bits = re.split(r"\s*[-–]\s*", part)
        start = int(bits[0])
        end = int(bits[1]) if len(bits) > 1 else start
        out.append((start, end))
    return out


def extract_citations(text: str, source: str = "<text>") -> list:
    """Every backticked `path:line` citation outside fenced code blocks."""
    cites = []
    in_fence = False
    for n, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for m in SPAN_RE.finditer(line):
            raw = m.group(1).strip()
            if "://" in raw or any(c in raw for c in "*<>{}"):
                continue
            cm = CITE_RE.match(raw)
            if not cm:
                continue
            cites.append(Citation(source, n, raw, cm.group("path"), parse_ranges(cm.group("lines"))))
    return cites


def _norm(p: str) -> str:
    p = p.replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    parts = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
            continue
        parts.append(seg)
    return "/".join(parts)


def candidates(cite_path: str, source_rel_dir: str, tree: dict) -> list:
    """Repo paths this citation can mean, best first (see the module docstring)."""
    cp = cite_path.replace("\\", "/")
    if cp.startswith("/"):
        cp = cp.lstrip("/")
    if _norm(cp) in tree:
        return [_norm(cp)]
    d = _norm(source_rel_dir)
    while d:
        p = _norm(d + "/" + cp)
        if p in tree:
            return [p]
        d = d.rsplit("/", 1)[0] if "/" in d else ""
    suffix = "/" + _norm(cp)
    return sorted(p for p in tree if p.endswith(suffix))


def resolve(cites: list, tree: dict, repo_root_rel: dict) -> list:
    """`tree` maps repo path -> line count; `repo_root_rel` maps source -> its folder in the repo."""
    findings = []
    for c in cites:
        cands = candidates(c.path, repo_root_rel.get(c.source, ""), tree)
        if not cands:
            findings.append(Finding(c, "missing", [], "no file at the revision matches"))
            continue

        def fits(p):
            n = tree[p]
            return all(1 <= s <= e <= n for s, e in c.ranges)

        good = [p for p in cands if fits(p)]
        if len(cands) == 1:
            if good:
                findings.append(Finding(c, "ok", cands))
            else:
                findings.append(Finding(c, "out-of-range", cands,
                                        f"{cands[0]} has {tree[cands[0]]} lines"))
        elif good and len(good) == len(cands):
            findings.append(Finding(c, "ok", cands, "several files match; all contain the lines"))
        elif good:
            findings.append(Finding(c, "ambiguous", cands,
                                    f"{len(cands)} files match; the lines fit only {', '.join(good)}"))
        else:
            findings.append(Finding(c, "out-of-range", cands,
                                    "; ".join(f"{p} has {tree[p]} lines" for p in cands)))
    return findings


def count_lines(blob: bytes) -> int:
    if not blob:
        return 0
    return blob.count(b"\n") + (0 if blob.endswith(b"\n") else 1)


def _git(repo: str, *args: str, data: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True,
                          check=True).stdout


def load_tree(repo: str, rev: str, wanted: set | None = None) -> dict:
    """Map every file at `rev` to its line count. Counts only the paths in `wanted` (others get
    a huge sentinel so existence still resolves) to keep a 27k-file repo fast."""
    names = _git(repo, "ls-tree", "-r", "--name-only", "-z", rev).decode("utf-8", "replace")
    paths = [p for p in names.split("\0") if p]
    tree = {p: sys.maxsize for p in paths}
    todo = [p for p in paths if wanted is None or p in wanted]
    if todo:
        req = "".join(f"{rev}:{p}\n" for p in todo).encode("utf-8")
        out = _git(repo, "cat-file", "--batch", data=req)
        i = 0
        for p in todo:
            nl = out.index(b"\n", i)
            header = out[i:nl].split()
            size = int(header[2])
            blob = out[nl + 1:nl + 1 + size]
            tree[p] = count_lines(blob)
            i = nl + 1 + size + 1
    return tree


def check_files(md_files: list, repo: str, rev: str, texts: dict | None = None) -> list:
    repo_abs = os.path.abspath(repo)
    cites, src_dirs = [], {}
    for f in md_files:
        if texts and f in texts:
            text = texts[f]
            rel_dir = ""
        else:
            with open(f, encoding="utf-8") as fh:
                text = fh.read()
            rel = os.path.relpath(os.path.abspath(f), repo_abs).replace("\\", "/")
            rel_dir = rel.rsplit("/", 1)[0] if "/" in rel else ""
        src_dirs[f] = rel_dir
        cites.extend(extract_citations(text, f))
    all_paths = load_tree(repo, rev, wanted=set())
    wanted = set()
    for c in cites:
        wanted.update(candidates(c.path, src_dirs[c.source], all_paths))
    tree = load_tree(repo, rev, wanted=wanted)
    return resolve(cites, tree, src_dirs)


def report(findings: list, out=sys.stdout, verbose: bool = False) -> int:
    bad = [f for f in findings if f.status != "ok"]
    for f in findings:
        if f.status == "ok" and not verbose:
            continue
        c = f.citation
        where = ", ".join(f.resolved) if f.resolved else "-"
        print(f"{f.status.upper():13} {c.source}:{c.source_line}  `{c.raw}`  -> {where}"
              f"{'  (' + f.detail + ')' if f.detail else ''}", file=out)
    print(f"{len(findings)} citations, {len(findings) - len(bad)} ok, {len(bad)} broken", file=out)
    return 1 if bad else 0


def self_check(repo: str, rev: str) -> int:
    """The fixture holds one good and two broken citations. The check must find exactly both."""
    findings = check_files(["<fixture>"], repo, rev, texts={"<fixture>": SELF_CHECK_FIXTURE})
    statuses = sorted(f.status for f in findings)
    ok = statuses == ["missing", "ok", "out-of-range"]
    print(f"self-check fixture: {statuses} -> {'BITES (pass)' if ok else 'DOES NOT BITE (fail)'}")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*", help="markdown files to scan")
    ap.add_argument("--rev", default="HEAD", help="git revision to resolve against (default HEAD)")
    ap.add_argument("--repo", default=".", help="repository root (default: current directory)")
    ap.add_argument("--self-check", action="store_true", help="prove the check can fail")
    ap.add_argument("-v", "--verbose", action="store_true", help="also print the ok citations")
    a = ap.parse_args(argv)
    try:
        if a.self_check:
            return self_check(a.repo, a.rev)
        if not a.files:
            print("no files given", file=sys.stderr)
            return 2
        return report(check_files(a.files, a.repo, a.rev), verbose=a.verbose)
    except (subprocess.CalledProcessError, OSError, ValueError) as e:
        print(f"could not run: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
