"""Rails for tools/doc_citation_resolver.py (FB-A3)."""
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import doc_citation_resolver as r  # noqa: E402


TREE = {
    "app/src/pages/terminal/TerminalShell.jsx": 400,
    "docs/terminal-research/12-decisions/d.md": 50,
    "docs/terminal-research/COMPLETION-LEDGER.md": 300,
    "a/dup.py": 10,
    "b/dup.py": 100,
}


def _one(text, source="docs/terminal-research/COMPLETION-LEDGER.md", tree=TREE):
    cites = r.extract_citations(text, source)
    src_dir = source.rsplit("/", 1)[0]
    return r.resolve(cites, tree, {source: src_dir})


def test_extracts_single_lines_ranges_and_lists():
    cites = r.extract_citations("x `a/b.py:12` y `c.md:3-9` z `d.js:225,312`")
    assert [(c.path, c.ranges) for c in cites] == [
        ("a/b.py", [(12, 12)]), ("c.md", [(3, 9)]), ("d.js", [(225, 225), (312, 312)])]


def test_skips_fences_urls_placeholders_and_non_citations():
    text = "\n".join([
        "```", "`inside.py:1`", "```",
        "`https://x.com/a.py:1`", "`app/**/x.js:2`", "`127.0.0.1:8000`",
        "`MAX_BOARD_WIDGETS`", "`:2263`", "`a.py`",
    ])
    assert r.extract_citations(text) == []


def test_repo_root_path_resolves_and_out_of_range_is_caught():
    f = _one("`app/src/pages/terminal/TerminalShell.jsx:291` and "
             "`app/src/pages/terminal/TerminalShell.jsx:401`")
    assert [x.status for x in f] == ["ok", "out-of-range"]


def test_path_relative_to_an_ancestor_of_the_markdown_file_resolves():
    f = _one("`12-decisions/d.md:39`")
    assert f[0].status == "ok"
    assert f[0].resolved == ["docs/terminal-research/12-decisions/d.md"]


def test_bare_filename_resolves_by_unique_suffix():
    f = _one("`TerminalShell.jsx:225,312`")
    assert f[0].status == "ok"


def test_missing_file_is_reported():
    f = _one("`api/services/nope.py:3`")
    assert f[0].status == "missing"


def test_ambiguous_suffix_reported_only_when_the_lines_do_not_fit_every_match():
    assert _one("`dup.py:5`")[0].status == "ok"          # fits both
    assert _one("`dup.py:50`")[0].status == "ambiguous"  # fits only b/dup.py
    assert _one("`dup.py:500`")[0].status == "out-of-range"


def test_backwards_range_and_line_zero_are_out_of_range():
    assert _one("`12-decisions/d.md:9-3`")[0].status == "out-of-range"
    assert _one("`12-decisions/d.md:0`")[0].status == "out-of-range"


def test_count_lines():
    assert r.count_lines(b"") == 0
    assert r.count_lines(b"a\nb\n") == 2
    assert r.count_lines(b"a\nb") == 2


def test_report_exit_code():
    import io
    good = _one("`12-decisions/d.md:1`")
    bad = _one("`12-decisions/d.md:99`")
    assert r.report(good, out=io.StringIO()) == 0
    assert r.report(bad, out=io.StringIO()) == 1


def test_self_check_bites_against_the_real_repo():
    # Non-vacuity: the fixture has one good citation, so a broken git read (empty tree) would
    # turn the good one into "missing" and the statuses would not match.
    proc = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "doc_citation_resolver.py"),
                           "--self-check", "--repo", ROOT], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "BITES" in proc.stdout


def test_self_check_fails_when_the_fixture_cannot_fail(monkeypatch):
    monkeypatch.setattr(r, "SELF_CHECK_FIXTURE", "`CLAUDE.md:1`\n")
    assert r.self_check(ROOT, "HEAD") == 1


def test_unreadable_revision_exits_2(tmp_path):
    md = tmp_path / "x.md"
    md.write_text("`a.py:1`\n", encoding="utf-8")
    assert r.main([str(md), "--repo", ROOT, "--rev", "no-such-rev-xyz"]) == 2
