"""Market Cap V1 METHODOLOGY identity -- what every production build must be built with, byte for byte.

The production lifecycle (docs/marketcap/PRODUCTION-LIFECYCLE.md) refreshes the DATA, never the rules. Every refresh
rebuilds from fresh inputs with exactly these files; a build whose methodology files are not byte-identical
(LF-normalised) to the ones below is refused by the release gates (gate METHODOLOGY) and can never be published.
Changing a rule is a separate, reviewed project that bumps METHODOLOGY_VERSION and these hashes together.

MCAP_V1-M1 was pinned at commit ad40add51 (the accepted candidate MCAP_V1-20261003T140306Z): the build, every evidence
parser that shapes an input, the shared extreme-step rule, the validator that proves gate N, and the two Fundamentals
modules the build imports (identical to the Fundamentals V5 frozen methodology hashes).

MCAP_V1-M2 (owner decision 2026-10-05, DURABLE ISSUER IDENTITY): M1 plus identity_ledger.py, and build.py valuing an
issuer over its current SEC tickers PLUS the tickers SEC attributed to it earlier (retained, never current). Every other
pinned file is byte-identical to M1. M1 -> M2 changes ONLY issuers whose SEC ticker list lost a symbol; an M2 build from
the M1 candidate's own inputs (one SEC snapshot) is the M1 build.

MCAP_V1-M3 (owner decisions 2026-10-05, OFFERING PROJECTIONS OF AN ALREADY-PUBLIC SECURITY): M2 plus offering_status.py
(evidence: the issuer's own prospectus says the security already trades; the first priced final prospectus; whether it
counts pre-funded warrants as shares outstanding) and, in build.py, two eligibility rules -- a preliminary projection is
usable only once pricing is public (the one existing clock), and a priced projection counting non-common instruments is
refused. reasons.py gains the observation status REJECTED_PROJECTION_NOT_COMMON_BASIS; no gap reason changes.
MCAP_V1-M3.1 (owner decisions 2026-10-06, TEMPORAL TICKER ATTRIBUTION + DETERMINISTIC EVIDENCE SELECTION): build.py only;
every other pinned file is byte-identical to M3. (1) a RETAINED symbol whose Massive record now names another CIK keeps
its proven history up to the SUCCESSION BOUNDARY (SEC 8-K12B / 8-K12G3, or the predecessor's Form 15 / 25; an uncertain
boundary withholds only the uncertain window, from both issuers) instead of being withheld whole; the successor's
valued days before the boundary are withheld (SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED); a succession-cut symbol keeps
its full price basis for split selection; a reassigned symbol's current Massive record is not multi-class evidence
about its predecessor. (2) a retained symbol and a current symbol of the same CIK joined by the provider's
ticker_change event, with non-overlapping bars, are one security (rename stitch). (3) split evidence is read in a TOTAL
order (ties were insertion order). Every rule triggers only on a RETAINED symbol, so an M3.1 build from M3's own
inputs (where no such symbol exists) is the M3 build.
"""
from __future__ import annotations

import hashlib
import os

from .extreme_steps import SEMANTICS_VERSION

METHODOLOGY_VERSION = "MCAP_V1-M3.1"
METHODOLOGY_PREVIOUS = "MCAP_V1-M3"
METHODOLOGY_COMMIT = "b03cdb0e0c32f6c50a95e81bfdd370c6d7adcff0"            # M3.1 pinned here (M3: 4ab717573, M2: 3c0ed9939, M1: ad40add51)
EXTREME_STEP_SEMANTICS = SEMANTICS_VERSION
SAFETY_BOUND_DAYS = 456

METHODOLOGY_FILES = {
    "build.py": "ea2be60a74598ae53084e4042128c0c29dfb09328e347a5fe1c40069ee2cf348",
    "adr.py": "30fedef57a1c6837e8fdce40aaa61f6fb2d1a4870d095d28c4e62f63e6fc3ddd",
    "classecon.py": "69979a2e7a67737ce6f21e9b48ad1a73eb5812043de5192f0c813fcbc9a09886",
    "cover.py": "35de23bf13fe0311fe65141ef19e5ec37cd65afeed25e54410e51a2edd42b261",
    "engine.py": "c62a28193f24e7855d469926527cb2ad940bfc4e68e3ffbfaf3052b8669fe158",
    "extreme_steps.py": "e2c1a42b4b1b4dd8d1c1a15018e972fb8c322a3a592303a108dadccd3d71bf72",
    "identity.py": "cf3b193026f2232d9b10ce35bbdea26500b5086ec86d0382b5d888cb25aad687",
    "reasons.py": "4f78ff04b8e38d3a4b83185968319c09370e8a16fb6e96f7714be3af8650c1dc",
    "state.py": "352e8f5f9dc7e8d859d1279cb3cca483f9275be6e14720027c627504f9efc994",
    "structure.py": "d664a0ce2740478a0fd5e96ad445181e7bfc5147eb08131c220a164797c8fb6b",
    "textcover.py": "6fa7626e3918334dfea2f35c0deb50b4b7ef1760cbba88a8482cab35f53d8f65",
    "ipo.py": "f277dac39df6bb29cd23ef87e9ec0c41df2d85b57cbb52e6ddc200f1a25197e2",
    "prospectus.py": "7b3d721ac7cd7df21d2751982f91b30009c0bc6d42e31cee0b3f672620e21b27",
    "splitev.py": "9a080b056968441d663997264eddd5c75320b6e557202a8d4ce8ac4948562b81",
    "lineage.py": "7d5a6917cb3c96e6d7dbd480536ec7376da237e52ba022dfa5f4c1bfe97e5b97",
    "acceptance.py": "8411a2c43cbf880d2c4a94261a550be0d0fe4fd0b0b75b04af10e26fd47e5009",
    "inputs.py": "fef130d963125832fa643b89c7602cc88d8aa49baa786694c2a0604f9bc7593d",
    "harvest_covers.py": "47d78b6d3630a13e2a0be8a5faad6e3a08002f6595ad6eb980d2fe04a7439d8f",
    "harvest_text.py": "fc78420c97d24c38894b7c5b89ccebab273c2d1418e824e579b277e870ff5998",
    "reparse_prosp.py": "a45c4ac6b2d3815ff0e0ecb4864b3374ca696e2d1d353eb07eb4faba0f1b850a",
    "prices.py": "c33d890d7dadcc92ad2a9db323e0bfa9bceec5b5621e8a1ff4d1869080e362eb",
    "fetch.py": "8951ee34d292357922727fe880194f62ae9359c312431d164372bed299640cd0",
    "step_records.py": "e838a5074a5d88063e20e2f07401ba34304b98f3f463842d2c34224df19bce7e",
    "fundamentals_pit/splits.py": "5bf44900ae934d8188d5b6e05228b21b9953671bf9ec4289586edb46a580ae79",
    "fundamentals_pit/filings.py": "d43d133ab7168e9887c65ded1183ec79aa5e5ff0fa1c1e7c2bc8738961323d13",
    "identity_ledger.py": "7130bd8e01cbc1322740153fa0f81a65be39ec5f47cda59a39fffe83d5eea43c",
    "offering_status.py": "35259a1e16d09261362c609e59d2ce11e09f52694f481945830c2925327e530f",
}


def _path(name: str, pkg_dir: str) -> str:
    if name.startswith("fundamentals_pit/"):
        return os.path.join(os.path.dirname(pkg_dir), "fundamentals_pit", name.split("/", 1)[1])
    return os.path.join(pkg_dir, name)


def file_sha(p: str) -> str:
    return hashlib.sha256(open(p, "rb").read().replace(b"\r\n", b"\n")).hexdigest()


def drift(pkg_dir: str | None = None) -> dict[str, str]:
    """{file: problem} for every methodology file that is not byte-identical (LF-normalised) to the pinned one."""
    pkg_dir = pkg_dir or os.path.dirname(os.path.abspath(__file__))
    out = {}
    for name, want in METHODOLOGY_FILES.items():
        p = _path(name, pkg_dir)
        if not os.path.exists(p):
            out[name] = "missing"
            continue
        got = file_sha(p)
        if got != want:
            out[name] = got
    return out


def digest() -> str:
    """One hash naming the whole pinned rule set (recorded in every release manifest)."""
    h = hashlib.sha256()
    for name in sorted(METHODOLOGY_FILES):
        h.update(f"{name}={METHODOLOGY_FILES[name]}\n".encode())
    return h.hexdigest()


def identity() -> dict:
    return {"version": METHODOLOGY_VERSION, "commit": METHODOLOGY_COMMIT, "extreme_step_semantics": EXTREME_STEP_SEMANTICS,
            "safety_bound_days": SAFETY_BOUND_DAYS, "files_digest": digest()}
