"""Quote of the Day — server pick contract.

The library (app/src/constants/quotes.json) is shared with the frontend; the
server adds the regime-aware pool and the ET-day key. These tests pin:
  * the library is loadable and tagged from the fixed vocabulary
  * every regime pool is usable and a FULL CYCLE (no repeat before exhaustion)
  * the walk is deterministic per day and keyed on the engine's tier word
  * STRIDE parity with app/src/constants/quotes.js, and the global pick matches
    the JS rotation for the same calendar day (run through node when present)
  * the public route: date/label handling and the wire-derived default tier
"""

from __future__ import annotations

import re
import shutil
import subprocess
from datetime import date, timedelta
from math import gcd
from pathlib import Path

import pytest

from api.services import quote_of_the_day as qotd

ROOT = Path(__file__).resolve().parents[1]
ROTATION_JS = ROOT / "app" / "src" / "constants" / "quoteRotation.js"


@pytest.fixture(autouse=True)
def _fresh_library():
    qotd.load_library.cache_clear()
    yield
    qotd.load_library.cache_clear()


# ── library ──────────────────────────────────────────────────────────────────

def test_library_loads_from_the_shared_json():
    lib = qotd.load_library()
    assert len(lib) >= 450
    for q in lib:
        assert q["t"] and q["a"] and isinstance(q["src"], str)
        assert 1 <= len(q["tags"]) <= 3 and set(q["tags"]) <= set(qotd.TAGS)


def test_every_regime_pool_is_usable():
    for tier in qotd.REGIME_TAGS:
        assert len(qotd.pool_for(tier)) >= 40, tier


def test_unknown_or_blank_label_means_the_whole_library():
    n = len(qotd.load_library())
    for label in (None, "", "   ", "Sideways", "GREEN"):
        assert len(qotd.pool_for(label)) == n
        assert qotd.normalize_label(label) is None


def test_label_is_case_insensitive_and_normalized():
    assert qotd.normalize_label("neutral") == "Neutral"
    assert qotd.normalize_label("  DEFENSIVE ") == "Defensive"


# ── rotation ─────────────────────────────────────────────────────────────────

def test_pick_is_deterministic_per_day_and_changes_across_days():
    d = date(2026, 8, 24)
    a, b = qotd.pick(d, "Neutral"), qotd.pick(d, "Neutral")
    assert a["quote"] == b["quote"] and a["label"] == "Neutral" and a["pool_size"] > 0
    assert qotd.pick(d + timedelta(days=1), "Neutral")["quote"] != a["quote"]


@pytest.mark.parametrize("tier", [None, *qotd.REGIME_TAGS])
def test_each_pool_is_a_full_cycle(tier):
    pool = qotd.pool_for(tier)
    n = len(pool)
    assert gcd(qotd.stride_for(n), n) == 1
    start = date(2026, 8, 24)
    seen = {qotd.pick(start + timedelta(days=i), tier)["quote"]["t"] for i in range(n)}
    assert len(seen) == n


def test_regime_pick_carries_a_preferred_tag():
    for tier, tags in qotd.REGIME_TAGS.items():
        q = qotd.pick(date(2026, 8, 24), tier)["quote"]
        assert set(q["tags"]) & set(tags), (tier, q)


def test_day_ordinal_advances_by_one_across_month_and_year_ends():
    assert qotd.day_ordinal(date(2026, 12, 31)) + 1 == qotd.day_ordinal(date(2027, 1, 1))
    assert qotd.day_ordinal(date(2026, 2, 28)) + 1 == qotd.day_ordinal(date(2026, 3, 1))


def test_missing_library_yields_no_quote_not_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(qotd, "LIBRARY_PATH", tmp_path / "nope.json")
    qotd.load_library.cache_clear()
    out = qotd.pick(date(2026, 8, 24), "Neutral")
    assert out["quote"] is None and out["pool_size"] == 0


# ── parity with the frontend ─────────────────────────────────────────────────

def test_stride_matches_the_js_constant():
    src = ROTATION_JS.read_text(encoding="utf-8")
    m = re.search(r"export const STRIDE = (\d+)", src)
    assert m, "STRIDE declaration not found in quoteRotation.js"
    assert int(m.group(1)) == qotd.STRIDE


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_pick_index_matches_the_js_rotation():
    # quoteRotation.js is pure (no JSON import), so plain Node loads it. Compare
    # the walk itself — index for a given (ordinal, pool size) — across a spread
    # of pool sizes including ones that are NOT coprime with the nominal stride,
    # plus the real library size. JS keys off LOCAL Y/M/D; Python off a date —
    # the same ordinal for 2026-08-24 either way.
    n_lib = len(qotd.load_library())
    sizes = [n_lib, 131, 262, 393, 1, 2, 50, 674, 700]
    js = (
        "import('./src/constants/quoteRotation.js').then(m => {"
        f"  const sizes = {sizes};"
        "  const o = m.dayOrdinal(new Date(2026, 7, 24));"
        "  const out = sizes.map(n => [o, n, m.pickIndex(o, n)].join(':'));"
        "  out.push(...[0, 1, 2, 365, 20322].map(d => [d, sizes[0], m.pickIndex(d, sizes[0])].join(':')));"
        "  process.stdout.write(out.join(' '));"
        "})"
    )
    r = subprocess.run(["node", "-e", js], cwd=ROOT / "app", capture_output=True, text=True,
                       timeout=60, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    rows = [tuple(int(x) for x in row.split(":")) for row in r.stdout.split()]
    assert rows, r.stdout
    assert rows[0][0] == qotd.day_ordinal(date(2026, 8, 24))
    for ordinal, n, idx in rows:
        assert qotd.pick_index(ordinal, n) == idx, (ordinal, n, idx)


# ── the wire-derived default tier ────────────────────────────────────────────

def test_current_label_reads_the_engine_tier_from_the_wire(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "_load_wire_data",
                        lambda: {"game_plan": {"exposure_tier": "Caution"}})
    assert qotd.current_label() == "Caution"
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"game_plan": {}})
    assert qotd.current_label() is None
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    assert qotd.current_label() is None


def test_current_label_never_raises(monkeypatch):
    from api.services import engine
    def boom():
        raise RuntimeError("cache down")
    monkeypatch.setattr(engine, "_load_wire_data", boom)
    assert qotd.current_label() is None


# ── the route ────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


def test_route_is_public_and_honours_date_and_label(client):
    r = client.get("/api/quote-of-the-day", params={"date": "2026-08-24", "label": "Neutral"})
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-08-24" and body["label"] == "Neutral"
    assert body["quote"] == qotd.pick(date(2026, 8, 24), "Neutral")["quote"]
    assert set(body["quote"]["tags"]) & set(qotd.REGIME_TAGS["Neutral"])


def test_route_rejects_a_malformed_date(client):
    assert client.get("/api/quote-of-the-day", params={"date": "08/24/2026"}).status_code == 400
    assert client.get("/api/quote-of-the-day", params={"date": "2026-13-40"}).status_code == 400


def test_route_default_is_anchored_to_the_latest_wire(client, monkeypatch):
    # Saturday: the latest wire is Friday's. The site shows Friday's quote until
    # Monday's wire lands — not a midnight flip, not a provisional pick.
    monkeypatch.setattr(qotd, "current_wire", lambda: (date(2026, 8, 21), "Neutral"))
    monkeypatch.setattr(qotd, "today_et", lambda: date(2026, 8, 22))
    body = client.get("/api/quote-of-the-day").json()
    assert body["date"] == "2026-08-21" and body["label"] == "Neutral"
    assert body["quote"] == qotd.pick(date(2026, 8, 21), "Neutral")["quote"]
    # ...and the engine, asking for that wire's date + tier explicitly, gets the same line.
    explicit = client.get("/api/quote-of-the-day", params={"date": "2026-08-21", "label": "Neutral"}).json()
    assert explicit["quote"] == body["quote"]


def test_route_with_no_wire_falls_back_to_today_et_and_the_whole_library(client, monkeypatch):
    monkeypatch.setattr(qotd, "current_wire", lambda: (None, None))
    monkeypatch.setattr(qotd, "today_et", lambda: date(2026, 8, 24))
    body = client.get("/api/quote-of-the-day").json()
    assert body["date"] == "2026-08-24" and body["label"] is None
    assert body["pool_size"] == len(qotd.load_library())


def test_current_wire_parses_the_date_and_tier_and_tolerates_garbage(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "_load_wire_data",
                        lambda: {"date": "2026-08-21", "game_plan": {"exposure_tier": "neutral"}})
    assert qotd.current_wire() == (date(2026, 8, 21), "Neutral")
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "21/08/2026", "game_plan": "nope"})
    assert qotd.current_wire() == (None, None)
    monkeypatch.setattr(engine, "_load_wire_data", lambda: "not a dict")
    assert qotd.current_wire() == (None, None)


def test_route_treats_an_unknown_label_as_no_regime(client):
    body = client.get("/api/quote-of-the-day", params={"date": "2026-08-24", "label": "Sideways"}).json()
    assert body["label"] is None and body["pool_size"] == len(qotd.load_library())
