"""The browser's limits ARE the server's (C, 2026-11-25). The composer counts against two numbers it cannot read from
the server: the chat limit and the import door's cap. Each is held equal here to the number the server enforces, read
from the browser's own code with its comments stripped (a number in a comment is no limit)."""
from __future__ import annotations

import re
from pathlib import Path

from api.services import code_paste
from api.services import definition_conversation as conv

AUTHORING = Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart" / "builder" / "authoring"


def _strip(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(^|[^:])//.*$", r"\1", text, flags=re.M)


def _code(name: str) -> str:
    return _strip((AUTHORING / name).read_text(encoding="utf-8"))


def test_the_browsers_chat_limit_is_the_servers():
    m = re.search(r"maxMessage:\s*(\d[\d_]*)", _code("converseClient.js"))
    assert m and int(m.group(1).replace("_", "")) == conv.MAX_MESSAGE_CHARS


def test_the_browsers_import_cap_is_the_servers():
    m = re.search(r"export const IMPORT_MAX_CHARS\s*=\s*(\d[\d_]*)", _code("codePaste.js"))
    assert m and int(m.group(1).replace("_", "")) == code_paste.import_max_chars()


def test_CONTROL_a_number_only_in_a_comment_is_not_read():
    assert re.search(r"maxMessage:\s*\d", _strip("// maxMessage: 9999\n/* maxMessage: 8888 */\nconst x = 1")) is None
    assert re.search(r"maxMessage:\s*\d", _strip("const L = { maxMessage: 2000 }")) is not None
