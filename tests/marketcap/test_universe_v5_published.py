"""The production universe source: Fundamentals V5's PUBLISHED authority (CURRENT -> sha-verified manifest), read-only."""
import gzip
import json

import pytest

from api.services.fundamentals_pit import v5_publish as V5P
from api.services.marketcap import acquire as Q


class ReadOnly(V5P.LocalTarget):
    def put(self, *a, **k):  # the source must never write
        raise AssertionError("universe acquisition wrote to the V5 target")


def _publish(root, tickers, *, tamper=False):
    t = V5P.LocalTarget(str(root))
    man = {"version": "v5-T", "tickers": tickers}
    body = V5P.encode(man)
    t.put(V5P.version_key("v5-T"), body if not tamper else body + b" ")
    t.put(V5P.CURRENT_KEY, V5P.encode({"version": "v5-T", "manifest_sha256": V5P.sha(body), "published_at": "2026-10-05T15:20:00Z"}))
    return ReadOnly(str(root))


def test_universe_is_the_manifest_ticker_map_grouped_by_cik(tmp_path):
    t = _publish(tmp_path / "b", {"GOOGL": 1652044, "GOOG": 1652044, "AAPL": 320193})
    out = tmp_path / "u.json.gz"
    r = Q.universe_from_v5_published(str(out), target=t, min_issuers=1)
    assert json.loads(gzip.decompress(out.read_bytes())) == {"1652044": ["", ["GOOG", "GOOGL"]], "320193": ["", ["AAPL"]]}
    assert r["issuers"] == 2 and r["tickers"] == 3 and r["v5_version"] == "v5-T"


def test_sha_mismatch_fails_closed(tmp_path):
    t = _publish(tmp_path / "b", {"AAPL": 320193}, tamper=True)
    with pytest.raises(V5P.PublishError):
        Q.universe_from_v5_published(str(tmp_path / "u.json.gz"), target=t, min_issuers=1)
    assert not (tmp_path / "u.json.gz").exists()


def test_missing_pointer_or_thin_universe_fails_closed(tmp_path):
    with pytest.raises(Q.AcquisitionError):
        Q.universe_from_v5_published(str(tmp_path / "u.json.gz"), target=ReadOnly(str(tmp_path / "empty")), min_issuers=1)
    t = _publish(tmp_path / "b", {"AAPL": 320193})
    with pytest.raises(Q.AcquisitionError):
        Q.universe_from_v5_published(str(tmp_path / "u.json.gz"), target=t)
