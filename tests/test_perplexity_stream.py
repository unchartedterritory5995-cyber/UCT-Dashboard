import asyncio
import sys
import types

from api.services import perplexity_search as pplx


def _fake_httpx(lines):
    class _Resp:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def aread(self):
            return b""

        async def aiter_lines(self):
            for ln in lines:
                yield ln

    class _Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **kw):
            return _Resp()

    mod = types.ModuleType("httpx")
    mod.AsyncClient = _Client
    return mod


def _collect(gen):
    async def go():
        return [ev async for ev in gen]
    return asyncio.run(go())


def test_stream_search_parses_sse_and_caches(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-key")
    pplx._SEARCH_CACHE.clear() if hasattr(pplx._SEARCH_CACHE, "clear") else None
    lines = [
        'data: {"choices":[{"delta":{"content":"NVDA is "}}]}',
        "",  # keep-alive blank
        'data: {"choices":[{"delta":{"content":"up 4%."}}],"citations":["https://a.com/x"],"related_questions":["What next?"]}',
        "data: [DONE]",
    ]
    monkeypatch.setitem(sys.modules, "httpx", _fake_httpx(lines))
    events = _collect(pplx.stream_search("nvda today TESTQ1", mode="lite", related=True))
    assert [e["type"] for e in events] == ["delta", "delta", "final"]
    final = events[-1]
    assert final["answer"] == "NVDA is up 4%."
    assert final["citations"] == ["https://a.com/x"]
    assert final["related_questions"] == ["What next?"]
    assert final["cached"] is False
    # Second call for the same query hits the cache → single final event.
    events2 = _collect(pplx.stream_search("nvda today TESTQ1", mode="lite", related=True))
    assert [e["type"] for e in events2] == ["final"]
    assert events2[0]["cached"] is True
    assert events2[0]["answer"] == "NVDA is up 4%."


def test_stream_search_empty_answer_yields_error(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "httpx", _fake_httpx(["data: [DONE]"]))
    events = _collect(pplx.stream_search("empty TESTQ2", mode="lite"))
    assert events[-1]["type"] == "error"
