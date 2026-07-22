import logging
import httpx
import pytest
from api.services import single_stock_etfs as ss

def test_num_formats():
    assert ss._num("1234567") == 1234567.0
    assert ss._num("1,234,567") == 1234567.0
    assert ss._num("12.34") == 12.34
    assert ss._num("-") is None
    assert ss._num("") is None
    assert ss._num(None) is None
    assert ss._num("n/a") is None

def test_fetch_never_logs_token(monkeypatch, caplog):
    monkeypatch.setenv("FINVIZ_API_KEY", "SECRET-TOKEN-XYZ")
    def boom(url, **kw):
        req = httpx.Request("GET", url + "?auth=SECRET-TOKEN-XYZ")
        resp = httpx.Response(401, request=req)
        raise httpx.HTTPStatusError("401 Unauthorized", request=req, response=resp)
    monkeypatch.setattr(ss.httpx, "get", boom)
    with caplog.at_level(logging.DEBUG):
        rows = ss._fetch_finviz_market()
    assert rows == []
    assert "SECRET-TOKEN-XYZ" not in caplog.text

def test_fetch_missing_key_returns_empty(monkeypatch, caplog):
    monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
    assert ss._fetch_finviz_market() == []
