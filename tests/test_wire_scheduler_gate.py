"""The wire ships DARK.

The detector job must not register unless WIRE_ENABLED is explicitly "1", so
merging this cannot start polling providers on production by accident.
"""
import os
from unittest import mock

from api.main import _wire_enabled


def test_off_by_default():
    env = {k: v for k, v in os.environ.items() if k != "WIRE_ENABLED"}
    with mock.patch.dict(os.environ, env, clear=True):
        assert _wire_enabled() is False


def test_enables_only_on_explicit_1():
    with mock.patch.dict(os.environ, {"WIRE_ENABLED": "1"}):
        assert _wire_enabled() is True


def test_any_other_value_is_off():
    """'true', 'yes', '0' and typos all mean OFF — no truthy-string surprises."""
    for val in ("0", "", "true", "True", "yes", "on", " 1"):
        with mock.patch.dict(os.environ, {"WIRE_ENABLED": val}):
            assert _wire_enabled() is False, f"{val!r} should not enable the wire"
