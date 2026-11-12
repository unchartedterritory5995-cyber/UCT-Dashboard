"""Boot quiet window (2026-11-12): jobs no member waits for start minutes after boot.

boot-probe `hot=` measured the first five minutes after a deploy at 150-430% CPU while every
member's tab reconnects; the flow.db integrity scan (100% of a core at boot+17 s), the bars
continuous audit and the breadth self-heal were among the top burners. These rails read
main.py's own source (importing it boots the app) and pin that each start goes through the
quiet-window table and that the table keeps them minutes out.
"""
import pathlib
import re

MAIN = (pathlib.Path(__file__).resolve().parents[2] / "api" / "main.py").read_text(encoding="utf-8")


def _table():
    m = re.search(r"_BOOT_QUIET_S = \{(.*?)\}", MAIN, re.S)
    assert m, "_BOOT_QUIET_S table missing from api/main.py"
    return {k: int(v) for k, v in re.findall(r'"(\w+)":\s*(\d+)', m.group(1))}


def test_quiet_window_table_keeps_each_job_minutes_out():
    t = _table()
    assert t.get("flow_integrity_probe", 0) >= 300
    assert t.get("bars_continuous_audit", 0) >= 120
    assert t.get("breadth_self_heal", 0) >= 120


def test_each_start_site_reads_the_table():
    probe = MAIN[MAIN.index("def _flow_integrity_probe():"):][:900]
    assert 'time.sleep(_BOOT_QUIET_S["flow_integrity_probe"])' in probe
    assert 'threading.Timer(_BOOT_QUIET_S["bars_continuous_audit"], _start_bars_continuous_audit)' in MAIN
    assert 'start_background_heal(delay_seconds=_BOOT_QUIET_S["breadth_self_heal"])' in MAIN
    wrapper = MAIN[MAIN.index("def _start_bars_continuous_audit():"):][:120]
    assert "bars_continuous_audit.start()" in wrapper
    assert MAIN.count("bars_continuous_audit.start()") == 1, "an immediate audit start came back"
