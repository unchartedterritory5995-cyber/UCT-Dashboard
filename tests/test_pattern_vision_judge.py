from api.services.pattern_vision import vision_judge as vj


class _FakeBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _FakeUsage:
    input_tokens = 1200
    output_tokens = 150


class _FakeMsg:
    def __init__(self, text):
        self.content = [_FakeBlock(text)]
        self.usage = _FakeUsage()


class _FakeClient:
    def __init__(self, text):
        self._text = text
        self.calls = []

    class _M:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kw):
            self._outer.calls.append(kw)
            return _FakeMsg(self._outer._text)

    @property
    def messages(self):
        return _FakeClient._M(self)


def test_build_messages_has_image_and_text():
    msgs = vj.build_messages("vcp", b"\x89PNG_fake")
    block_types = [b["type"] for b in msgs[0]["content"]]
    assert "image" in block_types and "text" in block_types
    img = next(b for b in msgs[0]["content"] if b["type"] == "image")
    assert img["source"]["type"] == "base64" and img["source"]["media_type"] == "image/png"


def test_parse_verdict_extracts_json_amid_prose():
    v = vj.parse_verdict('Sure.\n{"confirmed": true, "confidence": 80, "reason": "tight", "key_level": 12.5}\nDone')
    assert v["confirmed"] is True and v["confidence"] == 80 and v["key_level"] == 12.5


def test_parse_verdict_safe_on_garbage():
    v = vj.parse_verdict("no json here")
    assert v["confirmed"] is False and v["confidence"] == 0


def test_judge_uses_client_and_returns_verdict():
    client = _FakeClient('{"confirmed": true, "confidence": 77, "reason": "clean flag", "key_level": null}')
    out = vj.judge("bull_flag", b"\x89PNGdata", client=client)
    assert out["confirmed"] is True and out["confidence"] == 77
    assert out["usage"]["input_tokens"] == 1200
    sent = client.calls[0]
    assert sent["model"] == "claude-opus-4-8"
    assert "temperature" not in sent and "thinking" not in sent
