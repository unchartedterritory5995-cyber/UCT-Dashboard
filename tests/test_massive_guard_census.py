"""Positive-control tests for `tools/massive_guard_census.py`, mirroring
`test_fmp_guard_census.py`'s discipline — see that file's docstring.
"""
from __future__ import annotations

import os
import tempfile

from tools import massive_guard_census as census_mod


def test_real_repo_has_zero_unexempted_violations():
    base = census_mod.repo_root()
    hits = census_mod.census(base)
    assert hits == [], f"unexempted api.massive.com hits: {hits}"


def test_partner_exempt_is_the_exact_pinned_two_files():
    """Permanent, by-name exemption — never expected to shrink, and must
    never silently grow either (that would be how a THIRD file quietly
    stops being censused)."""
    assert set(census_mod.PARTNER_EXEMPT.keys()) == {
        "api/massive_ws_worker.py",
        "api/massive_processor.py",
    }
    for path, why in census_mod.PARTNER_EXEMPT.items():
        assert why.strip()


def test_quarantine_is_the_exact_pinned_set():
    assert set(census_mod.QUARANTINE.keys()) == {
        "api/backfill_rest.py",
        "api/darkpool_massive_ingest.py",
        "api/flow_rest_backfill.py",
        "api/massive_oi_snapshots.py",
        "api/oi_massive_snapshots.py",
        "api/oi_morning.py",
        "api/oi_snapshot_router.py",
        "api/routers/live_prices.py",
        "api/services/audit.py",
        "api/services/breadth_dividends.py",
        "api/services/etf_holdings.py",
        "api/services/polygon_extras.py",
        "api/services/polygon_news.py",
        "api/services/polygon_options.py",
        "api/services/trade_conditions.py",
        "api/services/watchlist_prebuilt_refresh.py",
        "api/ticker_types.py",
    }
    for path, why in census_mod.QUARANTINE.items():
        assert why.strip(), f"QUARANTINE entry {path!r} has no reason recorded"


def test_planted_url_literal_is_reported_by_name():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "sneaky_direct_call.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write(
                'import httpx\n'
                'def fetch(sym):\n'
                '    url = f"https://api.massive.com/v2/snapshot/{sym}"\n'
                '    return httpx.get(url)\n'
            )
        hits = census_mod.census(tmp)
        assert len(hits) == 1
        assert hits[0].path == "api/services/sneaky_direct_call.py"
        assert hits[0].line == 3


def test_planted_partner_owned_violation_is_silently_exempted():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "massive_ws_worker.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write('URL = "wss://api.massive.com/stocks"\n')
        hits = census_mod.census(tmp)
        assert hits == []


def test_planted_quarantined_violation_is_silently_exempted():
    with tempfile.TemporaryDirectory() as tmp:
        real_quarantined = next(iter(census_mod.QUARANTINE.keys()))
        full = os.path.join(tmp, *real_quarantined.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write('URL = "https://api.massive.com/v2/whatever"\n')
        hits = census_mod.census(tmp)
        assert hits == []


def test_the_adapter_file_itself_is_excluded():
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        adapter_path = os.path.join(api_dir, "massive.py")
        with open(adapter_path, "w", encoding="utf-8") as f:
            f.write('_REST_BASE = "https://api.massive.com"\n')
        hits = census_mod.census(tmp)
        assert hits == []


def test_no_double_count_for_a_planted_fstring():
    """The exact bug fmp_guard_census.py's own test caught: ast.walk visits
    a JoinedStr AND its child Constant, so a naive rule reports one f-string
    twice."""
    with tempfile.TemporaryDirectory() as tmp:
        api_dir = os.path.join(tmp, "api", "services")
        os.makedirs(api_dir)
        bad_path = os.path.join(api_dir, "one_fstring.py")
        with open(bad_path, "w", encoding="utf-8") as f:
            f.write('def f(sym):\n    return f"https://api.massive.com/x/{sym}"\n')
        hits = census_mod.census(tmp)
        assert len(hits) == 1
