import importlib
from unittest.mock import patch, MagicMock

import pytest

from api.services import twitterapi_io


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "test-key-xyz")


def _resp(status, json_body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body or {}
    r.text = str(json_body)
    return r


def test_get_user_last_tweets_success():
    payload = {"tweets": [
        {
            "id": "1",
            "text": "$AAPL beats",
            "createdAt": "Mon Jan 01 12:00:00 +0000 2026",
            "url": "https://x.com/DeItaone/status/1",
            "author": {"userName": "DeItaone", "name": "Walter"},
        },
    ]}
    with patch("requests.get", return_value=_resp(200, payload)):
        result = twitterapi_io.get_user_last_tweets("DeItaone")
    assert len(result) == 1
    assert result[0]["id"] == "1"
    assert result[0]["author_handle"] == "DeItaone"
    assert result[0]["text"] == "$AAPL beats"
    assert isinstance(result[0]["created_at"], int)


def test_get_user_last_tweets_passes_since_id_in_params():
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.get_user_last_tweets("DeItaone", since_id="123")
    _, kwargs = g.call_args
    # We send both casings; either being present is fine
    p = kwargs["params"]
    assert p.get("sinceId") == "123" or p.get("since_id") == "123"


def test_auth_header_format():
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.get_user_last_tweets("DeItaone")
    _, kwargs = g.call_args
    assert kwargs["headers"]["x-api-key"] == "test-key-xyz"


def test_401_raises_auth_error():
    with patch("requests.get", return_value=_resp(401, {"error": "invalid key"})):
        with pytest.raises(twitterapi_io.TwitterApiAuthError):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_402_raises_payment_required():
    with patch("requests.get", return_value=_resp(402, {"error": "no credits"})):
        with pytest.raises(twitterapi_io.TwitterApiPaymentRequired):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_429_raises_rate_limit():
    with patch("requests.get", return_value=_resp(429, {"error": "slow down"})):
        with pytest.raises(twitterapi_io.TwitterApiRateLimited):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_5xx_raises_transient_error():
    with patch("requests.get", return_value=_resp(503, {"error": "down"})):
        with pytest.raises(twitterapi_io.TwitterApiTransientError):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_network_error_raises_transient():
    import requests as _r
    with patch("requests.get", side_effect=_r.ConnectionError("boom")):
        with pytest.raises(twitterapi_io.TwitterApiTransientError):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("TWITTERAPI_IO_API_KEY", raising=False)
    with pytest.raises(twitterapi_io.TwitterApiConfigError):
        twitterapi_io.get_user_last_tweets("DeItaone")


# ---- find_deleted_tweet_ids (PACKET-S CP4, RG-21 §1d) ----------------------

def test_find_deleted_tweet_ids_reports_ids_missing_from_the_response():
    # TwitterAPI.io omits an id from `tweets` when it no longer resolves —
    # "1" and "3" survive, "2" is gone (deleted/protected/suspended).
    payload = {"tweets": [{"id": "1"}, {"id": "3"}], "status": "success", "message": ""}
    with patch("requests.get", return_value=_resp(200, payload)):
        gone = twitterapi_io.find_deleted_tweet_ids(["1", "2", "3"])
    assert gone == {"2"}


def test_find_deleted_tweet_ids_control_nothing_deleted_when_all_resolve():
    # Control: if the response echoes back every id, nothing is reported gone —
    # proves the set-difference logic isn't unconditionally flagging ids.
    payload = {"tweets": [{"id": "1"}, {"id": "2"}], "status": "success", "message": ""}
    with patch("requests.get", return_value=_resp(200, payload)):
        gone = twitterapi_io.find_deleted_tweet_ids(["1", "2"])
    assert gone == set()


def test_find_deleted_tweet_ids_empty_input_short_circuits_without_a_call():
    with patch("requests.get") as g:
        assert twitterapi_io.find_deleted_tweet_ids([]) == set()
    g.assert_not_called()


def test_find_deleted_tweet_ids_hits_the_get_tweets_endpoint_with_comma_joined_ids():
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.find_deleted_tweet_ids(["10", "20"])
    args, kwargs = g.call_args
    assert args[0].endswith("/twitter/tweets")
    assert kwargs["params"]["tweet_ids"] == "10,20"
    assert kwargs["headers"]["x-api-key"] == "test-key-xyz"


def test_find_deleted_tweet_ids_batches_over_the_conservative_cap():
    ids = [str(i) for i in range(1, 251)]  # 250 ids -> 3 batches of <=100
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.find_deleted_tweet_ids(ids)
    assert g.call_count == 3


def test_find_deleted_tweet_ids_401_raises_auth_error():
    with patch("requests.get", return_value=_resp(401, {"error": "invalid key"})):
        with pytest.raises(twitterapi_io.TwitterApiAuthError):
            twitterapi_io.find_deleted_tweet_ids(["1"])
