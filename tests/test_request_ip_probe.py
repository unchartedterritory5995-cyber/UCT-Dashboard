"""The measurement for the Cloudflare-origin hardening (request_ip.describe + its admin door).

What is pinned here, and why each matters:
  * `in_cloudflare` answers from Cloudflare's published ranges, both families, and is FALSE
    for a TEST-NET address, a private address and garbage (a check that says yes to
    everything would make the later fix trust every forged header).
  * `railway_hop` is the RIGHT-most `X-Forwarded-For` entry — the one a proxy appends — and
    never the left-most, which is what the caller claimed.
  * `describe` reports the forwarding headers verbatim and nothing else about the request.
  * `client_ip` is UNCHANGED by this measurement change (the fix waits for the reading).
  * the probe door refuses a non-admin with 403 and hands an admin the description.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.services import request_ip


def _req(headers=None, client_host="10.0.0.1"):
    return SimpleNamespace(headers=headers or {}, client=SimpleNamespace(host=client_host))


@pytest.mark.parametrize("ip", ["104.16.0.1", "172.64.1.2", "162.158.10.20", "2606:4700::1111",
                                "2400:cb00:2048:1::c629:d7a2"])
def test_a_cloudflare_address_is_recognised_in_both_families(ip):
    assert request_ip.in_cloudflare(ip) is True


@pytest.mark.parametrize("ip", ["203.0.113.7", "198.51.100.9", "10.0.0.1", "66.33.1.1",
                                "2001:db8::1", "", None, "not-an-ip", "104.16.0.1, 1.2.3.4"])
def test_anything_else_is_not_cloudflare(ip):
    assert request_ip.in_cloudflare(ip) is False


def test_the_ranges_are_the_published_lists_and_all_parse():
    # 15 IPv4 + 7 IPv6 ranges as published 2026-09-26; a typo would raise at import
    v4 = [r for r in request_ip.CLOUDFLARE_RANGES if ":" not in r]
    v6 = [r for r in request_ip.CLOUDFLARE_RANGES if ":" in r]
    assert (len(v4), len(v6)) == (15, 7)
    assert len(request_ip._CLOUDFLARE_NETWORKS) == len(request_ip.CLOUDFLARE_RANGES)


def test_the_hop_is_the_right_most_forwarded_entry_never_the_callers_claim():
    r = _req({"x-forwarded-for": "198.51.100.9, 104.16.0.1"})
    assert request_ip.railway_hop(r) == "104.16.0.1"
    assert request_ip.railway_hop(_req({"x-forwarded-for": " 66.33.1.1 "})) == "66.33.1.1"
    assert request_ip.railway_hop(_req({"x-forwarded-for": " , "})) is None
    assert request_ip.railway_hop(_req({})) is None


def test_describe_reports_the_forwarding_headers_verbatim_and_nothing_else():
    r = _req({"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9, 104.16.0.1",
              "cookie": "uct_session=secret", "authorization": "Bearer x"}, client_host="10.1.2.3")
    d = request_ip.describe(r)
    assert d["peer"] == "10.1.2.3"
    assert d["headers"] == {"cf-connecting-ip": "203.0.113.7",
                            "x-forwarded-for": "198.51.100.9, 104.16.0.1"}
    assert d["railway_hop"] == "104.16.0.1" and d["railway_hop_in_cloudflare"] is True
    assert d["client_ip_today"] == "203.0.113.7"
    assert "cookie" not in repr(d) and "secret" not in repr(d) and "Bearer" not in repr(d)


def test_client_ip_is_unchanged_by_the_measurement():
    # the fix is decided on the reading; until then a forged CF header still wins, as before
    r = _req({"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "66.33.1.1"})
    assert request_ip.client_ip(r) == "203.0.113.7"


def test_the_probe_door_refuses_a_non_admin_and_serves_an_admin():
    from api.routers import auth

    r = _req({"x-forwarded-for": "66.33.1.1"})
    with pytest.raises(HTTPException) as exc:
        auth.admin_request_ip_probe(request=r, user={"id": "u1", "role": "user"})
    assert exc.value.status_code == 403
    out = auth.admin_request_ip_probe(request=r, user={"id": "u2", "role": "admin"})
    assert out["railway_hop"] == "66.33.1.1" and out["railway_hop_in_cloudflare"] is False


def test_the_probe_is_mounted_at_its_documented_path():
    from api.routers import auth

    paths = {getattr(rt, "path", None) for rt in auth.router.routes}
    assert "/api/auth/admin/feedback" in paths          # non-vacuity: the probe can see a sibling
    assert "/api/auth/admin/request-ip-probe" in paths
