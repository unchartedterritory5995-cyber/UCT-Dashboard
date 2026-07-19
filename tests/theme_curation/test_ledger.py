from tools.theme_curation.ledger import Ledger


def test_record_and_readback(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    assert lg.is_decided("space", "RKLB", "add") is False
    lg.record("space", "RKLB", "add", "approve", {"tier": "core"})
    assert lg.is_decided("space", "RKLB", "add") is True
    assert lg.get("space", "RKLB", "add")["decision"] == "approve"


def test_last_write_wins(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("space", "X", "add", "approve")
    lg.record("space", "X", "add", "reject")
    assert lg.get("space", "X", "add")["decision"] == "reject"


def test_rejected_keys(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("space", "BAD", "add", "reject")
    lg.record("space", "GOOD", "add", "approve")
    assert lg.rejected_keys() == {("space", "BAD", "add")}


def test_record_rejects_bad_decision(tmp_path):
    import pytest
    lg = Ledger(str(tmp_path / "l.db"))
    with pytest.raises(ValueError):
        lg.record("t", "X", "add", "rejected")   # typo -> must raise, not silently store
