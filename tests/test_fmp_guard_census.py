"""Positive-control tests for `tools/fmp_guard_census.py`, per provider-
abstraction-spec.md §21.1's own discipline (adopted from
`test_yf_guard_census.py`): "0 findings could just mean the census stopped
working" — a planted bypass must be reported BY NAME before the rail is
trusted, and its inverse (a clean tree reports 0) must also hold.
"""
from __future__ import annotations

import os
import tempfile

from tools import fmp_guard_census as census_mod


# ── The real rail: the actual repo must currently be clean ──────────────────

def test_real_repo_has_zero_unquarantined_violations():
    """The actual acceptance-criterion-1 rail: no financialmodelingprep.com
    literal and no _fmp_get-shaped def outside fmp_client.py, except the
    named, tracked QUARANTINE entries."""
    base = census_mod.repo_root()
    urls, defs = census_mod.census(base)
    assert urls == [], f"unquarantined URL-literal hits: {urls}"
    assert defs == [], f"unquarantined _fmp_get-shaped defs: {defs}"


def test_quarantine_is_the_exact_pinned_set():
    """The QUARANTINE list must not silently grow (or shrink without this
    test being updated) — a mutation-check on the exemption list itself,
    the thing that would make an over-broad QUARANTINE entry invisible."""
    assert set(census_mod.QUARANTINE.keys()) == {
        "api/routers/calendar.py",
        "api/routers/earnings.py",
        "api/services/bars_fetch.py",
        "api/services/calendar_alerts.py",
        "api/services/catalyst/sources.py",
        "api/services/econ_calendar_fmp.py",
        "api/services/implied_store.py",
        "api/services/index_constituents.py",
        "api/services/screener/fundamentals_bulk.py",
        "api/services/ticker_logos.py",
        "api/services/engine.py",
        "api/services/earnings_estimates.py",
    }
    # Every entry must carry a real, non-empty reason -- an exemption with no
    # stated "why" is indistinguishable from a silently-added skip.
    for path, why in census_mod.QUARANTINE.items():
        assert why.strip(), f"QUARANTINE entry {path!r} has no reason recorded"


# ── Positive control: a planted violation MUST be reported by name ─────────

def test_planted_url_literal_is_reported_by_name():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "sneaky_direct_call.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write(
                'import requests\n'
                'def fetch(sym):\n'
                '    url = f"https://financialmodelingprep.com/stable/quote?symbol={sym}"\n'
                '    return requests.get(url)\n'
            )
        urls, defs = census_mod.census(tmp)
        assert defs == []
        assert len(urls) == 1
        hit = urls[0]
        assert hit.path == "api/services/sneaky_direct_call.py"
        assert hit.line == 3


def test_planted_helper_def_is_reported_by_name():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "sneaky_helper.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write(
                'def _fmp_get_something(path, params):\n'
                '    return None\n'
            )
        urls, defs = census_mod.census(tmp)
        assert urls == []
        assert len(defs) == 1
        hit = defs[0]
        assert hit.path == "api/services/sneaky_helper.py"
        assert hit.name == "_fmp_get_something"


def test_bare_fmp_get_name_also_caught():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "another_sneaky.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write('def _fmp_get(path, params):\n    return None\n')
        _, defs = census_mod.census(tmp)
        assert len(defs) == 1
        assert defs[0].name == "_fmp_get"


# ── The inverse: fmp_client.py itself is never flagged for its own literals ─

def test_the_adapter_file_itself_is_excluded():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        adapter_path = os.path.join(api_dir, "fmp_client.py")
        with open(adapter_path, "w", encoding="utf-8") as f:
            f.write(
                '_BASE_URL = "https://financialmodelingprep.com"\n'
                'def get_quote(ticker):\n'
                '    pass\n'
            )
        urls, defs = census_mod.census(tmp)
        assert urls == []
        assert defs == []


def test_a_quarantined_path_is_silently_skipped_not_reported():
    """A file whose relpath is IN QUARANTINE must never show up in the
    census output, even though it genuinely contains a violation — that's
    the whole point of the mechanism (tracked debt, not a broken rail)."""
    with tempfile.TemporaryDirectory() as tmp:
        # Reuse a real quarantined path so we don't have to monkeypatch the
        # module-level QUARANTINE dict.
        real_quarantined = next(iter(census_mod.QUARANTINE.keys()))
        full = os.path.join(tmp, *real_quarantined.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write('URL = "https://financialmodelingprep.com/stable/whatever"\n')
        urls, defs = census_mod.census(tmp)
        assert urls == [] and defs == []


def test_test_files_are_excluded_by_default():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        test_path = os.path.join(api_dir, "test_something_fmp.py")
        with open(test_path, "w", encoding="utf-8") as f:
            f.write('URL = "https://financialmodelingprep.com/stable/quote"\n')
        urls, defs = census_mod.census(tmp)
        assert urls == []
        urls_incl, _ = census_mod.census(tmp, include_tests=True)
        assert len(urls_incl) == 1
