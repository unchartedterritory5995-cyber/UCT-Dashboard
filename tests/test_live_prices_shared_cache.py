"""live-prices shared per-ticker cache + concurrency valve (2026-07-01 scale pass)."""

import api.routers.live_prices as lp


def _val():
    return {"price": 1.0, "change_pct": 0, "change": 0, "volume": 0,
            "day_open": 0, "day_high": 0, "day_low": 0, "prev_close": 0,
            "ext_price": None, "ext_session": None}


def test_overlapping_tickers_reuse_shared_cache(monkeypatch):
    calls = []

    def fake_fetch(client, tickers, session):
        calls.append(list(tickers))
        return {tk: _val() for tk in tickers}

    monkeypatch.setattr(lp, "_get_client", lambda: object())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    monkeypatch.setattr(lp, "_fetch_snapshots", fake_fetch)

    # distinctive symbols so we don't collide with anything already cached
    r1 = lp.get_live_prices("TSTA,TSTB")
    assert set(r1.keys()) == {"TSTA", "TSTB"}
    assert calls[0] == ["TSTA", "TSTB"]

    # different SET (whole-set cache misses) but TSTB is warm per-ticker →
    # only the genuinely missing TSTC hits upstream.
    r2 = lp.get_live_prices("TSTB,TSTC")
    assert set(r2.keys()) == {"TSTB", "TSTC"}
    assert calls[-1] == ["TSTC"]


def test_repeated_identical_request_is_whole_set_fast_path(monkeypatch):
    calls = []
    monkeypatch.setattr(lp, "_get_client", lambda: object())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    monkeypatch.setattr(lp, "_fetch_snapshots",
                        lambda c, tks, s: (calls.append(list(tks)), {tk: _val() for tk in tks})[1])

    lp.get_live_prices("WHOLEA,WHOLEB")
    n_after_first = len(calls)
    # identical request → served from the whole-set cache, no new upstream call
    lp.get_live_prices("WHOLEA,WHOLEB")
    assert len(calls) == n_after_first


def test_too_many_tickers_rejected():
    r = lp.get_live_prices(",".join(f"T{i}" for i in range(300)))
    assert getattr(r, "status_code", 200) == 400
