"""The Massive OI fallback must resolve contracts whose CallPut comes straight
from the flow table as 'CALL'/'PUT' (not the normalized 'C'/'P' letters).

Regression for the 7/15-17 daily-snapshot collapse: the chain index keys on
'C'/'P' but the batch carried 'CALL'/'PUT', so every lookup missed
("fetched N tickers -> 0/198 contracts resolved") AND any resolved key would
have been 'SYM|CALL|…' — unmergeable against oi_snapshots.make_key's 'SYM|C|…'.
"""
import asyncio

import pytest

from api import massive_oi_snapshots as mos
from api.oi_snapshots import make_key


FAKE_CHAIN = {
    ("C", 192.5, "8/7/2026"): 1234,
    ("P", 100.0, "12/18/2026"): 55,
}


@pytest.fixture
def fake_chain(monkeypatch):
    async def _fake_fetch(client, ticker):
        return dict(FAKE_CHAIN)

    monkeypatch.setattr(mos, "_fetch_chain_for_ticker", _fake_fetch)


def _run(batch):
    return asyncio.run(mos._fetch_oi_all_async(batch))


def test_flow_table_call_put_resolves(fake_chain):
    batch = [
        ("QCOM", "CALL", 192.5, "8/7/2026"),
        ("QCOM", "PUT", 100.0, "12/18/2026"),
        ("QCOM", "PUT", 999.0, "8/7/2026"),  # genuinely absent from chain
    ]
    results = dict(_run(batch))
    assert results[make_key("QCOM", "CALL", 192.5, "8/7/2026")] == 1234
    assert results[make_key("QCOM", "PUT", 100.0, "12/18/2026")] == 55
    assert results[make_key("QCOM", "PUT", 999.0, "8/7/2026")] is None


def test_single_letter_cp_still_resolves(fake_chain):
    batch = [("QCOM", "C", 192.5, "8/7/2026"), ("QCOM", "P", 100.0, "12/18/2026")]
    results = dict(_run(batch))
    assert results[make_key("QCOM", "C", 192.5, "8/7/2026")] == 1234
    assert results[make_key("QCOM", "P", 100.0, "12/18/2026")] == 55


def test_returned_keys_match_snapshot_key_format(fake_chain):
    """The merge in oi_snapshots matches massive keys against make_key output —
    they must be byte-identical for flow-table-shaped input."""
    results = _run([("QCOM", "CALL", 192.5, "8/7/2026")])
    (ck, oi), = results
    assert ck == "QCOM|C|192.5|8/7/2026"
    assert ck == make_key("QCOM", "CALL", 192.5, "8/7/2026")
