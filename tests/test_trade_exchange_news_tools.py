"""Trade Exchange News D1 operator tools: preflight (never prints a value) and the
staging deploy probe (refuses production; summarises outages honestly)."""
from __future__ import annotations

import pathlib

from tests.support.txn_fakes import FakeS3
from tools import txn_deploy_probe as probe
from tools import txn_preflight as pf

SECRET = "SECRET-VALUE-DO-NOT-PRINT"
DIGEST = "a" * 64


#: Production's rules after 2026-10-31 (owner screenshot): the multipart abort, the
#: 1-day preflight canary, and the old events rule DISABLED.
PERMANENT_RULES = [
    {"ID": "Default Multipart Abort Rule", "Status": "Enabled", "Filter": {"Prefix": ""},
     "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}},
    {"ID": "events-8d", "Status": "Disabled", "Filter": {"Prefix": "trade-exchange-news/v1/events/"},
     "Expiration": {"Days": 8}},
    {"ID": "preflight-1d", "Status": "Enabled", "Filter": {"Prefix": "trade-exchange-news/v1/preflight/"},
     "Expiration": {"Days": 1}},
]


class LifecycleS3(FakeS3):
    def __init__(self, days="permanent", put_ok=True):
        super().__init__()
        self.days = days
        self.put_ok = put_ok

    def get_bucket_lifecycle_configuration(self, *, Bucket):
        if self.days == "denied":
            raise PermissionError("AccessDenied")
        if self.days is None:
            raise KeyError("NoSuchLifecycleConfiguration")
        if self.days == "broken":
            raise TimeoutError("r2 slow")
        if self.days == "permanent":
            return {"Rules": PERMANENT_RULES}
        return {"Rules": [{"ID": "events-expire", "Status": "Enabled", "Filter": {"Prefix": "trade-exchange-news/"},
                           "Expiration": {"Days": self.days}}]}

    def put_object(self, **kw):
        if not self.put_ok:
            raise PermissionError("AccessDenied")
        return super().put_object(**kw)


def env(role):
    e = {"TXN_JOURNAL": "s3", "TXN_JOURNAL_ENDPOINT_URL": f"https://{SECRET}.r2",
         "TXN_JOURNAL_ACCESS_KEY_ID": SECRET, "TXN_JOURNAL_SECRET_ACCESS_KEY": SECRET,
         "TXN_JOURNAL_BUCKET": "txn-journal"}
    if role == "receiver":
        e.update(TXN_WEBHOOK_TOKEN_SHA256=DIGEST, TXN_INGEST_TOKEN=SECRET)
    else:
        e.update(TXN_INGEST_TOKEN_SHA256=DIGEST)
    return e


def test_preflight_ready_and_prints_no_value(capsys):
    assert pf.check("receiver", env("receiver"), client=LifecycleS3()) == []
    assert pf.check("web", env("web"), r2_write=True, client=LifecycleS3()) == []
    out = capsys.readouterr().out
    assert SECRET not in out and DIGEST not in out
    assert "none expires the journal prefix (permanent)" in out and "r2 write ok" in out


def test_preflight_names_every_problem():
    e = env("receiver")
    del e["TXN_INGEST_TOKEN"]
    e["TXN_WEBHOOK_TOKEN_SHA256"] = "nothex"
    probs = pf.check("receiver", e, client=LifecycleS3())
    assert "missing TXN_INGEST_TOKEN" in probs
    assert any("not 64-hex" in p for p in probs)
    # ⛔⛔ ANY enabled expiry over the journal is a problem now, however long (permanent archive).
    for days in (3, 8, 3650):
        assert any("expires the PERMANENT journal" in p for p in pf.check("web", env("web"), client=LifecycleS3(days=days)))
    assert pf.check("web", env("web"), client=LifecycleS3(days=None)) == []     # no lifecycle at all: permanent
    whole = [{"ID": "all", "Status": "Enabled", "Filter": {"Prefix": ""}, "Expiration": {"Days": 30}}]
    assert pf.journal_expiring_rules(whole, "trade-exchange-news/v1/events/") == ["all"]
    assert pf.journal_expiring_rules(PERMANENT_RULES, "trade-exchange-news/v1/events/") == []
    assert any("r2 write failed" in p
               for p in pf.check("web", env("web"), r2_write=True, client=LifecycleS3(put_ok=False)))


def test_preflight_scoped_key_lifecycle_needs_the_dashboard_confirmation(capsys):
    """D2: an Object Read & Write key scoped to the bucket is refused the lifecycle read."""
    probs = pf.check("web", env("web"), r2_write=True, client=LifecycleS3(days="denied"))
    assert any("--lifecycle-confirmed-in-dashboard" in p for p in probs)
    assert pf.check("web", env("web"), r2_write=True, client=LifecycleS3(days="denied"),
                    lifecycle_confirmed=True) == []
    # only a refusal is waived: any other failure still blocks
    assert any("unreadable" in p for p in pf.check("web", env("web"), client=LifecycleS3(days="broken"),
                                                   lifecycle_confirmed=True))
    assert SECRET not in capsys.readouterr().out


def test_probe_refuses_production_and_unconfirmed_runs(tmp_path, monkeypatch):
    f = tmp_path / "url.txt"
    f.write_text("https://news.uctintelligence.com/hook/x")
    monkeypatch.setenv("TXN_PROBE_URL_FILE", str(f))
    assert probe.main(["--out", str(tmp_path / "o.json")]) == 2
    assert probe.main(["--out", str(tmp_path / "o.json"), "--i-confirm-staging"]) == 2
    monkeypatch.delenv("TXN_PROBE_URL_FILE")
    assert probe.main(["--out", str(tmp_path / "o.json"), "--i-confirm-staging"]) == 2


def test_probe_summary_measures_the_longest_outage():
    rows = ([{"t": i * 0.2, "status": 200, "ms": 5} for i in range(10)]
            + [{"t": 2.0 + i * 0.2, "status": 502, "ms": 30} for i in range(4)]
            + [{"t": 2.8, "error": "ConnectError", "ms": 1}]
            + [{"t": 3.0 + i * 0.2, "status": 200, "ms": 6} for i in range(5)])
    s = probe.summarize(rows)
    assert s["sent"] == 20 and s["ok"] == 15
    assert s["failed_by_status"] == {"502": 4, "ConnectError": 1}
    assert s["longest_failure_run"] == 5 and s["longest_failure_seconds"] == 0.8


def test_tools_read_no_url_from_argv():
    src = pathlib.Path(probe.__file__).read_text(encoding="utf-8")
    assert "add_argument(\"--url\"" not in src and "TXN_PROBE_URL_FILE" in src
