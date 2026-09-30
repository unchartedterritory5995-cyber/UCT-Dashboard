"""V5 PRODUCTION identity: the frozen historical base, the methodology it was built with, and where the live state lives.

The frozen artifact (run v5-20260925T124921Z) is IMMUTABLE historical truth. Production never writes it: the live
store is a byte copy (`live.db`), and every change to the served interpretation is a new, immutable VERSION
(v5_publish.py). See docs/fundamentals-pit/V5-CUTOVER-DESIGN.md.
"""
from __future__ import annotations

import hashlib
import os

V5 = 5
RUN_ID = "v5-20260925T124921Z"
FROZEN_SHA256 = "a81481138a2c67e11f67ca12dc0e9e6807534d5fe5ea9992cabb81bc4148c6e1"
FROZEN_BYTES = 1088565248
FREEZE_JSON_SHA256 = "1b3da4eeb8c686b2bff5e5d335ba61a97e00508b0ad79c270bb0597149bf9430"
FROZEN_ARTIFACT_MANIFEST_SHA256 = "42794d92a4587323627259df1348d45312fe54f133a0412be8b95fdf77d6359f"
ARCHIVE_PREFIX = f"_runs/fundamentals_pit_v5/{RUN_ID}/frozen/"
ARCHIVE_BUNDLE_SHA256 = "ac044e085f94ab5667ff9e05e89906e3b2503f5ff47f58fcbbebadb46f51a7fe"
BASE_VERSION_ID = "v5-base-" + RUN_ID

# ⛔ The methodology is FROZEN with the base. Every later version extends the base with exactly these rules; a rule
# change would mix two methodologies inside one served series. Hashes are of the LF-normalised files at 7dfda83de.
METHODOLOGY_COMMIT = "7dfda83de6a78da0eb48fedc3d05ca588cf840b4"
METHODOLOGY_FILES = {
    "knowledge.py": "56af2e4425f036e6cab3009fd5b86194c96087a024b9373a5023181e9c5f8f01",
    "metrics.py": "f446857f3d5f2ae77b1d4d8336e1aa34b1e8c627da604043eca82fe75d04433f",
    "series.py": "ac4984d68c049f7cf3ea88f428805e01f83be81b4537f811b061f9e8ce416b74",
    "derive.py": "9b533524cfa4d334f5bee11586ce0b5b9eb68fd5d4c54c91b9ecc0547841c8ab",
    "concepts.py": "c2b647a0f8a01da2cc88d408ba84e2adf669aa01353b18e1ce289767b0f5909f",
    "split_ledger.py": "81e99fc9132eb3743171534ea6eb957d874d95dccf1a9e30ed5875ae344db747",
    "splits.py": "5bf44900ae934d8188d5b6e05228b21b9953671bf9ec4289586edb46a580ae79",
    "quarters.py": "1e614fe667849d437f7280182b9fc5ee1f148eca84cd25b5a6bb5175ef9759a6",
    "facts.py": "eb5579adf3fcf272e2acb51ffd4aaab69f0cd755bd7f4f2c80f4b22abf9afabd",
    "filings.py": "d43d133ab7168e9887c65ded1183ec79aa5e5ff0fa1c1e7c2bc8738961323d13",
    "restatement_signals.py": "aff124141308f709a0dd975d5e3604f44a22c1b09852e79fbc877242e788bb0e",
    "catalog.py": "ec5d11c180769095e9341c5bb396b95a3f0d4c237e94f93d7cac0ce5e26cc207",
    "store.py": "01d80e702bf6c815805dd08cc8643825b5feb58a5929ae146955747bf7495eae",
    "ingest.py": "2e49618a6adaf71e6a05cef7025aeb7d4d2986ca6b7542ac7e571ef6dacb4204",
    "incremental.py": "8bb64b3ba39f0c079d30840feb857a2b5933e35e416603e3ec108efd882d4b76",
}

# Every form that contributed XBRL facts (and so restatement evidence) to the frozen census. Discovery must watch the
# same scope, or an incremental version would see less evidence than a full rebuild of the same horizon.
EVIDENCE_FORMS = frozenset({
    "10-Q", "10-K", "20-F", "10-Q/A", "10-K/A", "6-K", "DEF 14A", "40-F", "8-K", "20-F/A", "PRE 14A", "10-KT",
    "6-K/A", "S-1/A", "S-1", "40-F/A", "8-K/A", "S-4/A", "POS AM", "F-1", "10-QT", "F-1/A", "S-4", "PRER14A",
    "DEFR14A", "10-KT/A", "DEFC14A", "PREC14A", "F-4/A", "DEF 14C", "DEFM14A", "PREM14A", "DEFA14A", "F-4",
    "PRE 14C", "SP 15D2", "S-11", "10-QT/A", "F-3",
})
# Forms the 10-minute feed watches (low latency for statements); the daily index backstops all EVIDENCE_FORMS.
FEED_FORMS = ("10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "8-K")


def root() -> str:
    return os.environ.get("FUNDAMENTALS_PIT_V5_ROOT", "/data/fundamentals_pit_v5_prod")


def paths(r: str | None = None) -> dict:
    r = r or root()
    return {"root": r, "base_dir": f"{r}/base", "base_db": f"{r}/base/v5_frozen.db", "base_artifacts": f"{r}/base/artifacts",
            "live_dir": f"{r}/live", "live_db": f"{r}/live/live.db", "snapshots": f"{r}/snapshots",
            "batches": f"{r}/batches", "versions": f"{r}/versions", "lock": f"{r}/pipeline.lock", "hold": f"{r}/HOLD",
            "status": f"{r}/status.json", "work": f"{r}/work"}


def sha256_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def methodology_drift(pkg_dir: str | None = None) -> dict[str, str]:
    """{file: problem} for every methodology file that is not byte-identical (LF-normalised) to the frozen base's."""
    pkg_dir = pkg_dir or os.path.dirname(os.path.abspath(__file__))
    out = {}
    for name, want in METHODOLOGY_FILES.items():
        p = os.path.join(pkg_dir, name)
        if not os.path.exists(p):
            out[name] = "missing"
            continue
        got = hashlib.sha256(open(p, "rb").read().replace(b"\r\n", b"\n")).hexdigest()
        if got != want:
            out[name] = got
    return out
