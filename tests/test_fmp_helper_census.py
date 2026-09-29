"""TERM-072 (FB-A3-01) -- the private-FMP-helper census and its shrink-only ratchet.

`tools/fmp_helper_census.py` counts, by AST, every reach to the legacy shared
helper `earnings_estimates._fmp_get` and every reach into `fmp_client`'s private
transport from outside the adapter. `REMAINING` in that file is the allowed set,
each entry with its reason. This file holds the rail (the real tree must EQUAL
it), controls proving a planted reach is reported BY NAME while prose is not,
and the ratchet's own mechanics.

Every planted needle lives in a temp tree, never under the real `api/`.
"""
from __future__ import annotations

import ast
import os
import tempfile
import textwrap

from tools import fmp_helper_census as cen

BASE = cen.repo_root()

# A minimal stand-in adapter for the planted trees: two privates and a public.
_STUB_ADAPTER = '_BASE_URL = "x"\n_session = None\ndef _get_raw(p, q):\n    return None\ndef get_quote(t):\n    return None\n'


def _tree(files: dict[str, str]) -> str:
    tmp = tempfile.mkdtemp(prefix="term072-census-")
    files = {cen.ADAPTER_FILE: _STUB_ADAPTER, **files}
    for rel, src in files.items():
        full = os.path.join(tmp, *rel.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(textwrap.dedent(src))
    return tmp


def _hits(files: dict[str, str]):
    return [(h.path, h.kind, h.detail, h.line) for h in cen.census(_tree(files))]


# ═════════════════════════════════════════════════════════════════════════
# THE RAIL -- the real tree against the ratchet, by name
# ═════════════════════════════════════════════════════════════════════════

def test_the_real_tree_matches_the_ratchet_exactly():
    now = cen.counts(cen.census(BASE))
    grew, new, slack = cen.compare(now, cen.allowed_counts())
    assert new == [], (
        "a NEW module reaches FMP through a private helper -- call the typed "
        f"function in api/services/fmp_client.py instead (file, allowed, now): {new}")
    assert grew == [], (
        f"a private-FMP-helper reach GREW (file, allowed, now): {grew}")
    assert slack == [], (
        "the private-helper queue shrank -- lower (or delete) the entry in "
        f"tools/fmp_helper_census.py REMAINING in the SAME change: {slack}")


def test_the_census_is_not_blind_on_the_real_tree():
    """Zero findings could mean the instrument stopped working. Name a member
    that is guaranteed to still be there: `bars_sanitize.py` is excluded from
    migration BY OWNER RULING, so its reaches cannot legitimately disappear."""
    now = cen.counts(cen.census(BASE))
    assert now.get("api/services/bars_sanitize.py", 0) >= 1, now


def test_every_remaining_entry_carries_a_reason():
    for path, (n, why) in cen.REMAINING.items():
        assert isinstance(n, int) and n > 0, (path, n)
        assert len(why.strip()) > 20, f"{path}: an exemption with no stated why is a silent skip"
        assert os.path.exists(os.path.join(BASE, *path.split("/"))), f"{path} does not exist"


def test_the_helper_definition_still_exists_while_consumers_remain():
    """The allowance is only coherent while the helper it allows reaches to is
    defined. If `_fmp_get` is ever deleted, REMAINING must be emptied with it."""
    with open(os.path.join(BASE, *cen.HELPER_FILE.split("/")), encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    defined = any(isinstance(n, ast.FunctionDef) and n.name == cen.HELPER_NAME for n in tree.body)
    assert defined == bool(cen.REMAINING)


def test_the_adapter_private_set_is_derived_and_names_the_transport():
    privates = cen.adapter_private_names(BASE)
    assert {"_get_raw", "_fetch", "_session", "_BASE_URL"} <= privates, sorted(privates)
    assert "get_quote" not in privates and "body_or_none" not in privates


def test_every_body_or_none_call_names_its_timeout():
    """Launch-hardening: every external call carries a timeout. `body_or_none`
    makes `timeout` keyword-only and REQUIRED, and this reads the call sites so
    a site cannot drift to an inherited default through some other wrapper."""
    sites, unnamed = [], []
    for root, _dirs, files in os.walk(os.path.join(BASE, "api")):
        for fn in files:
            if not fn.endswith(".py") or fn.startswith("test_"):
                continue
            path = os.path.join(root, fn)
            rel = os.path.relpath(path, BASE).replace("\\", "/")
            with open(path, encoding="utf-8") as fh:
                tree = ast.parse(fh.read())
            for node in ast.walk(tree):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == "body_or_none"):
                    sites.append(rel)
                    if not any(k.arg == "timeout" for k in node.keywords):
                        unnamed.append((rel, node.lineno))
    # Non-vacuity by NAME, not by count: a migrated module that must be in the scan.
    assert "api/services/analyst_intel.py" in sites, sorted(set(sites))
    assert unnamed == [], f"body_or_none without a named timeout: {unnamed}"


# ═════════════════════════════════════════════════════════════════════════
# CONTROLS -- a planted reach is reported by name; prose is not
# ═════════════════════════════════════════════════════════════════════════

def test_CONTROL_a_planted_call_through_the_module_is_reported():
    assert _hits({"api/services/sneaky.py": '''
        from api.services import earnings_estimates as ee
        def fetch(sym):
            return ee._fmp_get("/stable/profile", {"symbol": sym}, timeout=10)
        '''}) == [("api/services/sneaky.py", "legacy_helper", "._fmp_get", 4)]


def test_CONTROL_an_import_and_a_passed_reference_are_both_reported():
    got = _hits({"api/services/sneaky2.py": '''
        from concurrent.futures import ThreadPoolExecutor
        from api.services.earnings_estimates import _fmp_get
        def fetch(ex):
            return ex.submit(_fmp_get, "/stable/news/stock", {}, timeout=12)
        '''})
    assert [(k, d) for _p, k, d, _l in got] == [
        ("legacy_helper", "import _fmp_get"), ("legacy_helper", "_fmp_get")]


def test_CONTROL_a_getattr_by_string_is_reported():
    got = _hits({"api/services/sneaky3.py": '''
        from api.services import earnings_estimates as ee
        GET = getattr(ee, "_fmp_get")
        '''})
    assert [(k, d) for _p, k, d, _l in got] == [("legacy_helper", "'_fmp_get'")]


def test_CONTROL_a_reach_into_the_adapter_transport_is_reported_both_ways():
    got = _hits({
        "api/services/sneaky4.py": '''
            from api.services import fmp_client as fc
            import requests
            def fetch(p):
                return requests.get(fc._BASE_URL + p)
            ''',
        "api/services/sneaky5.py": '''
            from api.services.fmp_client import _get_raw
            def fetch(p):
                return _get_raw(p, {})
            ''',
    })
    assert sorted((p, k, d) for p, k, d, _l in got) == [
        ("api/services/sneaky4.py", "private_transport", "_BASE_URL"),
        ("api/services/sneaky5.py", "private_transport", "_get_raw"),
    ]


def test_CONTROL_the_public_typed_surface_is_not_a_reach():
    assert _hits({"api/services/fine.py": '''
        from api.services import fmp_client
        def fetch(sym):
            return fmp_client.body_or_none(fmp_client.get_quote, sym, timeout=10)
        '''}) == []


def test_CONTROL_prose_never_counts_but_the_same_name_in_code_does():
    prose = _hits({"api/services/prose.py": '''
        """This module used to call earnings_estimates._fmp_get directly."""
        # ee._fmp_get("/stable/profile") -- retired
        def f():
            """Formerly `_fmp_get`."""
            return 1
        '''})
    assert prose == []
    assert _hits({"api/services/code.py": '''
        def f(ee):
            """Formerly `_fmp_get`."""
            return ee._fmp_get
        '''}) == [("api/services/code.py", "legacy_helper", "._fmp_get", 4)]


def test_CONTROL_the_adapter_and_test_files_are_exempt():
    assert _hits({
        "api/services/test_x.py": "from api.services.earnings_estimates import _fmp_get\n",
        "api/services/y_test.py": "from api.services.fmp_client import _get_raw\n",
    }) == []
    # the adapter itself may name its own privates freely
    assert _hits({cen.ADAPTER_FILE: _STUB_ADAPTER + "X = _get_raw\n"}) == []


def test_CONTROL_an_unrelated_private_attribute_is_not_a_transport_reach():
    """`_session` on some other object is not fmp_client's session: only a name
    bound to the adapter MODULE counts."""
    assert _hits({"api/services/other.py": '''
        from api.services import fmp_client
        class C:
            def __init__(self):
                self._session = None
            def go(self):
                return self._session
        '''}) == []


# ═════════════════════════════════════════════════════════════════════════
# THE RATCHET'S OWN MECHANICS
# ═════════════════════════════════════════════════════════════════════════

def test_compare_names_growth_new_files_and_slack():
    allowed = {"a.py": 3, "b.py": 2}
    now = {"a.py": 4, "b.py": 1, "c.py": 1}
    grew, new, slack = cen.compare(now, allowed)
    assert grew == [("a.py", 3, 4)]
    assert new == [("c.py", 0, 1)]
    assert slack == [("b.py", 2, 1)]
    assert cen.compare(allowed, allowed) == ([], [], [])
    # a file that dropped to zero is slack, never silently fine
    assert cen.compare({}, {"a.py": 1}) == ([], [], [("a.py", 1, 0)])
