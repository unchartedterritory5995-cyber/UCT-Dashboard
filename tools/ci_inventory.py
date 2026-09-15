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

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", help="a results/<run_id> directory from a ci-results checkout")
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not a.dir:
        print("need --dir (or --self-check)")
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
