"""Drift detector for the ENML cross-LANE parity rail (Plan E Task 4).

`enmlParity.contract.test.js` (the JS half) is the rail that catches a client/server divergence:
it runs the client `.enex` path over the same ENML and compares semantic summaries. THIS file only
guards the Python side: the committed fixtures must equal what the generator writes now, every
stem must have its sidecar, and every resource's declared hash must be the md5 of its bytes (the
client matches resources by COMPUTED md5, the server by the declared hash, so a wrong hash in a
sidecar would make the two lanes disagree for a reason that is not a converter's).
"""

from __future__ import annotations

import base64
import hashlib
import json

from api.services.journal_two.note_connectors.convert import enml_parity_fixtures_gen as gen

BRIEFED_STEMS = {"01-todo", "02-media-mixed", "03-missing-and-unreferenced", "04-note-links",
                 "05-crypt", "06-table-nested-lists", "07-codeblock", "08-link-around-image",
                 "09-web-clip-source-url"}


def _norm(text: str) -> str:
    # Line endings normalised (see test_obsidian_parity_fixtures.py: a CRLF checkout is not drift).
    return text.replace("\r\n", "\n")


def _committed() -> dict[str, str]:
    return {p.name: _norm(p.read_text(encoding="utf-8"))
            for p in sorted(gen.FIXTURES_OUT_DIR.glob("*.json"))}


def test_enml_parity_fixtures_are_current():
    assert gen.render_all() == _committed()  # byte-equal (after line endings), all stems


def test_every_stem_has_a_sidecar_and_a_committed_summary():
    stems = {p.stem for p in gen.FIXTURES_IN_DIR.glob("*.enml")}
    assert BRIEFED_STEMS <= stems
    for stem in stems:
        assert (gen.FIXTURES_IN_DIR / f"{stem}.note.json").is_file(), stem
        fixture = json.loads((gen.FIXTURES_OUT_DIR / f"{stem}.json").read_text(encoding="utf-8"))
        assert fixture["server"]["blocks"], stem  # non-vacuous
    assert {p.stem for p in gen.FIXTURES_OUT_DIR.glob("*.json")} == stems


def test_every_fixture_resource_hash_is_the_md5_of_its_bytes():
    seen = 0
    for sidecar in sorted(gen.FIXTURES_IN_DIR.glob("*.note.json")):
        note = json.loads(sidecar.read_text(encoding="utf-8"))
        for r in note["resources"]:
            data = base64.b64decode(r["data_b64"])
            assert hashlib.md5(data).hexdigest() == r["hash"], (sidecar.name, r["name"])
            seen += 1
    assert seen > 0


def test_generation_is_deterministic():
    assert gen.render_all() == gen.render_all()
