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
import json
import pathlib
import posixpath
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

#: ⛔ ORDER IS PRECEDENCE, worst first. A run that cannot be read is not a run;
#: a run whose arithmetic does not close cannot be trusted to say anything; a run
#: that LOST COVERAGE is worse than one with a named new failure, because nobody
#: was told what stopped running.
VERDICTS = ("INVALID", "DID_NOT_RECONCILE", "COVERAGE_LOST", "NEW_FAILURES",
            "NO_NEW_FAILURES")


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


#: a path-shaped identifier — vitest reports a file-level failure as `<file> :: <file>`
_PATH_LIKE = re.compile(r"[\\/].+\.(?:jsx?|tsx?|mjs|cjs|py)$")


def is_file_level_key(key) -> bool:
    """Is this entry a WHOLE-FILE failure rather than a test's?

    ⛔ The two are not the same fact. A file-level entry means the suite could not be
    LOADED, so none of its tests ran; a test-level entry means one assertion failed. They
    are told apart by shape: a file-level key's classname and name are the same path.
    """
    return (len(key) == 3 and key[1] == key[2] and bool(_PATH_LIKE.search(key[1] or "")))


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
         current_summary: dict, baseline_summary=None, flaky=None,
         flaky_previous=None, repo=".", first_run=False,
         attribute=False) -> dict:
    """NEW / FIXED / UNCHANGED / MISSING + a verdict. Never raises.

    ⛔ **F-CI-30: `flaky` is SUBTRACTED FROM NEW, AND FROM NOTHING ELSE.** A flaky test is
    not fixed, not forgiven and not re-run — it is a test whose result this suite cannot
    tell apart from noise, so it must not be able to fire a gate. It still appears, by
    name, in its own bucket and in `flaky_findings.md`.
    ⭐ `flaky` arrives as a DERIVED set (see `flaky_set`). If it ever arrives from a file
    somebody edits, that file is the finding.

    ⛔⛔ **`first_run=True` (E CP38) means no prior VALID run exists to compare against —
    NOT that the comparison came back clean.** The verdict is FIRST_RUN, distinct from
    NO_NEW_FAILURES, so a rolling baseline with nothing yet behind it can never read as a
    passed gate. `attribute=True` additionally derives per-entry NEW/FIXED attribution
    (`attribute_new_and_fixed`) and folds NEW-OURS/NEW-OTHERS/UNATTRIBUTED counts in.
    """
    invalid = []
    s = current_summary or {}
    p = s.get("pytest") or {}
    if not baseline_failing and not first_run:
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

    flaky = set(flaky or ())
    ran_classnames = {k[1] for k in current_ran}
    unchanged = sorted(baseline_failing & current_failing)
    new_all = sorted(current_failing - baseline_failing)
    new = [k for k in new_all if k not in flaky]
    new_flaky = [k for k in new_all if k in flaky]
    gone = baseline_failing - current_failing
    fixed, missing, file_level = [], [], []
    for k in sorted(gone):
        if k in current_ran:
            fixed.append(k)
        elif is_file_level_key(k) and k[1] in ran_classnames:
            # ⚰️⚰️ **F-CI-41 — A FIXED SUITE-LOAD FAILURE READ AS COVERAGE LEAVING.**
            # When vitest cannot LOAD a file it reports a FILE-level failure, and
            # `ci_extract` writes it as `<file> :: <file>` — so `entry_key` yields
            # `(vitest, <path>, <path>)`, a synthetic key that can NEVER appear in
            # `ran_keys`, which holds real test names. The moment the load failure is
            # fixed, that baseline key is in neither set and the diff called it MISSING.
            # ⛔ MISSING means coverage left; this is the exact opposite — the file loads
            # again and its tests ran. Measured on run #29:
            # `legendFromDefinitions.test.jsx` had **62 testcases collected** while the
            # diff reported it MISSING.
            # ⭐ So the file's own CLASSNAME being present in `ran` is the evidence, and
            # it resolves to FIXED.
            fixed.append(k)
            file_level.append(k)
        else:
            missing.append(k)

    # ⛔ THE ARITHMETIC STILL CLOSES OVER **EVERY** ENTRY. Subtracting the flaky ones from
    # NEW without carrying them in their own term would turn the reconciliation — the one
    # check that proves nothing was silently dropped — into a check that cannot fail.
    arithmetic = ("baseline %d = unchanged %d + fixed %d + missing %d  |  "
                  "current %d = unchanged %d + new %d + new-but-flaky %d"
                  % (len(baseline_failing), len(unchanged), len(fixed), len(missing),
                     len(current_failing), len(unchanged), len(new), len(new_flaky)))
    reconciles = (len(baseline_failing) == len(unchanged) + len(fixed) + len(missing)
                  and len(current_failing) == len(unchanged) + len(new) + len(new_flaky))

    # ⛔ F-CI-41 — ATTRIBUTE EVERY MISSING ENTRY. A deletion or rename named in the diff
    # is somebody's recorded decision and reconciles; anything else is a test that stopped
    # running with nobody told, and that is COVERAGE_LOST.
    sha_a = ((baseline_summary or {}).get("sha") or "")
    sha_b = (s.get("sha") or "")
    missing_buckets = {}
    unattributed = []
    for k in missing:
        bucket, detail = attribute_missing(k, sha_a, sha_b, repo)
        missing_buckets["|".join(k)] = [bucket, detail]
        if bucket in (DE_COLLECTED, UNATTRIBUTED):
            unattributed.append(k)

    if invalid:
        verdict = "INVALID"
    elif not reconciles:
        verdict = "DID_NOT_RECONCILE"
    elif unattributed:
        verdict = "COVERAGE_LOST"
    elif first_run:
        verdict = "FIRST_RUN"
    elif new:
        verdict = "NEW_FAILURES"
    else:
        verdict = "NO_NEW_FAILURES"
    prev_flaky = set(flaky_previous or ())
    counts = {"new": len(new), "fixed": len(fixed),
              "unchanged": len(unchanged),
              "missing": len(missing),
              "baseline": len(baseline_failing),
              "current": len(current_failing),
              "current_ran": len(current_ran),
              "new_flaky": len(new_flaky),
              "flaky_size": len(flaky),
              "flaky_new": len(flaky - prev_flaky),
              "flaky_fixed": len(prev_flaky - flaky),
              "file_level_resolved": len(file_level),
              "coverage_lost": len(unattributed)}
    result = {"verdict": verdict, "new": new, "fixed": fixed, "unchanged": unchanged,
              "missing": missing, "new_flaky": new_flaky,
              "file_level_resolved": file_level, "missing_buckets": missing_buckets,
              "coverage_lost": unattributed, "counts": counts,
              "arithmetic": arithmetic, "invalid_because": invalid,
              "first_run": first_run}
    if attribute and not invalid:
        table, attr_counts = attribute_new_and_fixed(new, fixed, sha_a, sha_b, repo)
        result["attribution"] = table
        counts.update(attr_counts)
    return result


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
    if d.get("first_run"):
        out += ["⛔⛔ **FIRST_RUN** — no prior VALID run exists to compare against. This is "
                "NOT a clean bill of health; every current failure is listed as NEW because "
                "there is nothing yet behind it to diff against.", ""]
    if d["invalid_because"]:
        out += ["⛔ INVALID because:", ""] + ["- %s" % r for r in d["invalid_because"]] + [""]
    c = d["counts"]
    if "new_ours" in c:
        out += ["**NEW %d · NEW-OURS %d · NEW-OTHERS %d · UNATTRIBUTED %d**"
                % (c["new"], c["new_ours"], c["new_others"], c["new_unattributed"]), ""]
    out += ["| NEW | FIXED | UNCHANGED | MISSING |", "|---|---|---|---|",
            "| **%d** | %d | %d | **%d** |" % (c["new"], c["fixed"], c["unchanged"],
                                               c["missing"]), "",
            "| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED | NEW-but-flaky |",
            "|---|---|---|---|",
            "| %d | %d | %d | %d |" % (c.get("flaky_size", 0), c.get("flaky_new", 0),
                                       c.get("flaky_fixed", 0), c.get("new_flaky", 0)),
            "",
            "`%s`" % d["arithmetic"], "",
            "⛔ MISSING is *in the baseline and not collected now* — coverage leaving, never "
            "counted as FIXED.",
            "⛔ NEW **excludes** the derived FLAKY set (F-CI-30). A flaky test is not fixed "
            "and is never re-run — it is one whose result cannot be told from noise, so it "
            "may not fire the gate. It is listed below by name, and in `flaky_findings.md`.",
            ""]
    if d.get("missing_buckets"):
        out += ["### MISSING — why each one stopped being collected", "",
                "| entry | bucket | detail |", "|---|---|---|"]
        for k, (bucket, detail) in sorted(d["missing_buckets"].items()):
            out.append("| `%s` | **%s** | %s |" % (k[:70], bucket, detail[:90]))
        out += ["", "⛔ **DELETED / RENAMED reconcile** — somebody's decision, recorded in a "
                "commit. **DE-COLLECTED / UNATTRIBUTED do not**: a test stopped running and "
                "nobody was told, which is `COVERAGE_LOST`.", ""]
    if d.get("file_level_resolved"):
        out += ["### A SUITE THAT COULD NOT LOAD, AND NOW CAN", "",
                "⭐ These were WHOLE-FILE failures in the baseline (`<file> :: <file>`), a key "
                "shape that can never appear in `ran`. Their files' real testcases ran this "
                "time, so they are **FIXED** — reporting them MISSING would call a repair a "
                "coverage loss.", ""]
        out += ["- `%s`" % k[1] for k in d["file_level_resolved"][:20]]
        out.append("")
    if d.get("new_flaky"):
        out += ["### NEW but FLAKY — excluded from the verdict, named anyway", ""]
        out += ["- `%s` · `%s` · %s" % (k[0], k[1], k[2]) for k in d["new_flaky"][:50]]
        out.append("")
    if d.get("attribution"):
        out += ["### Attribution — commit range, never a hand-typed list", "",
                "| entry | class | commit | workstream | ours? |", "|---|---|---|---|---|"]
        for key, a in sorted(d["attribution"].items()):
            if not a.get("workstreams"):
                out.append("| `%s` | %s | — | — | — |" % (key[:60], a["class"]))
                continue
            for w in a["workstreams"]:
                out.append("| `%s` | %s | `%s` | %s | %s |"
                           % (key[:60], a["class"], w["commit"], w["workstream"],
                              "OURS" if w["ours"] else ""))
        out += ["", "⛔ UNATTRIBUTED carries the evidence of absence (range + path checked), "
                "never a bare label — see `reason` in the JSON.", ""]
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


# ── F-CI-30 · THE DERIVED FLAKY SET ───────────────────────────────────────────────────
#
# ⛔⛔ **NOTHING HERE IS HAND-MAINTAINED. A FILE LISTING "KNOWN FLAKY TESTS" IS A FINDING,
# NOT A FIX.** The set is re-derived from the record on every run, so a test leaves it the
# moment the evidence stops supporting it, and nobody can quietly add one.
#
# The owner's rule (F-CI-30): a test is FLAKY if the record shows it in BOTH states across
# >= 2 runs **at the same commit SHA**, or across consecutive runs whose diff touched no
# file that test imports. It leaves the set after K = 5 consecutive stable runs. The gate
# reports NEW **excluding** FLAKY, plus FLAKY_NEW / FLAKY_FIXED / FLAKY_SIZE.
#
# ⚠️⚠️ **AND THE SECOND LIMB, READ LITERALLY, IS WRONG — MEASURED.** Runs #18 and #19
# differ by ONE file, `.github/workflows/full-suite-report.yml`, which no test imports. A
# literal reading calls that pair equivalent, and **130 tests changed state across it** —
# because the change was `setup-node` + `npm ci` inside the PYTEST job, the E CP21 fix that
# gave the JS lane its modules back. Those are 129 real repairs and one real regression;
# classifying them as flakes would have muted the single most valuable diff in this record.
# ⭐ **So a workflow file is judged by WHICH JOB changed** — a change confined to `publish`
# or `gate` cannot reach a test, a change inside a job that runs the suite obviously can —
# and the test jobs are DERIVED from the workflow's own steps, never listed here.
FLAKY_STABLE_RUNS = 5
_SOURCE_GLOBS = ["*.py", "*.js", "*.jsx", "*.ts", "*.tsx", "*.mjs", "*.cjs"]
_INERT_SUFFIX = (".md",)
_INERT_PREFIX = ("docs/",)


def _git(args, repo="."):
    """(rc, stdout). ⛔ Never raises: an unreadable git is UNREADABLE, not False."""
    import subprocess
    try:
        p = subprocess.run(["git"] + args, cwd=repo, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=300)
    except Exception as exc:                                    # noqa: BLE001
        return 128, str(exc)
    return p.returncode, (p.stdout or "")


def source_references(path: str, sha: str, repo=".") -> list:
    """Source files (NOT prose) that mention `path`'s module name, or None if unreadable.

    ⛔ **CODE, NEVER PROSE.** The search is restricted to source extensions, so a module
    named in CLAUDE.md or a build record is not a reference. This repo has paid for that
    rule six times in one session.

    ⭐ The direction of the approximation is deliberate: a false POSITIVE ("something
    mentions it") only makes a pair non-equivalent, which suppresses a flaky claim. A
    false negative would invent one. So a bare, over-broad token is the safe token.
    """
    token = pathlib.Path(path).stem
    if not token:
        return []
    rc, out = _git(["grep", "-l", "-F", "-w", "--", token, sha, "--"] + _SOURCE_GLOBS
                   + [":!node_modules/", ":!" + path], repo)
    if rc not in (0, 1):                       # 1 = no match; anything else is unreadable
        return None
    return [l.strip() for l in out.splitlines() if l.strip()]


def _load_yaml(text):
    try:
        import yaml
    except ImportError:
        return None
    try:
        return yaml.safe_load(text)
    except Exception:                                           # noqa: BLE001
        return None


def _stable(obj) -> str:
    """A comparable rendering of a parsed YAML subtree.

    ⚰️ Keys are stringified first because **YAML 1.1 parses `on:` as the BOOLEAN True**,
    so a GitHub workflow's top-level mapping mixes `bool` and `str` keys and
    `json.dumps(sort_keys=True)` dies with *"'<' not supported between instances of 'bool'
    and 'str'"*. Measured the first time this ran against the real workflow.
    """
    def keys_to_str(o):
        if isinstance(o, dict):
            return {str(k): keys_to_str(v) for k, v in o.items()}
        if isinstance(o, list):
            return [keys_to_str(v) for v in o]
        return o
    return json.dumps(keys_to_str(obj), sort_keys=True, default=str)


#: the test tool as a COMMAND, at a command boundary. ⛔⛔ **CODE, NEVER PROSE — and this
#: check broke that rule twice before it held.** Matching the whole job blob called `publish`
#: a test job; matching a bare word then matched `# E CP6: pytest is now N shards` (a COMMENT
#: inside a `run:` block) and `print("| pytest | %s |")` (a summary-table LABEL). Both are the
#: publish job talking ABOUT the suite. `_command_text` strips comments and quoted strings
#: first, and the token must sit where a command sits.
_SUITE_TOOLS = ("pytest", "vitest", "jest")


def _command_text(run: str) -> str:
    """A `run:` block with prose removed: quoted strings and `#` comments.

    ⭐ Over-stripping is the safe direction ONLY because `_TEST_NAME` carries the common
    case — this repo's suite jobs are literally named `pytest` and `vitest`. A job that
    invokes the suite from inside a quoted string AND is named nothing test-like would be
    missed, and that is the one direction that could invent a flake; it is recorded here
    rather than hidden.
    """
    t = re.sub(r"'[^'" + chr(10) + r"]*'", " ", run or "")
    t = re.sub(r'"[^"' + chr(10) + r']*"', " ", t)
    return re.sub(r"#[^" + chr(10) + r"]*", " ", t)


def runs_suite(run: str) -> bool:
    """Does this `run:` block INVOKE a test runner?

    ⚰️ Decided by the PRECEDING TOKEN, not by position on the line. A
    command-position regex missed `/usr/bin/time -v python -m pytest --collect-only`
    — a real invocation behind a wrapper — and **that is the dangerous direction**: a
    suite job read as a non-suite job makes a pair look comparable when it is not, and
    invents flakes out of real regressions.

    ⛔ The rule: a tool token whose previous token is a FLAG is an argument
    (`ci_summarize.py --suite vitest`), except `-m`, which is how Python invokes a
    module (`python -m pytest`). Everything else is a command.
    """
    for line in _command_text(run).splitlines():
        toks = line.replace("|", " | ").replace(";", " ; ").split()
        for i, tok in enumerate(toks):
            low = tok.lower()
            if low in _SUITE_TOOLS or (low == "npm" and "test" in toks[i + 1:i + 3]):
                prev = toks[i - 1] if i else None
                if prev is not None and prev.startswith("-") and prev != "-m":
                    continue                    # an argument to something else
                return True
    return False
#: …and a job whose NAME says it runs tests is treated as one whatever its steps look like.
#: Generic, derived from the workflow's own naming — not a list of this repo's jobs.
_TEST_NAME = re.compile(r"(^|[-_])(test|tests|pytest|vitest|suite|spec)([-_]|$)", re.I)


def workflow_test_jobs(doc) -> set:
    """Jobs that RUN THE SUITE, derived from their own steps. Never a hand-kept list.

    ⛔ The failure direction is asymmetric and deliberate: calling a job a test job when it
    is not only makes a pair non-comparable (no flake is claimed). MISSING a real test job
    would let a genuine code-driven change be read as noise. So both a command match and a
    name match count, and either one is enough.
    """
    out = set()
    for name, job in ((doc or {}).get("jobs") or {}).items():
        if _TEST_NAME.search(str(name)):
            out.add(name)
            continue
        for step in (job or {}).get("steps") or []:
            if isinstance(step, dict) and runs_suite(str(step.get("run") or "")):
                out.add(name)
                break
    return out


def workflow_change_reaches_tests(path: str, sha_a: str, sha_b: str, repo="."):
    """(True/False/None, reason) — can this workflow edit have moved a test's outcome?

    ⛔ None is UNREADABLE and the caller must treat it as "assume it can".
    """
    rc_a, ta = _git(["show", "%s:%s" % (sha_a, path)], repo)
    rc_b, tb = _git(["show", "%s:%s" % (sha_b, path)], repo)
    if rc_a != 0 or rc_b != 0:
        return None, "%s is UNREADABLE at one of the two commits" % path
    da, db = _load_yaml(ta), _load_yaml(tb)
    if da is None or db is None:
        return None, "%s could not be parsed as YAML (or PyYAML is absent)" % path
    top_a = {k: v for k, v in da.items() if k != "jobs"}
    top_b = {k: v for k, v in db.items() if k != "jobs"}
    if _stable(top_a) != _stable(top_b):
        return True, "%s changed OUTSIDE `jobs:` — every job sees that" % path
    ja, jb = (da.get("jobs") or {}), (db.get("jobs") or {})
    changed = {n for n in set(ja) | set(jb) if _stable(ja.get(n)) != _stable(jb.get(n))}
    suite = workflow_test_jobs(db) | workflow_test_jobs(da)
    hit = sorted(changed & suite)
    if hit:
        return True, "%s changed the suite-running job(s) %s" % (path, ", ".join(hit))
    return False, "%s changed only %s, which run no tests" % (
        path, ", ".join(sorted(changed)) or "nothing")


def suite_harness_files(sha: str, repo=".") -> set:
    """Every repo path the SUITE JOBS (and everything they `needs`) actually invoke.

    ⚰️⚰️ **RUN #25 LAUNDERED 41 REAL REGRESSIONS AS NOISE, AND THIS IS THE FIX.** The
    previous session-hour's shard split (`tools/pytest_shards.py`, `ROOT_BUCKETS` 8 → 12)
    broke `tests/test_voice_router.py` — 41 tests returning `402 Payment Required` because
    the file was shuffled beside different neighbours. Reverting it flipped all 41 back, and
    the #24 → #25 pair read **comparable** — `pytest_shards.py` is imported by no test — so
    the derived set jumped to **FLAKY_SIZE 49, FLAKY_NEW 44**.

    ⛔ **A FILE THAT DECIDES HOW THE SUITE IS RUN CAN MOVE A TEST'S OUTCOME WITHOUT ANY TEST
    IMPORTING IT.** That is the same defect as the workflow limb (see the header), one level
    deeper: `pytest_shards.py` decides WHO SHARES A PROCESS. Import-reachability cannot see
    it, and a gate that excuses a regression as noise is worse than no gate.

    ⭐ Derived, never listed: the suite jobs come from the workflow's own steps, the
    `needs:` closure comes from the workflow, and the paths come from those jobs' `run:`
    blocks with prose stripped. `tools/ci_inventory.py` is deliberately NOT in this set —
    it is invoked by `publish` and `gate`, which no suite job depends on.
    """
    out = set()
    rc, names = _git(["ls-tree", "--name-only", "-r", sha, ".github/workflows"], repo)
    if rc != 0:
        return None
    for wf in [n.strip() for n in names.splitlines() if n.strip().endswith((".yml", ".yaml"))]:
        rc, text = _git(["show", "%s:%s" % (sha, wf)], repo)
        if rc != 0:
            return None
        doc = _load_yaml(text)
        if doc is None:
            return None
        jobs = (doc.get("jobs") or {})
        want = workflow_test_jobs(doc)
        # …and everything those jobs depend on, transitively: the plan job produces the
        # shard partition the suite jobs consume.
        changed = True
        while changed:
            changed = False
            for name in list(want):
                needs = (jobs.get(name) or {}).get("needs") or []
                if isinstance(needs, str):
                    needs = [needs]
                for n in needs:
                    if n not in want:
                        want.add(n)
                        changed = True
        for name in want:
            for step in (jobs.get(name) or {}).get("steps") or []:
                if not isinstance(step, dict):
                    continue
                for tok in _command_text(str(step.get("run") or "")).split():
                    tok = tok.strip("\"'(),;|&")
                    if "/" in tok and tok.split(".")[-1] in ("py", "sh", "js", "mjs", "cjs",
                                                             "json", "toml", "cfg", "ini"):
                        out.add(tok.lstrip("./"))
    return out


DELETED, RENAMED, DE_COLLECTED, UNATTRIBUTED = ("DELETED", "RENAMED", "DE-COLLECTED",
                                                "UNATTRIBUTED")


def _key_file(key):
    """The source file a failure key points at, or None. ⛔ Dotted for pytest, path for
    vitest — and the dotted form may carry a CLASS after the module."""
    cls = (key[1] or "").strip()
    if "/" in cls or "\\" in cls:
        return cls
    parts = cls.split(".")
    for n in range(len(parts), 0, -1):
        cand = "/".join(parts[:n]) + ".py"
        if pathlib.Path(cand).is_file():
            return cand
    return None


def attribute_missing(key, sha_a: str, sha_b: str, repo="."):
    """(bucket, detail) for ONE missing entry — why did this test stop being collected?

    ⛔⛔ **A TEST THAT LEAVES COVERAGE IS A VERDICT, NOT A FOOTNOTE.** But "MISSING" alone
    cannot tell a deliberate deletion from a silent de-collection, and the difference is
    the whole point: one is somebody's decision recorded in a commit, the other is a test
    that quietly stopped running and nobody was told.

    ⭐ **The attribution is DERIVED** — `git log --diff-filter=DR` between the two commits
    the record itself names — never a list somebody maintains.
    """
    path = _key_file(key)
    if not path:
        return UNATTRIBUTED, "the entry names no file this checkout has"
    if not (sha_a and sha_b):
        return UNATTRIBUTED, "the record does not carry both commit SHAs"
    rc, out = _git(["log", "--diff-filter=DR", "--name-status", "--oneline",
                    "%s..%s" % (sha_a, sha_b), "--", path], repo)
    if rc != 0:
        # ⛔ UNREADABLE is not "nothing happened" — a shallow clone cannot answer this.
        return UNATTRIBUTED, "git could not read %s..%s (shallow?)" % (sha_a[:9], sha_b[:9])
    body = out.strip()
    if not body:
        exists = pathlib.Path(path).is_file()
        return (DE_COLLECTED,
                "%s still exists and was neither deleted nor renamed in the diff — it "
                "stopped being COLLECTED" % path) if exists else (
            UNATTRIBUTED, "%s is absent and no deletion is attributable in the diff" % path)
    if re.search(r"^R\d*\s", body, re.M):
        return RENAMED, body.splitlines()[0][:120]
    return DELETED, body.splitlines()[0][:120]


def runs_equivalent(sha_a: str, sha_b: str, repo="."):
    """(True/False/None, reason) — could ANY code change explain a state change?

    ⛔ **UNREADABLE IS NOT EQUIVALENT.** A shallow checkout cannot diff two commits, and a
    tool that shrugged there would start calling real regressions flaky on exactly the
    runs where it can see least. F-CI-32's `fetch-depth: 0` is what feeds this.
    """
    if sha_a and sha_a == sha_b:
        return True, "SAME SHA — the strongest form of the rule"
    if not (sha_a and sha_b):
        return None, "a run in this pair records no commit SHA"
    rc, out = _git(["diff", "--name-only", sha_a, sha_b], repo)
    if rc != 0:
        return None, "the diff %s..%s is UNREADABLE (shallow checkout?)" % (sha_a[:9],
                                                                            sha_b[:9])
    harness = suite_harness_files(sha_b, repo)
    if harness is None:
        return None, "the suite's harness file set is UNREADABLE at %s" % sha_b[:9]
    reasons = []
    for f in [l.strip() for l in out.splitlines() if l.strip()]:
        if f.endswith(_INERT_SUFFIX) or f.startswith(_INERT_PREFIX):
            continue
        # ⛔ BEFORE import-reachability: does CI INVOKE this file to run the suite? A file
        # that decides how the suite runs moves outcomes without being imported.
        if f in harness:
            reasons.append("%s is invoked by the suite's own jobs" % f)
            continue
        if f.startswith(".github/workflows/"):
            reaches, why = workflow_change_reaches_tests(f, sha_a, sha_b, repo)
            if reaches is None:
                return None, why
            if reaches:
                reasons.append(why)
            continue
        if f.startswith(".github/"):
            reasons.append("%s is CI configuration outside a workflow file" % f)
            continue
        refs = source_references(f, sha_b, repo)
        if refs is None:
            return None, "whether %s is referenced is UNREADABLE" % f
        if refs:
            reasons.append("%s is referenced by %d source file(s)" % (f, len(refs)))
    if reasons:
        return False, "; ".join(reasons[:3])
    return True, "no changed file can reach a test"


def flaky_set(runs, repo="."):
    """The derived set, from a list of {n, id, sha, failing, ran} ordered by run number.

    Returns {key: {"evidence": [(run_a, run_b), …], "retired": bool, "stable": int}}.
    ⛔ Stateless by construction — re-derived from the record every time, so there is no
    file anyone can edit to add a test to it.
    """
    evidence, pairs = {}, []
    for a, b in zip(runs, runs[1:]):
        eq, why = runs_equivalent(a.get("sha", ""), b.get("sha", ""), repo)
        pairs.append({"a": a["n"], "b": b["n"], "equivalent": eq, "why": why})
        if eq is not True:
            continue
        both_ran = a["ran"] & b["ran"]
        for k in sorted((a["failing"] ^ b["failing"]) & both_ran):
            evidence.setdefault(k, []).append((a["n"], b["n"]))
    out = {}
    for k, ev in evidence.items():
        last = ev[-1][1]
        after = [r for r in runs if r["n"] > last]
        # ⛔ A run in which the test did not RUN does not extend a stable streak. "It was
        # not collected" is not "it behaved."
        stable = 0
        state = None
        for r in after:
            if k not in r["ran"]:
                stable = 0
                state = None
                continue
            here = k in r["failing"]
            if state is None or here == state:
                state = here
                stable += 1
            else:
                state = here
                stable = 1
        out[k] = {"evidence": ev, "stable": stable,
                  "retired": stable >= FLAKY_STABLE_RUNS}
    return out, pairs


def render_flaky(derived, pairs, runs, previous=None) -> str:
    """`flaky_findings.md` — one finding per flaky test, written by the tool."""
    live = {k: v for k, v in derived.items() if not v["retired"]}
    retired = {k: v for k, v in derived.items() if v["retired"]}
    prev = set(previous or ())
    out = ["# Flaky tests — DERIVED", "",
           "⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a "
           "quarantine list**: it is re-derived from the record on every run, so a test "
           "leaves it the moment the evidence stops supporting it.", "",
           "**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH "
           "states across two runs that no code change can distinguish — the same commit "
           "SHA, or a diff that cannot reach a test. It leaves after **%d** consecutive "
           "stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline."
           % FLAKY_STABLE_RUNS, "",
           "| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |", "|---|---|---|",
           "| **%d** | %d | %d |" % (len(live), len(set(live) - prev),
                                     len(prev - set(live))), "",
           "## The pairs the record could compare", "",
           "| runs | comparable | why |", "|---|---|---|"]
    for p in pairs:
        tag = {True: "**yes**", False: "no", None: "**UNREADABLE**"}[p["equivalent"]]
        out.append("| #%s → #%s | %s | %s |" % (p["a"], p["b"], tag, p["why"]))
    comparable = sum(1 for p in pairs if p["equivalent"] is True)
    out += ["", "⛔ **%d of %d consecutive pairs were comparable.** A pair that is not "
            "comparable contributes NO evidence in either direction — it cannot make a "
            "test flaky and it cannot clear one." % (comparable, len(pairs)), ""]
    if not live:
        out += ["## No test qualifies", "",
                "⭐ That is a statement about the EVIDENCE, not a clean bill of health: "
                "with %d comparable pair(s) in the record, the set can only be as large "
                "as what those pairs could show." % comparable, ""]
    for k, v in sorted(live.items()):
        out += ["## `%s` · `%s`" % (k[0], k[1]), "", "**%s**" % k[2], "",
                "- changed state across: %s"
                % ", ".join("#%s→#%s" % e for e in v["evidence"]),
                "- consecutive stable runs since: **%d** of %d needed to leave the set"
                % (v["stable"], FLAKY_STABLE_RUNS),
                "- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is "
                "not re-run: it is a test whose result this suite cannot trust.", ""]
    if retired:
        out += ["## Left the set (%d consecutive stable runs)" % FLAKY_STABLE_RUNS, ""]
        out += ["- `%s` · `%s` · %s" % k for k in sorted(retired)]
        out.append("")
    return "\n".join(out) + "\n"


def collect_runs(root, repo="."):
    """Every readable results/<run_id> record, ordered by run number."""
    root = pathlib.Path(root)
    runs = []
    for d in sorted(p for p in root.glob("*") if p.is_dir()):
        sp = d / "summary.json"
        if not sp.is_file():
            continue
        try:
            s = json.loads(sp.read_text(encoding="utf-8"))
        except ValueError:
            continue
        failing, ran, _ = load_record(d)
        if not ran:
            continue        # no junit = RAN unknowable = this run can witness nothing
        runs.append({"id": d.name, "n": s.get("run_number") or 0,
                     "sha": s.get("sha") or "", "failing": failing, "ran": ran})
    runs.sort(key=lambda r: r["n"])
    return runs


# ── E CP38 — rolling baseline with attribution ──────────────────────────────────────
#
# ⛔⛔ **R-ROLLING-BASELINE.** A fixed `BASELINE_RUN_ID` on a SHARED branch measures
# every workstream's drift against one frozen point, so a wide NEW count is mostly
# other people's work. The baseline for a run on `master` is instead the previous
# VALID `master` run — so the diff carries only what changed in the range between
# them, and every NEW/FIXED entry can be attributed to the commit that caused it.
# `BASELINE_RUN_ID` is RETIRED for master; kept, unchanged, for feat-branch runs
# (there the comparison point is a deliberate feat-branch anchor, not a moving one).

def record_is_valid(summary: dict) -> bool:
    """VALID = every pytest shard succeeded, the totals are present, and the suite
    actually collected something. Mirrors `diff()`'s own INVALID checks — a baseline
    this function calls valid is one `diff()` would never mark INVALID on its own
    account."""
    p = (summary or {}).get("pytest") or {}
    total = p.get("shards_total")
    success = p.get("shards_success")
    if not total or success != total:
        return False
    if p.get("shards_unreadable") or p.get("shards_without_totals") or p.get("shards_missing"):
        return False
    if not p.get("collected"):
        return False
    return True


def previous_valid_master_run(results_root, current_run_id=None, branch="master",
                              current_run_number=None):
    """(run_id, summary, candidates, exclusions) — the nearest EARLIER VALID run on
    `branch`, skipping INVALID ones in between.

    ⛔⛔ **`current_run_number` is load-bearing, not decorative.** Excluding only the
    current run's OWN id from the candidate pool is not enough — without a
    run-number cutoff, a run published AFTER the one being diffed (e.g. re-deriving
    an OLDER run's historical baseline once master has moved on) would be picked as
    its "baseline", comparing a run against something that did not exist yet at the
    time it ran. Caught by testing this against a real, already-published record
    store before wiring it into the workflow — with no cutoff, re-deriving run #42's
    baseline picked run #50, eight runs in its own future.

    ⭐ **Controls this satisfies (E38.1):** two valid runs with an INVALID run between
    them still resolve to the nearer valid one (INVALID is skipped, never treated as
    a gap that resets the search); a branch with no prior valid run returns `None`
    for `run_id`, which the caller reports as FIRST-RUN, never NO_NEW_FAILURES (an
    absence of evidence is not evidence of health).

    `candidates` and `exclusions` are the printed derivation — every run considered,
    and why the ones that were skipped were skipped — so this is never a black box.
    """
    root = pathlib.Path(results_root)
    candidates, exclusions = [], []
    if not root.is_dir():
        return None, {}, candidates, exclusions
    for d in sorted((p for p in root.glob("*") if p.is_dir()), key=lambda p: p.name):
        if current_run_id is not None and d.name == str(current_run_id):
            continue
        sp = d / "summary.json"
        if not sp.is_file():
            continue
        try:
            s = json.loads(sp.read_text(encoding="utf-8"))
        except ValueError:
            exclusions.append((d.name, "summary.json unreadable"))
            continue
        if (s.get("branch") or "") != branch:
            continue
        try:
            n = int(s.get("run_number") or 0)
        except (TypeError, ValueError):
            n = 0
        if current_run_number is not None and n >= current_run_number:
            exclusions.append((d.name, "run #%s is not earlier than the current run #%s"
                               % (n, current_run_number)))
            continue
        if record_is_valid(s):
            candidates.append((n, d.name, s))
        else:
            p = s.get("pytest") or {}
            exclusions.append((d.name, "INVALID: shards_success=%s/%s collected=%s"
                               % (p.get("shards_success"), p.get("shards_total"),
                                  p.get("collected"))))
    if not candidates:
        return None, {}, candidates, exclusions
    candidates.sort(key=lambda c: c[0])
    n, run_id, summary = candidates[-1]
    return run_id, summary, candidates, exclusions


_MERGE_BRANCH_RE = re.compile(r"^Merge (?:remote-tracking )?branch '([^']+)'(?: into (\S+))?")


def _branch_from_merge_subject(subject):
    """The workstream name from a merge commit's own subject, or None.

    'Merge branch 'X' into HEAD' -> X. 'Merge remote-tracking branch 'origin/master'
    into fix/Y' -> fix/Y — the branch being UPDATED, since 'origin/master' names no
    workstream at all, only the ref that was pulled in.
    """
    m = _MERGE_BRANCH_RE.match((subject or "").strip())
    if not m:
        return None
    name, into = m.group(1), m.group(2)
    if name in ("master", "origin/master") and into:
        return into
    return name


_MESSAGE_TAG_RE = re.compile(r"^([A-Za-z][\w. -]*?)(?:\s*\([^)]*\))?\s*:")


def _message_tag(subject):
    """The self-declared leading tag on a commit subject, or None — e.g. 'E CP36'
    from 'E CP36: …', 'DC-3' from 'DC-3 (b): …', 'wisdom' from 'wisdom(session-25): …'.
    Every concurrent workstream on this shared master uses this same idiom, including
    this session's own 'K CP'/'E CP' checkpoints — it is the most specific signal
    available for a commit that never went through its own merge commit."""
    m = _MESSAGE_TAG_RE.match((subject or "").strip())
    return m.group(1) if m else None


def commit_workstream(sha: str, sha_b: str, repo=".") -> tuple:
    """(label, confidence) for one commit in a range ending at sha_b.

    Tried in order: 'merge' (the commit IS a merge naming a branch) > 'message-tag'
    (its own subject declares one) > 'nearest-merge' (the next merge commit reachable
    after it, up to sha_b, names one) > 'author' (last resort, prefixed so it reads as
    the weaker signal it is) > (None, 'unattributed').

    ⛔ Author name was measured and ruled out as a PRIMARY signal on this repo: at
    least four distinct concurrent workstreams push under the identical git identity
    "Claude Fable 5", so it cannot discriminate between them — it survives only as
    the last-resort fallback here.
    """
    rc, subj = _git(["log", "-1", "--format=%s", sha], repo)
    subj = subj.strip() if rc == 0 else ""
    b = _branch_from_merge_subject(subj)
    if b:
        return b, "merge"
    tag = _message_tag(subj)
    if tag:
        return tag, "message-tag"
    rc, merges = _git(["log", "--merges", "--format=%H", "--reverse",
                        "%s..%s" % (sha, sha_b)], repo)
    if rc == 0:
        for m in merges.splitlines():
            m = m.strip()
            if not m:
                continue
            rc2, msubj = _git(["log", "-1", "--format=%s", m], repo)
            b = _branch_from_merge_subject(msubj.strip()) if rc2 == 0 else None
            if b:
                return b, "nearest-merge"
    rc, an = _git(["log", "-1", "--format=%an", sha], repo)
    if rc == 0 and an.strip():
        return "author:%s" % an.strip(), "author"
    return None, "unattributed"


_OURS_SUBJECT_RE = re.compile(
    r"^(?:[EKDST]\d*\s*CP\d+\b|fix\(ci\)|fix\(tests\)|packet-)", re.I)


def commit_is_ours(sha: str, repo=".") -> bool:
    """True when a commit's own subject matches THIS programme's checkpoint
    convention (K CP20:, E CP36:, D5 CP3:, S6 CP2:, T CP1:, fix(ci):, fix(tests):,
    packet-…). Best-effort and reviewable, not a cross-repo authority — this tool
    has no reach into the docs repo's own signing manifest, which is the ground
    truth for 'ours'; that cross-check is done by hand at E38.3, not by this
    function, which exists for the WORKFLOW's automated, repo-local approximation."""
    rc, subj = _git(["log", "-1", "--format=%s", sha], repo)
    return rc == 0 and bool(_OURS_SUBJECT_RE.match(subj.strip()))


_PY_IMPORT_RE = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", re.M)
_JS_IMPORT_RE = re.compile(r"""(?:from\s+|require\()\s*['"]([^'"]+)['"]""")


def _imported_product_files(test_path: str, sha: str, repo=".") -> set:
    """Best-effort: the product files a test file's own imports resolve to, at sha.
    Never raises — an unreadable file or an unresolvable import is silently skipped.
    This WIDENS the search for a touching commit; it is not a claim of a complete
    import graph (no transitive resolution, no package-alias resolution)."""
    rc, text = _git(["show", "%s:%s" % (sha, test_path)], repo)
    if rc != 0:
        return set()
    out = set()
    if test_path.endswith(".py"):
        for m in _PY_IMPORT_RE.finditer(text):
            mod = m.group(1) or m.group(2)
            if not mod or mod.split(".")[0] in ("pytest", "unittest", "os", "sys"):
                continue
            rel = mod.replace(".", "/")
            for cand in (rel + ".py", rel + "/__init__.py"):
                rc2, _out = _git(["cat-file", "-e", "%s:%s" % (sha, cand)], repo)
                if rc2 == 0:
                    out.add(cand)
    elif test_path.endswith((".js", ".jsx", ".ts", ".tsx")):
        base_dir = posixpath.dirname(test_path)
        for m in _JS_IMPORT_RE.finditer(text):
            spec = m.group(1)
            if not spec.startswith("."):
                continue
            joined = posixpath.normpath(posixpath.join(base_dir, spec))
            for cand in (joined, joined + ".js", joined + ".jsx", joined + ".ts",
                         joined + ".tsx", joined + "/index.js", joined + "/index.jsx"):
                rc2, _out = _git(["cat-file", "-e", "%s:%s" % (sha, cand)], repo)
                if rc2 == 0:
                    out.add(cand)
                    break
    return out


def attribute_change(key, sha_a: str, sha_b: str, repo=".") -> dict:
    """Attribution for one NEW or FIXED entry: which commit(s) in (sha_a, sha_b]
    touched its test file or a product file it imports, and each one's workstream.

    ⭐ **Controls this satisfies (E38.1):** a NEW/FIXED entry whose test file changed
    in range is attributed via 'test-file-change'; failing that, one whose imported
    product file changed is attributed via 'imported-file-change'; an entry with
    nothing in range is UNATTRIBUTED, carrying the evidence of that absence (the
    exact range and path checked) rather than a bare label.
    """
    path = _key_file(key)
    if not path or not sha_a or not sha_b:
        return {"class": UNATTRIBUTED, "commits": [], "workstreams": [],
                "reason": "no test-file path or no commit range"}
    rc, log = _git(["log", "--format=%H", "--reverse", "%s..%s" % (sha_a, sha_b),
                     "--", path], repo)
    commits = [c for c in (log.splitlines() if rc == 0 else []) if c.strip()]
    reason_kind = "test-file-change"
    if not commits:
        for prod in sorted(_imported_product_files(path, sha_b, repo)):
            rc2, log2 = _git(["log", "--format=%H", "--reverse",
                               "%s..%s" % (sha_a, sha_b), "--", prod], repo)
            commits += [c for c in (log2.splitlines() if rc2 == 0 else []) if c.strip()]
        if commits:
            reason_kind = "imported-file-change"
    if not commits:
        return {"class": UNATTRIBUTED, "commits": [], "workstreams": [],
                "reason": "no commit in %s..%s touched %s or anything it imports"
                          % (sha_a[:9], sha_b[:9], path)}
    workstreams = []
    for c in commits:
        label, conf = commit_workstream(c, sha_b, repo)
        workstreams.append({"commit": c[:9], "workstream": label or UNATTRIBUTED,
                             "confidence": conf, "ours": commit_is_ours(c, repo)})
    return {"class": reason_kind, "commits": [c[:9] for c in commits],
            "workstreams": workstreams}


def attribute_new_and_fixed(new_keys, fixed_keys, sha_a: str, sha_b: str, repo="."):
    """{'entry|key': attribution} for every NEW and FIXED key, plus rollup counts
    (NEW-OURS / NEW-OTHERS / UNATTRIBUTED) — the per-entry table and the verdict
    line's own numbers, derived from the same pass so they can never disagree."""
    table = {}
    counts = {"new_ours": 0, "new_others": 0, "new_unattributed": 0}
    for k in new_keys:
        a = attribute_change(k, sha_a, sha_b, repo)
        table["|".join(k)] = a
        if a["class"] == UNATTRIBUTED:
            counts["new_unattributed"] += 1
        elif any(w["ours"] for w in a["workstreams"]):
            counts["new_ours"] += 1
        else:
            counts["new_others"] += 1
    for k in fixed_keys:
        table["|".join(k)] = attribute_change(k, sha_a, sha_b, repo)
    return table, counts


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

    # ── F-CI-30: the derived flaky set ────────────────────────────────────────────────
    #
    # ⛔ THE CONTROL THAT MATTERS IS THE PAIR THAT IS **NOT** COMPARABLE. Without it,
    # "a flip makes a test flaky" is satisfied by a tool that calls every regression noise.
    print()
    for src, want, why in (
            ("python -m pytest tests/ -q", True, "a real invocation"),
            ("/usr/bin/time -v python -m pytest --collect-only -q x", True,
             "behind a WRAPPER — the miss a command-position regex made"),
            ("npx vitest run --reporter=json", True, "npx vitest"),
            ("npm run test", True, "npm run test"),
            ('echo "| pytest | ${{ needs.pytest.result }} |"', False,
             "a summary-table LABEL — prose, not a command"),
            ("# E CP6: pytest is now N shards.", False, "a COMMENT inside a run: block"),
            ("python tools/ci_extract.py --pytest-log x.log", False, "a FLAG"),
            ("cat extract/1/pytest_failures.txt", False, "a FILENAME"),
            ("python tools/ci_summarize.py --suite vitest", False,
             "an ARGUMENT to another tool")):
        show("runs_suite: %s" % why, runs_suite(src), want)

    # ⚰️ RUN #25 LAUNDERED 41 REAL REGRESSIONS AS NOISE. A file the suite's own jobs INVOKE
    # can move a test's outcome without any test importing it, and `tools/pytest_shards.py`
    # — which decides who shares a process — is the proof.
    _h = suite_harness_files("HEAD")
    show("the harness set is non-empty (a broken walk would re-open the hole)",
         bool(_h) and len(_h) > 3, True)
    show("  ...and it contains the SHARD PLANNER, which broke run #24",
         "tools/pytest_shards.py" in (_h or set()), True)
    show("  ...and NOT the reporting tool, invoked only by publish/gate",
         "tools/ci_inventory.py" in (_h or set()), False)

    def _wf(jobs, top=None):
        doc = {"name": "w", "on": {"push": None}, "jobs": jobs}
        doc.update(top or {})
        return doc

    SUITE = {"steps": [{"run": "python -m pytest tests/ -q"}]}
    PUB = {"steps": [{"run": "python tools/ci_publish.py --push"}]}
    show("workflow_test_jobs finds the suite job", sorted(workflow_test_jobs(
        _wf({"runtests": SUITE, "publish": PUB}))), ["runtests"])
    show("  ...and not the publishing job (non-vacuity: it found ONE)",
         "publish" in workflow_test_jobs(_wf({"runtests": SUITE, "publish": PUB})), False)

    # runs A and B, same three tests, one of which flips
    A_, B_, C_ = ("pytest", "m", "a"), ("pytest", "m", "b"), ("pytest", "m", "c")
    RUNS = [{"id": "1", "n": 1, "sha": "s1", "failing": {A_}, "ran": {A_, B_, C_}},
            {"id": "2", "n": 2, "sha": "s1", "failing": {A_, B_}, "ran": {A_, B_, C_}}]
    derived, pairs = flaky_set(RUNS)
    show("SAME SHA + a flip -> FLAKY, by name", sorted(derived), [B_])
    show("  ...and the pair says why", pairs[0]["why"][:8], "SAME SHA")
    # ⛔ THE CONTROL: the identical flip across a pair that is NOT comparable is a
    # REGRESSION, and must not enter the set. Different shas + no repo to diff = UNREADABLE.
    RUNS2 = [dict(RUNS[0], sha="aaa"), dict(RUNS[1], sha="bbb")]
    d2, p2 = flaky_set(RUNS2, repo="no-such-repo-dir")
    show("an UNCOMPARABLE pair contributes NOTHING", sorted(d2), [])
    show("  ...and it is reported UNREADABLE, never 'not equivalent'",
         p2[0]["equivalent"], None)
    # a test that did not RUN in one of the two runs cannot witness anything
    RUNS3 = [{"id": "1", "n": 1, "sha": "s1", "failing": {A_}, "ran": {A_}},
             {"id": "2", "n": 2, "sha": "s1", "failing": {A_, B_}, "ran": {A_, B_}}]
    show("a test absent from one run's junit is NOT flaky", sorted(flaky_set(RUNS3)[0]), [])
    # K = 5 retirement, and a run where it did not run breaks the streak.
    # ⛔ The tail must hold B_ in the state the flip LEFT it in (failing). A tail that
    # flips it back is not five stable runs — it is a sixth piece of evidence, and the
    # first version of this fixture made exactly that mistake and read as a code defect.
    tail = [{"id": str(i), "n": i, "sha": "s1", "failing": {A_, B_}, "ran": {A_, B_, C_}}
            for i in range(3, 3 + FLAKY_STABLE_RUNS)]
    d4, _ = flaky_set(RUNS + tail)
    show("%d stable runs -> RETIRED" % FLAKY_STABLE_RUNS, d4[B_]["retired"], True)
    d5, _ = flaky_set(RUNS + tail[:-1])
    show("  ...and %d is not enough (non-vacuity)" % (FLAKY_STABLE_RUNS - 1),
         d5[B_]["retired"], False)
    gap = list(tail)
    gap[2] = dict(gap[2], ran={A_, C_})
    d6, _ = flaky_set(RUNS + gap)
    show("a run where it was NOT COLLECTED breaks the streak", d6[B_]["retired"], False)

    # the gate: NEW excludes FLAKY, and the arithmetic still closes over everything
    dF = diff({A_}, {A_, B_, C_}, {A_, B_, C_}, GOOD, flaky={B_})
    show("NEW excludes the flaky entry", dF["new"], [C_])
    show("  ...and names it in its own bucket", dF["new_flaky"], [B_])
    show("  ...so the verdict is still NEW_FAILURES on the real one",
         dF["verdict"], "NEW_FAILURES")
    dG = diff({A_}, {A_, B_}, {A_, B_}, GOOD, flaky={B_})
    show("a run whose ONLY new entry is flaky -> NO_NEW_FAILURES",
         dG["verdict"], "NO_NEW_FAILURES")
    show("  ...and the arithmetic still reconciles",
         dG["verdict"] != "DID_NOT_RECONCILE", True)
    show("  ...and FLAKY_SIZE is reported", dG["counts"]["flaky_size"], 1)
    # ⛔ NON-VACUITY: with an EMPTY flaky set the same inputs DO fire the gate, or
    # "flaky is excluded" would be satisfied by a gate that never fires.
    show("  ...and with NO flaky set the same run FAILS",
         diff({A_}, {A_, B_}, {A_, B_}, GOOD)["verdict"], "NEW_FAILURES")

    # ── F-CI-41 · COVERAGE_LOST, and the suite-load repair that read as coverage loss ──
    print()
    FILEK = ("vitest", "src/x/y.test.jsx", "src/x/y.test.jsx")
    TESTK = ("vitest", "src/x/y.test.jsx", "renders the thing")
    show("a file-level key is recognised by its shape", is_file_level_key(FILEK), True)
    show("  ...and a test-level key in the same file is NOT", is_file_level_key(TESTK), False)
    show("  ...nor is a pytest dotted key", is_file_level_key(("pytest", "tests.a", "tests.a")),
         False)
    # ⛔ THE ONE THAT MATTERS: a baseline file-level failure whose file now RUNS is FIXED.
    dfl = diff({FILEK}, set(), {TESTK}, GOOD)
    show("a fixed suite-load failure resolves to FIXED, not MISSING", dfl["counts"]["fixed"], 1)
    show("  ...and MISSING stays 0", dfl["counts"]["missing"], 0)
    show("  ...and it is reported as such", dfl["counts"]["file_level_resolved"], 1)
    show("  ...so the verdict is clean", dfl["verdict"], "NO_NEW_FAILURES")
    # ⛔ NON-VACUITY: a file-level failure whose file did NOT run is still MISSING.
    dfl2 = diff({FILEK}, set(), {("vitest", "src/other.test.jsx", "t")}, GOOD)
    show("  ...but a file that did NOT run is still MISSING", dfl2["counts"]["missing"], 1)
    show("  ...and THAT is COVERAGE_LOST", dfl2["verdict"], "COVERAGE_LOST")
    # attribution buckets, against this repo's real history
    A = ("pytest", "tests.test_voice_router", "test_tts_requires_auth")
    b, _d = attribute_missing(A, "HEAD~1", "HEAD")
    show("a live file with no deletion in the diff -> DE-COLLECTED", b, DE_COLLECTED)
    b2, _ = attribute_missing(("pytest", "tests.no_such_module_at_all", "t"), "HEAD~1", "HEAD")
    show("an entry naming no file -> UNATTRIBUTED", b2, UNATTRIBUTED)
    b3, _ = attribute_missing(A, "", "")
    show("no SHAs in the record -> UNATTRIBUTED, never 'nothing happened'", b3, UNATTRIBUTED)
    b4, _ = attribute_missing(A, "deadbeefdeadbeef", "HEAD")
    show("an unreadable range -> UNATTRIBUTED (a shallow clone cannot answer)", b4,
         UNATTRIBUTED)
    # ⛔ VERDICT PRECEDENCE, worst first
    show("precedence: INVALID beats COVERAGE_LOST",
         diff({FILEK}, set(), set(), {})["verdict"], "INVALID")
    show("precedence: COVERAGE_LOST beats NEW_FAILURES",
         diff({A, FILEK}, {("pytest", "tests.x", "t")},
              {("vitest", "src/other.test.jsx", "t")}, GOOD)["verdict"], "COVERAGE_LOST")
    show("  ...and the order is declared worst-first", VERDICTS[0], "INVALID")
    show("  ...with NO_NEW_FAILURES last", VERDICTS[-1], "NO_NEW_FAILURES")

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
    ap.add_argument("--flaky", action="store_true",
                    help="derive the FLAKY set from every record under --results-root")
    ap.add_argument("--repo", default=".",
                    help="the code checkout the diffs are read from (needs full history)")
    ap.add_argument("--flaky-out", help="write flaky_findings.md here")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    if a.flaky:
        runs = collect_runs(a.results_root, a.repo)
        if len(runs) < 2:
            print("[ci-inventory] FLAKY: %d readable record(s) — a flake needs two runs "
                  "to be visible at all. Nothing derived, and that is not a clean bill "
                  "of health." % len(runs))
            return OK
        derived, pairs = flaky_set(runs, a.repo)
        live = {k: v for k, v in derived.items() if not v["retired"]}
        prev, _ = flaky_set(runs[:-1], a.repo)
        prev_live = {k for k, v in prev.items() if not v["retired"]}
        text = render_flaky(derived, pairs, runs, prev_live)
        if a.flaky_out:
            pathlib.Path(a.flaky_out).parent.mkdir(parents=True, exist_ok=True)
            pathlib.Path(a.flaky_out).write_text(text, encoding="utf-8")
            print("[ci-inventory] wrote %s" % a.flaky_out)
        if a.out:
            pathlib.Path(a.out).write_text(json.dumps(
                {"flaky": ["|".join(k) for k in sorted(live)],
                 "flaky_size": len(live),
                 "flaky_new": len(set(live) - prev_live),
                 "flaky_fixed": len(prev_live - set(live)),
                 "stable_runs_to_leave": FLAKY_STABLE_RUNS,
                 "runs": [r["n"] for r in runs],
                 "pairs": pairs}, indent=2) + "\n", encoding="utf-8")
            print("[ci-inventory] wrote %s" % a.out)
        else:
            print(text)
        # ⛔ Deriving the set is never a failure: an empty set and a full one are both
        # readings. The GATE is what fails, on NEW.
        return OK

    if a.baseline or a.current:
        if not (a.baseline and a.current):
            print("--baseline and --current are used together")
            return FAIL
        root = pathlib.Path(a.results_root)
        rolling = (a.baseline == "previous-valid-master")
        first_run = False
        derivation_lines = []
        cdir = pathlib.Path(a.current_dir) if a.current_dir else root / a.current
        cf, cr, cs = load_record(cdir)
        if rolling:
            # ⛔⛔ R-ROLLING-BASELINE (E CP38) — the baseline for a MASTER run is the
            # previous VALID master run, derived here, never a constant. Printed BEFORE
            # the diff so the choice is reviewable, not just the result of it. The
            # current run's OWN run_number is threaded through so a run published
            # after the one being diffed can never be chosen as its baseline.
            try:
                _cur_n = int(cs.get("run_number") or 0) or None
            except (TypeError, ValueError):
                _cur_n = None
            run_id, bsum, candidates, exclusions = previous_valid_master_run(
                root, current_run_id=a.current, branch="master",
                current_run_number=_cur_n)
            derivation_lines.append("[ci-inventory] rolling-baseline derivation:")
            for n, rid, _s in candidates:
                mark = " <= CHOSEN" if rid == run_id else ""
                derivation_lines.append("  candidate  run #%s (%s)%s" % (n, rid, mark))
            for rid, why in exclusions:
                derivation_lines.append("  excluded   %s — %s" % (rid, why))
            if run_id is None:
                first_run = True
                bf, bs = set(), {}
                derivation_lines.append("  -> no prior VALID master run: FIRST-RUN")
            else:
                bdir = root / run_id
                bf, _, bs = load_record(bdir)
                derivation_lines.append("  -> baseline = run #%s (%s), sha %s"
                                        % (bsum.get("run_number"), run_id,
                                           (bsum.get("sha") or "")[:9]))
            a = argparse.Namespace(**{**vars(a), "baseline": (run_id or "NONE")})
        else:
            bdir = pathlib.Path(a.baseline_dir) if a.baseline_dir else root / a.baseline
            bf, _, bs = load_record(bdir)
        # ⛔ The FLAKY set is DERIVED HERE, from the published record, not read from a
        # file. If the record is not reachable the set is EMPTY — and an empty set means
        # every NEW entry fires the gate, which is the safe direction.
        flaky, flaky_prev = set(), set()
        if root.is_dir():
            runs = collect_runs(root, a.repo)
            if len(runs) >= 2:
                derived, _pairs = flaky_set(runs, a.repo)
                flaky = {k for k, v in derived.items() if not v["retired"]}
                prev, _ = flaky_set(runs[:-1], a.repo)
                flaky_prev = {k for k, v in prev.items() if not v["retired"]}
        d = diff(bf, cf, cr, cs, bs, flaky=flaky, flaky_previous=flaky_prev, repo=a.repo,
                 first_run=first_run, attribute=rolling)
        for line in derivation_lines:
            print(line)
        text = render_diff(d, a.baseline, a.current)
        if a.out:
            import json as _json
            pathlib.Path(a.out).write_text(_json.dumps(
                {"verdict": d["verdict"], "counts": d["counts"],
                 "arithmetic": d["arithmetic"], "invalid_because": d["invalid_because"],
                 "baseline_run_id": a.baseline, "current_run_id": a.current,
                 "baseline_sha": (bs or {}).get("sha"), "current_sha": (cs or {}).get("sha"),
                 "commit_range": "%s..%s" % ((bs or {}).get("sha") or "NONE",
                                             (cs or {}).get("sha") or ""),
                 "first_run": first_run,
                 "new": ["|".join(k) for k in d["new"]],
                 "missing": ["|".join(k) for k in d["missing"]],
                 "fixed": ["|".join(k) for k in d["fixed"]],
                 "new_flaky": ["|".join(k) for k in d.get("new_flaky", [])],
                 "flaky": ["|".join(k) for k in sorted(flaky)],
                 "file_level_resolved": ["|".join(k) for k in d.get("file_level_resolved", [])],
                 "coverage_lost": ["|".join(k) for k in d.get("coverage_lost", [])],
                 "missing_buckets": d.get("missing_buckets", {}),
                 "attribution": d.get("attribution", {})},
                indent=2) + "\n", encoding="utf-8")
            print("[ci-inventory] wrote %s" % a.out)
        print(text)
        # ⛔ Non-zero on anything that is not a clean diff: a gate that cannot fail is not
        # a gate, and INVALID must never read as a pass. FIRST_RUN is likewise never OK —
        # "nothing to compare against" is not "compared clean".
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
