"""`widget_request_body.read_json_object`: the empty-body and non-object branches (Task 10.12
re-review N1; written in Task 9.6d). Called directly, with the bytes handed in, so each branch is
seen on its own rather than through a router."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from api.services.journal_two import widget_request_body as wbody


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _read(raw: bytes, max_depth: int = 32):
    async def read_raw() -> bytes:
        return raw
    return asyncio.run(wbody.read_json_object(read_raw, max_depth, _err))


@pytest.mark.parametrize("raw", [b"", b" ", b"\r\n", b" \t\r\n "], ids=repr)
def test_an_empty_body_is_an_empty_object(raw):
    assert _read(raw) == {}


@pytest.mark.parametrize("raw", [b"[]", b"[1, 2]", b'"x"', b'""', b"0", b"3.5", b"null", b"true",
                                 b"false", b' [{"a": 1}] '], ids=repr)
def test_a_value_that_is_not_an_object_is_400_invalid(raw):
    with pytest.raises(HTTPException) as e:
        _read(raw)
    assert e.value.status_code == 400
    assert e.value.detail == {"code": "invalid", "message": wbody.S_UNREADABLE_BODY}


def test_CONTROL_an_object_is_returned_as_sent():
    """The two branches above are not the reader refusing everything."""
    assert _read(b'{"a": [1, {"b": null}]}') == {"a": [1, {"b": None}]}
    assert _read(b' {} ') == {}
