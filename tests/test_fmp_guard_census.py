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
        # 2026-09-11 (W1-A): `api/routers/calendar.py` and
        # `api/services/econ_calendar_fmp.py` REMOVED — both are fully
        # migrated onto fmp_client and measure zero violations, so their
        # entries were suppressing the rail rather than tracking debt.
        # See `test_retired_quarantine_entries_are_genuinely_clean` below.
        "api/routers/earnings.py",
        "api/services/bars_fetch.py",
        "api/services/calendar_alerts.py",
        "api/services/catalyst/sources.py",
        "api/services/implied_store.py",
        "api/services/index_constituents.py",
        "api/services/screener/fundamentals_bulk.py",
        "api/services/ticker_logos.py",
        "api/services/engine.py",
        # ⛔ ADDED 2026-09-12 by the G5 ruling. ⭐ Unlike every other entry here,
        # this one is NOT migration debt — it is a deliberate architectural
        # exemption: fmp_news absorbs transient failure and owns a PER-RUN
        # request budget; the adapter fails fast with a GLOBAL token bucket.
        # Retiring it would mean changing that contract, not finishing a
        # migration. The reason lives in tools/fmp_guard_census.py's QUARANTINE.
        "api/services/news/adapters/fmp_news.py",
        "api/services/earnings_estimates.py",
    }
    # Every entry must carry a real, non-empty reason -- an exemption with no
    # stated "why" is indistinguishable from a silently-added skip.
    for path, why in census_mod.QUARANTINE.items():
        assert why.strip(), f"QUARANTINE entry {path!r} has no reason recorded"


def test_retired_quarantine_entries_are_genuinely_clean():
    """The justification for un-quarantining these two, asserted rather than
    asserted-in-prose: each was exempted by the 10-file addendum and has
    since been fully migrated onto `fmp_client`, so each must now measure
    ZERO violations on its own. If a direct FMP call is ever re-added to
    either, this fails BY NAME and says which file — the thing the stale
    exemption was silently preventing."""
    base = census_mod.repo_root()
    retired = ("api/routers/calendar.py", "api/services/econ_calendar_fmp.py")
    for path in retired:
        assert path not in census_mod.QUARANTINE, (
            f"{path} was re-quarantined without updating this test")
    urls, defs = census_mod.census(base)
    offenders = [h for h in urls if h.path in retired]
    offender_defs = [h for h in defs if h.path in retired]
    assert offenders == [], f"retired-from-quarantine file has a URL literal again: {offenders}"
    assert offender_defs == [], f"retired-from-quarantine file has an _fmp_get-shaped def again: {offender_defs}"


def test_no_quarantine_entry_is_stale():
    """A quarantine entry for a file that has NO violation is not tracked
    debt — it is a rail suppressed for a file that is already clean, which
    is how `api/routers/calendar.py` and `api/services/econ_calendar_fmp.py`
    sat un-guarded after their own migrations landed. Measured by running
    the census with QUARANTINE emptied and checking every exempted path
    actually still has something to exempt."""
    base = census_mod.repo_root()
    saved = dict(census_mod.QUARANTINE)
    try:
        census_mod.QUARANTINE.clear()
        urls, defs = census_mod.census(base)
    finally:
        census_mod.QUARANTINE.clear()
        census_mod.QUARANTINE.update(saved)
    violating = {h.path for h in urls} | {h.path for h in defs}
    stale = sorted(p for p in saved if p not in violating)
    assert stale == [], (
        f"QUARANTINE entries with no actual violation (migrate-then-forget "
        f"leftovers suppressing the rail): {stale}")


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
