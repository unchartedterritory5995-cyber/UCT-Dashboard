"""Claude 5 models emit a ThinkingBlock BEFORE the TextBlock. `get_key_quotes`
read `msg.content[0].text` and threw `'ThinkingBlock' object has no attribute
'text'` (live for FLXS, 2026-08-22), silently dropping the key-quotes leg of
every brief. It must read the TEXT block wherever it sits."""


class _ThinkingBlock:
    type = "thinking"
    thinking = "let me think"
    # deliberately NO `.text`


class _TextBlock:
    type = "text"
    text = '{"quotes": [{"topic": "Guidance", "quote": "We raised the full-year outlook."}]}'


class _Msg:
    content = [_ThinkingBlock(), _TextBlock()]


class _Messages:
    calls = []

    def create(self, **kw):
        self.calls.append(kw)
        return _Msg()


class _Client:
    messages = _Messages()


def test_key_quotes_survive_a_leading_thinking_block(monkeypatch):
    from api.services import earnings_enrichment as ee
    from api.services import engine
    from api.services import transcripts
    monkeypatch.setattr(transcripts, "_fetch_latest_transcript", lambda sym: {"text": "x" * 600})
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    out = ee.get_key_quotes("TST")
    assert out == [{"topic": "Guidance", "quote": "We raised the full-year outlook."}]
    # The thinking budget is disabled so the 600-token cap is spent on the JSON.
    assert _Messages.calls[-1]["thinking"] == {"type": "disabled"}


def test_key_quotes_are_extracted_once_per_transcript(monkeypatch, tmp_path):
    """The quotes come from the prior call's transcript, which changes once a quarter:
    an unchanged transcript must not pay Claude again, and a new one must."""
    from api.services import earnings_enrichment as ee
    from api.services import engine
    from api.services import transcripts
    monkeypatch.setenv("KEY_QUOTES_CACHE_DIR", str(tmp_path))
    transcript = {"text": "y" * 700}
    monkeypatch.setattr(transcripts, "_fetch_latest_transcript", lambda sym: dict(transcript))
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    before = len(_Messages.calls)
    first = ee.get_key_quotes("TST")
    assert ee.get_key_quotes("TST") == first and len(_Messages.calls) == before + 1
    transcript["text"] = "z" * 700                     # next quarter's call
    assert ee.get_key_quotes("TST") == first and len(_Messages.calls) == before + 2


def test_a_failed_extraction_is_not_cached(monkeypatch, tmp_path):
    from api.services import earnings_enrichment as ee
    from api.services import engine
    from api.services import transcripts
    monkeypatch.setenv("KEY_QUOTES_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(transcripts, "_fetch_latest_transcript", lambda sym: {"text": "w" * 700})

    class _Bad:
        class messages:
            @staticmethod
            def create(**kw):
                raise RuntimeError("boom")
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Bad())
    assert ee.get_key_quotes("BAD") is None
    assert list(tmp_path.iterdir()) == []
