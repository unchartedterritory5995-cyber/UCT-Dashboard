"""Guard the dependency-pinning policy itself.

Railway resolves requirements at BUILD time, so an open `>=` on a critical
dependency lets a new MAJOR in on any rebuild — days after the code was
written, and only in production (local dev keeps its old resolved version).

That is precisely how the broker fleet died on 2026-07-23: `snaptrade-python-sdk
>=11.0.0` resolved to 12.0.0, whose constructor takes config as `**kwargs`, so
our credential kwargs were silently swallowed and every signed request went out
unauthenticated — no exception, no log, just 401s across every member.

These tests make that class of failure impossible to reintroduce by accident.
They check the DECLARATION, not the installed version, so they pass in CI and
on any machine.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"

# Dependencies where a silent major bump is BOTH plausible and damaging.
# Value = why it matters, surfaced in the failure message so whoever trips this
# understands the stake rather than just deleting the assertion.
CRITICAL: dict[str, str] = {
    "snaptrade-python-sdk": "broker sync — 12.0.0 silently dropped our credentials (2026-07-23)",
    "apscheduler": "every scheduled job — 4.0 is a full API rewrite",
    "websockets": "live bars feed + OPRA consumer — 13/14 reworked the asyncio API",
    "bcrypt": "auth — hashpw/checkpw on every login",
    "stripe": "payments + webhooks",
    "resend": "member email (verification, reconnect, digests)",
    "cryptography": "Fernet — broker secret-at-rest decryption",
}

_LINE = re.compile(r"^\s*([A-Za-z0-9._-]+(?:\[[^\]]+\])?)\s*(.*?)\s*(?:#.*)?$")


def _declarations() -> dict[str, str]:
    """{normalized package name: version specifier} from requirements.txt."""
    out: dict[str, str] = {}
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        name = m.group(1).split("[")[0].strip().lower().replace("_", "-")
        out[name] = m.group(2).strip()
    return out


@pytest.mark.parametrize("package", sorted(CRITICAL))
def test_critical_dependency_has_an_upper_bound(package: str) -> None:
    decls = _declarations()
    assert package in decls, (
        f"{package} vanished from requirements.txt — it is on the CRITICAL list "
        f"({CRITICAL[package]}). If it was intentionally removed, drop it from "
        f"CRITICAL in this test too."
    )
    spec = decls[package]
    assert spec, f"{package} has no version specifier at all"
    pinned_exactly = spec.startswith("==")
    has_upper_bound = "<" in spec
    assert pinned_exactly or has_upper_bound, (
        f"{package} is declared as `{spec}` — no upper bound.\n"
        f"WHY THIS MATTERS: {CRITICAL[package]}.\n"
        f"A Railway rebuild can install the next MAJOR at any time. When a "
        f"library takes config as **kwargs, that failure is SILENT (see "
        f"snaptrade 12.0.0, 2026-07-23). Add `,<N` at the currently-running "
        f"major, or pin exactly."
    )


def test_snaptrade_stays_below_12() -> None:
    """The specific regression. 12.0.0 changed SnapTrade.__init__ to
    (configuration=None, **kwargs); our consumer_key/client_id kwargs are then
    swallowed with no error and every request goes out unauthenticated."""
    spec = _declarations().get("snaptrade-python-sdk", "")
    assert "<12" in spec, (
        f"snaptrade-python-sdk is `{spec}`. Do NOT relax past <12 without "
        f"migrating _sdk() to the 12.x auth model "
        f"(Configuration(auth=CommercialApiKeyAuth(mode='commercialApiKey', …))) "
        f"AND re-validating every call site in "
        f"api/services/journal_two/broker/snaptrade_client.py."
    )


def test_requirements_file_parses() -> None:
    """A malformed line would make the checks above vacuously pass."""
    decls = _declarations()
    assert len(decls) > 20, f"only parsed {len(decls)} requirements — parser broke?"
    assert "fastapi" in decls
