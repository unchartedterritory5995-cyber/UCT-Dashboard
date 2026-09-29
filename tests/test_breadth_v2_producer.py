"""The dedicated V2 producer: fail-closed validation, immutable publication, web adoption."""
from __future__ import annotations

import gzip
import json
import os

import pytest

from api.services import breadth_authority as ba
from api.services import breadth_v2_producer as prod

M = ba.V2_METRICS
D = "2026-09-25"


class FakeR2:
    def __init__(self):
        self.o = {}

    def put_object(self, Bucket, Key, Body, **k):
        self.o[Key] = Body if isinstance(Body, bytes) else Body.read()

    def get_object(self, Bucket, Key):
        if Key not in self.o:
            raise KeyError(Key)

        class _B:
            def __init__(s, b): s.b = b
            def read(s): return s.b
        return {"Body": _B(self.o[Key])}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(prod, "ROOT", str(tmp_path / "producer"))
    monkeypatch.setenv("BREADTH_V2_DIR", str(tmp_path / "web"))
    r2 = FakeR2()
    monkeypatch.setattr(prod, "_r2", lambda: (r2, "bucket"))
    from api.services import breadth_ohlc_sync as bos
    monkeypatch.setattr(bos, "_client", lambda: r2)
    monkeypatch.setattr(bos, "_bucket", lambda: "bucket")
    ba._LIVE.update(stat=None, data=None)
    return r2


def _res(d=D, uct=True, drop=None, twin=True, buckets=390, uc=3700, **over):
    rows = []
    for u in prod.UNIVERSES:
        if u == "uct" and not uct:
            continue
        for m in M:
            if u == "uct" and m == drop:
                continue
            v = uc if m == "universe_count" else 50.0
            rows.append([u, d, m, v, v + 1, v - 1, v, "intraday_recon_1m"])
    mem = {u: ["A", "B"] for u in prod.UNIVERSES if u != "uct" or uct}
    r = {"dates": [d], "determinism": twin, "preflight_problems": [],
         "checkpoints": {d: ["done", None]}, "calendar": {d: {"trading_day": True, "window": [570, 959]}},
         "sessions": {d: {"expected_buckets": 390, "early_close": 0,
                          "universe_buckets": {u: buckets for u in mem}, "universe_sizes": {u: 2 for u in mem}}},
         "rows": rows, "members": {d: mem},
         "membership_sha256": {d: {u: "sha-" + u for u in mem}},
         "overlay": {"methodology": "rth-1m-composites-v2c2-div+ema-tie-exact-v1", "ema_rule": "ema-tie-exact-v1",
                     "modules_md5_lf": {"breadth_live.py": "x"}},
         "meta": {"guard_input_key": "g", "dividend_input_key": "d"},
         "grouped_calendar_tail": ["2026-09-%02d" % i for i in (14, 15, 16, 17, 18, 21, 22, 23, 24, 25)]}
    r.update(over)
    return r


def _prior_counts(gap=False, uc=3700):
    out = {}
    for u in prod.UNIVERSES:
        for d in ("2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21",
                  "2026-09-22", "2026-09-23", "2026-09-24"):
            if gap and u == "uct" and d == "2026-09-23":
                continue
            out.setdefault(u, {})[d] = {"up_4pct_today": 10, "down_4pct_today": 5, "universe_count": uc}
    return out


def test_a_complete_session_validates():
    v = prod.validate_batch(_res(), {D}, _prior_counts())
    assert v[D]["ok"], v[D]["problems"]


@pytest.mark.parametrize("over,why", [
    ({"twin": False}, "nondeterministic"),
    ({"buckets": 200}, "buckets"),
    ({"uc": 1800}, "universe_count"),
    ({"drop": "pct_above_50sma"}, "missing"),
    ({"preflight_problems": ["stale"]}, "preflight"),
    ({"checkpoints": {D: ["failed", "TRADING DAY WITHOUT a minute flat file"]}}, "checkpoint"),
])
def test_every_gate_fails_closed(over, why):
    kw = dict(over)
    res = _res(**{k: kw.pop(k) for k in ("twin", "buckets", "uc", "drop") if k in kw}, **kw)
    v = prod.validate_batch(res, {D}, _prior_counts())
    assert not v[D]["ok"] and any(why in p for p in v[D]["problems"]), v[D]["problems"]


def test_a_ratio_is_absent_by_rule_only_when_its_window_reaches_a_gap():
    ok = prod.validate_batch(_res(drop="ratio_5day"), {D}, _prior_counts(gap=True))
    assert ok[D]["ok"] and ok[D]["absent_by_rule"] == ["ratio_5day"]
    bad = prod.validate_batch(_res(drop="ratio_5day"), {D}, _prior_counts(gap=False))
    assert not bad[D]["ok"]


def test_pit_membership_must_agree_with_the_ledger():
    assert not prod.validate_batch(_res(uct=True), set(), _prior_counts())[D]["ok"]      # uct on a rejected day
    assert prod.validate_batch(_res(uct=False), set(), _prior_counts())[D]["ok"]         # honest gap
    assert not prod.validate_batch(_res(uct=False), {D}, _prior_counts())[D]["ok"]      # accepted but absent


def _vintage(tmp_path):
    inp = tmp_path / "inputs"
    inp.mkdir(exist_ok=True)
    for f in ("INPUT_MANIFEST.json", "pit_uct_ledger.json", "pit_reference.json"):
        (inp / f).write_text("{}")
    return {"tag": "p202609262100", "inputs_dir": str(inp)}


def test_publish_then_web_adoption_round_trip(env, tmp_path):
    res = _res()
    v = prod.validate_batch(res, {D}, _prior_counts())[D]
    blob, pub = prod.build_publication(D, res, _vintage(tmp_path), v)
    sha = prod.publish(D, blob, pub)
    man = json.loads(env.o[ba._R2_MANIFEST])
    assert man["sessions"][D]["sha256"] == sha
    out = ba.sync_live_once()
    assert out["results"][D] == "adopted"
    assert ba.session_authority(D, (D,)) == ba.V2_LIVE
    prov = ba._load_live()["sessions"][D]["provenance"]
    assert prov["membership"]["uct"] == ["A", "B"] and prov["membership_sha256"]["uct"] == "sha-uct"
    assert prov["methodology"].endswith("ema-tie-exact-v1")


def test_an_accepted_session_is_never_republished_differently(env, tmp_path):
    res = _res()
    v = prod.validate_batch(res, {D}, _prior_counts())[D]
    blob, pub = prod.build_publication(D, res, _vintage(tmp_path), v)
    prod.publish(D, blob, pub)
    res2 = _res(uc=3701)
    blob2, pub2 = prod.build_publication(D, res2, _vintage(tmp_path), v)
    with pytest.raises(RuntimeError, match="already accepted"):
        prod.publish(D, blob2, pub2)
    assert prod.status()["conflicts"]


def test_a_pit_rejected_session_publishes_as_a_gap(env, tmp_path):
    res = _res(uct=False)
    v = prod.validate_batch(res, set(), _prior_counts())[D]
    blob, pub = prod.build_publication(D, res, _vintage(tmp_path), v)
    assert pub["provenance"]["membership_sha256"]["uct"] == "PIT_REJECTED"
    prod.publish(D, blob, pub)
    assert ba.sync_live_once()["results"][D] == "adopted"
    assert ba.session_authority(D, (D,)) == ba.V2_GAP


def test_publication_bytes_are_deterministic(tmp_path):
    res = _res()
    v = prod.validate_batch(res, {D}, _prior_counts())[D]
    v["x"] = 1
    a = prod.build_publication(D, res, _vintage(tmp_path), v)[1]["pub_id"]
    b = prod.build_publication(D, res, _vintage(tmp_path), v)[1]["pub_id"]
    assert a == b
