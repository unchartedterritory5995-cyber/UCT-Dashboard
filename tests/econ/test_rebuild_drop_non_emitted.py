"""tools/econ/rebuild_local_db.py --drop-non-emitted: a backfill NULL row the CURRENT adapter
no longer emits from its own archived payload (fed_ddp daily ND = market holiday) is dropped;
everything else is carried/re-placed and verified. Fail closed without evidence."""
from __future__ import annotations

import importlib.util
import shutil
import sqlite3
from pathlib import Path

import pytest

from api.services.econ import store as S
from api.services.econ.adapters import fed_ddp
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ import registry as R

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures" / "fed_ddp" / "FRB_h15_xml_trim.zip"
SHA = "f" * 64
T0 = 1_790_000_000


def _tool():
    spec = importlib.util.spec_from_file_location("rebuild_local_db", ROOT / "tools" / "econ" / "rebuild_local_db.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _old_rows():
    """UST10Y rows as the PRE-FIX adapter wrote them: ND kept as a None row."""
    sp = SeriesSpec(R.get("UST10Y"))
    parsed = fed_ddp.parse_sdmx_zip(FIX.read_bytes(), {fed_ddp.mnemonic_of(sp)})
    rows = fed_ddp.select_series(parsed, sp)["rows"]
    out = []
    for label, raw, status in rows:
        v = fed_ddp.parse_value(raw, status)
        out.append((str(label), v))
    return out


def _make_old(tmp_path, extra_valued=None, archive=True):
    arch = tmp_path / "archive"
    if archive:
        (arch / "fed_ddp").mkdir(parents=True)
        shutil.copy(FIX, arch / "fed_ddp" / f"{SHA}.bin")
    old = tmp_path / "old.db"
    s = S.connect(str(old))
    acq = s.record_acquisition("fed_ddp", "fed_ddp:release_xml:H15:test")
    s.finish_acquisition(acq, outcome="ok", archive_ref=f"local:fed_ddp/{SHA}.bin")
    rel = s.upsert_release("backfill:UST10Y:test", "fed:h15", "backfill", None, acq)
    rows = _old_rows() + ([(extra_valued, 9.99)] if extra_valued else [])
    s.write_observations("UST10Y", rel, [(ps, ps, v, "", T0, "rule", "V", acq, None) for ps, v in rows])
    s.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    s.close()
    return old, arch, rows


def test_drop_removes_exactly_the_nd_rows_and_verifies(tmp_path):
    tool = _tool()
    old, arch, rows = _make_old(tmp_path)
    nd = {ps for ps, v in rows if v is None}
    assert nd, "fixture carries ND rows"
    rep = tool.rebuild(str(old), str(tmp_path / "new.db"), stamp="t", log=lambda *a: None,
                       drop_non_emitted=True, archive_dir=str(arch), probes=[])
    v = rep["verify"]
    assert v["ok"], v["failures"]
    assert rep["dropped"]["count"] == len(nd) and rep["dropped"]["by_series"] == {"UST10Y": len(nd)}
    assert v["daily_null_shares_date_with_value"] == {}
    assert v["latest_excused_dropped_nulls"] == {"UST10Y": len(nd)}
    c = sqlite3.connect(str(tmp_path / "new.db"))
    got = dict(c.execute("SELECT period_start, value FROM observation WHERE series_id='UST10Y'").fetchall())
    assert set(got) == {ps for ps, _ in rows} - nd
    assert all(x is not None for x in got.values())
    assert old.exists()                                          # the old DB is never touched


def test_negative_control_without_the_flag_nothing_is_dropped_and_the_masking_is_visible(tmp_path):
    tool = _tool()
    old, arch, rows = _make_old(tmp_path)
    rep = tool.rebuild(str(old), str(tmp_path / "new.db"), stamp="t", log=lambda *a: None, probes=[])
    assert rep["dropped"]["count"] == 0 and rep["verify"]["ok"]
    assert rep["verify"]["daily_null_shares_date_with_value"].get("UST10Y", 0) > 0   # the defect, measured


def test_fails_closed_on_a_valued_row_the_adapter_does_not_emit(tmp_path):
    tool = _tool()
    old, arch, _ = _make_old(tmp_path, extra_valued="2001-01-03")   # not in the trimmed payload
    with pytest.raises(SystemExit, match="VALUED"):
        tool.rebuild(str(old), str(tmp_path / "new.db"), stamp="t", log=lambda *a: None,
                     drop_non_emitted=True, archive_dir=str(arch), probes=[])


def test_fails_closed_without_the_archive(tmp_path):
    tool = _tool()
    old, arch, _ = _make_old(tmp_path, archive=False)
    with pytest.raises(SystemExit, match="missing"):
        tool.rebuild(str(old), str(tmp_path / "new.db"), stamp="t", log=lambda *a: None,
                     drop_non_emitted=True, archive_dir=str(arch), probes=[])
