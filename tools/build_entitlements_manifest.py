"""GATE-S9 CHECKPOINT 1 — the entitlement axis, enumerated. INERT DATA ONLY.

⛔ APPROVED SCOPE (owner, delegated to the running Claude Code session, 2026-09-19),
verbatim: "CP1 — the entitlement axis as INERT DATA + a duplication rail: every
site that answers 'may this member' enumerated from source, with FREE_PAGES'
three copies named. No gate changed."

⛔⛔ NOTHING IN `api/**` OR `app/src/**` READS WHAT THIS WRITES, AND THAT IS
ENFORCED. `tests/test_entitlements_manifest.py::test_no_product_path_reads_the_manifest`
walks every module and fails if one does. CP1 is the form written down; CP2+ is
the first reader, and per GATE-S9 it is NOT PROPOSABLE until OI-03(a) is answered.

⭐ THE FINDING THIS CORRECTS, MEASURED RATHER THAN QUOTED. GATE-S9 §2 (2026-09-13)
said "PAID_PLANS is already copied twice." Measured 2026-09-19: not on the PYTHON
side — one definition (`api/middleware/auth_middleware.py::PAID_PLANS`), many
importers, and its own comment already says "single source of truth — mirrored
by isPaid in AuthContext.jsx." Following that pointer is where the real finding
is: THREE independent JS re-implementations of the identical
`['pro','premium','lifetime'].includes(plan)` literal —
`context/AuthContext.jsx` (the canonical `isPaid`, which ALSO ORs in
`trial.active`), `pages/Login.jsx` (post-login routing, NO trial clause), and
`pages/Pricing.jsx` (`trulyPaid`, deliberately WITHOUT the trial clause — a
different, intentionally narrower predicate for pricing-page messaging, not a
drifted copy). `Login.jsx`'s omission looks like the OTHER kind: the same
predicate as `isPaid`, missing the term `isPaid` has, which reads as a member on
an active trial getting routed to `/morning-wire` instead of `/dashboard` right
after signing in. RECORDED HERE, NOT FIXED — CP1 changes no gate.

⭐⭐ AND SEPARATELY, `FREE_PAGES` IS THE FRONTEND'S OWN TRIPLICATION: hand-typed
identically in THREE files (AuthGuard.jsx, MoreSheet.jsx, NavBar.jsx), each
carrying a "keep in sync" comment pointing at the other two. Two different
"may this member" axes, two different duplication shapes, in the same packet's
one-line finding.

⛔ NOT ONE VALUE IS TYPED HERE. Every field below is read out of the source files
that already carry it.

Usage:
    python tools/build_entitlements_manifest.py            # write the file
    python tools/build_entitlements_manifest.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import ast
import json
import pathlib
import re
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

OUT_PATH = _ROOT / "api" / "data" / "entitlements_manifest.json"

SCHEMA_VERSION = 1

_AUTH_MIDDLEWARE = _ROOT / "api" / "middleware" / "auth_middleware.py"
_ENTITLEMENTS = _ROOT / "api" / "services" / "entitlements.py"

#: ⚰️ RETIRED 2026-09-19 — these three used to each hand-type their OWN
#: `FREE_PAGES` literal. Now they import the single source below; this list
#: is what `_free_pages_consumers()` verifies actually imports it, not what
#: independently defines a value.
_FREE_PAGES_SOURCE = _ROOT / "app" / "src" / "constants" / "freePages.js"
_FREE_PAGES_CONSUMERS = [
    _ROOT / "app" / "src" / "components" / "AuthGuard.jsx",
    _ROOT / "app" / "src" / "components" / "mobile" / "MoreSheet.jsx",
    _ROOT / "app" / "src" / "components" / "NavBar.jsx",
]

#: Every module under api/** that names one of these is a "may this member" call
#: site, whether or not it duplicates anything — CP1 counts the population, CP2+
#: (not proposable yet) is where consolidation would happen.
_GATE_NAMES = ("PAID_PLANS", "require_plan", "meets_plan_gate", "require_admin",
               "is_paid_user", "requires_voice_access", "require_paid")


def _strip_py_prose(path: pathlib.Path) -> str:
    """CODE, NEVER PROSE — every string-only Expr (docstrings) blanked before
    a literal search, so a comment explaining a gate name is never counted as a
    call site of it."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(ast.fix_missing_locations(tree))


def _paid_plans() -> list[str]:
    """`PAID_PLANS` read by AST, never retyped."""
    tree = ast.parse(_AUTH_MIDDLEWARE.read_text(encoding="utf-8"))
    for node in tree.body:
        if (isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "PAID_PLANS" for t in node.targets)):
            val = ast.literal_eval(node.value)
            assert isinstance(val, (set, frozenset)) and val, (
                "PAID_PLANS derivation found an empty or non-set value — the "
                "AST walk is broken, not the plan list")
            return sorted(val)
    raise AssertionError("PAID_PLANS not found in auth_middleware.py by AST — "
                          "the derivation is broken, not green")


def _toolkit_names() -> list[str]:
    """`TOOLKITS`' keys, read by AST. Only the names — the `Limits` values are a
    separate axis (HOW MUCH, not WHETHER) and are not this checkpoint's concern.

    ⛔ `TOOLKITS: Mapping[str, Limits] = MappingProxyType({...})` is an
    `AnnAssign` (the type hint), not a plain `Assign` — the first draft of this
    walk only matched `Assign` and found nothing, silently, until the empty-list
    assertion in `build()` caught it. Both forms are checked.
    """
    tree = ast.parse(_ENTITLEMENTS.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        target = None
        value = None
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "TOOLKITS" for t in node.targets):
            target, value = "TOOLKITS", node.value
        elif (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
                and node.target.id == "TOOLKITS" and node.value is not None):
            target, value = "TOOLKITS", node.value
        if target is None:
            continue
        # TOOLKITS = MappingProxyType({...}) — the dict is the sole call arg.
        assert isinstance(value, ast.Call) and value.args, (
            "TOOLKITS is not a MappingProxyType({...}) call — the shape moved")
        dict_node = value.args[0]
        assert isinstance(dict_node, ast.Dict), "TOOLKITS' argument is not a dict literal"
        names = [ast.literal_eval(k) for k in dict_node.keys]
        assert names, "TOOLKITS derived to zero names — the walk is broken, not the map"
        return names
    raise AssertionError("TOOLKITS not found in entitlements.py by AST")


#: `const FREE_PAGES = [...]` or `let/var FREE_PAGES = [...]`, single- or
#: double-quoted string entries, on one line (every current instance is).
_FREE_PAGES_RE = re.compile(
    r"(?:const|let|var)\s+FREE_PAGES\s*=\s*(\[[^\]]*\])", re.M)


def _strip_js_comments(text: str) -> str:
    """CODE, NEVER PROSE for the JS side too — `//` line comments blanked so a
    "keep in sync" comment naming FREE_PAGES cannot itself be mistaken for a
    second array by a naive scan."""
    return re.sub(r"//[^\n]*", "", text)


def _free_pages_value() -> list[str]:
    """The ONE array, from the ONE source. Since 2026-09-19 (S9 CP1 follow-up)
    `constants/freePages.js` is the sole definition."""
    code = _strip_js_comments(_FREE_PAGES_SOURCE.read_text(encoding="utf-8"))
    m = _FREE_PAGES_RE.search(code)
    assert m, "no FREE_PAGES array literal found in constants/freePages.js"
    values = json.loads(m.group(1).replace("'", '"'))
    assert isinstance(values, list) and values, "FREE_PAGES parsed empty"
    return values


#: A real ES import of the shared source — not a re-declaration. The relative
#: specifier differs per consumer's depth (`../constants/freePages` vs
#: `../../constants/freePages`), so this matches the tail common to both.
_FREE_PAGES_IMPORT_RE = re.compile(
    r"import\s*\{\s*FREE_PAGES\s*\}\s*from\s*['\"][./]*constants/freePages['\"]")


def _free_pages_consumer_entry(path: pathlib.Path) -> dict:
    code = _strip_js_comments(path.read_text(encoding="utf-8"))
    rel = str(path.relative_to(_ROOT)).replace("\\", "/")
    imports_shared = bool(_FREE_PAGES_IMPORT_RE.search(code))
    # ⛔ A LOCAL RE-DECLARATION WOULD BE THE OLD DEFECT BACK. If a consumer
    # ever hand-types `const FREE_PAGES = [...]` again instead of importing,
    # this must say so by name, not just "imports_shared: false".
    redeclares = bool(re.search(r"(?:const|let|var)\s+FREE_PAGES\s*=", code))
    m2 = re.search(r"FREE_PAGES\s*\.\s*(some|includes)\s*\(", code)
    semantics = "(undetermined)"
    if m2:
        window = code[m2.start():m2.start() + 80]
        if m2.group(1) == "includes":
            semantics = "exact (includes)"
        elif "startsWith" in window:
            semantics = "prefix (some+startsWith)"
        else:
            semantics = "some (unrecognised predicate)"
    return {"file": rel, "imports_shared_source": imports_shared,
            "redeclares_locally": redeclares, "match_semantics": semantics}


#: The literal every JS re-implementation of "is this plan paid" carries,
#: single- or double-quoted. THREE sites carried it at first measurement
#: (2026-09-19); Login.jsx's copy was retired the same day (fixed to read
#: `data.paid_equiv`, the backend's own answer, instead of re-deriving it —
#: closing the finding that a trial member could be routed to the free page
#: right after signing in). TWO remain by design: AuthContext.jsx (canonical)
#: and Pricing.jsx (deliberately narrower). A THIRD reappearing would be a NEW
#: copy this rail should catch, and the non-vacuity control below asserts the
#: count is not silently zero either.
_PAID_PLAN_LIST_RE = re.compile(
    r"\[\s*['\"]pro['\"]\s*,\s*['\"]premium['\"]\s*,\s*['\"]lifetime['\"]\s*\]"
    r"\s*\.\s*includes\s*\(")

_APP_SRC = _ROOT / "app" / "src"


def _paid_check_call_sites() -> list[dict]:
    """Every JS file re-implementing the paid-plan literal, with whether its
    surrounding expression also ORs in an active-trial check — the term
    `AuthContext.jsx::isPaid` (the canonical predicate) carries and the other
    two do not."""
    out = []
    for path in sorted(_APP_SRC.rglob("*.jsx")):
        if ".test." in path.name:
            continue
        code = _strip_js_comments(path.read_text(encoding="utf-8"))
        for m in _PAID_PLAN_LIST_RE.finditer(code):
            # ⛔ MEASURED, NOT GUESSED. A same-expression trailing `|| ...trial...`
            # clause (AuthContext.jsx) sits 16 chars past the match end; the
            # next, UNRELATED statement's `onTrial` (Pricing.jsx) sits 40 chars
            # past it. A window of +100 caught both and produced a false
            # positive on Pricing.jsx (caught by
            # test_the_trial_clause_finding_is_recorded_accurately) — +25 sits
            # strictly between the two, measured across all three known sites.
            window = code[m.end():m.end() + 25]
            has_trial_clause = "trial" in window.lower()
            rel = str(path.relative_to(_ROOT)).replace("\\", "/")
            out.append({"file": rel, "ors_in_trial_active": has_trial_clause})
    assert out, ("no JS site re-implements the paid-plan literal — the regex "
                 "missed, the population did not vanish")
    return out


def _gate_call_sites() -> dict:
    """Every module under api/** naming one of `_GATE_NAMES`, in CODE. Reported
    as a population per name — never asserted as a fixed count, the same
    "measure it, don't quote it" discipline the rest of this repo uses."""
    out: dict[str, list[str]] = {name: [] for name in _GATE_NAMES}
    for path in sorted((_ROOT / "api").rglob("*.py")):
        try:
            code = _strip_py_prose(path)
        except SyntaxError:  # pragma: no cover
            continue
        rel = str(path.relative_to(_ROOT)).replace("\\", "/")
        for name in _GATE_NAMES:
            if name in code:
                out[name].append(rel)
    return out


def build() -> dict:
    paid_plans = _paid_plans()
    toolkits = _toolkit_names()
    free_pages_value = _free_pages_value()
    free_pages_consumers = [_free_pages_consumer_entry(p) for p in _FREE_PAGES_CONSUMERS]
    paid_checks = _paid_check_call_sites()
    call_sites = _gate_call_sites()

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "tools/build_entitlements_manifest.py",
        "what_this_is": (
            "GATE-S9 CP1 — the entitlement axis, enumerated from source. Every "
            "value below is derived, none is typed here. No gate is read or "
            "changed by this file; CP2+ (the first reader) is NOT PROPOSABLE "
            "until OI-03(a)/OI-03(b)/OI-12 are answered by the owner."
        ),
        "who_may": {
            "paid_plans": {
                "source": "api/middleware/auth_middleware.py::PAID_PLANS",
                "values": paid_plans,
                "note": "single definition; every other module IMPORTS this one. "
                        "GATE-S9's own 2026-09-13 finding called this 'copied "
                        "twice' -- measured 2026-09-19, it is not. See free_pages "
                        "below for the duplication that is actually live.",
            },
            "toolkits": {
                "source": "api/services/entitlements.py::TOOLKITS",
                "names": toolkits,
                "note": "a DIFFERENT axis (how much, not whether) -- single "
                        "definition, not a duplicate of paid_plans.",
            },
        },
        "paid_plan_literal_MIRRORED_ACROSS_LANES": {
            "python_source": "api/middleware/auth_middleware.py::PAID_PLANS",
            "python_values": paid_plans,
            "js_call_sites": paid_checks,
            "note": "THE REAL SHAPE OF GATE-S9's 'PAID_PLANS is copied twice' "
                    "finding: not a second Python copy, but THREE independent "
                    "JS re-implementations of the same literal, found "
                    "2026-09-19. context/AuthContext.jsx (the canonical isPaid) "
                    "ORs in an active trial; pages/Pricing.jsx deliberately "
                    "does not (a narrower, intentionally-named trulyPaid "
                    "predicate for pricing-page messaging) -- both REMAIN, by "
                    "design, two different concepts. pages/Login.jsx's copy "
                    "was the third: same purpose as isPaid (ROUTING: paid -> "
                    "/dashboard, else -> /morning-wire), missing the term "
                    "isPaid has -- FIXED the same day, now reads "
                    "`data.paid_equiv` (the backend's own already-computed "
                    "answer) instead of re-deriving anything.",
        },
        "free_pages": {
            "source": "app/src/constants/freePages.js",
            "values": free_pages_value,
            "consumers": free_pages_consumers,
            "all_import_the_shared_source": all(
                c["imports_shared_source"] and not c["redeclares_locally"]
                for c in free_pages_consumers),
            "note": "RETIRED 2026-09-19 — was hand-typed identically in all "
                    "three consumers below (GATE-S9 §2's finding, against the "
                    "wrong variable name). Now ONE export, three importers. "
                    "match_semantics is DELIBERATELY NOT unified: AuthGuard.jsx "
                    "tests a live location.pathname (needs prefix/startsWith, "
                    "since a member could visit a nested sub-path); "
                    "MoreSheet.jsx/NavBar.jsx test one fixed NAV_ITEMS target "
                    "string (exact/includes is correct there, never a bug to "
                    "converge). Only the VALUE was ever actually duplicated.",
        },
        "gate_call_sites": {
            "source": "api/**/*.py, CODE only (docstrings/comments stripped)",
            "population": {name: sites for name, sites in call_sites.items()},
            "note": "a population, not a duplication finding by itself -- CP2+ "
                    "is where an owner-informed consolidation would use this "
                    "inventory. Reported so it exists BEFORE that answer, not "
                    "assembled by hand at that point.",
        },
    }


def _dumps(manifest: dict) -> str:
    return json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the checked-in manifest is not what this derives")
    args = ap.parse_args(argv)

    manifest = build()
    text = _dumps(manifest)

    if args.check:
        if not OUT_PATH.exists():
            print("[entitlements-manifest] MISSING: %s" % OUT_PATH)
            return 1
        current = OUT_PATH.read_text(encoding="utf-8")
        if current != text:
            print("[entitlements-manifest] STALE — the checked-in manifest is not "
                  "what the declarations derive. Re-run without --check.")
            return 1
        print("[entitlements-manifest] OK — free_pages consumers all import "
              "the shared source: %s"
              % manifest["free_pages"]["all_import_the_shared_source"])
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print("[entitlements-manifest] wrote %s" % OUT_PATH)
    print("[entitlements-manifest] free_pages consumers all import the "
          "shared source: %s"
          % manifest["free_pages"]["all_import_the_shared_source"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
