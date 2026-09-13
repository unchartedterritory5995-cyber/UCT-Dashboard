"""core migrations. core_001 is the W1 base contract, read from the repo so the
DDL has exactly one authority: docs/wisdom/contracts/wisdom-db-v0.sql.

Once core_001 has been applied on production that file is FROZEN; every later
change is a new additive core_NNN migration appended here (Wave 1: no drops)."""
from __future__ import annotations

import pathlib

BASE_SCHEMA_FILE = (
    pathlib.Path(__file__).resolve().parents[4] / "docs" / "wisdom" / "contracts" / "wisdom-db-v0.sql"
)

MIGRATIONS: list[tuple[str, str]] = [
    ("core_001_base_v0", BASE_SCHEMA_FILE.read_text(encoding="utf-8")),
]
