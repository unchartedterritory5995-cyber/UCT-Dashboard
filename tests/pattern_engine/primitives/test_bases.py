import pytest

from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, hi, lo):
    return {"t": 1_600_000_000 + i * 86400, "o": (hi + lo) / 2,
            "h": hi, "l": lo, "c": (hi + lo) / 2, "v": 1_000_000}


def _noise(n, seed=7, amp=0.04):
    out, p = [], 100.0
    x = seed
    for _ in range(n):
        x = (1103515245 * x + 12345) % (2 ** 31)
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * amp
        out.append(p)
    return out


def _from_closes(prices, spread=0.01):
    return [_bar(i, p * (1 + spread), p * (1 - spread))
            for i, p in enumerate(prices)]


NULL_KEYS = {"base_shape", "base_shape_label", "base_matches",
             "base_relation_count", "base_render"}


# ── the guard ──────────────────────────────────────────────────────────────

def test_too_few_bars_returns_every_key_as_none():
    """The snapshot's not-computable convention: the KEYS are always present,
    the VALUES are None. A missing key and a null value are different facts
    downstream.
    """
    out = bases.classify(_from_closes([100.0] * 5))
    assert set(out) == NULL_KEYS
    assert all(v is None for v in out.values())


def test_no_bars_at_all_returns_the_same_null_shape():
    assert bases.classify([]) == bases.classify(None)
    assert set(bases.classify([])) == NULL_KEYS


# ── SHAPE is a total partition ─────────────────────────────────────────────

def test_every_sufficient_input_gets_exactly_one_shape():
    """TOTAL BY CONSTRUCTION. There is no series this cannot name — the
    cascade's last branch takes no condition. This is the invariant whose
    absence left 43.6% of candle rows unnamed.
    """
    shape_keys = {s.key for s in bc.SHAPES}
    for seed in range(1, 25):
        out = bases.classify(_from_closes(_noise(300, seed=seed)))
        assert out["base_shape"] in shape_keys, f"seed {seed} named nothing"


def test_the_shape_is_always_present_in_base_matches():
    out = bases.classify(_from_closes(_noise(300)))
    assert f",{out['base_shape']}," in out["base_matches"]


def test_a_flat_series_still_gets_named():
    """Zero volatility means the segmenter refuses to confirm swings, so the
    shape must fall through to the total-partition branch rather than None.
    """
    out = bases.classify(_from_closes([50.0] * 200, spread=0.0))
    assert out["base_shape"] == bc.FALLBACK_SHAPE


# ── base_matches is DELIMITER-WRAPPED ──────────────────────────────────────

def test_base_matches_is_delimiter_wrapped_at_both_ends():
    """⛔ `contains` compiles to `LIKE %v%` in query.py. A bare CSV lets a
    filter for one key match a longer key that contains it. The candle
    library shipped this trap once already — `candle_matches` is wrapped for
    exactly this reason and so is this column.
    """
    out = bases.classify(_from_closes(_noise(300)))
    m = out["base_matches"]
    assert m.startswith(",") and m.endswith(",")
    for key in m.strip(",").split(","):
        assert f",{key}," in m


def test_wrapping_prevents_a_substring_key_from_matching():
    """The control that proves the wrapping does something. A LIKE search for
    ',range,' must not match a row carrying only 'contracting-range'.
    """
    wrapped = ",contracting-range,"
    assert ",range," not in wrapped
    assert ",contracting-range," in wrapped


# ── relations are sparse and isolated ──────────────────────────────────────

def test_relation_count_counts_relations_only_never_the_shape():
    out = bases.classify(_from_closes(_noise(300)))
    keys = out["base_matches"].strip(",").split(",")
    relation_keys = {s.key for s in bc.RELATIONS}
    assert out["base_relation_count"] == len([k for k in keys if k in relation_keys])


def test_a_relation_that_raises_never_kills_the_row(monkeypatch):
    """One bad predicate must cost that predicate, not the whole symbol.
    Same failure contract every context-join reader in this package uses.
    """
    def boom(ctx):
        raise ValueError("bad relation")

    exploding = bc.Structure(
        key="exploding-relation", label="Exploding", axis="relation",
        family="Test", bias="neutral", rank=999, min_bars=0,
        desc="raises on purpose", detect=boom,
    )
    monkeypatch.setattr(bc, "RELATIONS", list(bc.RELATIONS) + [exploding])
    out = bases.classify(_from_closes(_noise(300)))
    assert out["base_shape"] is not None
    assert ",exploding-relation," not in out["base_matches"]


def test_a_relation_below_its_min_bars_is_not_evaluated():
    called = []

    def spy(ctx):
        called.append(1)
        return True

    hungry = bc.Structure(
        key="hungry-relation", label="Hungry", axis="relation",
        family="Test", bias="neutral", rank=998, min_bars=100_000,
        desc="needs more bars than exist", detect=spy,
    )
    ctx_bars = _from_closes(_noise(300))
    orig = bc.RELATIONS
    try:
        bc.RELATIONS = list(orig) + [hungry]
        out = bases.classify(ctx_bars)
    finally:
        bc.RELATIONS = orig
    assert called == []
    assert ",hungry-relation," not in out["base_matches"]


# ── render ─────────────────────────────────────────────────────────────────

def test_render_is_primary_secondary_and_count():
    """Mirrors the candle library: `Primary (Secondary) +N`."""
    assert bases._render(["Darvas Box"]) == "Darvas Box"
    assert bases._render(["Darvas Box", "Advancing Structure"]) == \
        "Darvas Box (Advancing Structure)"
    assert bases._render(["Darvas Box", "Advancing Structure", "X", "Y"]) == \
        "Darvas Box (Advancing Structure) +2"


def test_render_is_empty_for_nothing():
    assert bases._render([]) is None


def test_a_relation_outranks_the_shape_in_the_rendered_head():
    """A named structure is more informative than a trend reading, so it
    leads. The shape is still carried in base_matches and its own column.
    """
    order = bases._render_order("advancing-structure", ["darvas-box"])
    assert order[0] == "darvas-box"
    assert order[-1] == "advancing-structure"


def test_shape_label_matches_the_catalog():
    out = bases.classify(_from_closes(_noise(300)))
    assert out["base_shape_label"] == bc.by_key(out["base_shape"]).label
