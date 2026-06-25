import io

from PIL import Image

from api.services import desk_thumbnail as t


def test_render_returns_1280x720_jpeg():
    data = t.render_session_thumbnail("June 24, 2026")
    assert isinstance(data, (bytes, bytearray)) and len(data) > 5000
    im = Image.open(io.BytesIO(data))
    assert im.size == (1280, 720)
    assert im.format == "JPEG"
    assert im.mode == "RGB"


def test_render_handles_any_date_text():
    # Long month name still renders without raising.
    data = t.render_session_thumbnail("September 30, 2026")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)
