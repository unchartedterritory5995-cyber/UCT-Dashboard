"""Rails for api/services/backup_crypto.py — envelope encryption of every backup that leaves web.

Railway leaked customer env vars on 2026-10-21, R2 backup credentials among them. A backup in R2
must be readable only with the OFFLINE private key: the pod holds the public half alone.
"""
from __future__ import annotations

import base64
import logging
import os

import pytest

from api.services import backup_crypto as bc
from tests import _backup_keys as K


def _blob(n: int) -> bytes:
    return os.urandom(n)


def _roundtrip(tmp_path, data: bytes, **kw) -> bytes:
    src, enc, out = tmp_path / "src.bin", tmp_path / "src.bin.enc", tmp_path / "out.bin"
    src.write_bytes(data)
    priv, pub = K.keypair()
    bc.encrypt_file(src, enc, pub, **kw)
    bc.decrypt_file(enc, out, priv)
    return out.read_bytes()


def test_roundtrip_small(tmp_path):
    data = b"hello member data u1@x.dev"
    assert _roundtrip(tmp_path, data) == data


def test_roundtrip_empty_file(tmp_path):
    assert _roundtrip(tmp_path, b"") == b""


def test_roundtrip_multi_chunk_with_a_partial_last_chunk(tmp_path):
    # 3.5 chunks at a small chunk size, so every boundary case is exercised.
    data = _blob(4096 * 3 + 2048)
    assert _roundtrip(tmp_path, data, chunk_size=4096) == data


def test_roundtrip_exact_multiple_of_chunk_size(tmp_path):
    data = _blob(4096 * 4)
    assert _roundtrip(tmp_path, data, chunk_size=4096) == data


def test_roundtrip_default_chunk_size_spans_several_chunks(tmp_path):
    data = _blob(bc.DEFAULT_CHUNK_SIZE * 2 + 17)
    assert _roundtrip(tmp_path, data) == data


def test_ciphertext_starts_with_the_magic_and_holds_no_plaintext(tmp_path):
    marker = b"PLAINTEXT-MARKER-alice@example.com"
    src, enc = tmp_path / "s", tmp_path / "s.enc"
    src.write_bytes(marker * 200)
    bc.encrypt_file(src, enc, K.keypair()[1])
    blob = enc.read_bytes()
    assert blob.startswith(bc.MAGIC)
    assert marker not in blob
    assert bc.is_encrypted(enc) and bc.is_encrypted(blob) and bc.is_encrypted(str(enc))
    assert not bc.is_encrypted(src) and not bc.is_encrypted(b"\x1f\x8b gzip")


def test_two_encryptions_of_the_same_file_differ(tmp_path):
    src = tmp_path / "s"
    src.write_bytes(b"same bytes" * 100)
    bc.encrypt_file(src, tmp_path / "a", K.keypair()[1])
    bc.encrypt_file(src, tmp_path / "b", K.keypair()[1])
    assert (tmp_path / "a").read_bytes() != (tmp_path / "b").read_bytes()


@pytest.mark.parametrize("where", ["header", "wrapped_key", "first_chunk", "last_byte"])
def test_tamper_anywhere_is_detected(tmp_path, where):
    src, enc, out = tmp_path / "s", tmp_path / "s.enc", tmp_path / "o"
    src.write_bytes(_blob(4096 * 2 + 100))
    priv, pub = K.keypair()
    bc.encrypt_file(src, enc, pub, chunk_size=4096)
    blob = bytearray(enc.read_bytes())
    pos = {"header": len(bc.MAGIC) + 1, "wrapped_key": len(bc.MAGIC) + 40,
           "first_chunk": len(blob) // 3, "last_byte": len(blob) - 1}[where]
    blob[pos] ^= 0x01
    enc.write_bytes(bytes(blob))
    with pytest.raises(bc.BackupDecryptError):
        bc.decrypt_file(enc, out, priv)
    assert not out.exists(), "a failed decrypt must never leave a partial plaintext behind"


def test_truncation_at_a_chunk_boundary_is_detected(tmp_path):
    src, enc, out = tmp_path / "s", tmp_path / "s.enc", tmp_path / "o"
    src.write_bytes(_blob(4096 * 3))
    priv, pub = K.keypair()
    bc.encrypt_file(src, enc, pub, chunk_size=4096)
    blob = enc.read_bytes()
    rec = 1 + 4 + 4096 + 16          # one full chunk record
    enc.write_bytes(blob[:-rec])     # drop the final chunk record entirely
    with pytest.raises(bc.BackupDecryptError):
        bc.decrypt_file(enc, out, priv)


def test_trailing_garbage_is_detected(tmp_path):
    src, enc, out = tmp_path / "s", tmp_path / "s.enc", tmp_path / "o"
    src.write_bytes(b"abc")
    priv, pub = K.keypair()
    bc.encrypt_file(src, enc, pub)
    enc.write_bytes(enc.read_bytes() + b"extra")
    with pytest.raises(bc.BackupDecryptError):
        bc.decrypt_file(enc, out, priv)


def test_the_wrong_private_key_fails(tmp_path):
    src, enc, out = tmp_path / "s", tmp_path / "s.enc", tmp_path / "o"
    src.write_bytes(b"secret")
    bc.encrypt_file(src, enc, K.keypair("a")[1])
    with pytest.raises(bc.BackupDecryptError):
        bc.decrypt_file(enc, out, K.keypair("b")[0])
    assert not out.exists()


def test_decrypting_a_plaintext_file_fails(tmp_path):
    p = tmp_path / "plain.gz"
    p.write_bytes(b"\x1f\x8b not encrypted")
    with pytest.raises(bc.BackupDecryptError):
        bc.decrypt_file(p, tmp_path / "o", K.keypair()[0])


# ── the public key from the environment ─────────────────────────────────────
def test_env_key_accepts_base64_single_line(monkeypatch):
    monkeypatch.setenv("BACKUP_PUBLIC_KEY", K.public_b64())
    assert bc.load_public_key_from_env() == K.keypair()[1]


def test_env_key_accepts_raw_pem(monkeypatch):
    monkeypatch.setenv("BACKUP_PUBLIC_KEY", K.keypair()[1].decode())
    assert bc.load_public_key_from_env().startswith(b"-----BEGIN PUBLIC KEY-----")


def test_env_key_accepts_pem_with_escaped_newlines(monkeypatch):
    monkeypatch.setenv("BACKUP_PUBLIC_KEY", K.keypair()[1].decode().replace("\n", "\\n"))
    assert bc.load_public_key_from_env().startswith(b"-----BEGIN PUBLIC KEY-----")


@pytest.mark.parametrize("value", [None, "", "   ", "not-a-key", base64.b64encode(b"garbage").decode()])
def test_env_key_missing_or_invalid_raises(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("BACKUP_PUBLIC_KEY", raising=False)
    else:
        monkeypatch.setenv("BACKUP_PUBLIC_KEY", value)
    with pytest.raises(bc.BackupKeyError, match="BACKUP_PUBLIC_KEY"):
        bc.load_public_key_from_env()


def test_env_key_refuses_a_PRIVATE_key(monkeypatch):
    """Pasting the private half into Railway would put it right back where the leak was."""
    monkeypatch.setenv("BACKUP_PUBLIC_KEY", base64.b64encode(K.keypair()[0]).decode())
    with pytest.raises(bc.BackupKeyError, match="PRIVATE"):
        bc.load_public_key_from_env()


def test_env_key_refuses_a_short_rsa_key(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    small = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    monkeypatch.setenv("BACKUP_PUBLIC_KEY", small.decode())
    with pytest.raises(bc.BackupKeyError, match="4096"):
        bc.load_public_key_from_env()


def test_public_key_or_log_logs_ONE_error_naming_the_variable(monkeypatch, caplog):
    monkeypatch.delenv("BACKUP_PUBLIC_KEY", raising=False)
    log = logging.getLogger("test.backup_crypto")
    with caplog.at_level(logging.ERROR, logger="test.backup_crypto"):
        assert bc.public_key_or_log(log, "[rail]") is None
    errs = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errs) == 1 and "BACKUP_PUBLIC_KEY" in errs[0].getMessage()
    assert "[rail]" in errs[0].getMessage()


def test_private_key_resolution_flag_beats_env(monkeypatch, tmp_path):
    a = K.write_private(tmp_path, "a")
    b = K.write_private(tmp_path, "b")
    monkeypatch.setenv("BACKUP_PRIVATE_KEY_PATH", str(b))
    assert bc.load_private_key(a) == K.keypair("a")[0]
    assert bc.load_private_key(None) == K.keypair("b")[0]
    monkeypatch.delenv("BACKUP_PRIVATE_KEY_PATH")
    assert bc.load_private_key(None) is None


def test_encrypted_name_helpers():
    assert bc.ENC_SUFFIX == ".enc"
    assert bc.strip_enc("a/b.db.gz.enc") == "a/b.db.gz" and bc.strip_enc("a/b.db.gz") == "a/b.db.gz"
