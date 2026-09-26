"""client_ip trusts CF-Connecting-IP only behind a Cloudflare edge — pinned on MEASURED shapes.

The four header shapes below are what production handed the running process on
2026-09-26 (read through GET /api/auth/admin/request-ip-probe as the smoke account;
addresses swapped for documentation ranges, the structure kept exactly):

  * THROUGH CLOUDFLARE: XFF = "<cloudflare edge>, <railway proxy>", CF-Connecting-IP and
    X-Real-IP = the member. The member's address must be used.
  * AT THE ORIGIN, FORGED: XFF = "<caller>, <railway proxy>", X-Real-IP = the caller, and a
    forged CF-Connecting-IP. The caller's REAL address must be used (the defect: it used
    the forged one, so a caller who skipped Cloudflare picked their own bucket).
  * A Cloudflare range added after CLOUDFLARE_RANGES was fetched: Railway's X-Real-IP still
    names the member.
  * NOT BEHIND RAILWAY (local dev, tests): the peer, whatever forwarded headers say.

⛔ The RIGHT-most XFF entry is Railway's own proxy on every request; keying on it would
put every member in one bucket. A rail below makes that the failing case.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.services import request_ip

CF_EDGE = "108.162.200.10"        # inside 108.162.192.0/18
RAILWAY_PROXY = "100.64.0.2"      # stands in for Railway's internal proxy (same on every request)
MEMBER = "2001:db8::42"
CALLER = "198.51.100.77"
FORGED = "203.0.113.7"


def _req(headers=None, client_host="10.0.0.1"):
    return SimpleNamespace(headers=headers or {}, client=SimpleNamespace(host=client_host))


THROUGH_CLOUDFLARE = {"x-forwarded-for": f"{CF_EDGE}, {RAILWAY_PROXY}",
                      "cf-connecting-ip": MEMBER, "x-real-ip": MEMBER}
AT_ORIGIN_FORGED = {"x-forwarded-for": f"{CALLER}, {RAILWAY_PROXY}",
                    "cf-connecting-ip": FORGED, "x-real-ip": CALLER}


def test_through_cloudflare_the_member_is_keyed():
    assert request_ip.client_ip(_req(THROUGH_CLOUDFLARE, client_host=CF_EDGE)) == MEMBER


def test_a_direct_hit_cannot_choose_its_bucket_with_a_forged_cf_header():
    assert request_ip.client_ip(_req(AT_ORIGIN_FORGED, client_host=CALLER)) == CALLER


def test_a_direct_hit_without_x_real_ip_falls_to_the_connecting_address():
    h = {"x-forwarded-for": f"{CALLER}, {RAILWAY_PROXY}", "cf-connecting-ip": FORGED}
    assert request_ip.client_ip(_req(h)) == CALLER


def test_an_unlisted_cloudflare_edge_still_keys_the_member_through_x_real_ip():
    h = {"x-forwarded-for": f"192.0.2.10, {RAILWAY_PROXY}", "cf-connecting-ip": MEMBER,
         "x-real-ip": MEMBER}
    assert request_ip.client_ip(_req(h)) == MEMBER


def test_members_behind_different_edges_are_different_buckets_never_the_railway_proxy():
    a = dict(THROUGH_CLOUDFLARE)
    b = {"x-forwarded-for": f"172.69.1.1, {RAILWAY_PROXY}", "cf-connecting-ip": "2001:db8::99",
         "x-real-ip": "2001:db8::99"}
    ka, kb = request_ip.client_ip(_req(a)), request_ip.client_ip(_req(b))
    assert ka != kb and RAILWAY_PROXY not in (ka, kb)


def test_not_behind_railway_forwarded_headers_are_not_trusted():
    h = {"cf-connecting-ip": FORGED, "x-real-ip": FORGED}
    assert request_ip.client_ip(_req(h, client_host="10.9.9.9")) == "10.9.9.9"
    assert request_ip.client_ip(SimpleNamespace(headers={}, client=None)) == "unknown"


def test_the_edge_client_is_the_left_most_entry_railway_writes():
    assert request_ip.railway_edge_client(_req(THROUGH_CLOUDFLARE)) == CF_EDGE
    assert request_ip.railway_edge_client(_req({"x-forwarded-for": " , "})) is None
    assert request_ip.railway_edge_client(_req({})) is None


@pytest.mark.parametrize("ip", ["104.16.0.1", "172.64.1.2", "172.69.1.1", "162.158.10.20",
                                CF_EDGE, "2606:4700::1111", "2400:cb00:2048:1::c629:d7a2"])
def test_a_cloudflare_address_is_recognised_in_both_families(ip):
    assert request_ip.in_cloudflare(ip) is True


@pytest.mark.parametrize("ip", [FORGED, CALLER, RAILWAY_PROXY, "10.0.0.1", "2001:db8::1",
                                "", None, "not-an-ip", "104.16.0.1, 1.2.3.4"])
def test_anything_else_is_not_cloudflare(ip):
    assert request_ip.in_cloudflare(ip) is False


def test_the_ranges_are_the_published_lists_and_all_parse():
    v4 = [r for r in request_ip.CLOUDFLARE_RANGES if ":" not in r]
    v6 = [r for r in request_ip.CLOUDFLARE_RANGES if ":" in r]
    assert (len(v4), len(v6)) == (15, 7)
    assert len(request_ip._CLOUDFLARE_NETWORKS) == len(request_ip.CLOUDFLARE_RANGES)


def test_describe_reports_the_forwarding_headers_verbatim_and_nothing_else():
    r = _req({**AT_ORIGIN_FORGED, "cookie": "uct_session=secret", "authorization": "Bearer x"},
             client_host=CALLER)
    d = request_ip.describe(r)
    assert d["peer"] == CALLER
    assert d["headers"] == AT_ORIGIN_FORGED
    assert d["railway_edge_client"] == CALLER and d["edge_in_cloudflare"] is False
    assert d["client_ip"] == CALLER
    assert "secret" not in repr(d) and "Bearer" not in repr(d)


def test_the_probe_door_refuses_a_non_admin_and_serves_an_admin():
    from api.routers import auth

    r = _req(THROUGH_CLOUDFLARE)
    with pytest.raises(HTTPException) as exc:
        auth.admin_request_ip_probe(request=r, user={"id": "u1", "role": "user"})
    assert exc.value.status_code == 403
    out = auth.admin_request_ip_probe(request=r, user={"id": "u2", "role": "admin"})
    assert out["edge_in_cloudflare"] is True and out["client_ip"] == MEMBER


def test_the_probe_is_mounted_at_its_documented_path():
    from api.routers import auth

    paths = {getattr(rt, "path", None) for rt in auth.router.routes}
    assert "/api/auth/admin/feedback" in paths          # non-vacuity: the probe can see a sibling
    assert "/api/auth/admin/request-ip-probe" in paths
