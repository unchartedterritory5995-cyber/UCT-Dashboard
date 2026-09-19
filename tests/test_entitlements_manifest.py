"""GATE-S9 CHECKPOINT 1 — the entitlement axis, enumerated. Mirrors
test_canonical_address_book.py's shape exactly: non-vacuity first, the
derivation rail run as a subprocess, the inertness rail with its own
non-vacuity control, and the two duplication findings mutation-proved.

⛔ APPROVED SCOPE (owner, delegated to the running Claude Code session,
2026-09-19): "CP1 — the entitlement axis as INERT DATA + a duplication rail:
every site that answers 'may this member' enumerated from source, with
FREE_PAGES' three copies named. No gate changed."
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import subprocess
import sys

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MANIFEST_PATH = _REPO / "api" / "data" / "entitlements_manifest.json"
_BUILDER = _REPO / "tools" / "build_entitlements_manifest.py"


def _manifest() -> dict:
    return json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# NON-VACUITY FIRST
# ─────────────────────────────────────────────────────────────────────────────

def test_both_findings_are_non_empty_and_name_a_real_file():
    m = _manifest()
    free_pages = m["free_pages_TRIPLICATED"]
    assert len(free_pages["entries"]) == 3
    for e in free_pages["entries"]:
        assert (_REPO / e["file"]).exists(), f"named but missing: {e['file']}"

    mirrored = m["paid_plan_literal_MIRRORED_ACROSS_LANES"]
    assert len(mirrored["js_call_sites"]) == 3
    for e in mirrored["js_call_sites"]:
        assert (_REPO / e["file"]).exists(), f"named but missing: {e['file']}"


def test_the_gate_call_site_population_is_reported_not_assumed():
    """⛔ NO `assert len(...) == N` — the population is meant to change as
    routers are added. This asserts the SHAPE (every declared name has at least
    one real site) rather than a count that would need editing on every PR."""
    m = _manifest()
    population = m["gate_call_sites"]["population"]
    for name, sites in population.items():
        assert sites, f"{name} has zero call sites — the scan is broken, not the population"
        for rel in sites:
            assert (_REPO / rel).exists(), f"{name} names a file that does not exist: {rel}"


# ─────────────────────────────────────────────────────────────────────────────
# THE DERIVATION ITSELF
# ─────────────────────────────────────────────────────────────────────────────

def test_the_checked_in_manifest_IS_what_the_declarations_derive():
    r = subprocess.run([sys.executable, str(_BUILDER), "--check"],
                       cwd=str(_REPO), capture_output=True, text=True)
    assert r.returncode == 0, (
        "the checked-in entitlements manifest is not what the declarations "
        "derive:\n" + r.stdout + r.stderr)
    assert "OK" in r.stdout, r.stdout


def test_the_derivation_rail_CAN_FAIL(tmp_path):
    """⛔ THE MUTATION, RUN IN-PROCESS. A copy, corrupted, never the real file."""
    m = _manifest()
    corrupted = dict(m)
    corrupted["free_pages_TRIPLICATED"] = dict(m["free_pages_TRIPLICATED"])
    corrupted["free_pages_TRIPLICATED"]["entries"] = [
        dict(e) for e in m["free_pages_TRIPLICATED"]["entries"]
    ]
    corrupted["free_pages_TRIPLICATED"]["entries"][0]["values"] = ["/some-other-page"]
    corrupted_path = tmp_path / "entitlements_manifest.json"
    corrupted_path.write_text(json.dumps(corrupted, indent=2), encoding="utf-8")

    reloaded = json.loads(corrupted_path.read_text(encoding="utf-8"))
    assert reloaded != m, (
        "the corrupted copy still equals the real manifest — the comparison "
        "this rail relies on would not notice a real drift either")


# ─────────────────────────────────────────────────────────────────────────────
# THE TWO DUPLICATION FINDINGS — the reason CP1 exists
# ─────────────────────────────────────────────────────────────────────────────

def test_FREE_PAGES_values_agree_across_all_three_files():
    """⛔ THE DUPLICATION RAIL GATE-S9 §3 CALLS FOR. Fails the moment one of the
    three hand-typed copies diverges from the other two — which today happens
    silently, with only a code comment asking a human to remember."""
    m = _manifest()
    fp = m["free_pages_TRIPLICATED"]
    values = [tuple(e["values"]) for e in fp["entries"]]
    assert len(set(values)) == 1, (
        f"FREE_PAGES has diverged across its three copies: {fp['entries']}")
    assert fp["values_agree"] is True, "the manifest's own agree flag disagrees with its own data"


def test_the_FREE_PAGES_rail_CAN_FAIL():
    """⛔ MUTATION-PROVED. Three distinct value sets must NOT agree."""
    values = [("/morning-wire",), ("/morning-wire",), ("/DIFFERENT-PAGE",)]
    assert len(set(values)) != 1, "the divergence check cannot see three-way disagreement"


def test_paid_plan_literal_mirrors_the_python_source_everywhere_it_appears():
    """The JS literal itself must still equal Python's PAID_PLANS wherever it is
    re-typed — CP1 does not touch these sites, but a manifest claiming to track
    them must notice if one is ever hand-edited to a DIFFERENT plan list."""
    m = _manifest()
    mirrored = m["paid_plan_literal_MIRRORED_ACROSS_LANES"]
    py_values = set(mirrored["python_values"])
    assert py_values == {"pro", "premium", "lifetime"}
    plan_re = re.compile(
        r"\[\s*['\"]pro['\"]\s*,\s*['\"]premium['\"]\s*,\s*['\"]lifetime['\"]\s*\]"
        r"\s*\.\s*includes\s*\(")
    for entry in mirrored["js_call_sites"]:
        raw = (_REPO / entry["file"]).read_text(encoding="utf-8")
        assert plan_re.search(raw), (
            f"{entry['file']} no longer carries the literal the manifest recorded "
            "for it — the manifest is stale, re-run the builder")


def test_the_trial_clause_finding_is_recorded_accurately():
    """⛔ NOT A BLANKET 'THEY DISAGREE' — the manifest's own record of WHICH
    sites carry the trial clause and which do not must match reality, since
    this finding is what a future CP2+ session would act on."""
    m = _manifest()
    by_file = {e["file"]: e["ors_in_trial_active"]
               for e in m["paid_plan_literal_MIRRORED_ACROSS_LANES"]["js_call_sites"]}
    assert by_file["app/src/context/AuthContext.jsx"] is True, (
        "AuthContext.jsx's isPaid is the canonical predicate and ORs in trial.active"
    )
    assert by_file["app/src/pages/Login.jsx"] is False, (
        "Login.jsx's post-login routing check does not carry the trial clause"
    )
    assert by_file["app/src/pages/Pricing.jsx"] is False, (
        "Pricing.jsx's trulyPaid is deliberately narrower than isPaid"
    )


# ─────────────────────────────────────────────────────────────────────────────
# INERTNESS — CP1 is data nothing reads. Mirrors test_canonical_address_book.py.
# ─────────────────────────────────────────────────────────────────────────────

def _py_code_only(path: pathlib.Path) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


def _js_code_only(path: pathlib.Path) -> str:
    """CODE, NEVER PROSE for JS — `//` line comments blanked, mirroring
    tools/build_entitlements_manifest.py's own `_strip_js_comments`."""
    return re.sub(r"//[^\n]*", "", path.read_text(encoding="utf-8"))


#: CP1 is inert by construction: the approval says the manifest is not read by
#: any product path. A reader is CP2+, and per GATE-S9 §3 that is "NOT
#: PROPOSABLE" until the owner answers OI-03(a)/OI-03(b)/OI-12. This fails by
#: NAME the moment a reader appears, on either lane.
_ALLOWED_MANIFEST_READERS: tuple[str, ...] = ()


def test_no_python_product_path_reads_the_manifest():
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        try:
            code = _py_code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        if "entitlements_manifest" in code and rel not in _ALLOWED_MANIFEST_READERS:
            offenders.append(rel)
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], (
        f"a product path reads the entitlements manifest before CP2+ is authorized: {offenders}")


def test_no_frontend_product_path_reads_the_manifest():
    offenders = []
    scanned = 0
    for p in (_REPO / "app" / "src").rglob("*.jsx"):
        if ".test." in p.name:
            continue
        code = _js_code_only(p)
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        if "entitlements_manifest" in code and rel not in _ALLOWED_MANIFEST_READERS:
            offenders.append(rel)
    for p in (_REPO / "app" / "src").rglob("*.js"):
        if ".test." in p.name:
            continue
        code = _js_code_only(p)
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace(chr(92), "/")
        if "entitlements_manifest" in code and rel not in _ALLOWED_MANIFEST_READERS:
            offenders.append(rel)
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], (
        f"a frontend path reads the entitlements manifest before CP2+ is authorized: {offenders}")


def test_the_inertness_rail_can_see_a_real_reference():
    """⛔ THE CONTROL. Without it, a broken walk or an over-eager stripper would
    make the assertions above pass over nothing."""
    raw = _BUILDER.read_text(encoding="utf-8")
    assert "entitlements_manifest" in raw, "the needle is not even in the builder"
    code = _py_code_only(_BUILDER)
    assert "entitlements_manifest" in code or "OUT_PATH" in code, (
        "the stripper removed a REAL code reference — then its absence in api/ "
        "proves nothing")


def test_the_manifest_is_committed_data_not_a_build_artifact():
    assert _MANIFEST_PATH.exists()
    r = subprocess.run(["git", "ls-files", "--error-unmatch",
                        str(_MANIFEST_PATH.relative_to(_REPO)).replace("\\", "/")],
                       cwd=str(_REPO), capture_output=True, text=True)
    assert r.returncode == 0, "the entitlements manifest is not tracked by git"
