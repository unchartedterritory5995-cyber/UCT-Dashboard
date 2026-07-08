"""Recap-poster layout tests — the budget-aware layout must never let text or
ticker pills spill past the footer clearance line (the July-7 poster shipped
with pills cut off at the bottom edge and bullets hard-clipped mid-word)."""
import pytest

from PIL import Image, ImageDraw

from api.services import desk_recap_poster as rp


def _draw():
    return ImageDraw.Draw(Image.new("RGB", (10, 10)))


# ── _wrap_clip ───────────────────────────────────────────────────────────────────

def test_wrap_clip_within_limit_untouched():
    d = _draw()
    f = rp._font("DejaVuSans.ttf", 26)
    lines = rp._wrap_clip(d, "short line", f, 900, 3)
    assert lines == ["short line"]


def test_wrap_clip_ellipsizes_at_word_boundary():
    d = _draw()
    f = rp._font("DejaVuSans.ttf", 26)
    text = "alpha bravo charlie delta echo foxtrot golf hotel " * 12
    lines = rp._wrap_clip(d, text.strip(), f, 500, 2)
    assert len(lines) == 2
    assert lines[-1].endswith("…")
    body = lines[-1][:-1]
    # No mid-word cut: the clipped line is a whole-words prefix of its source.
    assert all(w in {"alpha", "bravo", "charlie", "delta", "echo",
                     "foxtrot", "golf", "hotel"} for w in body.split())
    assert d.textlength(lines[-1], font=f) <= 500


# ── _fit_takeaways ───────────────────────────────────────────────────────────────

_LONG_BULLETS = [
    "Patrick discussed market conditions, noting that several indices were "
    "approaching or tapping their 50-day moving averages, with some stocks like "
    "Intel and Dell showing mixed performance across the broader trading session "
    "while volume stayed elevated into the afternoon and leadership rotated." for _ in range(5)
]


def test_fit_takeaways_respects_available_height():
    d = _draw()
    for avail in (250, 350, 478, 700, 1200):
        f, line_h, wrapped = rp._fit_takeaways(d, list(_LONG_BULLETS), 866, avail)
        h = sum(len(w) * line_h + 10 for w in wrapped)
        assert h <= avail, f"avail={avail} got h={h}"
        assert len(wrapped) >= 3          # never fewer than 3 bullets


def test_fit_takeaways_keeps_all_bullets_when_space_allows():
    d = _draw()
    f, line_h, wrapped = rp._fit_takeaways(d, ["one.", "two.", "three.", "four."], 866, 1000)
    assert len(wrapped) == 4
    assert f.size == 26                    # roomy -> full-size font, no clipping


# ── _pill_rows mirrors the draw loop ─────────────────────────────────────────────

def test_pill_rows_counts_wrapping():
    d = _draw()
    f = rp._font("DejaVuSans-Bold.ttf", 24)
    assert rp._pill_rows(d, ["SPY"], f, 904) == 1
    many = ["GOOGL", "MRVL", "MSFT", "SOXX", "WIZ", "NVDA", "ALAB", "QQQ"]
    rows = rp._pill_rows(d, many, f, 400)
    assert rows >= 2


# ── Full render: nothing may cross the footer clearance line ─────────────────────

def _render(**kw):
    import io
    png = rp.render_recap_poster(
        title=kw.pop("title", "Live Trading Session — July 7, 2026"),
        date_text=kw.pop("date_text", "July 7, 2026"),
        **kw,
    )
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    return Image.open(io.BytesIO(png))


def _strip(img):
    """Pixels between the layout FLOOR and the footer text — must be identical
    to a content-free render (only gradient + watermark live there)."""
    H = rp._H
    return list(img.crop((0, H - 108, rp._W, H - 82)).getdata())


def test_overloaded_render_never_spills_past_floor():
    baseline = _render(headline="", summary=[], tickers=[])
    heavy = _render(
        headline="This was a trading discussion focused on market analysis and "
                 "stock setups, with Patrick leading the conversation about current "
                 "market conditions and potential trading opportunities near key levels.",
        summary=list(_LONG_BULLETS),
        tickers=["INTC", "QQQ", "VIX", "SMH", "DIA", "SPY", "MRVL", "ARM",
                 "AMBA", "DELL", "GLW", "AEHR"],
    )
    assert _strip(heavy) == _strip(baseline)


def test_tickers_deduped_with_overflow_pill():
    # 12 uniques + dupes -> 8 pills + "+4"; smoke: renders, and the pill row
    # logic is exercised via the strip invariant above. Here just no-crash +
    # dedupe path.
    img = _render(summary=["Bullet one.", "Bullet two.", "Bullet three."],
                  tickers=["MU", "MU", "MRVL", "SNDK", "DDOG", "SNOW", "TWLO",
                           "MDB", "RBRK", "CRWD", "LLY", "RKLB", "HOOD"])
    assert img.size == (rp._W, rp._H)
