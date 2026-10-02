"""Generate a VAPID key pair for BRK-04 Web Push (api/services/web_push.py).

    python tools/gen_vapid_keys.py [--subject mailto:you@example.com]

Prints the three Railway variables to set on the `web` service. The keys are
printed to YOUR terminal only -- this script writes no file. ⛔ Never commit
them. Rotating the pair invalidates every existing device subscription (each
browser subscribed against the old public key), so members must re-enable push.

Format: the private key is the raw 32-byte P-256 scalar and the public key the
65-byte uncompressed point, both base64url without padding -- what browsers
take as `applicationServerKey` and what web_push.vapid_config() validates.
"""
from __future__ import annotations

import argparse
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def generate() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    priv = key.private_numbers().private_value.to_bytes(32, "big")
    pub = key.public_key().public_bytes(serialization.Encoding.X962,
                                        serialization.PublicFormat.UncompressedPoint)
    return _b64u(pub), _b64u(priv)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--subject", default="mailto:REPLACE_ME@example.com",
                    help="contact the push services can reach (mailto: or https:)")
    args = ap.parse_args()
    pub, priv = generate()
    print("# Set these on the Railway `web` service. Do NOT commit them.")
    print(f"WEB_PUSH_VAPID_PUBLIC_KEY={pub}")
    print(f"WEB_PUSH_VAPID_PRIVATE_KEY={priv}")
    print(f"WEB_PUSH_VAPID_SUBJECT={args.subject}")
    print("# then, when ready to arm: WEB_PUSH_ENABLED=1")


if __name__ == "__main__":
    main()
