"""Writes the nightly visual-journey run's dated JSON report.

Kept separate from run_nightly_visual_journey.ps1 (which drives the actual
Playwright journey) so the report SHAPE has its own test, independent of
booting a real backend/frontend.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def write_report(
    *,
    journey_report: dict | None,
    exit_code: int,
    backend_boot_ok: bool,
    frontend_boot_ok: bool,
    date_str: str | None = None,
) -> Path:
    date_str = date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = Path("docs/pine/nightly-journey")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{date_str}.json"

    payload = {
        "date": date_str,
        "base": (journey_report or {}).get("base"),
        "fixtures_dir": (journey_report or {}).get("fixtures"),
        "exit_code": exit_code,
        "backend_boot_ok": backend_boot_ok,
        "frontend_boot_ok": frontend_boot_ok,
        "rows": (journey_report or {}).get("rows", []),
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--journey-report-path", default=None,
                         help="Path to c0_visual_journey.py's own report.json, or omit if the journey never ran")
    parser.add_argument("--exit-code", type=int, required=True)
    parser.add_argument("--backend-boot-ok", choices=["true", "false"], required=True)
    parser.add_argument("--frontend-boot-ok", choices=["true", "false"], required=True)
    args = parser.parse_args()

    journey_report = None
    if args.journey_report_path and Path(args.journey_report_path).exists():
        journey_report = json.loads(Path(args.journey_report_path).read_text(encoding="utf-8"))

    out_path = write_report(
        journey_report=journey_report,
        exit_code=args.exit_code,
        backend_boot_ok=args.backend_boot_ok == "true",
        frontend_boot_ok=args.frontend_boot_ok == "true",
    )
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
