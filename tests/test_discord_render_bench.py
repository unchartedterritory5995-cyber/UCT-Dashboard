"""The bench's own arithmetic. A bench whose percentile or diff is wrong reports a
system property that belongs to the instrument — so the instrument is railed."""
from __future__ import annotations

import io
import json

from tools import discord_render_bench as bench


def _png(color=(10, 10, 10), size=(40, 20), dot=None) -> bytes:
    from PIL import Image
    im = Image.new("RGB", size, color)
    if dot:
        im.putpixel(dot, (255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_percentile_is_nearest_rank_and_ignores_none():
    xs = [5, 1, None, 3, 2, 4]
    assert bench.pct(xs, 50) == 3
    assert bench.pct(xs, 100) == 5
    assert bench.pct(xs, 0) == 1
    assert bench.pct([], 50) is None
    # a tail percentile on a small sample is the max, never an interpolated number nobody measured
    assert bench.pct([10, 20, 30], 99) == 30


def test_pixel_diff_separates_same_bytes_from_same_picture():
    a = _png()
    assert bench.pixel_diff(a, a)["same_bytes"] is True
    b = _png(dot=(3, 4))
    d = bench.pixel_diff(a, b)
    assert d["same_bytes"] is False and d["same_size"] is True
    assert d["bbox"] == [3, 4, 4, 5]
    assert 0 < d["changed_pct"] < 1.5


def test_pixel_diff_reports_a_size_change_rather_than_a_percentage():
    d = bench.pixel_diff(_png(size=(40, 20)), _png(size=(40, 21)))
    assert d["same_size"] is False and "changed_pct" not in d


def test_pixel_diff_refuses_to_compare_a_missing_image():
    # a failed run must not read as "identical" to a successful one
    assert bench.pixel_diff(None, _png())["comparable"] is False
    assert bench.pixel_diff(_png(), None)["same_bytes"] is False


def test_summary_groups_hops_and_judges_determinism_per_case():
    rows = [
        {"case_id": "chart:SPY:D", "kind": "chart", "group": "liquid", "outcome": "ok", "delivered": True,
         "hops_ms": {"house_render": 2000.0}, "png_bytes": 100, "png_sha": "a", "diff_vs_first": None},
        {"case_id": "chart:SPY:D", "kind": "chart", "group": "liquid", "outcome": "ok", "delivered": True,
         "hops_ms": {"house_render": 3000.0}, "png_bytes": 100, "png_sha": "b",
         "diff_vs_first": {"same_bytes": False, "changed_pct": 0.2, "bbox": [1, 2, 3, 4]}},
        {"case_id": "chart:ZZZZQ:D", "kind": "chart", "group": "edge", "outcome": "no_bars", "delivered": False,
         "hops_ms": {"bars_D": 900.0}, "png_bytes": None, "png_sha": None, "diff_vs_first": None},
    ]
    s = bench.summarize(rows)
    liquid = s["groups"]["chart:liquid"]
    assert liquid["success_rate"] == 1.0
    assert liquid["hops_ms"]["house_render"]["p50"] == 2000.0
    assert liquid["hops_ms"]["house_render"]["max"] == 3000.0
    assert s["groups"]["chart:edge"]["success_rate"] == 0.0
    det = s["determinism"]["chart:SPY:D"]
    assert det["byte_identical"] is False and det["bboxes"] == [[1, 2, 3, 4]]
    assert "chart:ZZZZQ:D" not in s["determinism"]      # one run cannot say anything about determinism


def test_a_hop_that_did_not_happen_is_left_out_not_counted_and_does_not_crash():
    # The real baseline's first summary crashed here: a no-bars case has no first image.
    rows = [
        {"case_id": "chart:ZZZZQ:D", "kind": "chart", "group": "edge", "outcome": "no_bars", "delivered": False,
         "hops_ms": {"bars_D": 900.0, "e2e_first_image": None}, "png_bytes": None, "png_sha": None, "diff_vs_first": None},
        {"case_id": "chart:SPY:D", "kind": "chart", "group": "edge", "outcome": "ok", "delivered": True,
         "hops_ms": {"bars_D": 10.0, "e2e_first_image": 2000.0}, "png_bytes": 5, "png_sha": "a", "diff_vs_first": None},
    ]
    s = bench.summarize(rows)["groups"]["chart:edge"]["hops_ms"]
    assert s["e2e_first_image"]["n"] == 1 and s["e2e_first_image"]["max"] == 2000.0
    assert s["bars_D"]["n"] == 2


def test_dry_run_writes_one_row_per_case_run_and_a_summary(tmp_path):
    out = tmp_path / "bench.jsonl"
    assert bench.main(["--dry", "--out", str(out), "--runs", "2", "--limit", "3", "--sleep-ms", "0"]) == 0
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 6
    assert all("_png" not in r for r in rows)              # bytes never land in the JSONL
    summary = json.loads((tmp_path / "bench.jsonl.summary.json").read_text(encoding="utf-8"))
    assert summary["groups"]
    # SPY's fake frame carries a clock, so a second run can differ — the harness must SAY so, not hide it
    spy = [k for k in summary["determinism"] if ":SPY:" in k]
    assert spy


def test_bench_never_leaves_self_heal_on(tmp_path, monkeypatch):
    monkeypatch.setenv("DISCORD_CHART_SELF_HEAL", "1")
    bench.main(["--dry", "--out", str(tmp_path / "b.jsonl"), "--runs", "1", "--limit", "1", "--sleep-ms", "0"])
    import os
    assert os.environ["DISCORD_CHART_SELF_HEAL"] == "0"
