"""Envelope encryption for every backup that leaves the web pod (format ``UCTBK1``).

WHY (2026-10-21): Railway leaked customer environment variables, our R2 backup credentials
among them, and the backup rails were uploading UNENCRYPTED member data to R2. From here on a
backup object is readable only with an OFFLINE private key. The pod holds the PUBLIC half
alone (``BACKUP_PUBLIC_KEY``), so a future leak of every variable on Railway, R2 credentials
included, yields ciphertext and nothing else.

Scheme, per file:
  * a fresh random 32-byte data key -> AES-256-GCM over the file in fixed-size chunks (constant
    memory however large the file is);
  * the data key wrapped with RSA-OAEP(SHA-256) under a >= 4096-bit RSA public key.

Wire format (all integers big-endian)::

    header  = MAGIC(6) | wrapped_len(u16) | wrapped_key | nonce_prefix(8) | chunk_size(u32)
    record  = final_flag(u8: 0|1) | ct_len(u32) | ciphertext+tag(ct_len)
    file    = header | record_0 | record_1 | ... | record_n   (exactly one final record, last)

Chunk ``i`` uses nonce ``nonce_prefix || u32(i)`` and associated data
``header || u32(i) || final_flag``. So the header is authenticated by every chunk, chunks
cannot be reordered, dropped or duplicated (counter), the stream cannot be truncated at a
chunk boundary (the final flag), and bytes after the final record are rejected. A failed
decrypt raises ``BackupDecryptError`` and never leaves a partial plaintext file behind.

The magic carries the version; a future format gets a new magic (``UCTBK2``) and this
module keeps reading the old one.

⛔ FAIL CLOSED. ``public_key_or_log`` is what a rail calls: a missing or invalid
``BACKUP_PUBLIC_KEY`` logs ONE error naming the variable and returns None, and the rail
uploads nothing. There is no plaintext fallback anywhere. The private key never belongs on
Railway; restore tools read it from ``--private-key PATH`` or ``BACKUP_PRIVATE_KEY_PATH``.
Runbook: docs/runbooks/backup-encryption.md.
"""
from __future__ import annotations

import base64
import binascii
import os
import struct
from pathlib import Path
from typing import Optional, Union

MAGIC = b"UCTBK1"
ENC_SUFFIX = ".enc"
ENC_CONTENT_TYPE = "application/octet-stream"
PUBLIC_KEY_ENV = "BACKUP_PUBLIC_KEY"
PRIVATE_KEY_PATH_ENV = "BACKUP_PRIVATE_KEY_PATH"
PRIVATE_KEY_PASSPHRASE_ENV = "BACKUP_PRIVATE_KEY_PASSPHRASE"
MIN_RSA_BITS = 4096
DEFAULT_CHUNK_SIZE = 1024 * 1024
_MAX_CHUNK_SIZE = 64 * 1024 * 1024
_DATA_KEY_BYTES = 32
_NONCE_PREFIX_BYTES = 8
_TAG_BYTES = 16
_REC_HEAD = struct.Struct(">BI")

PathLike = Union[str, os.PathLike]


class BackupKeyError(ValueError):
    """A key is missing, unreadable, the wrong kind, or too short."""


class BackupDecryptError(ValueError):
    """The object cannot be decrypted: not this format, tampered, truncated, or the wrong key."""


# ── names ────────────────────────────────────────────────────────────────────
def strip_enc(name: str) -> str:
    """``x.db.gz.enc`` -> ``x.db.gz``; a legacy plaintext name is returned unchanged."""
    return name[: -len(ENC_SUFFIX)] if name.endswith(ENC_SUFFIX) else name


def is_encrypted(path_or_bytes: Union[PathLike, bytes, bytearray]) -> bool:
    """True iff the bytes (or the file's first bytes) start with the UCTBK1 magic."""
    if isinstance(path_or_bytes, (bytes, bytearray)):
        return bytes(path_or_bytes[: len(MAGIC)]) == MAGIC
    try:
        with open(path_or_bytes, "rb") as f:
            return f.read(len(MAGIC)) == MAGIC
    except OSError:
        return False


# ── keys ─────────────────────────────────────────────────────────────────────
def _normalise_pem_text(raw: str) -> bytes:
    """Raw PEM, PEM with literal ``\\n`` escapes, or base64 of a PEM -> PEM bytes."""
    text = raw.strip().strip('"').strip("'").strip()
    if "-----BEGIN" in text:
        return text.replace("\\n", "\n").encode("ascii", errors="strict")
    try:
        decoded = base64.b64decode("".join(text.split()), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} is neither a PEM nor base64 of one") from exc
    if b"-----BEGIN" not in decoded:
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} decodes from base64 but is not a PEM")
    return decoded


def _validated_public(pem: bytes):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    if b"PRIVATE KEY" in pem:
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} holds a PRIVATE key; only the public half may "
                             "be set on the server (and the private one must now be treated as leaked)")
    try:
        key = serialization.load_pem_public_key(pem)
    except (ValueError, TypeError) as exc:
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} is not a readable PEM public key: {exc}") from exc
    if not isinstance(key, rsa.RSAPublicKey):
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} is not an RSA public key")
    if key.key_size < MIN_RSA_BITS:
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} is RSA-{key.key_size}; RSA-{MIN_RSA_BITS} or larger is required")
    return key


def load_public_key_from_env() -> bytes:
    """The validated ``BACKUP_PUBLIC_KEY`` as SubjectPublicKeyInfo PEM bytes.

    Accepts raw PEM, PEM with ``\\n`` escapes, or base64-encoded PEM (Railway variables are
    single-line). Raises BackupKeyError — naming the variable — when it is missing or invalid."""
    from cryptography.hazmat.primitives import serialization

    raw = os.environ.get(PUBLIC_KEY_ENV, "")
    if not raw.strip():
        raise BackupKeyError(f"{PUBLIC_KEY_ENV} is not set")
    key = _validated_public(_normalise_pem_text(raw))
    return key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def public_key_or_log(logger, tag: str) -> Optional[bytes]:
    """What a backup rail calls before it builds anything. The PEM, or None after ONE error line.

    None means: upload NOTHING. There is no plaintext fallback."""
    try:
        return load_public_key_from_env()
    except BackupKeyError as exc:
        logger.error("%s FAIL-CLOSED: %s -- refusing to upload an unencrypted backup; nothing "
                     "uploaded (set %s; docs/runbooks/backup-encryption.md)", tag, exc, PUBLIC_KEY_ENV)
        return None


def load_private_key(path: Optional[PathLike] = None) -> Optional[bytes]:
    """The private-key PEM from ``path``, else from ``BACKUP_PRIVATE_KEY_PATH``, else None.

    Raises BackupKeyError when a path is named but cannot be read."""
    chosen = path or os.environ.get(PRIVATE_KEY_PATH_ENV, "").strip() or None
    if not chosen:
        return None
    try:
        return Path(chosen).read_bytes()
    except OSError as exc:
        raise BackupKeyError(f"cannot read the private key at {chosen}: {exc}") from exc


def private_key_passphrase() -> Optional[bytes]:
    v = os.environ.get(PRIVATE_KEY_PASSPHRASE_ENV)
    return v.encode("utf-8") if v else None


def _load_private(pem: bytes, passphrase: Optional[bytes]):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    try:
        key = serialization.load_pem_private_key(pem, password=passphrase)
    except (ValueError, TypeError) as exc:
        raise BackupDecryptError(f"the private key cannot be loaded: {exc}") from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise BackupDecryptError("the private key is not an RSA key")
    return key


def _oaep():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    return padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


# ── encrypt / decrypt ────────────────────────────────────────────────────────
def _nonce(prefix: bytes, i: int) -> bytes:
    return prefix + struct.pack(">I", i)


def _aad(header: bytes, i: int, final: int) -> bytes:
    return header + struct.pack(">IB", i, final)


def encrypt_file(src: PathLike, dst: PathLike, public_key_pem: bytes, *,
                 chunk_size: int = DEFAULT_CHUNK_SIZE) -> None:
    """Encrypt ``src`` into ``dst`` (UCTBK1). Streams; memory is O(chunk_size)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not (1 <= chunk_size <= _MAX_CHUNK_SIZE):
        raise ValueError(f"chunk_size out of range: {chunk_size}")
    pub = _validated_public(public_key_pem)
    data_key = AESGCM.generate_key(bit_length=256)
    wrapped = pub.encrypt(data_key, _oaep())
    prefix = os.urandom(_NONCE_PREFIX_BYTES)
    header = MAGIC + struct.pack(">H", len(wrapped)) + wrapped + prefix + struct.pack(">I", chunk_size)
    aes = AESGCM(data_key)
    dst = Path(dst)
    tmp = dst.with_name(dst.name + ".partial")
    try:
        with open(src, "rb") as fin, open(tmp, "wb") as fout:
            fout.write(header)
            i = 0
            cur = fin.read(chunk_size)
            while True:
                nxt = fin.read(chunk_size)
                final = 0 if nxt else 1
                ct = aes.encrypt(_nonce(prefix, i), cur, _aad(header, i, final))
                fout.write(_REC_HEAD.pack(final, len(ct)))
                fout.write(ct)
                if final:
                    break
                cur, i = nxt, i + 1
        os.replace(tmp, dst)
    finally:
        if tmp.exists():
            tmp.unlink()


def _read_exact(f, n: int) -> bytes:
    b = f.read(n)
    if len(b) != n:
        raise BackupDecryptError("truncated")
    return b


def decrypt_file(src: PathLike, dst: PathLike, private_key_pem: bytes, *,
                 passphrase: Optional[bytes] = None) -> None:
    """Decrypt a UCTBK1 ``src`` into ``dst``. Raises BackupDecryptError on any defect; on
    failure ``dst`` is not created (the plaintext is written aside and renamed at the end)."""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    priv = _load_private(private_key_pem, passphrase)
    dst = Path(dst)
    tmp = dst.with_name(dst.name + ".partial")
    try:
        with open(src, "rb") as fin:
            if fin.read(len(MAGIC)) != MAGIC:
                raise BackupDecryptError("not a UCTBK1 encrypted backup (magic missing)")
            (wlen,) = struct.unpack(">H", _read_exact(fin, 2))
            if wlen != priv.key_size // 8:
                raise BackupDecryptError("wrapped-key length does not match this private key")
            wrapped = _read_exact(fin, wlen)
            prefix = _read_exact(fin, _NONCE_PREFIX_BYTES)
            (chunk_size,) = struct.unpack(">I", _read_exact(fin, 4))
            if not (1 <= chunk_size <= _MAX_CHUNK_SIZE):
                raise BackupDecryptError("chunk size out of range")
            header = MAGIC + struct.pack(">H", wlen) + wrapped + prefix + struct.pack(">I", chunk_size)
            try:
                data_key = priv.decrypt(wrapped, _oaep())
            except ValueError as exc:
                raise BackupDecryptError("the data key does not unwrap: wrong private key, or "
                                         "the header was altered") from exc
            if len(data_key) != _DATA_KEY_BYTES:
                raise BackupDecryptError("unwrapped data key has the wrong length")
            aes = AESGCM(data_key)
            with open(tmp, "wb") as fout:
                i = 0
                while True:
                    head = fin.read(_REC_HEAD.size)
                    if len(head) != _REC_HEAD.size:
                        raise BackupDecryptError("truncated: the final chunk is missing")
                    final, ct_len = _REC_HEAD.unpack(head)
                    if final not in (0, 1) or not (_TAG_BYTES <= ct_len <= chunk_size + _TAG_BYTES):
                        raise BackupDecryptError(f"chunk {i} record header is malformed")
                    ct = _read_exact(fin, ct_len)
                    try:
                        fout.write(aes.decrypt(_nonce(prefix, i), ct, _aad(header, i, final)))
                    except InvalidTag as exc:
                        raise BackupDecryptError(f"chunk {i} failed authentication (tampered)") from exc
                    if final:
                        break
                    i += 1
            if fin.read(1):
                raise BackupDecryptError("data after the final chunk")
        os.replace(tmp, dst)
    except BackupDecryptError:
        raise
    except (OSError, struct.error) as exc:
        raise BackupDecryptError(f"{type(exc).__name__}: {exc}") from exc
    finally:
        if tmp.exists():
            tmp.unlink()


def decrypt_if_encrypted(path: PathLike, work_dir: PathLike, private_key_pem: Optional[bytes], *,
                         passphrase: Optional[bytes] = None) -> Path:
    """Restore-tool helper: a plaintext (legacy) file comes back unchanged; an encrypted one is
    decrypted into ``work_dir`` under its name minus ``.enc``.

    Raises BackupKeyError when the file is encrypted and no private key was given, and
    BackupDecryptError when it cannot be decrypted."""
    path = Path(path)
    if not is_encrypted(path):
        return path
    if not private_key_pem:
        raise BackupKeyError(f"{path.name} is encrypted and no private key was given "
                             f"(--private-key PATH or {PRIVATE_KEY_PATH_ENV})")
    name = strip_enc(path.name)
    if name == path.name:
        name = name + ".dec"
    out = Path(work_dir) / name
    if out.resolve() == path.resolve():
        out = Path(work_dir) / (name + ".dec")
    decrypt_file(path, out, private_key_pem,
                 passphrase=passphrase if passphrase is not None else private_key_passphrase())
    return out
