import json
from pathlib import Path
from datetime import datetime, timezone

import pytest

from scripts.nightly_visual_journey_report import write_report


def test_write_report_creates_dated_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    journey_report = {
        "base": "http://127.0.0.1:18500",
        "fixtures": "tools/c0_oos_fixtures",
        "rows": [{"file": "high_engagement__02-waddah-attar-explosion-lazybear.pine", "ok": True}],
    }
    out_path = write_report(
        journey_report=journey_report,
        exit_code=0,
        backend_boot_ok=True,
        frontend_boot_ok=True,
        date_str="2026-09-20",
    )
    assert out_path == Path("docs/pine/nightly-journey/2026-09-20.json")
    saved = json.loads(out_path.read_text(encoding="utf-8"))
    assert saved["date"] == "2026-09-20"
    assert saved["exit_code"] == 0
    assert saved["backend_boot_ok"] is True
    assert saved["rows"] == journey_report["rows"]


def test_write_report_records_boot_failure_without_rows(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    out_path = write_report(
        journey_report=None,
        exit_code=1,
        backend_boot_ok=False,
        frontend_boot_ok=False,
        date_str="2026-09-20",
    )
    saved = json.loads(out_path.read_text(encoding="utf-8"))
    assert saved["backend_boot_ok"] is False
    assert saved["rows"] == []
    assert saved["exit_code"] == 1


def test_cli_reads_journey_report_file_and_writes_dated_report(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    journey_report_path = tmp_path / "report.json"
    journey_report_path.write_text(
        json.dumps({"base": "http://127.0.0.1:18500", "fixtures": "tools/c0_oos_fixtures", "rows": [{"file": "x.pine", "ok": True}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "nightly_visual_journey_report.py",
            "--journey-report-path", str(journey_report_path),
            "--exit-code", "0",
            "--backend-boot-ok", "true",
            "--frontend-boot-ok", "true",
        ],
    )
    from scripts.nightly_visual_journey_report import _main
    assert _main() == 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = json.loads(Path(f"docs/pine/nightly-journey/{today}.json").read_text(encoding="utf-8"))
    assert saved["rows"] == [{"file": "x.pine", "ok": True}]


def test_cli_handles_missing_journey_report_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "sys.argv",
        [
            "nightly_visual_journey_report.py",
            "--exit-code", "1",
            "--backend-boot-ok", "false",
            "--frontend-boot-ok", "false",
        ],
    )
    from scripts.nightly_visual_journey_report import _main
    assert _main() == 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = json.loads(Path(f"docs/pine/nightly-journey/{today}.json").read_text(encoding="utf-8"))
    assert saved["rows"] == []
    assert saved["backend_boot_ok"] is False
