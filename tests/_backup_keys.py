"""Test-only RSA keypairs for the encrypted-backup rails (api/services/backup_crypto.py).

Generated ONCE per test session (RSA-4096 takes a second or two) and never written to disk
except where a test asks for a file in its own tmp_path. Nothing here is real key material.
"""
from __future__ import annotations

import base64
import functools

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

PUBLIC_ENV = "BACKUP_PUBLIC_KEY"


def keypair(which: str = "a") -> tuple[bytes, bytes]:
    """(private_pem, public_pem) for a named test keypair. 'a' is the default one."""
    return _generate(which)


@functools.lru_cache(maxsize=None)
def _generate(which: str) -> tuple[bytes, bytes]:
    # Cached on the NAME alone (lru_cache keys keypair() and keypair("a") apart).
    key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    priv = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)
    return priv, pub


def public_b64(which: str = "a") -> str:
    return base64.b64encode(keypair(which)[1]).decode("ascii")


def arm(monkeypatch, which: str = "a") -> bytes:
    """Set BACKUP_PUBLIC_KEY (the single-line base64 form Railway holds); returns the private PEM."""
    monkeypatch.setenv(PUBLIC_ENV, public_b64(which))
    return keypair(which)[0]


def write_private(tmp_path, which: str = "a"):
    p = tmp_path / f"backup-private-{which}.pem"
    p.write_bytes(keypair(which)[0])
    return p
