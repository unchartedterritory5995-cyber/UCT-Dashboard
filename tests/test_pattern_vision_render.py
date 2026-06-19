import datetime

from api.services.pattern_vision import chart_render


def _bars(n=130):
    base = datetime.date(2025, 1, 1)
    out = []
    for i in range(n):
        d = base + datetime.timedelta(days=i)
        ts = int(d.strftime("%Y%m%d"))  # valid YYYYMMDD across month boundaries
        c = 100 + i
        out.append((ts, float(c), c * 1.02, c * 0.98, float(c), 1_000_000 + i))
    return out


def test_render_returns_png_bytes():
    png = chart_render.render_chart(_bars(), window=120)
    assert isinstance(png, bytes) and len(png) > 1000
    assert png[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic number


def test_render_empty_safe():
    assert chart_render.render_chart([], window=120) == b""
