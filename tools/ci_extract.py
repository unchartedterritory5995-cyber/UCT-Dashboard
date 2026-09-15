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


def vitest_failures_from_junit(xml_text: str):
    """[(file, name, first assertion line)] from a vitest junit report."""
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


def run(pytest_log, vitest_log, vitest_junit, out_dir, head=40) -> int:
    out = pathlib.Path(out_dir)
    n_sections = n_vit = 0

    if pytest_log and pathlib.Path(pytest_log).is_file():
        text = pathlib.Path(pytest_log).read_text(encoding="utf-8", errors="replace")
        secs = collect_error_sections(text, head)
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
               "no `ERROR collecting` sections found in pytest.log")
        n_sections = len(secs)
        # the bucket table, which is the thing a human actually reads
        buckets = {}
        for nodeid, body in secs:
            buckets.setdefault(final_exception(body), []).append(nodeid)
        tbl = ["bucket | count | example node id", "-" * 70]
        for k, v in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
            tbl.append("%-3d | %s | %s" % (len(v), k[:110], v[0]))
        _write(out / "pytest_error_buckets.txt", tbl if buckets else [],
               "no collection errors to bucket")

    if vitest_junit and pathlib.Path(vitest_junit).is_file():
        fails = vitest_failures_from_junit(
            pathlib.Path(vitest_junit).read_text(encoding="utf-8", errors="replace"))
        lines = ["%s :: %s\n    %s" % (f, n, a) for f, n, a in fails]
        n_vit = _write(out / "vitest_failures.txt", lines,
                       "no <failure>/<error> entries in the vitest junit report")
    elif vitest_log and pathlib.Path(vitest_log).is_file():
        _write(out / "vitest_failures.txt", [],
               "no vitest junit report was produced; only the text log exists")

    print("[ci-extract] pytest collection-error sections: %d" % n_sections)
    print("[ci-extract] vitest failure entries: %d" % n_vit)
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
    f = vitest_failures_from_junit(junit)
    show("one failing vitest case is extracted", len(f), 1)
    show("its file is captured", f[0][0], "src/a.test.js")
    show("its first assertion line is captured", f[0][2], "expected 1 to be 2")
    show("a malformed junit yields no entries, never a crash",
         len(vitest_failures_from_junit("<not xml")), 0)

    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "p.log").write_text("2 passed in 1s\n", encoding="utf-8")
        run(str(d / "p.log"), None, None, str(d / "out"))
        txt = (d / "out" / "pytest_collect_errors.txt").read_text(encoding="utf-8")
        show("EMPTY run still WRITES the file", (d / "out" / "pytest_collect_errors.txt").is_file(), True)
        show("...and it says ZERO", txt.startswith("ZERO"), True)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pytest-log")
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
    return run(a.pytest_log, a.vitest_log, a.vitest_junit, a.out_dir, a.head)


if __name__ == "__main__":
    raise SystemExit(main())
