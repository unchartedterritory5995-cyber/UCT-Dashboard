"""Rails for `api/services/pine_seed_store.py` (RS Rating transfer, L6).

Offline: GitHub is a recording double. The two uploads below have the real file's
shape (`rs_ranking.py::generate_tradingview_csv`): 35 calendar-day rows, 5 per
percentile, the NEWEST rows carrying the 1st-percentile value.
"""
import datetime as dt
import json

import pytest

from api.services import pine_seed_store as store

SEED = "SEED_FRED6725_RS_RATING:RSRATING"
MIRROR = store.SEEDS[SEED]


def upload(yesterday: dt.date, values_low_to_high) -> str:
    """The generator's own algorithm, transcribed: ascending percentiles, 5 rows each,
    dated back from `yesterday`, then reversed into date order."""
    lines, k = [], 0
    for v in values_low_to_high:
        for _ in range(5):
            d = yesterday - dt.timedelta(days=k)
            lines.append(f"{d:%Y%m%d}T,0,1000,0,{v},0\n")
            k += 1
    return "".join(reversed(lines))


V1 = [12.0, 40.0, 78.0, 94.0, 102.0, 125.0, 199.0]
V2 = [12.5, 42.44, 78.22, 94.28, 102.85, 125.0, 199.57]
D1 = dt.date(2026, 11, 9)
D2 = dt.date(2026, 11, 10)


class FakeGitHub:
    def __init__(self, commits):           # commits: newest first, [(sha, iso, text)]
        self.commits = commits
        self.calls = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if "/commits?" in url:
            page = int(url.rsplit("page=", 1)[1])
            batch = self.commits[(page - 1) * 100: page * 100]
            return json.dumps([{"sha": s, "commit": {"committer": {"date": when}}}
                               for s, when, _ in batch]).encode()
        for sha, _when, text in self.commits:
            if f"/{sha}/" in url:
                return text.encode()
        raise AssertionError(f"unexpected url {url}")


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_SEEDS_DB", str(tmp_path / "seeds.db"))
    store._reset_for_tests()
    yield
    store._reset_for_tests()


def test_parse_reads_the_generators_rows_in_date_order():
    rows, skipped = store.parse_csv(upload(D2, V2))
    assert skipped == 0 and len(rows) == 35
    assert rows[-1] == {"t": "2026-11-10", "o": 0.0, "h": 1000.0, "l": 0.0, "c": 12.5, "v": 0.0}
    assert rows[0]["c"] == 199.57 and rows[0]["t"] == "2026-10-07"


def test_a_row_that_does_not_parse_completely_is_skipped_never_half_read():
    text = "20261110T,0,1000,0,12.5,0\n20261109T,0,1000,0,,0\nnot a row\n"
    rows, skipped = store.parse_csv(text)
    assert [r["t"] for r in rows] == ["2026-11-10"]
    assert skipped == 2


def test_the_series_is_the_newest_upload_alone():
    """Q-RS2 (NYSE:RDDT 1D, 2026-11-15): TradingView's seed is `na` on every bar
    before the newest upload's first row and equals that upload exactly after it. An
    upload REPLACES the series; rows only an older upload covered are gone."""
    gh = FakeGitHub([("bbb", "2026-11-11T03:04:36Z", upload(D2, V2)),
                     ("aaa", "2026-11-10T04:52:42Z", upload(D1, V1))])
    res = store.refresh([SEED], get=gh, max_pages=3)
    assert res["ok"] and res["ingested"][SEED] == 2
    by_date = {b["t"]: b["c"] for b in store.bars(SEED)}
    assert by_date["2026-11-10"] == 12.5 and by_date["2026-11-06"] == 12.5
    # 2026-10-06 only the OLDER upload covered: not served
    assert "2026-10-06" not in by_date
    assert len(by_date) == 35
    assert store.coverage()[SEED]["uploads"] == 2          # provenance keeps both


def test_upload_order_matters_control():
    """Control: applying the NEWEST upload first leaves the older one in force, so the
    test above really pins oldest-first application."""
    store.ingest_upload(SEED, "bbb", "2026-11-11T03:04:36Z", upload(D2, V2))
    store.ingest_upload(SEED, "aaa", "2026-11-10T04:52:42Z", upload(D1, V1))
    by_date = {b["t"]: b["c"] for b in store.bars(SEED)}
    assert by_date["2026-11-09"] != 12.5 and "2026-10-06" in by_date


def test_refresh_is_incremental_and_stops_at_the_first_known_commit():
    gh = FakeGitHub([("aaa", "2026-11-10T04:52:42Z", upload(D1, V1))])
    store.refresh([SEED], get=gh, max_pages=3)
    gh2 = FakeGitHub([("bbb", "2026-11-11T03:04:36Z", upload(D2, V2)),
                      ("aaa", "2026-11-10T04:52:42Z", upload(D1, V1))])
    res = store.refresh([SEED], get=gh2, max_pages=3)
    assert res["ingested"][SEED] == 1
    assert not any("/aaa/" in u for u in gh2.calls)
    assert store.coverage()[SEED]["uploads"] == 2


class _Http404(Exception):
    code = 404


class _Http503(Exception):
    code = 503


def _gh_with_missing_file(exc):
    """Three uploads, the middle one's file absent at its commit."""
    commits = [("ccc", "2026-11-11T03:04:36Z", upload(D2, V2)),
               ("bbb", "2026-11-10T09:00:00Z", None),
               ("aaa", "2026-11-10T04:52:42Z", upload(D1, V1))]
    gh = FakeGitHub([(s, w, t or "") for s, w, t in commits])
    inner = gh.__call__

    def get(url):
        if "/bbb/" in url:
            raise exc
        return inner(url)
    return get


def test_a_file_absent_at_a_commit_is_an_empty_upload_and_the_replay_continues():
    """Measured on the live mirror 2026-11-14: one commit 404s for the file."""
    res = store.refresh([SEED], get=_gh_with_missing_file(_Http404()), max_pages=3)
    assert res["ok"] and res["ingested"][SEED] == 3
    assert {b["t"]: b["c"] for b in store.bars(SEED)}["2026-11-10"] == 12.5
    assert store.coverage()[SEED]["uploads"] == 3


def test_an_empty_upload_does_not_wipe_the_series():
    store.ingest_upload(SEED, "aaa", "2026-11-10T04:52:42Z", upload(D2, V2))
    store.ingest_upload(SEED, "bbb", "2026-11-11T04:52:42Z", "")
    assert len(store.bars(SEED)) == 35


def test_any_other_fetch_error_still_stops_and_is_retried_control():
    res = store.refresh([SEED], get=_gh_with_missing_file(_Http503()), max_pages=3)
    assert not res["ok"]
    assert store.coverage()[SEED]["uploads"] == 1          # only the upload before it


def test_an_unregistered_seed_serves_nothing_and_says_so():
    assert store.bars("SEED_SOMEONE_ELSE:X") == []
    res = store.refresh(["SEED_SOMEONE_ELSE:X"], get=FakeGitHub([]))
    assert not res["ok"] and "not a registered seed" in res["errors"]["SEED_SOMEONE_ELSE:X"]


def test_daily_only():
    store.ingest_upload(SEED, "bbb", "2026-11-11T03:04:36Z", upload(D2, V2))
    assert len(store.build_bars(SEED, "D")["bars"]) == 35
    w = store.build_bars(SEED, "W")
    assert w["bars"] == [] and "daily timeframe only" in w["note"]


def test_one_mirror_error_is_reported_not_raised():
    def boom(url):
        raise OSError("network down")
    res = store.refresh([SEED], get=boom)
    assert not res["ok"] and "network down" in res["errors"][SEED]


def test_seed_key_matches_the_request_seed_spelling():
    assert store.seed_key("seed_fred6725_rs_rating", "RSRATING") == SEED
    assert store.is_seed_symbol("seed_fred6725_rs_rating:rsrating")
