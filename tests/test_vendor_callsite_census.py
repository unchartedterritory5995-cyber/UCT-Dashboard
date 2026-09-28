"""TERM-022 (FB-D1-01) -- the retirement queue behind the Massive adapter.

`tools/vendor_callsite_census.py` DERIVES every vendor reach under `api/` that
does not go through that vendor's adapter, per provider and per file. The
checked-in `tools/vendor_callsite_baseline.json` is a RATCHET over that census:

  * a (provider, file) count may never GROW, and a new file may never APPEAR --
    red BY NAME, which is acceptance criterion (a): "a new module cannot reach
    the vendor except through the adapter, proved by a rail with a control";
  * a count that SHRANK must be written down in the same change -- red by name
    as "slack", so the ratchet clicks and a migrated site cannot quietly regrow
    into the room it left.

Every control below plants its needle in a temp tree, and every needle is
built by CONCATENATION so this file is not itself a vendor reach to any grep.
"""
from __future__ import annotations

import json
import os
import tempfile
import textwrap

import pytest

from tools import massive_guard_census as literal_census
from tools import vendor_callsite_census as cen

BASE = cen.repo_root()

_MASSIVE_HOST = "api." + "massive" + ".com"
_FMP_HOST = "financialmodeling" + "prep.com"
_MASSIVE_KEY_ENV = "MASSIVE" + "_API_KEY"


def _tree(files: dict[str, str]) -> str:
    tmp = tempfile.mkdtemp(prefix="term022-census-")
    for rel, src in files.items():
        full = os.path.join(tmp, *rel.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(textwrap.dedent(src))
    return tmp


def _hits(files: dict[str, str]):
    return cen.census(_tree(files))


# ═════════════════════════════════════════════════════════════════════════
# THE RAIL -- the real tree against the ratchet, by name
# ═════════════════════════════════════════════════════════════════════════

def test_the_real_tree_matches_the_ratchet_exactly():
    counts = cen.counts(cen.census(BASE))
    baseline = cen.load_baseline(BASE)
    grew, new, slack = cen.compare(counts, baseline)
    assert new == [], (
        "a NEW file reaches a vendor outside its adapter -- route it through the "
        f"adapter (api/services/massive_adapter.py for Massive): {new}")
    assert grew == [], (
        f"a vendor reach GREW outside its adapter (provider, file, baseline, now): {grew}")
    assert slack == [], (
        "the retirement queue shrank -- click the ratchet down in the SAME change: "
        f"`python tools/vendor_callsite_census.py --write-baseline` (it refuses to raise): {slack}")


def test_the_census_is_not_blind_on_the_real_tree():
    """0 findings could mean the instrument stopped working. The real tree has a
    known, large Massive queue; the census must see it -- including every file the
    older literal-only census (`tools/massive_guard_census.py`) quarantines."""
    counts = cen.counts(cen.census(BASE))
    massive = counts.get("massive", {})
    assert sum(massive.values()) >= 50, massive
    missing = sorted(p for p in literal_census.QUARANTINE if massive.get(p, 0) == 0)
    assert missing == [], f"the literal census quarantines these but this census sees nothing: {missing}"


def test_the_census_sees_what_the_literal_census_is_blind_to():
    """The finding this ticket measured: a module that builds its URL from
    `massive._REST_BASE` and `client._api_key` contains no vendor literal, so the
    literal-only census reports it CLEAN. `bars_fetch.py` is the live example."""
    literal_paths = {h.path for h in literal_census.census(BASE)} | set(literal_census.QUARANTINE)
    counts = cen.counts(cen.census(BASE))
    assert counts["massive"].get("api/services/bars_fetch.py", 0) > 0
    assert "api/services/bars_fetch.py" not in literal_paths


def test_the_baseline_is_not_empty_and_is_well_formed():
    b = cen.load_baseline(BASE)
    assert set(b) <= set(cen.PROVIDERS), set(b) - set(cen.PROVIDERS)
    assert b.get("massive"), "the Massive queue cannot be empty today"
    for prov, files in b.items():
        for path, n in files.items():
            assert isinstance(n, int) and n > 0, (prov, path, n)
            assert path not in cen.PARTNER_OWNED, f"partner-owned file in the ratchet: {path}"


# ═════════════════════════════════════════════════════════════════════════
# CONTROLS -- a planted reach MUST be reported by name, prose must not be
# ═════════════════════════════════════════════════════════════════════════

def test_CONTROL_a_planted_vendor_url_in_a_new_module_is_reported_by_name():
    hits = _hits({"api/services/sneaky.py": f'''
        import httpx
        def fetch(sym):
            return httpx.get(f"https://{_MASSIVE_HOST}/v2/snapshot/{{sym}}")
        '''})
    assert [(h.provider, h.path, h.kind, h.line) for h in hits] == [
        ("massive", "api/services/sneaky.py", "url", 4)]


def test_CONTROL_a_private_reach_into_the_massive_client_is_reported():
    hits = _hits({"api/services/sneaky2.py": '''
        from api.services import massive as _m
        def fetch():
            c = _m._get_client()
            return c._get(f"{_m._REST_BASE}/v3/x?apiKey={c._api_key}")
        '''})
    kinds = sorted((h.provider, h.kind, h.detail) for h in hits)
    assert kinds == [("massive", "private", "_REST_BASE"), ("massive", "private", "_api_key")], kinds


def test_CONTROL_a_bare_imported_private_name_is_reported_at_each_use():
    hits = _hits({"api/services/sneaky3.py": '''
        from api.services.massive import _REST_BASE, to_polygon_symbol
        A = _REST_BASE + "/v2/a"
        B = _REST_BASE + "/v2/b"
        '''})
    assert [(h.kind, h.detail, h.line) for h in hits] == [
        ("private", "_REST_BASE", 3), ("private", "_REST_BASE", 4)]


def test_CONTROL_api_key_attr_is_only_a_massive_reach_in_a_module_that_imports_massive():
    other = _hits({"api/services/other_vendor.py": '''
        class C:
            def __init__(self):
                self._api_key = "x"
        '''})
    assert other == []


def test_CONTROL_prose_never_counts_but_the_same_text_in_code_does():
    prose = _hits({"api/services/prose.py": f'''
        """This module used to call https://{_MASSIVE_HOST}/v2/x directly."""
        # https://{_MASSIVE_HOST}/v3/y -- retired
        def f():
            """Formerly https://{_MASSIVE_HOST}/v3/z."""
            return 1
        '''})
    assert prose == []
    code = _hits({"api/services/code.py": f'''
        def f():
            """Formerly https://{_MASSIVE_HOST}/v3/z."""
            return "https://{_MASSIVE_HOST}/v3/z"
        '''})
    assert [(h.kind, h.line) for h in code] == [("url", 4)]


def test_CONTROL_an_fstring_counts_once_not_per_ast_node():
    hits = _hits({"api/services/one.py": f'''
        def f(s):
            return f"https://{_MASSIVE_HOST}/x/{{s}}"
        '''})
    assert len(hits) == 1


def test_CONTROL_a_credential_env_name_counts_only_as_an_exact_literal():
    hits = _hits({"api/services/cred.py": f'''
        import os
        K = os.environ.get("{_MASSIVE_KEY_ENV}", "")
        MSG = "set {_MASSIVE_KEY_ENV} before running"
        '''})
    assert [(h.provider, h.kind, h.line) for h in hits] == [("massive", "credential", 3)]


def test_CONTROL_every_provider_is_detected():
    hits = _hits({
        "api/services/a.py": f'U = "https://{_FMP_HOST}/stable/quote"\n',
        "api/services/b.py": "import yfinance as yf\n",
        "api/services/c.py": "def _fmp_get_thing(p):\n    return None\n",
        "api/services/d.py": 'U = "https://api.' + 'polygon.io/v2/x"\n',
        "api/services/e.py": 'U = "https://nfs.' + 'faireconomy.media/ff_calendar_thisweek.json"\n',
        "api/services/f.py": 'U = "https://www.' + 'alphavantage.co/query"\n',
        "api/services/g.py": 'U = "https://' + 'finnhub.io/api/v1/quote"\n',
        "api/services/h.py": 'U = "https://api.' + 'bullflow.io/v1/x"\n',
    })
    got = sorted((h.path.rsplit("/", 1)[1], h.provider, h.kind) for h in hits)
    assert got == [
        ("a.py", "fmp", "url"), ("b.py", "yfinance", "sdk"), ("c.py", "fmp", "helper_def"),
        ("d.py", "polygon_direct", "url"), ("e.py", "forexfactory", "url"),
        ("f.py", "alphavantage", "url"), ("g.py", "finnhub", "url"), ("h.py", "bullflow", "url"),
    ]


def test_CONTROL_the_adapter_is_exempt_but_its_legacy_untyped_transport_is_counted():
    """Inside `massive.py` a vendor literal is the adapter's job -- but a
    never-raise `._get(url)` there is an UNSTAMPED legacy read, and the queue
    must see those too, or 'retired' could mean 'moved into the adapter file'."""
    hits = _hits({
        "api/services/massive.py": f'''
            _REST_BASE = "https://{_MASSIVE_HOST}"
            class _MassiveRestClient:
                def _get(self, url):
                    return {{}}
                def legacy(self):
                    return self._get(f"{{_REST_BASE}}/v2/x?apiKey={{self._api_key}}")
            ''',
        "api/services/massive_adapter.py": f'B = "https://{_MASSIVE_HOST}"\n',
    })
    assert [(h.path, h.kind, h.detail) for h in hits] == [
        ("api/services/massive.py", "legacy_transport", "_get")]


def test_CONTROL_test_files_are_excluded():
    assert _hits({"api/services/test_x.py": f'U = "https://{_MASSIVE_HOST}/x"\n'}) == []


def test_CONTROL_partner_owned_files_are_reported_but_never_ratcheted():
    tree = _tree({"api/massive_ws_worker.py": f'U = "wss://{_MASSIVE_HOST}/x"\n'})
    hits = cen.census(tree)
    assert [h.path for h in hits] == ["api/massive_ws_worker.py"]
    assert cen.counts(hits) == {}
    assert cen.partner_counts(hits) == {"massive": {"api/massive_ws_worker.py": 1}}


# ═════════════════════════════════════════════════════════════════════════
# THE RATCHET'S OWN MECHANICS
# ═════════════════════════════════════════════════════════════════════════

def test_compare_names_growth_new_files_and_slack():
    baseline = {"massive": {"a.py": 3, "b.py": 2}}
    now = {"massive": {"a.py": 4, "b.py": 1, "c.py": 1}}
    grew, new, slack = cen.compare(now, baseline)
    assert grew == [("massive", "a.py", 3, 4)]
    assert new == [("massive", "c.py", 0, 1)]
    assert slack == [("massive", "b.py", 2, 1)]
    assert cen.compare(baseline, baseline) == ([], [], [])


def test_write_baseline_only_ever_lowers(tmp_path):
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"schema": 1, "counts": {"massive": {"a.py": 3, "b.py": 2}}}),
                    encoding="utf-8")
    ok, msg = cen.write_baseline({"massive": {"a.py": 2}}, str(path))
    assert ok, msg
    assert json.loads(path.read_text(encoding="utf-8"))["counts"] == {"massive": {"a.py": 2}}
    refused, msg = cen.write_baseline({"massive": {"a.py": 3}}, str(path))
    assert not refused and "a.py" in msg
    assert json.loads(path.read_text(encoding="utf-8"))["counts"] == {"massive": {"a.py": 2}}
    refused, msg = cen.write_baseline({"massive": {"a.py": 2, "z.py": 1}}, str(path))
    assert not refused and "z.py" in msg


def test_ratchet_regressions_catch_a_hand_raised_baseline():
    """Raising the JSON by hand is the one way past `write_baseline`; the
    `--ratchet-against <ref>` check compares against an older baseline."""
    old = {"massive": {"a.py": 2}, "fmp": {"x.py": 1}}
    new = {"massive": {"a.py": 3, "n.py": 1}}
    assert cen.ratchet_regressions(old, new) == [
        ("massive", "a.py", 2, 3), ("massive", "n.py", 0, 1)]
    assert cen.ratchet_regressions(old, {"massive": {"a.py": 1}}) == []
