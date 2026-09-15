"""Turn a published CI record's failure text into a BUCKETED inventory — derived, never typed.

⛔⛔ **THE WORKFLOW'S OWN HEADER ASKS FOR THIS, AND ASKS FOR IT THE WRONG WAY.** It says the
first complete CI run *"is the inventory. Copy it into this header, with a finding id per
row."* ⭐ A hand-typed table beside the artifact it describes is the defect this repository
records over and over — the writer-index `FOUR`, the COT router's "4 routes", the setup
catalog's "24". So the inventory is DERIVED by this tool and the header points at the tool.

⛔⛔ **AND THE AXIS THAT MATTERS IS NOT THE COUNT.** Run #18 published **185 failed** across
226 failure entries, and **119 of those entries carried a CI-ENVIRONMENT signature** — 109 of
them one missing `npm ci`. *"206 failures"* is a true number and a misleading one; **"107
product-shaped, 119 environment-shaped"** is the sentence somebody can act on.

⚠️ **WHAT THIS TOOL CLAIMS, EXACTLY.** `ENV` means *this bucket's text names a condition of
the CI environment*. It is a statement about the TEXT, never a verdict that the test would
pass elsewhere — only a run with that condition removed can say so. Every ENV row therefore
carries the **matched signature**, so a reader can check the call rather than trust it.

⛔ **UNMATCHED IS `PRODUCT`, ALWAYS.** The classifier fails toward *"a human must look at
this"*, never toward *"probably just the environment"*. A misfiled ENV row is a real failure
nobody triages; a misfiled PRODUCT row costs somebody five minutes.

Usage:
    python tools/ci_inventory.py --dir results/<run_id>            # from a ci-results checkout
    python tools/ci_inventory.py --dir results/<run_id> --out inventory.md
    python tools/ci_inventory.py --self-check
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

try:  # pragma: no cover - depends on the host console
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OK, FAIL = 0, 1
UNREADABLE = "UNREADABLE"

#: A signature is (label, pattern). ⛔ Each names a CONDITION OF THE RUNNER, not a kind of
#: bug. Adding one is a claim that the text cannot be produced by a product defect.
ENV_SIGNATURES = (
    ("the JS lane could not run (node/node_modules)",
     r"LaneUnavailable|JS lane exited|node is not on PATH"),
    ("a node module could not be resolved",
     r"node:internal/modules|MODULE_NOT_FOUND|Cannot find module"),
    ("a git ref a shallow single-branch checkout does not have",
     r"merge-base|no base ref resolved|origin/master"),
    ("a /data path that exists only on the dev box",
     r"['\"]/data/"),
)

#: noise that makes two identical causes look like two buckets
_NORMALISE = (
    (r"u_[0-9a-f]{12}", "u_<id>"),
    (r"0x[0-9a-f]+", "0x<addr>"),
    (r"/home/runner[^\s'\"]*", "<runner-path>"),
    (r"[A-Za-z]:\\\\[^\s'\"]*", "<win-path>"),
    (r"\b\d{3,}\b", "<n>"),
)


def normalise(text: str) -> str:
    """Collapse per-run noise so identical causes land in ONE bucket."""
    out = text.strip()
    for pat, rep in _NORMALISE:
        out = re.sub(pat, rep, out)
    return out


def classify(text: str):
    """(kind, matched_signature). ⛔ Unmatched is PRODUCT — never 'probably environment'."""
    for label, pat in ENV_SIGNATURES:
        if re.search(pat, text):
            return "ENV", label
    return "PRODUCT", ""


def parse_entries(text: str):
    """[(where, what)] from EITHER failures-file shape.

    ⚰️ **THE FIRST RUN OF THIS TOOL AGAINST THE REAL RECORD OVER-COUNTED.** `ci_extract`
    writes two shapes: pytest as one line, ``file | test | message``, and vitest as TWO,
    ``file :: test`` then an indented message. A per-line parser turned each vitest failure
    into two entries — 272 where the files held 249 — and put the message in its own bucket
    with `where` unknown.

    ⭐ Caught by running it against the published record rather than the fixture it was
    written from. A fixture written by the same hand reproduces the same assumption.
    """
    out = []
    lines = (text or "").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if "|" in line and len(line.split("|")) >= 3:           # pytest: one line
            parts = line.split("|")
            out.append(("|".join(p.strip() for p in parts[:2]), "|".join(parts[2:]).strip()))
            i += 1
        elif " :: " in line:                                     # vitest: header + body
            body = []
            j = i + 1
            while j < len(lines) and (lines[j].startswith(("    ", "\t"))):
                body.append(lines[j].strip())
                j += 1
            out.append((line.strip(), " ".join(body) if body else line.strip()))
            i = j
        else:
            out.append(("?", line.strip()))
            i += 1
    return out


def inventory(pytest_text: str, vitest_text: str) -> dict:
    """Buckets, counts and the ENV/PRODUCT split. Never raises."""
    buckets = {}
    totals = {"ENV": 0, "PRODUCT": 0}
    for suite, text in (("pytest", pytest_text), ("vitest", vitest_text)):
        for where, what in parse_entries(text):
            key = normalise(what)[:110]
            kind, sig = classify(what)
            b = buckets.setdefault((suite, key), {"suite": suite, "bucket": key, "count": 0,
                                                  "kind": kind, "signature": sig,
                                                  "example": where})
            b["count"] += 1
            totals[kind] += 1
    rows = sorted(buckets.values(), key=lambda r: (-r["count"], r["suite"], r["bucket"]))
    return {"rows": rows, "entries": totals["ENV"] + totals["PRODUCT"],
            "env": totals["ENV"], "product": totals["PRODUCT"],
            # ⛔ ZERO entries is UNREADABLE, never "nothing is broken" — the same refusal
            # `ci_latest` makes about ZERO-RECORDS.
            "state": UNREADABLE if not rows else "READ"}


# ─── THE BASELINE DIFF ───────────────────────────────────────────────────────
#
# ⛔⛔ **CI's VERDICT IS BASELINE-RELATIVE, AND IT IS NEVER "GREEN".** This repository has
# 85 failing pytest entries and 21 vitest ones on a good day; a gate that waits for zero is
# a gate that never arrives, and one that reports "green" the moment it is quiet is the
# `lesson_gate_that_cannot_fail` shape. The joystick harness already settled this: the
# question is **"is anything failing now that was not failing in a NAMED baseline run?"**
#
# ⛔ **MISSING IS NEVER COUNTED AS FIXED.** A test that stopped being collected disappears
# from the failure list exactly as a test that started passing does, and the difference is
# the whole point — one is progress, the other is coverage silently leaving. The record
# carries every shard's junit, so *"did this test run in the current record"* is answered
# EXACTLY rather than inferred from a collected count.

VERDICTS = ("NO_NEW_FAILURES", "NEW_FAILURES", "INVALID", "DID_NOT_RECONCILE")


def entry_key(suite: str, where: str):
    """(suite, classname, name) — the identity a failure keeps across runs."""
    w = (where or "").strip()
    if suite == "vitest" and " :: " in w:
        f, _, n = w.partition(" :: ")
        return (suite, f.strip(), n.strip())
    if "|" in w:
        parts = [p.strip() for p in w.split("|")]
        return (suite, parts[0], parts[1] if len(parts) > 1 else "?")
    return (suite, w, "?")


def ran_keys(record_dir) -> set:
    """Every (suite, classname, name) that RAN — read from the junit reports.

    ⭐ This is what makes FIXED and MISSING distinguishable. Without it, a test that
    vanished from the suite and a test that started passing are the same observation.
    """
    import glob
    import xml.etree.ElementTree as ET
    out = set()
    d = str(record_dir)
    for suite, pattern in (("pytest", d + "/shards/*/pytest-junit.xml"),
                           ("vitest", d + "/vitest-junit.xml")):
        for f in glob.glob(pattern):
            try:
                root = ET.fromstring(pathlib.Path(f).read_text(encoding="utf-8",
                                                               errors="replace"))
            except Exception:
                continue          # an unparseable junit contributes nothing, never a guess
            for tc in root.iter("testcase"):
                out.add((suite, tc.get("classname") or tc.get("file") or "?",
                         tc.get("name") or "?"))
    return out


def failing_keys(pytest_text: str, vitest_text: str) -> set:
    out = set()
    for suite, text in (("pytest", pytest_text), ("vitest", vitest_text)):
        for where, _ in parse_entries(text):
            out.add(entry_key(suite, where))
    return out


def diff(baseline_failing: set, current_failing: set, current_ran: set,
         current_summary: dict, baseline_summary=None) -> dict:
    """NEW / FIXED / UNCHANGED / MISSING + a verdict. Never raises."""
    invalid = []
    s = current_summary or {}
    p = s.get("pytest") or {}
    if not baseline_failing:
        invalid.append("the BASELINE holds zero failure entries — nothing to diff against")
    if p.get("shards_total") and p.get("shards_success", 0) < p["shards_total"]:
        invalid.append("current: shards_success %s of %s"
                       % (p.get("shards_success"), p.get("shards_total")))
    for field in ("shards_unreadable", "shards_without_totals", "shards_missing"):
        if p.get(field):
            invalid.append("current: %s = %s" % (field, p[field]))
    if not p.get("collected"):
        invalid.append("current: collected is 0 — the suite did not run")
    if not current_ran:
        invalid.append("current: no junit testcases could be read — RAN is unknowable, "
                       "so FIXED and MISSING cannot be told apart")

    unchanged = sorted(baseline_failing & current_failing)
    new = sorted(current_failing - baseline_failing)
    gone = baseline_failing - current_failing
    fixed = sorted(k for k in gone if k in current_ran)
    missing = sorted(k for k in gone if k not in current_ran)

    arithmetic = ("baseline %d = unchanged %d + fixed %d + missing %d  |  "
                  "current %d = unchanged %d + new %d"
                  % (len(baseline_failing), len(unchanged), len(fixed), len(missing),
                     len(current_failing), len(unchanged), len(new)))
    reconciles = (len(baseline_failing) == len(unchanged) + len(fixed) + len(missing)
                  and len(current_failing) == len(unchanged) + len(new))

    if invalid:
        verdict = "INVALID"
    elif not reconciles:
        verdict = "DID_NOT_RECONCILE"
    elif new:
        verdict = "NEW_FAILURES"
    else:
        verdict = "NO_NEW_FAILURES"
    return {"verdict": verdict, "new": new, "fixed": fixed, "unchanged": unchanged,
            "missing": missing, "counts": {"new": len(new), "fixed": len(fixed),
                                           "unchanged": len(unchanged),
                                           "missing": len(missing),
                                           "baseline": len(baseline_failing),
                                           "current": len(current_failing),
                                           "current_ran": len(current_ran)},
            "arithmetic": arithmetic, "invalid_because": invalid}


def load_record(d):
    """(failing, ran, summary) for one results/<run_id> directory."""
    d = pathlib.Path(d)

    def read(name):
        p = d / name
        if not p.is_file():
            return ""
        t = p.read_text(encoding="utf-8", errors="replace")
        return "" if t.strip().startswith("ZERO") else t

    summary = {}
    sp = d / "summary.json"
    if sp.is_file():
        import json as _json
        try:
            summary = _json.loads(sp.read_text(encoding="utf-8"))
        except ValueError:
            summary = {}
    return (failing_keys(read("pytest_failures.txt"), read("vitest_failures.txt")),
            ran_keys(d), summary)


def render_diff(d: dict, baseline_id: str, current_id: str) -> str:
    out = ["# CI baseline diff", "",
           "⚠️ DERIVED by `tools/ci_inventory.py --baseline … --current …`. Not hand-edited.",
           "", "**baseline `%s` → current `%s`**" % (baseline_id, current_id), "",
           "## VERDICT: %s" % d["verdict"], ""]
    if d["invalid_because"]:
        out += ["⛔ INVALID because:", ""] + ["- %s" % r for r in d["invalid_because"]] + [""]
    c = d["counts"]
    out += ["| NEW | FIXED | UNCHANGED | MISSING |", "|---|---|---|---|",
            "| **%d** | %d | %d | **%d** |" % (c["new"], c["fixed"], c["unchanged"],
                                               c["missing"]), "",
            "`%s`" % d["arithmetic"], "",
            "⛔ MISSING is *in the baseline and not collected now* — coverage leaving, never "
            "counted as FIXED.", ""]
    if d["new"]:
        out += ["### NEW — failing now, not in the baseline", ""]
        out += ["- `%s` · `%s` · %s" % (k[0], k[1], k[2]) for k in d["new"][:50]]
        if len(d["new"]) > 50:
            out.append("- …and %d more" % (len(d["new"]) - 50))
        out.append("")
    if d["missing"]:
        out += ["### MISSING — in the baseline, not collected now", ""]
        out += ["- `%s` · `%s` · %s" % (k[0], k[1], k[2]) for k in d["missing"][:50]]
        out.append("")
    return "\n".join(out) + "\n"


def render(inv: dict) -> str:
    if inv["state"] == UNREADABLE:
        return ("# CI failure inventory\n\n⛔ UNREADABLE — no failure entries were found. "
                "That is not the same as a green suite; it means the files this reads were "
                "absent or empty.\n")
    out = ["# CI failure inventory", "",
           "⚠️ DERIVED by `tools/ci_inventory.py` from a published record. Do not hand-edit.",
           "", "| entries | environment-shaped | product-shaped |", "|---|---|---|",
           "| %d | **%d** | **%d** |" % (inv["entries"], inv["env"], inv["product"]), "",
           "⛔ `ENV` means the bucket's TEXT names a condition of the CI environment. It is "
           "not a verdict that the test would pass elsewhere — only a run with that condition "
           "removed can say so. The matched signature is shown so the call can be checked.",
           "", "| n | suite | kind | matched signature | bucket | example |",
           "|---|---|---|---|---|---|"]
    for r in inv["rows"]:
        out.append("| %d | %s | %s | %s | `%s` | `%s` |"
                   % (r["count"], r["suite"], r["kind"], r["signature"] or "—",
                      r["bucket"].replace("|", "\\|"), r["example"].replace("|", "\\|")[:70]))
    return "\n".join(out) + "\n"


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print("  %-62s -> %-9s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    # Lines taken VERBATIM from run #18's published record, not invented.
    p = "\n".join([
        "tests.test_alert_user_admission | test_a | api.services.alert_user_series."
        "AdmissionRefused: u_0123456789ab: the lanes could not be compared "
        "(LaneUnavailable: the JS lane exited 1:",
        "tests.test_alert_user_admission | test_b | api.services.alert_user_series."
        "AdmissionRefused: u_beef0123cdef: the lanes could not be compared "
        "(LaneUnavailable: the JS lane exited 1:",
        "tests.pattern_engine.test_pattern_db_shared_root_guard | test_c | AssertionError: "
        "assert '/data/patterns.db' == '/home/runner/work/x/patterns.db'",
        "tests.test_x | test_d | TypeError: 'NoneType' object is not subscriptable",
        "tests.test_y | test_e | KeyError: 'text_origin'",
    ])
    # ⛔ The REAL vitest shape: a `file :: test` header and an INDENTED message line.
    # The first version of this tool parsed per line and counted each failure twice.
    v = ("src/hub/rule12Paths.test.js :: the rail can see this branch\n"
         "    RULE 12 RAIL CANNOT RUN — no base ref resolved … merge-base origin/master HEAD")
    inv = inventory(p, v)
    show("every entry is counted", inv["entries"], 6)
    show("ENV and PRODUCT partition the entries", inv["env"] + inv["product"], inv["entries"])
    show("the two AdmissionRefused lines collapse to ONE bucket",
         max(r["count"] for r in inv["rows"]), 2)
    show("...because the user id is normalised away", "u_<id>" in inv["rows"][0]["bucket"], True)
    show("the JS-lane bucket is ENV", inv["rows"][0]["kind"], "ENV")
    show("...and NAMES the signature it matched",
         inv["rows"][0]["signature"], "the JS lane could not run (node/node_modules)")

    # ⛔ THE FALSE-POSITIVE DIRECTION, which is the one that costs something: a real
    # product failure must NOT be filed as environment.
    prod = [r for r in inv["rows"] if r["kind"] == "PRODUCT"]
    show("a TypeError is PRODUCT, not ENV",
         any("NoneType" in r["bucket"] for r in prod), True)
    show("a KeyError is PRODUCT, not ENV",
         any("text_origin" in r["bucket"] for r in prod), True)
    show("...and PRODUCT rows carry NO signature",
         all(r["signature"] == "" for r in prod), True)

    # ⛔ NON-VACUITY: both classes must actually occur, or "no false positives" is satisfied
    # by a classifier that calls everything PRODUCT.
    show("both classes occur in the fixture", (inv["env"] > 0, inv["product"] > 0), (True, True))

    # ⛔ ZERO is UNREADABLE, never "nothing is broken".
    empty = inventory("", "")
    show("no entries at all is UNREADABLE, not clean", empty["state"], UNREADABLE)
    show("...and the rendering says so", "UNREADABLE" in render(empty), True)
    # ⛔ ...and it must be distinguishable from a real read.
    show("UNREADABLE and READ are distinguishable", inv["state"], "READ")

    # a vitest entry is classified on the same axis
    vrow = [r for r in inv["rows"] if r["suite"] == "vitest"]
    show("the vitest entry is ENV (a git ref the checkout lacks)",
         (len(vrow), vrow[0]["kind"] if vrow else None), (1, "ENV"))
    # ⛔ THE OVER-COUNT THIS TOOL SHIPPED WITH, AS A CONTROL: a two-line vitest failure is
    # ONE entry, not two, and its `where` is the test, not "?".
    show("a two-line vitest failure counts ONCE", sum(r["count"] for r in vrow), 1)
    show("...and its `where` is the TEST, not unknown", vrow[0]["example"].startswith("src/"), True)
    # ⛔ NON-VACUITY: the parser must still see BOTH shapes in one file set.
    show("both file shapes are parsed", (inv["entries"], len(vrow) > 0), (6, True))

    # ─── THE BASELINE DIFF — seven controls, fixtures only ───────────────────
    A = ("pytest", "tests.test_a", "test_one")
    B = ("pytest", "tests.test_b", "test_two")
    C = ("pytest", "tests.test_c", "test_three")
    GOOD = {"pytest": {"shards_total": 2, "shards_success": 2, "shards_unreadable": [],
                       "shards_without_totals": [], "shards_missing": [], "collected": 100}}
    RAN = {A, B, C}

    # 1 identical
    d1 = diff({A, B}, {A, B}, RAN, GOOD)
    show("1 identical -> NO_NEW_FAILURES", d1["verdict"], "NO_NEW_FAILURES")
    show("  ...and FIXED is 0", d1["counts"]["fixed"], 0)
    # 2 one added
    d2 = diff({A}, {A, B}, RAN, GOOD)
    show("2 one added -> NEW_FAILURES", d2["verdict"], "NEW_FAILURES")
    show("  ...and it is NAMED", d2["new"], [B])
    # 3 one removed, and it RAN
    d3 = diff({A, B}, {A}, RAN, GOOD)
    show("3 one removed that RAN -> FIXED=1", (d3["verdict"], d3["counts"]["fixed"]),
         ("NO_NEW_FAILURES", 1))
    # 4 ⛔ one removed that did NOT run -> MISSING, never FIXED
    d4 = diff({A, B}, {A}, {A, C}, dict(GOOD, pytest=dict(GOOD["pytest"], collected=60)))
    show("4 one removed that did NOT run -> MISSING=1", d4["counts"]["missing"], 1)
    show("  ...and FIXED stays 0 — coverage leaving is not progress",
         d4["counts"]["fixed"], 0)
    show("  ...and it is NAMED", d4["missing"], [B])
    # 5 a current record with one unreadable shard
    bad = {"pytest": dict(GOOD["pytest"], shards_unreadable=["tests-07"])}
    d5 = diff({A}, {A}, RAN, bad)
    show("5 an unreadable shard -> INVALID", d5["verdict"], "INVALID")
    show("  ...and says which field", any("shards_unreadable" in r
                                          for r in d5["invalid_because"]), True)
    # 6 empty baseline
    d6 = diff(set(), {A}, RAN, GOOD)
    show("6 an EMPTY baseline -> INVALID, never NO_NEW_FAILURES", d6["verdict"], "INVALID")
    # 7 ⛔ THE PAIR CONTROL: a real failure present in BOTH is UNCHANGED — proof the tool
    #   still sees failures at all, rather than passing because it sees nothing.
    d7 = diff({A, B}, {A, B}, RAN, GOOD)
    show("7 a failure in BOTH is UNCHANGED (the tool still sees failures)",
         (d7["counts"]["unchanged"], d7["counts"]["new"]), (2, 0))

    # ⛔ NON-VACUITY over the verdicts: the seven must not collapse to one answer.
    show("the controls produce more than one verdict",
         len({d1["verdict"], d2["verdict"], d5["verdict"], d6["verdict"]}) >= 3, True)
    # ⛔ the arithmetic is PRINTED and must actually reconcile on a clean diff
    show("a clean diff reconciles", "baseline 2 = unchanged 1 + fixed 1 + missing 0"
         in d3["arithmetic"], True)
    show("...and the RAN count is reported (non-vacuity for FIXED/MISSING)",
         d3["counts"]["current_ran"], 3)
    # ⛔ no junit readable at all -> RAN unknowable -> INVALID, never a silent FIXED
    d8 = diff({A, B}, {A}, set(), GOOD)
    show("no junit readable -> INVALID, so FIXED cannot be guessed", d8["verdict"], "INVALID")
    # ⚰️ E CP24 — run #21's gate said `collected is 0` for a run that collected 24,445,
    # because the CURRENT directory was `extract/<run>/`, which has no summary.json until
    # the publish step writes it. The tool was right; the wiring lied about the directory.
    d9 = diff({A, B}, {A, B}, RAN, {})
    show("a current dir with NO summary -> INVALID", d9["verdict"], "INVALID")
    show("  ...and it NAMES collected, not something vague",
         any("collected is 0" in r for r in d9["invalid_because"]), True)
    # ⛔ NON-VACUITY: with the summary present the SAME inputs are not INVALID, or the
    # check above would be satisfied by a function that always returns INVALID.
    show("  ...and WITH a summary the same inputs are valid",
         diff({A, B}, {A, B}, RAN, GOOD)["verdict"], "NO_NEW_FAILURES")

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", help="a results/<run_id> directory from a ci-results checkout")
    ap.add_argument("--baseline", help="baseline run_id (with --current)")
    ap.add_argument("--current", help="current run_id (with --baseline)")
    ap.add_argument("--results-root", default="results")
    # the baseline and the current record do not have to live under one root: in CI
    # the baseline is pulled out of the ci-results branch and the current one is the
    # extract directory that has not been published yet.
    ap.add_argument("--baseline-dir")
    ap.add_argument("--current-dir")
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    if a.baseline or a.current:
        if not (a.baseline and a.current):
            print("--baseline and --current are used together")
            return FAIL
        root = pathlib.Path(a.results_root)
        bdir = pathlib.Path(a.baseline_dir) if a.baseline_dir else root / a.baseline
        cdir = pathlib.Path(a.current_dir) if a.current_dir else root / a.current
        bf, _, bs = load_record(bdir)
        cf, cr, cs = load_record(cdir)
        d = diff(bf, cf, cr, cs, bs)
        text = render_diff(d, a.baseline, a.current)
        if a.out:
            import json as _json
            pathlib.Path(a.out).write_text(_json.dumps(
                {"verdict": d["verdict"], "counts": d["counts"],
                 "arithmetic": d["arithmetic"], "invalid_because": d["invalid_because"],
                 "baseline_run_id": a.baseline, "current_run_id": a.current,
                 "new": ["|".join(k) for k in d["new"]],
                 "missing": ["|".join(k) for k in d["missing"]],
                 "fixed": ["|".join(k) for k in d["fixed"]]},
                indent=2) + "\n", encoding="utf-8")
            print("[ci-inventory] wrote %s" % a.out)
        print(text)
        # ⛔ Non-zero on anything that is not a clean diff: a gate that cannot fail is not
        # a gate, and INVALID must never read as a pass.
        return OK if d["verdict"] == "NO_NEW_FAILURES" else FAIL

    if not a.dir:
        print("need --dir, or --baseline/--current (or --self-check)")
        return FAIL

    d = pathlib.Path(a.dir)

    def read(name):
        p = d / name
        if not p.is_file():
            print("[ci-inventory] UNREADABLE: %s does not exist" % p)
            return ""
        t = p.read_text(encoding="utf-8", errors="replace")
        # ⛔ `_write` writes the word ZERO rather than an empty file; that is a FINDING,
        # not a set of entries, and must not be parsed as one.
        return "" if t.strip().startswith("ZERO") else t

    inv = inventory(read("pytest_failures.txt"), read("vitest_failures.txt"))
    text = render(inv)
    if a.out:
        pathlib.Path(a.out).write_text(text, encoding="utf-8")
        print("[ci-inventory] wrote %s (%d entries: %d environment, %d product)"
              % (a.out, inv["entries"], inv["env"], inv["product"]))
    else:
        print(text)
    return OK if inv["state"] == "READ" else FAIL


if __name__ == "__main__":
    raise SystemExit(main())
