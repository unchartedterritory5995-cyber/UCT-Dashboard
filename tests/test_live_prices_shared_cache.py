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


# ── L10: an unknown ticker is absent, not a 503 ─────────────────────────────

class _Answered:
    """A provider that ANSWERS: lists only the tickers it knows."""
    def __init__(self, known=()):
        self.known = set(known)

    def get_batch_quotes(self, tickers, *, entity_ids=None):
        from api.services import provider_errors as pe
        value = {t: {"ticker": t, "day": {"c": 10.0, "o": 9, "h": 11, "l": 9, "v": 1},
                     "prevDay": {"c": 9.5}, "lastTrade": {"p": 10.0}}
                 for t in tickers if t in self.known}
        return pe.ProviderResult(value=value,
                                 provenance=pe.ProvenanceRecord(vendor="massive", source_activity="t"),
                                 licensing_class="R")


def test_L10_a_single_unknown_ticker_is_200_and_absent(monkeypatch):
    monkeypatch.setattr(lp, "_get_client", lambda: _Answered())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    r = lp.get_live_prices("DAWNX1")
    assert getattr(r, "status_code", 200) == 200 and r == {}


def test_L10_a_known_ticker_beside_an_unknown_one_is_served(monkeypatch):
    monkeypatch.setattr(lp, "_get_client", lambda: _Answered(known=("KNOWNX1",)))
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    r = lp.get_live_prices("KNOWNX1,DAWNX2")
    assert set(r) == {"KNOWNX1"}


def test_L10_a_degraded_provider_is_still_a_503(monkeypatch):
    from api.services import provider_errors as pe

    class _Down:
        def get_batch_quotes(self, tickers, *, entity_ids=None):
            return pe.ProviderResult(value=None,
                                     provenance=pe.ProvenanceRecord(vendor="massive", source_activity="t"),
                                     licensing_class="R", degraded="cached_forbidden")
    monkeypatch.setattr(lp, "_get_client", lambda: _Down())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    assert lp.get_live_prices("DOWNX1").status_code == 503


def test_L10_a_raising_provider_is_still_a_503(monkeypatch):
    class _Boom:
        def get_batch_quotes(self, tickers, *, entity_ids=None):
            raise RuntimeError("massive down")
    monkeypatch.setattr(lp, "_get_client", lambda: _Boom())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    assert lp.get_live_prices("DOWNX2").status_code == 503


def test_L10_no_client_is_still_a_503(monkeypatch):
    def nope():
        raise RuntimeError("no key")
    monkeypatch.setattr(lp, "_get_client", nope)
    assert lp.get_live_prices("DOWNX3").status_code == 503


def test_L10_a_degraded_read_held_back_mid_session_is_still_a_503(monkeypatch):
    # Massive listed the ticker but with no day close, no prior close and a 0
    # change mid-RTH: no row can be built, so it is held back and the client
    # keeps its last good value.
    from api.services import provider_errors as pe

    class _Held:
        def get_batch_quotes(self, tickers, *, entity_ids=None):
            return pe.ProviderResult(value={t: {"ticker": t, "day": {}, "prevDay": {},
                                                "lastTrade": {}, "todaysChangePerc": 0}
                                            for t in tickers},
                                     provenance=pe.ProvenanceRecord(vendor="massive", source_activity="t"),
                                     licensing_class="R")
    monkeypatch.setattr(lp, "_get_client", lambda: _Held())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")
    assert lp.get_live_prices("HELDX1").status_code == 503
