"""Wave 5 Task A5: opt_flow — run_pull, read_opt_flow_fields, job registration.

No sockets anywhere: every run_pull test monkeypatches
`api.services.screener.opt_flow.data_sync.get_bytes`; every reader test only
touches a JSON file under `tmp_path` via `SCREENER_OPTFLOW_ARTIFACT`. Mirrors
the finviz_universe reader-half rail (`tests/test_screener_wave2_finviz.py`)
and the job-registration rail (`tests/test_screener_schedule.py`).
"""
import json
from datetime import datetime, timedelta, timezone


def _row(sym):
    return {
        "opt_net_premium_1d": 1_000_000.0,
        "opt_bull_pct_1d": 62.5,
        "opt_net_premium_5d": 4_200_000.0,
    }


def _make_payload(n=30, as_of=None):
    return {
        "as_of": as_of or datetime.now(timezone.utc).isoformat(),
        "days": ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
        "rows": {f"T{i:04d}": _row(f"T{i:04d}") for i in range(n)},
        "census": {"rows_scanned": n * 5, "rows_classified": n * 4, "tickers": n},
    }


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── run_pull ──────────────────────────────────────────────────────────────

def test_run_pull_healthy_writes_artifact(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    payload = _make_payload(30)
    monkeypatch.setattr(of.data_sync, "get_bytes",
                         lambda key: json.dumps(payload).encode())

    receipt = of.run_pull()

    assert receipt["wrote"] is True
    assert receipt["tickers"] == 30
    assert receipt["as_of"] == payload["as_of"]
    assert receipt["reason"] is None
    assert artifact.exists()

    on_disk = json.loads(artifact.read_text())
    assert on_disk == payload
    assert on_disk["rows"]["T0000"]["opt_net_premium_1d"] == 1_000_000.0


def test_run_pull_missing_r2_object_refuses_and_preserves_prior(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    prior_payload = _make_payload(40, as_of="2020-01-01T00:00:00+00:00")
    artifact.write_text(json.dumps(prior_payload))
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    monkeypatch.setattr(of.data_sync, "get_bytes", lambda key: None)

    receipt = of.run_pull()

    assert receipt["wrote"] is False
    assert receipt["reason"] == "no_r2_object"
    assert receipt["tickers"] == 0
    after = json.loads(artifact.read_text())
    assert after == prior_payload  # byte-for-byte untouched


def test_run_pull_below_floor_refuses_and_preserves_prior(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    prior_payload = _make_payload(40, as_of="2020-01-01T00:00:00+00:00")
    artifact.write_text(json.dumps(prior_payload))
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    short_payload = _make_payload(5)  # below _MIN_TICKERS = 25
    monkeypatch.setattr(of.data_sync, "get_bytes",
                         lambda key: json.dumps(short_payload).encode())

    receipt = of.run_pull()

    assert receipt["wrote"] is False
    assert receipt["reason"] == "below_floor"
    assert receipt["tickers"] == 5
    after = json.loads(artifact.read_text())
    assert after == prior_payload  # byte-for-byte untouched


def test_run_pull_not_a_dict_refuses(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    monkeypatch.setattr(of.data_sync, "get_bytes", lambda key: b"null")
    receipt = of.run_pull()
    assert receipt["wrote"] is False
    assert receipt["reason"] == "not_a_dict"
    assert not artifact.exists()

    monkeypatch.setattr(of.data_sync, "get_bytes", lambda key: b"[1, 2, 3]")
    receipt = of.run_pull()
    assert receipt["wrote"] is False
    assert receipt["reason"] == "not_a_dict"


def test_run_pull_invalid_json_refuses(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    monkeypatch.setattr(of.data_sync, "get_bytes", lambda key: b"{not valid json")
    receipt = of.run_pull()
    assert receipt["wrote"] is False
    assert receipt["reason"] == "not_a_dict"
    assert not artifact.exists()


def test_run_pull_rows_not_a_dict_refuses(monkeypatch, tmp_path):
    artifact = tmp_path / "opt_flow.json"
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    payload = {"as_of": _now_iso(), "rows": [1, 2, 3]}
    monkeypatch.setattr(of.data_sync, "get_bytes",
                         lambda key: json.dumps(payload).encode())

    receipt = of.run_pull()

    assert receipt["wrote"] is False
    assert receipt["reason"] == "rows_not_a_dict"
    assert receipt["as_of"] == payload["as_of"]
    assert not artifact.exists()


# ── read_opt_flow_fields ──────────────────────────────────────────────────

def _write_artifact(tmp_path, monkeypatch, rows, as_of=None):
    artifact = tmp_path / "opt_flow.json"
    artifact.write_text(json.dumps({
        "as_of": as_of or _now_iso(),
        "days": [],
        "rows": rows,
        "census": {},
    }))
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    return artifact


def test_read_opt_flow_fields_healthy(monkeypatch, tmp_path):
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(30)}
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import opt_flow as of

    out = of.read_opt_flow_fields(["T0000", "ZZZZ"])

    assert out["T0000"]["opt_net_premium_1d"] == 1_000_000.0
    assert out["T0000"]["opt_bull_pct_1d"] == 62.5
    assert out["T0000"]["opt_net_premium_5d"] == 4_200_000.0
    assert out["ZZZZ"] == {}


def test_read_opt_flow_fields_missing_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(tmp_path / "nope.json"))
    from api.services.screener import opt_flow as of

    failures = {}
    out = of.read_opt_flow_fields(["AAA"], failures=failures)

    assert out == {}
    assert failures["opt_flow"]["missing"] == 1


def test_read_opt_flow_fields_short_artifact_counts_missing(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(5)}  # below _MIN_TICKERS
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import opt_flow as of

    failures = {}
    out = of.read_opt_flow_fields(["T0000"], failures=failures)

    assert out == {}
    assert failures["opt_flow"]["missing"] == 1


def test_read_opt_flow_fields_stale_is_served_but_counted(tmp_path, monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(30)}
    _write_artifact(tmp_path, monkeypatch, rows, as_of=old)
    from api.services.screener import opt_flow as of

    failures = {}
    out = of.read_opt_flow_fields(["T0000"], failures=failures)

    assert out["T0000"]["opt_bull_pct_1d"] == 62.5
    assert any(k.startswith("stale:") for k in failures["opt_flow"])


def test_read_opt_flow_fields_fresh_not_counted_stale(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(30)}
    _write_artifact(tmp_path, monkeypatch, rows)  # as_of defaults to now
    from api.services.screener import opt_flow as of

    failures = {}
    out = of.read_opt_flow_fields(["T0000"], failures=failures)

    assert out["T0000"]["opt_net_premium_1d"] == 1_000_000.0
    assert failures == {}


def test_read_opt_flow_fields_per_column_presence(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(29)}
    rows["T9999"] = {"opt_net_premium_1d": 500.0}  # 5d never computed for this ticker
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import opt_flow as of

    out = of.read_opt_flow_fields(["T0000", "T9999"])

    assert out["T0000"]["opt_net_premium_5d"] == 4_200_000.0
    assert out["T9999"]["opt_net_premium_1d"] == 500.0
    assert "opt_net_premium_5d" not in out["T9999"]
    assert "opt_bull_pct_1d" not in out["T9999"]


def test_read_opt_flow_fields_ticker_absent_from_rows(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": _row(f"T{i:04d}") for i in range(30)}
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import opt_flow as of

    out = of.read_opt_flow_fields(["NOPE"])

    assert out["NOPE"] == {}


def test_read_opt_flow_fields_json_null_artifact_guard(tmp_path, monkeypatch):
    artifact = tmp_path / "opt_flow.json"
    artifact.write_text("null")
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(artifact))
    from api.services.screener import opt_flow as of

    failures = {}
    out = of.read_opt_flow_fields(["AAA"], failures=failures)

    assert out == {}
    assert failures["opt_flow"]["missing"] == 1


# ── job registration (OFF-flag case; the ON case + AST is
# tests/test_screener_wave2_jobs.py) ──────────────────────────────────────

class _FakeSched:
    def __init__(self):
        self.ids = []

    def add_job(self, *a, **k):
        self.ids.append(k.get("id"))


def test_opt_flow_pull_job_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_OPTFLOW_PULL_ENABLED", "0")
    import api.main as m

    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    assert "screener_opt_flow_pull" not in sched.ids
    assert "screener_snapshot_nightly" in sched.ids  # control: siblings unaffected
