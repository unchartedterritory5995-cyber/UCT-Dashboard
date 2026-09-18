"""Turn a CI runner log into the ERROR TEXT a later session can diagnose from.

⛔⛔ **COUNTS ARE NOT A DIAGNOSIS.** `tools/ci_summarize.py` publishes that pytest saw
**479 errors** and vitest **21 failures**. Neither number says WHY, and a number nobody can
act on decays into a status badge. This writes the text beside the counts:

* `pytest_collect_errors.txt` — every `ERROR collecting <nodeid>` section, first
  `--head` lines each, so a collection failure can be bucketed by its final exception.
* `vitest_failures.txt` — one entry per failing test: file, test name, first assertion line.

⛔ **A COLLECTION ERROR IS NOT A TEST FAILURE, AND THE DIFFERENCE IS THE WHOLE POINT.**
479 errors with 2 collected means the suite never ran. Bucketing those by their final
exception line is what turns "the backend is red" into "one missing dependency".

⛔ **ZERO IS WRITTEN DOWN, NEVER LEFT BLANK.** A missing file and a clean run are the same
observation to whoever reads the branch next, so an empty extraction writes the word ZERO
and says what it looked in. An absence is only evidence if the instrument could have seen
a presence.

Usage:
    python tools/ci_extract.py --pytest-log pytest.log --out-dir results/<run_id>
    python tools/ci_extract.py --vitest-log vitest.log --vitest-junit v.xml --out-dir ...
    python tools/ci_extract.py --self-check
"""
from __future__ import annotations

import argparse
import pathlib
import re
import xml.etree.ElementTree as ET

OK, FAIL = 0, 1

#: pytest prints `______ ERROR collecting tests/test_x.py ______` (underscore count varies).
_COLLECT = re.compile(r"^_+ ERROR collecting (\S+) _+$", re.M)
#: the last `SomeError: message` line in a section is the one worth bucketing on.
_EXC = re.compile(r"^(?:E\s+)?([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning)):\s*(.*)$")

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(s: str) -> str:
    return _ANSI.sub("", s)


def collect_error_sections(log: str, head: int = 40):
    """[(nodeid, [lines])] — one entry per collection error, truncated to `head` lines."""
    log = strip_ansi(log)
    hits = list(_COLLECT.finditer(log))
    out = []
    for i, m in enumerate(hits):
        start = m.end()
        end = hits[i + 1].start() if i + 1 < len(hits) else len(log)
        body = log[start:end].strip("\n").splitlines()
        out.append((m.group(1), body[:head]))
    return out


def final_exception(lines) -> str:
    """The bucket key: the LAST exception line in the section, paths normalised.

    ⭐ The last one, not the first: an ImportError raised while handling another error
    reports the proximate cause last, and that is the one a fix targets."""
    found = ""
    for ln in lines:
        m = _EXC.match(ln.strip())
        if m:
            found = "%s: %s" % (m.group(1), m.group(2))
    if not found:
        return "(no exception line in the captured head)"
    # normalise absolute paths and quoted module paths so buckets group
    found = re.sub(r"['\"]?(?:[A-Za-z]:)?[/\\][^\s'\"]+[/\\]", "", found)
    return found.strip()


def failures_from_junit(xml_text: str):
    """[(file, name, first assertion line)] from ANY junit report.

    ⭐ E CP19 — this was called `vitest_failures_from_junit` and is vendor-neutral: it reads
    `<testcase>` plus `<failure>/<error>`, which pytest writes too. The NAME is the only
    reason pytest failures had no extractor while vitest failures had one, and run #15's
    record carried 136 pytest failures with no text beside any of them.
    """
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for tc in root.iter("testcase"):
        for bad in list(tc.iter("failure")) + list(tc.iter("error")):
            msg = (bad.get("message") or "").strip()
            body = (bad.text or "").strip()
            first = ""
            for ln in (msg + "\n" + body).splitlines():
                if ln.strip():
                    first = ln.strip()
                    break
            out.append((tc.get("classname") or tc.get("file") or "?",
                        tc.get("name") or "?", first))
    return out


def _write(path: pathlib.Path, lines, what: str):
    """⛔ Always writes the file. ZERO is a finding, not a missing artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not lines:
        path.write_text("ZERO — %s\n" % what, encoding="utf-8")
        return 0
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def run(pytest_log, vitest_log, vitest_junit, out_dir, head=40, pytest_junit=None) -> int:
    out = pathlib.Path(out_dir)
    n_sections = n_vit = n_pfails = 0

    # ⚰️⚰️ E CP19 — THIS BLOCK WAS SKIPPED ENTIRELY AND THE RECORD STILL NAMED ITS FILES.
    # `--pytest-log logs/pytest.log` pointed at a path that stopped existing when E CP6
    # sharded pytest: each shard uploads its OWN pytest.log and pytest-junit.xml. The guard
    # was false, nothing was written, and `summary.json`'s `detail` block still promised
    # three files — 3 of its 6 named paths did not exist in run #15.
    # ⭐ `_write` was built so ZERO is a FINDING rather than a missing artifact. An absent
    # INPUT defeated that by skipping the write, so the block now always writes.
    logs = [p for p in (pytest_log or []) if p and pathlib.Path(p).is_file()]
    if True:
        parts = []
        for p in logs:
            parts.append("===== shard log: %s =====" % p)
            parts.append(pathlib.Path(p).read_text(encoding="utf-8", errors="replace"))
        text = "\n".join(parts)
        secs = collect_error_sections(text, head) if logs else []
        lines = []
        for nodeid, body in secs:
            lines.append("=" * 70)
            lines.append("ERROR collecting %s" % nodeid)
            lines.append("BUCKET: %s" % final_exception(body))
            lines.append("-" * 70)
            lines.extend(body)
            lines.append("")
        # ⚰️ `_write` returns a LINE count. Reporting it as a SECTION count printed
        # "27 sections" for a single collection error -- a summary line contradicting the
        # artifact beside it, which is the defect class this whole tool exists to expose.
        # Caught by the scoped control, not by review.
        _write(out / "pytest_collect_errors.txt", lines,
               ("no `ERROR collecting` sections across %d shard log(s)" % len(logs)) if logs
               else "NO pytest log was readable — UNREADABLE, not a clean collection")
        n_sections = len(secs)
        # the bucket table, which is the thing a human actually reads
        buckets = {}
        for nodeid, body in secs:
            buckets.setdefault(final_exception(body), []).append(nodeid)
        tbl = ["bucket | count | example node id", "-" * 70]
        for k, v in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
            tbl.append("%-3d | %s | %s" % (len(v), k[:110], v[0]))
        _write(out / "pytest_error_buckets.txt", tbl if buckets else [],
               "no collection errors to bucket across %d shard log(s)" % len(logs))

        # ⛔ E CP19 — the FAILURES, not just the collection errors. Run #15 recorded 136
        # pytest failures with no text for any of them, while vitest's 21 had
        # `vitest_failures.txt` beside them. Same extractor, both suites.
        jun = [j for j in (pytest_junit or []) if j and pathlib.Path(j).is_file()]
        pfails = []
        for j in jun:
            pfails.extend(failures_from_junit(
                pathlib.Path(j).read_text(encoding="utf-8", errors="replace")))
        _write(out / "pytest_failures.txt",
               ["%s | %s | %s" % f for f in pfails],
               "no <failure>/<error> entries across %d shard junit report(s)" % len(jun))
        n_pfails = len(pfails)

    if vitest_junit and pathlib.Path(vitest_junit).is_file():
        fails = failures_from_junit(
            pathlib.Path(vitest_junit).read_text(encoding="utf-8", errors="replace"))
        lines = ["%s :: %s\n    %s" % (f, n, a) for f, n, a in fails]
        n_vit = _write(out / "vitest_failures.txt", lines,
                       "no <failure>/<error> entries in the vitest junit report")
    elif vitest_log and pathlib.Path(vitest_log).is_file():
        _write(out / "vitest_failures.txt", [],
               "no vitest junit report was produced; only the text log exists")

    print("[ci-extract] pytest collection-error sections: %d" % n_sections)
    print("[ci-extract] vitest failure entries: %d" % n_vit)
    print("[ci-extract] pytest failure entries: %d" % n_pfails)
    return OK


def _self_check() -> int:
    import tempfile
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-7s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    us = "_" * 20
    log = (
        "==== ERRORS ====\n"
        + us + " ERROR collecting tests/test_a.py " + us + "\n"
        "ImportError while importing test module 'tests/test_a.py'.\n"
        "Hint: make sure your test modules are importable.\n"
        "E   ModuleNotFoundError: No module named 'fastapi'\n"
        + us + " ERROR collecting tests/test_b.py " + us + "\n"
        "E   ModuleNotFoundError: No module named 'fastapi'\n"
        + us + " ERROR collecting tests/test_c.py " + us + "\n"
        "E   AttributeError: module 'x' has no attribute 'y'\n"
        "==== 3 errors in 1.0s ====\n"
    )
    secs = collect_error_sections(log)
    show("three ERROR collecting sections are found", len(secs), 3)
    show("the node id is captured", secs[0][0], "tests/test_a.py")
    show("bucket key is the FINAL exception line",
         final_exception(secs[0][1]), "ModuleNotFoundError: No module named 'fastapi'")
    buckets = {}
    for nid, body in secs:
        buckets.setdefault(final_exception(body), []).append(nid)
    show("two distinct buckets over three errors", len(buckets), 2)
    show("the big bucket holds two node ids",
         max(len(v) for v in buckets.values()), 2)

    # ⛔ NON-VACUITY: a log with no collection errors must yield ZERO, not silence
    show("a clean log yields ZERO sections", len(collect_error_sections("2 passed in 1s\n")), 0)

    junit = ('<testsuites><testsuite name="s"><testcase classname="src/a.test.js" '
             'name="does a thing"><failure message="expected 1 to be 2">at line 4'
             '</failure></testcase><testcase classname="src/b.test.js" name="ok"/>'
             '</testsuite></testsuites>')
    f = failures_from_junit(junit)
    show("one failing vitest case is extracted", len(f), 1)
    show("its file is captured", f[0][0], "src/a.test.js")
    show("its first assertion line is captured", f[0][2], "expected 1 to be 2")
    show("a malformed junit yields no entries, never a crash",
         len(failures_from_junit("<not xml")), 0)

    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "p.log").write_text("2 passed in 1s\n", encoding="utf-8")
        run(str(d / "p.log"), None, None, str(d / "out"))
        txt = (d / "out" / "pytest_collect_errors.txt").read_text(encoding="utf-8")
        show("EMPTY run still WRITES the file", (d / "out" / "pytest_collect_errors.txt").is_file(), True)
        show("...and it says ZERO", txt.startswith("ZERO"), True)
        # ⛔ E CP19 — ALL THREE pytest artifacts must exist even with no input at all.
        # Run #15's record NAMED three files that were never written, because an absent
        # input skipped the whole block. "Named but absent" is the state this refuses.
        for f in ("pytest_collect_errors.txt", "pytest_error_buckets.txt",
                  "pytest_failures.txt"):
            show("no input at all -> %s still written" % f,
                 (d / "out" / f).is_file(), True)
        show("...and the collect-errors file says UNREADABLE, not 'clean'",
             "UNREADABLE" in (d / "out" / "pytest_collect_errors.txt").read_text(
                 encoding="utf-8"), True)

    # ⛔ E CP19 — MANY SHARD LOGS AND MANY SHARD JUNITS, which is the real CI shape.
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "s1.log").write_text(
            "____ ERROR collecting tests/a.py ____\nE   ImportError: no mod a\n",
            encoding="utf-8")
        (d / "s2.log").write_text(
            "____ ERROR collecting tests/b.py ____\nE   ImportError: no mod a\n",
            encoding="utf-8")
        pj = ('<testsuites><testsuite name="p"><testcase classname="tests.test_x" '
              'name="test_y"><failure message="assert 1 == 2">boom</failure>'
              "</testcase></testsuite></testsuites>")
        (d / "j1.xml").write_text(pj, encoding="utf-8")
        (d / "j2.xml").write_text(pj.replace("test_y", "test_z"), encoding="utf-8")
        run([str(d / "s1.log"), str(d / "s2.log")], None, None, str(d / "o"),
            pytest_junit=[str(d / "j1.xml"), str(d / "j2.xml")])
        errs = (d / "o" / "pytest_collect_errors.txt").read_text(encoding="utf-8")
        show("both shard logs are read", errs.count("ERROR collecting"), 2)
        bucket = (d / "o" / "pytest_error_buckets.txt").read_text(encoding="utf-8")
        # ⛔ Read the row, do not hand-type its spacing: the first version of this control
        # asserted a padded literal and failed a CORRECT implementation.
        rows = [l for l in bucket.splitlines() if "|" in l and not l.startswith("bucket")]
        show("identical causes across shards bucket into ONE row", len(rows), 1)
        show("...and that row counts BOTH", rows[0].split("|")[0].strip(), "2")
        pf = (d / "o" / "pytest_failures.txt").read_text(encoding="utf-8")
        show("both shard junits are read", len([l for l in pf.splitlines() if l.strip()]), 2)
        show("...and a pytest failure names its test", "test_z" in pf, True)
        show("...and carries its first assertion line", "assert 1 == 2" in pf, True)
        # ⛔ NON-VACUITY: the many-shard case must differ from the no-input case, or
        # "the file exists" proves nothing about whether anything was read.
        show("many-shard output differs from the empty one", pf.startswith("ZERO"), False)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pytest-log", action="append", default=[])
    ap.add_argument("--pytest-junit", action="append", default=[])
    ap.add_argument("--vitest-log")
    ap.add_argument("--vitest-junit")
    ap.add_argument("--out-dir")
    ap.add_argument("--head", type=int, default=40)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not a.out_dir:
        print("need --out-dir (or --self-check)")
        return FAIL
    return run(a.pytest_log, a.vitest_log, a.vitest_junit, a.out_dir, a.head,
               pytest_junit=a.pytest_junit)


if __name__ == "__main__":
    raise SystemExit(main())
