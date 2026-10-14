"""base_pivot_px is written only from the HEAD structure's own detection.

Structure -> detector mapping (each `Structure.pivot` calls the detector with
EXACTLY the arguments that structure's `detect` passes, and applies the same
qualification gate `detect` applies):

    flat-base            flat_base_state(ctx.bars), only if flat_base_qualifies(st, ctx.bars)
    base-on-base         base_on_base_state(ctx.bars) -> its `pivot2` (the newer base's pivot)
    double-bottom        double_bottom_state(ctx)
    high-tight-flag      high_tight_flag_state(ctx)
    vcp                  vcp_state(ctx)
    ascending-base       ascending_base_state(ctx)
    square-box           square_box_state(ctx.bars), only if prior_advance >= BOX_PRIOR_ADVANCE
    cup-with-handle      cup.cup_with_handle_state(ctx.bars) (primitives/cup.py; its state carries `pivot`)
    cheat-3c             cheat_3c_state(ctx)
    low-cheat            low_cheat_state(ctx)
    saucer               saucer_state(ctx)
    three-weeks-tight    three_weeks_tight_state(ctx.bars), only if pairwise <= TWT_MAX_PAIRWISE

No pivot concept (pivot=None): darvas-box, green-line-breakout, pocket-pivot,
power-play, stage-2-breakout, stage-4-breakdown, ugly-double-bottom, climax-top, parabolic-extension,
wyckoff-spring, buyable-gap-up, ema-crossback, go-signal, and the four shape
structures and the fallback shape.
"""
import dataclasses
import math

import pytest

from api.services.screener import base_catalog, bases


def _bars_flat_base():
    # 80 bars: a 50% advance then a tight 30-bar flat base.
    out, p = [], 100.0
    for i in range(50):
        p *= 1.008
        out.append({"t": f"2026-01-{(i % 28) + 1:02d}", "o": p * 0.995, "h": p * 1.01,
                    "l": p * 0.99, "c": p, "v": 1_000_000})
    top = p
    for i in range(30):
        c = top * (0.97 + 0.01 * ((i % 3) - 1))
        out.append({"t": f"2026-03-{(i % 28) + 1:02d}", "o": c, "h": min(top, c * 1.01),
                    "l": c * 0.985, "c": c, "v": 600_000})
    return out


def _patch_by_key(monkeypatch, pivots):
    """Give chosen structure keys a fixed pivot callable; others untouched."""
    real = base_catalog.by_key

    def fake(key):
        st = real(key)
        if st is not None and key in pivots:
            return dataclasses.replace(st, pivot=pivots[key])
        return st

    monkeypatch.setattr(base_catalog, "by_key", fake)


def test_null_shape_has_the_key():
    assert bases.classify([])["base_pivot_px"] is None


def test_every_structure_pivot_is_callable_or_none():
    for s in base_catalog.ALL_STRUCTURES:
        assert s.pivot is None or callable(s.pivot), s.key


def test_the_pivot_adapters_are_the_eleven_mapped_structures():
    have = {s.key for s in base_catalog.ALL_STRUCTURES if s.pivot is not None}
    assert have == {"flat-base", "base-on-base", "double-bottom", "high-tight-flag",
                    "vcp", "ascending-base", "square-box", "cup-with-handle", "cheat-3c", "low-cheat",
                    "saucer", "three-weeks-tight"}


def test_pivot_of_never_invents():
    assert base_catalog._pivot_of(None) is None
    assert base_catalog._pivot_of({}) is None
    assert base_catalog._pivot_of({"pivot": None}) is None
    assert base_catalog._pivot_of({"pivot": 0}) is None
    assert base_catalog._pivot_of({"pivot": -3.0}) is None
    assert base_catalog._pivot_of({"pivot": float("nan")}) is None
    assert base_catalog._pivot_of({"pivot": float("inf")}) is None
    assert base_catalog._pivot_of({"pivot": "x"}) is None
    assert base_catalog._pivot_of({"pivot": 12.5}) == 12.5


def test_real_classification_pivot_is_finite_positive_or_none():
    row = bases.classify(_bars_flat_base())
    px = row["base_pivot_px"]
    assert px is None or (math.isfinite(px) and px > 0)


def test_a_head_with_a_pivot_writes_it(monkeypatch):
    monkeypatch.setattr(bases, "_render_order",
                        lambda shape, rels: ["flat-base", shape])
    _patch_by_key(monkeypatch, {"flat-base": lambda ctx: 123.45})
    assert bases.classify(_bars_flat_base())["base_pivot_px"] == 123.45


def test_pivot_is_taken_from_the_HEAD_only(monkeypatch):
    """A non-head structure HAS a pivot, the head has none -> None."""
    monkeypatch.setattr(bases, "_render_order",
                        lambda shape, rels: ["advancing-structure", "flat-base"])
    _patch_by_key(monkeypatch, {"flat-base": lambda ctx: 999.0})
    assert base_catalog.by_key("flat-base").pivot is not None      # control
    assert base_catalog.by_key("advancing-structure").pivot is None  # control
    assert bases.classify(_bars_flat_base())["base_pivot_px"] is None


def test_a_raising_pivot_costs_the_pivot_not_the_row(monkeypatch):
    def boom(ctx):
        raise RuntimeError("detector bug")

    monkeypatch.setattr(bases, "_render_order",
                        lambda shape, rels: ["flat-base", shape])
    _patch_by_key(monkeypatch, {"flat-base": boom})
    row = bases.classify(_bars_flat_base())
    assert row["base_pivot_px"] is None
    assert row["base_render"]


def test_snapshot_declares_the_column_as_REAL():
    from api.services.screener import snapshot_db
    assert "base_pivot_px" in snapshot_db.COLUMNS
    assert "base_pivot_px" not in snapshot_db._TEXT
    assert "base_pivot_px" not in snapshot_db._INT


def test_a_scan_requesting_base_pivot_px_is_accepted(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db, query
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "uct_composite": 90, "base_pivot_px": 10.5,
         "snapshot_date": "2026-08-21"},
        {"ticker": "BBB", "price": 20.0, "uct_composite": 80, "base_pivot_px": None,
         "snapshot_date": "2026-08-21"},
    ])
    out = query.run_scan({"columns": ["price", "base_pivot_px"],
                          "sort": {"key": "uct_composite", "dir": "desc"}})
    by = {r["ticker"]: r for r in out["rows"]}
    assert by["AAA"]["base_pivot_px"] == 10.5
    assert by["BBB"]["base_pivot_px"] is None
    assert "base_pivot_px" in out["view_columns"]
