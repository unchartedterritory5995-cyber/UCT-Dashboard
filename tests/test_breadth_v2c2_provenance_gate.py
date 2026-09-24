"""ARTIFACT PROVENANCE GATE — design rails. NOT merged, NOT deployed.

A pass artifact is merged only if it declares the V2c2 dividend-basis methodology, the
canonical dividend basis and its dividend input. The frozen split-only V2c / V1 / original V2
share V2c2's `source` names; the precedence list alone would adopt them."""
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as bridge
from tests.test_breadth_v2_merge_precedence import _make_snap, fresh_store  # noqa: F401

M = "pct_above_50sma"
ROWS = [("us", "2026-03-20", M, 30.0, 31.0, 29.0, 30.0, "intraday_recon_1m")]


def _with_meta(path, **meta):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE pass_meta(key TEXT PRIMARY KEY, value TEXT)")
    c.executemany("INSERT INTO pass_meta VALUES(?,?)", list(meta.items()))
    c.commit(); c.close()


GOOD = dict(methodology="rth-1m-composites-v2c2-div",
            price_basis="dividend-adjusted (breadth_dividend_basis div-basis-v6): ...",
            dividend_input_key="be2569e9")


def test_a_v2c2_dividend_artifact_merges(fresh_store, tmp_path):
    snap = str(tmp_path / "a.db"); _make_snap(snap, ROWS); _with_meta(snap, **GOOD)
    assert bridge._merge_from(snap) == 1


@pytest.mark.parametrize("bad", [
    dict(GOOD, methodology="rth-1m-composites-v2c"),                                   # frozen split-only V2c
    dict(GOOD, price_basis="split-adjusted provider close"),                            # no dividend basis
    dict(GOOD, price_basis="dividend-adjusted (breadth_dividend_basis div-basis-v3)"),  # a superseded basis
    dict(GOOD, price_basis="dividend-adjusted (breadth_dividend_basis div-basis-v5)"),  # CAD withheld, MPT/ADAM withheld
    {k: v for k, v in GOOD.items() if k != "dividend_input_key"},                       # no provenance
])
def test_any_other_artifact_is_refused_and_adopts_nothing(fresh_store, tmp_path, bad):
    snap = str(tmp_path / "b.db"); _make_snap(snap, ROWS); _with_meta(snap, **bad)
    with pytest.raises(bridge.ArtifactProvenanceRefused):
        bridge._merge_from(snap)
    with store._conn() as c:
        assert c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0] == 0


def test_a_store_sync_snapshot_without_pass_meta_is_not_an_artifact(fresh_store, tmp_path):
    snap = str(tmp_path / "c.db"); _make_snap(snap, ROWS)
    assert bridge._merge_from(snap) == 1
