"""Wave 7 lane H, fix round 1 -- review M-10: the editor refuses an image the
server would refuse BEFORE uploading it (tiptap.js `uploadInlineImage`), so a
phone does not ship a multi-megabyte HEIC only to learn "Only PNG/JPG/GIF/WebP
images allowed".

⛔ That makes the allowed types and the size limit ONE FACT IN TWO FILES. This
rail PARSES the client's constants out of tiptap.js (it does not restate
them -- a copy here would be a third authority) and pins them to the server's
`notes._ALLOWED_IMAGE_MIMES` / `_MAX_IMAGE_BYTES`, and pins the refusal
sentences to the ones the server raises. Client stricter than the server =>
a member refused an image the server takes; looser => the upload the
pre-check exists to save.
"""
from __future__ import annotations

import ast
import pathlib
import re

from api.services.journal_two import notes

TIPTAP = pathlib.Path(__file__).resolve().parents[1] / "app/src/pages/journal-2-0/lib/tiptap.js"
NOTES = pathlib.Path(notes.__file__)


def _js_const(name: str) -> str:
    src = TIPTAP.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = (.+)$", src, re.MULTILINE)
    assert m, f"tiptap.js no longer declares {name}"
    return m.group(1).strip()


def test_the_client_accepts_EXACTLY_the_types_the_server_accepts():
    raw = _js_const("INLINE_IMAGE_MIMES")
    client = set(ast.literal_eval(raw))
    assert client, "non-vacuity: parsed an empty list"
    assert client == set(notes._ALLOWED_IMAGE_MIMES)


def test_the_client_size_limit_IS_the_servers():
    raw = _js_const("INLINE_IMAGE_MAX_BYTES")
    assert re.fullmatch(r"[\d\s*]+", raw), raw          # a product of integers, nothing else
    assert eval(raw, {"__builtins__": {}}) == notes._MAX_IMAGE_BYTES   # noqa: S307 -- digits and *


def test_the_client_refuses_in_the_servers_words():
    js = TIPTAP.read_text(encoding="utf-8")
    server = NOTES.read_text(encoding="utf-8")
    for sentence in ("Only PNG/JPG/GIF/WebP images allowed", "Image must be < 5 MB"):
        assert f'"{sentence}"' in server, f"the server no longer says {sentence!r}"
        assert f"'{sentence}'" in js, f"the client pre-check no longer says {sentence!r}"
