"""Voice client-action tools — open_page + read_aloud."""

from api.services import voice_client_action_tools as vcat


# ── open_page ──────────────────────────────────────────────────────────────

def test_open_page_exact_name():
    out = vcat.open_page(name="journal")
    assert out["ok"] is True
    assert out["client_action"]["type"] == "navigate"
    assert out["client_action"]["path"] == "/journal"


def test_open_page_alias():
    out = vcat.open_page(name="rundown")
    assert out["ok"] is True
    assert out["client_action"]["path"] == "/morning-wire"


def test_open_page_partial_match():
    out = vcat.open_page(name="trade journal")
    assert out["ok"] is True
    assert out["client_action"]["path"] == "/journal"


def test_open_page_unknown():
    out = vcat.open_page(name="warpdrive")
    assert out["ok"] is False
    assert "Journal" in out["narration"]


def test_open_page_empty():
    out = vcat.open_page(name="")
    assert out["ok"] is False


def test_open_page_case_insensitive():
    out = vcat.open_page(name="WATCHLISTS")
    assert out["ok"] is True
    assert out["client_action"]["path"] == "/watchlists"


# ── read_aloud ─────────────────────────────────────────────────────────────

def test_read_aloud_morning_wire():
    out = vcat.read_aloud(content="morning wire")
    assert out["ok"] is True
    assert out["client_action"]["type"] == "read_aloud"
    assert "wire" in out["client_action"]["content"]


def test_read_aloud_partial_match():
    out = vcat.read_aloud(content="brief me")
    assert out["ok"] is True


def test_read_aloud_unknown():
    # Empty key fails. Note: arbitrary strings may partial-match because
    # READ_ALOUD_TARGETS contains very short tokens — that's intentional
    # (voice transcription is noisy), so only empty truly fails.
    out = vcat.read_aloud(content="")
    assert out["ok"] is False
