"""NY Fed Empire State Manufacturing Survey adapter: real SA diffusion CSV, column identity,
ND markers, month grammar, latest vs history, soft failures, edge 403."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from api.services.econ import secrets
from api.services.econ.adapters import get_adapter, nyfed_esms
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "nyfed_esms"
CSV = (FIX / "esms_seasonallyadjusted_diffusion.csv").read_bytes()


def spec(sym="USEMPIRE", file="esms_seasonallyadjusted_diffusion.csv", column="GACDISA", **p):
    return SeriesSpec({"symbol": sym, "frequency": "M",
                       "source": {"adapter": "nyfed_esms", "params": {"file": file, "column": column, **p}}})


class Resp:
    def __init__(self, status=200, content=b"", headers=None):
        self.status_code = status
        self.content = content
        self.headers = headers or {"Content-Type": "text/csv"}


class T:
    def __init__(self, resp):
        self.resp = resp
        self.sent = []

    def __call__(self, req):
        self.sent.append(req.url)
        return self.resp


def client(t):
    return HttpClient(transport=t, sleep=lambda s: None, host_intervals={}, default_interval=0, max_retries=0)


def run(specs, resp=None, mode="history", start=None, end=None):
    t = T(resp or Resp(200, CSV))
    res = nyfed_esms.NyFedEsmsAdapter().fetch(specs, mode=mode, start=start, end=end, http=client(t))
    return res, t


def test_registered_keyless():
    assert isinstance(get_adapter("nyfed_esms"), nyfed_esms.NyFedEsmsAdapter)
    assert nyfed_esms.NyFedEsmsAdapter.key_env is None


def test_history_gacdisa_real_file():
    [r], t = run([spec()])
    assert t.sent == ["https://www.newyorkfed.org/medialibrary/media/survey/empire/data/"
                      "esms_seasonallyadjusted_diffusion.csv"]
    obs = r.observations
    assert (obs[0].period_start, obs[0].period_end, obs[0].value) == ("2001-07-01", "2001-07-31", -13.3)
    assert (obs[-1].period_start, obs[-1].period_end, obs[-1].value) == ("2026-09-01", "2026-09-30", 7.6)
    assert obs[-2].value == 20.6                                   # Aug 2026
    assert len(obs) == 303 and all(o.value is not None for o in obs)
    assert r.request_key == "nyfed_esms:esms_seasonallyadjusted_diffusion.csv:GACDISA:.."
    assert r.source_published_at is None and r.payload_sha256


def test_nd_marker_is_none_not_zero():
    [r], _ = run([spec(sym="USEMPIRESUP", column="ASCDISA")])
    nas = [o for o in r.observations if o.value is None]
    assert nas and nas[0].period_start == "2001-07-01"
    assert not any(o.value == 0 for o in nas)


def test_shared_file_one_request_many_columns_and_alias():
    [r], t = run([spec(), spec(sym="USEMPIRENO", file="sa_diffusion", column="NOCDISA")])
    assert len(t.sent) == 1
    ids = {o.series_id for o in r.observations}
    assert ids == {"USEMPIRE", "USEMPIRENO"}
    assert r.request_key.endswith(":GACDISA,NOCDISA:..")


def test_latest_and_window():
    [r], _ = run([spec()], mode="latest")
    assert len(r.observations) == nyfed_esms.LATEST_N and r.observations[-1].period_start == "2026-09-01"
    [r], _ = run([spec()], start=date(2026, 1, 1), end=date(2026, 3, 31))
    assert [o.period_start for o in r.observations] == ["2026-01-01", "2026-02-01", "2026-03-01"]


def test_unknown_column_is_identity_failure():
    with pytest.raises(MalformedPayload, match="identity"):
        run([spec(column="GACDISAX")])


@pytest.mark.parametrize("params", [{"file": "../../etc/passwd"}, {"file": "https://evil/x.csv"},
                                    {"column": "GA CD;"}, {"column": ""}])
def test_bad_params(params):
    with pytest.raises(MalformedPayload):
        run([spec(**params)])


@pytest.mark.parametrize("resp,exc", [
    (Resp(200, b""), MalformedPayload),
    (Resp(200, b"<!DOCTYPE html><html>Page moved</html>", {"Content-Type": "text/html"}), MalformedPayload),
    (Resp(200, b"date,GACDISA\n2026-09-30,7.6\n"), MalformedPayload),
    (Resp(200, b"surveyDate,GACDISA\n2026-09-30,7.6,1\n"), MalformedPayload),
    (Resp(200, b"surveyDate,GACDISA\nSep 2026,7.6\n"), MalformedPayload),
    (Resp(200, b"surveyDate,GACDISA\n2026-09-30,seven\n"), MalformedPayload),
    (Resp(200, b"surveyDate,GACDISA,GACDISA\n2026-09-30,7.6,7.6\n"), MalformedPayload),
    (Resp(403, b"<html>Access Denied</html>"), SourceUnavailable),
    (Resp(404, b""), SourceUnavailable),
    (Resp(302, b"", {"Location": "https://www.newyorkfed.org/error"}), MalformedPayload),
])
def test_failures(resp, exc):
    with pytest.raises(exc):
        run([spec()], resp=resp)


def test_request_key_secret_free(monkeypatch):
    monkeypatch.setenv("BEA_API_KEY", "beaTESTkey1122334455")
    [r], _ = run([spec()], mode="latest")
    assert secrets.redact(r.request_key) == r.request_key
