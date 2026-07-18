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
    # chunk boundaries are an implementation detail (the think-filter may hold
    # back a small tail) — assert the concatenated text and the event ordering.
    assert events[-1]["type"] == "final"
    deltas = "".join(e["text"] for e in events[:-1] if e["type"] == "delta")
    assert deltas == "NVDA is up 4%."
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


def test_cache_salt_separates_entries():
    base = pplx._cache_key("m", None, "finance", 700, True, "sys", "q")
    salted = pplx._cache_key("m", None, "finance", 700, True, "sys", "q", salt="GREEN|NVDA")
    assert base != salted


def test_think_filter_strips_across_chunk_boundaries():
    f = pplx._ThinkFilter()
    out = ""
    # tags split across chunks — nothing inside <think> may leak
    for chunk in ["<th", "ink>secret reasoning", " continues</thi", "nk>The real", " answer[1]."]:
        out += f.feed(chunk)
    out += f.flush()
    assert out == "The real answer[1]."
    assert "secret" not in out


def test_think_filter_passthrough_without_tags():
    f = pplx._ThinkFilter()
    out = f.feed("Plain answer ") + f.feed("with no tags.") + f.flush()
    assert out == "Plain answer with no tags."


def test_strip_think_final():
    assert pplx._strip_think("<think>internal</think>\nAnswer.") == "Answer."
    assert pplx._strip_think("Answer.") == "Answer."


def test_stream_search_filters_think_from_reasoning_stream(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "test-key")
    lines = [
        'data: {"choices":[{"delta":{"content":"<think>let me reason"}}]}',
        'data: {"choices":[{"delta":{"content":" about this</think>NVDA "}}]}',
        'data: {"choices":[{"delta":{"content":"is up."}}]}',
        "data: [DONE]",
    ]
    monkeypatch.setitem(sys.modules, "httpx", _fake_httpx(lines))
    events = _collect(pplx.stream_search("reasoning TESTQ3", mode="lite"))
    deltas = "".join(e["text"] for e in events if e["type"] == "delta")
    assert "reason" not in deltas
    assert "NVDA is up." in deltas
    assert events[-1]["type"] == "final"
    assert events[-1]["answer"] == "NVDA is up."
