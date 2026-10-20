"""Study -- the bank importer script (scripts/study/import_bank.py).

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A SILENT ZERO. The first pod run printed `stored: 0` because the counter
   read keys the route does not return; `summarise` reads the route's real
   keys (`inserted`/`updated`/`terms` ints, `flagged`/`misses`/`rejected` lists).
2. A SEGMENT LOST TO ORDERING OR FILTERING. `iter_bank` returns every *.json
   in name order, keeps an empty file as `[]`, and `--only` narrows by stem.
3. A RUN WITHOUT THE SECRET. No PUSH_SECRET -> exit 2 before any request.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.study import import_bank as job  # noqa: E402


def test_summarise_reads_the_routes_real_keys():
    resp = {"inserted": 54, "updated": 0, "ids": ["a"] * 54, "terms": 0,
            "misses": [{"id": "x"}], "rejected": [], "flagged": [{"id": "y"}, {"id": "z"}]}
    assert job.summarise(resp) == {"inserted": 54, "updated": 0, "terms": 0,
                                   "flagged": 2, "misses": 1, "rejected": 0}


def test_summarise_tolerates_missing_keys():
    assert job.summarise({}) == {k: 0 for k in job.COUNT_KEYS}


def test_add_totals_accumulates():
    tot: dict = {}
    job.add_totals(tot, {"inserted": 2, "misses": 1})
    job.add_totals(tot, {"inserted": 3, "flagged": 4})
    assert tot == {"inserted": 5, "misses": 1, "flagged": 4}


def test_iter_bank_order_empty_and_only(tmp_path):
    (tmp_path / "b.second.json").write_text(json.dumps([{"id": "si_2"}]), encoding="utf-8")
    (tmp_path / "a.first.json").write_text(json.dumps([{"id": "si_1"}]), encoding="utf-8")
    (tmp_path / "c.empty.json").write_text("[]", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignored", encoding="utf-8")
    segs = job.iter_bank(tmp_path)
    assert [s for s, _ in segs] == ["a.first", "b.second", "c.empty"]
    assert segs[2][1] == []
    assert [s for s, _ in job.iter_bank(tmp_path, only=["b.second"])] == ["b.second"]


def test_iter_bank_refuses_a_non_list(tmp_path):
    (tmp_path / "bad.json").write_text(json.dumps({"id": "si_1"}), encoding="utf-8")
    with pytest.raises(ValueError):
        job.iter_bank(tmp_path)


def test_main_dry_run_posts_nothing(tmp_path, monkeypatch, capsys):
    (tmp_path / "x.json").write_text(json.dumps([{"id": "si_1"}, {"id": "si_2"}]), encoding="utf-8")
    monkeypatch.setattr(job, "post_segment", lambda *a, **k: pytest.fail("posted during dry-run"))
    assert job.main(["--bank", str(tmp_path), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "x: 2 items" in out and "nothing posted" in out


def test_main_without_secret_exits_before_posting(tmp_path, monkeypatch):
    (tmp_path / "x.json").write_text(json.dumps([{"id": "si_1"}]), encoding="utf-8")
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.setattr(job, "post_segment", lambda *a, **k: pytest.fail("posted without secret"))
    assert job.main(["--bank", str(tmp_path)]) == 2


def test_main_posts_each_segment_and_totals(tmp_path, monkeypatch, capsys):
    (tmp_path / "a.json").write_text(json.dumps([{"id": "si_1"}, {"id": "si_2"}]), encoding="utf-8")
    (tmp_path / "b.json").write_text("[]", encoding="utf-8")
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("PORT", "9999")
    seen = []

    def fake_post(url, secret, items, timeout=600.0):
        seen.append((url, secret, len(items)))
        return {"inserted": len(items), "updated": 0, "ids": [], "terms": 0,
                "misses": [], "rejected": [], "flagged": []}

    monkeypatch.setattr(job, "post_segment", fake_post)
    assert job.main(["--bank", str(tmp_path)]) == 0
    assert seen == [("http://127.0.0.1:9999/api/study/import", "s3cret", 2)]
    out = capsys.readouterr().out
    assert "b: empty, skipped" in out
    assert "'inserted': 2" in out and "failed_segments=0" in out
