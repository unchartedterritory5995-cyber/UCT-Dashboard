"""Study blocker B1 -- the Sunday Scans image copy job.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A DEAD HOT-LINK STORED AS A CHART. Substack returns an HTML page for a
   missing image; the job must refuse anything that is not image bytes.
2. A GUESSED TICKER PROMOTED TO A KEY. `label_ticker` is copied as a HINT only;
   `ticker_confirmed` stays None until the owner's review screen fills it.
3. A RE-RUN THAT RE-DOWNLOADS 2,953 IMAGES. The ledger makes the pass
   resumable and idempotent by image_id; failures are retried, stores are not.
4. A WRITE TO THE WISDOM TABLE. The job reads `wisdom_chart_images` and writes
   only its own ledger (checked by reading the table back unchanged).
"""
from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path

import pytest  # noqa: F401 - fixtures

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.study import copy_scans_images as job  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
HTML = b"<!doctype html><html><body>not found</body></html>"


def _row(i, ticker="PLTR"):
    return {"image_id": f"url-sha256:{i:064x}", "source_id": "src", "segment_id": None,
            "public_url": f"https://substackcdn.com/image/{i}.png", "width": 1000,
            "height": 600, "label_text": f"{ticker} (Daily)", "label_ticker": ticker,
            "label_timeframe": "Daily", "created_at": "2026-06-08T00:00:00Z"}


def test_ext_detection_by_content_type_then_magic_bytes():
    assert job.ext_for("image/png", b"") == "png"
    assert job.ext_for("image/jpeg; charset=binary", b"") == "jpg"
    assert job.ext_for(None, PNG) == "png"
    assert job.ext_for("text/html", HTML) is None
    assert job.ext_for("application/octet-stream", b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"


def test_a_dead_link_is_recorded_as_not_an_image_and_never_uploaded():
    puts = []
    entry = job.copy_one(_row(1), fetch=lambda u: (200, "text/html", HTML),
                         put=lambda k, d, ct: puts.append(k) or True)
    assert entry["status"] == "not_an_image" and puts == []
    entry = job.copy_one(_row(2), fetch=lambda u: (404, "text/html", HTML),
                         put=lambda k, d, ct: puts.append(k) or True)
    assert entry["status"] == "fetch_failed" and entry["reason"] == "http 404" and puts == []


def test_a_fetch_exception_is_recorded_not_raised():
    def boom(url):
        raise TimeoutError("slow cdn")
    entry = job.copy_one(_row(3), fetch=boom, put=lambda k, d, ct: True)
    assert entry["status"] == "fetch_error" and "TimeoutError" in entry["reason"]


def test_a_stored_image_is_keyed_by_its_content_hash_and_keeps_the_ticker_as_a_hint():
    puts = {}
    entry = job.copy_one(_row(4, ticker="NVDA"), fetch=lambda u: (200, "image/png", PNG),
                         put=lambda k, d, ct: puts.__setitem__(k, (d, ct)) or True)
    sha = hashlib.sha256(PNG).hexdigest()
    assert entry["status"] == "stored"
    assert entry["r2_key"] == f"study/scans/{sha}.png" and entry["sha256"] == sha
    assert puts[entry["r2_key"]] == (PNG, "image/png")
    assert entry["ticker_hint"] == "NVDA" and entry["ticker_confirmed"] is None


def test_a_rerun_skips_stored_rows_retries_failures_and_honours_the_limit():
    rows = [_row(i) for i in range(1, 6)]
    ledger = {rows[0]["image_id"]: {"status": "stored", "r2_key": "study/scans/x.png"},
              rows[1]["image_id"]: {"status": "fetch_failed", "reason": "http 503"}}
    fetched = []

    def fetch(url):
        fetched.append(url)
        return 200, "image/jpeg", JPG

    counts = job.run(rows, ledger, fetch=fetch, put=lambda k, d, ct: True,
                     limit=2, pace_seconds=0)
    assert counts == {"stored": 2, "skipped": 1, "failed": 0}
    assert fetched == [rows[1]["public_url"], rows[2]["public_url"]]  # the failure first, then new
    assert ledger[rows[1]["image_id"]]["status"] == "stored"
    assert rows[3]["image_id"] not in ledger  # beyond the limit, untouched


def test_pending_rows_reads_only_sunday_scans_with_a_url_and_writes_nothing(tmp_path):
    db = sqlite3.connect(tmp_path / "w.db")
    db.execute("""CREATE TABLE wisdom_chart_images (image_id TEXT PRIMARY KEY, source_id TEXT,
                  segment_id TEXT, origin TEXT, public_url TEXT, r2_key TEXT, width INTEGER,
                  height INTEGER, label_text TEXT, label_ticker TEXT, label_timeframe TEXT,
                  status TEXT, created_at TEXT)""")
    db.executemany("INSERT INTO wisdom_chart_images VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        ("a", "s1", None, "sunday_scans", "https://x/a.png", None, 1, 1, "SPY (Daily)", "SPY", "Daily", "provisional", "2026-06-01"),
        ("b", "s1", None, "zoom_frame", "https://x/b.png", None, 1, 1, None, None, None, "provisional", "2026-06-01"),
        ("c", "s2", None, "sunday_scans", None, None, 1, 1, None, None, None, "provisional", "2026-06-02"),
        ("d", "s2", None, "sunday_scans", "https://x/d.png", None, 1, 1, "QQQ", "QQQ", None, "provisional", "2026-05-01"),
    ])
    db.commit()
    before = db.execute("SELECT * FROM wisdom_chart_images ORDER BY image_id").fetchall()
    rows = job.pending_rows(db)
    assert [r["image_id"] for r in rows] == ["d", "a"]  # oldest first, scans with a url only
    assert db.execute("SELECT * FROM wisdom_chart_images ORDER BY image_id").fetchall() == before


def test_ledger_round_trip_is_atomic_and_tolerates_a_missing_file(tmp_path):
    p = tmp_path / "ledger.json"
    assert job.load_ledger(p) == {}
    job.save_ledger(p, {"k": {"status": "stored"}})
    assert job.load_ledger(p) == {"k": {"status": "stored"}}
    assert not (tmp_path / "ledger.json.tmp").exists()


def test_ledger_path_honours_the_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDY_SCANS_LEDGER", str(tmp_path / "x.json"))
    assert job.ledger_path() == tmp_path / "x.json"
    monkeypatch.delenv("STUDY_SCANS_LEDGER")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert job.ledger_path() == tmp_path / "study_scans_ledger.json"
