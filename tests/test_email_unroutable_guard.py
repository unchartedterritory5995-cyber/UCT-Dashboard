"""send_email never spends quota on a domain that cannot receive mail."""
from __future__ import annotations

import pytest

from api.services import email_service as es


@pytest.mark.parametrize("addr", [
    "smoke@uctintelligence.internal",
    "Smoke <smoke@uctintelligence.internal>",
    "a@foo.invalid", "a@b.test", "a@example", "a@host.local", "a@localhost",
    "a@uctintelligence.INTERNAL.",
])
def test_special_use_domains_are_unroutable(addr):
    assert es.is_unroutable(addr)


@pytest.mark.parametrize("addr", [
    "unchartedterritory5995@gmail.com", "a@uctintelligence.com", "a@b.co.uk",
    "a@internal.com", "a@test.io", "a@local.news",
])
def test_real_domains_are_routable(addr):
    # A domain that merely CONTAINS a reserved word is a real domain.
    assert not es.is_unroutable(addr)


class _FakeResend:
    def __init__(self):
        self.sent = []

        class _Emails:
            @staticmethod
            def send(payload):
                self.sent.append(payload["to"][0])
        self.Emails = _Emails


def test_send_email_refuses_before_calling_resend(monkeypatch):
    fake = _FakeResend()
    monkeypatch.setattr(es, "_resend", fake)
    assert es.send_email("smoke@uctintelligence.internal", "UCT Alert", "<p>x</p>") is False
    # Control: the same path DOES send to a real address, so the refusal above
    # is the guard, not a broken fake.
    assert es.send_email("a@uctintelligence.com", "UCT Alert", "<p>x</p>") is True
    assert fake.sent == ["a@uctintelligence.com"]
