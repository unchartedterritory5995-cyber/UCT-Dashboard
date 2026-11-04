"""Track C safeguard (a): per-row rights clearance for withheld knowledge rows (knowledge/rights.py,
tools/kn_rights_review.py). Fixture pack only; no network; Brain stays OFF in production."""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent.knowledge import index, policy, rights
from tests.test_uct_agent_knowledge import KB, _make_pack, kn as _kn_base, read  # noqa: F401

CUP = (14, "SETUP", "TSDR note: cup and handle", "The cup and handle forms over weeks; the team watches the handle.",
       "trader_archive", "TSDR", 5)


@pytest.fixture
def kn(_kn_base, monkeypatch, tmp_path):
    """The knowledge fixture with one admitted row that names an excluded setup (Cup with Handle), under a writable
    copy of the SHIPPED policy (excluded_setup_mentions.mode = withhold)."""
    import time
    _make_pack(_kn_base["brain"], _kn_base["data"], int(time.time()) - 3600, kb=KB + [CUP])
    pol = json.loads(policy.DEFAULT_PATH.read_text(encoding="utf-8"))
    f = tmp_path / "policy_rights.json"
    f.write_text(json.dumps(pol), encoding="utf-8")
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE_POLICY", str(f))
    index.build()
    return {**_kn_base, "policy": f}


def _ids(out):
    return {p["kb_id"] for p in (out.get("data") or {}).get("passages") or []}


def _filled(ws, ref="RR-14", **over):
    d = {"clear": True, "provenance_ref": "PROV-14", "rights_review_ref": ref, "approved_by": "Owner Name",
         "approved_on": "2026-11-01", "notes": ""}
    d.update(over)
    return {**ws, "decision": d}


def test_the_row_is_withheld_before_review(kn):
    assert 14 not in _ids(read("knowledge.search", {"question": "cup and handle handle weeks", "k": 3}))
    st = rights.status()
    assert st["ok"] and st["withheld_now"] >= 1 and st["cleared_current"] == 0 and st["mode"] == "withhold"


def test_worksheet_is_one_row_with_its_sha_reasons_and_a_blank_decision(kn):
    ws = rights.worksheet(14)
    assert ws["kb_id"] == 14 and len(ws["content_sha"]) == 64 and ws["source_admitted"] is True
    assert any("Cup with Handle" in r for r in ws["withheld_because"])
    assert ws["decision"]["clear"] is False and not ws["decision"]["rights_review_ref"]
    assert rights.validate(ws)                                       # an unfilled worksheet never validates
    with pytest.raises(ValueError):
        rights.worksheet(999)


def test_a_completed_review_clears_exactly_that_row_and_its_text(kn):
    ws = _filled(rights.worksheet(14))
    assert rights.validate(ws) == []
    res = rights.apply(rights.entries([ws]), kn["policy"])
    assert res == {"added": 1, "replaced": 0, "policy_version": policy.version()}
    assert 14 in _ids(read("knowledge.search", {"question": "cup and handle handle weeks", "k": 3}))
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    assert pol["excluded_setup_mentions"]["mode"] == "withhold"       # nothing else changed
    assert rights.status()["cleared_current"] == 1


def test_changed_text_loses_the_clearance_and_a_stale_worksheet_is_refused(kn):
    import sqlite3
    import time
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"])
    _make_pack(kn["brain"], kn["data"], int(time.time()) - 60,
               kb=KB + [(14, CUP[1], CUP[2], CUP[3] + " Edited later.", CUP[4], CUP[5], CUP[6])])
    index.build()
    assert 14 not in _ids(read("knowledge.search", {"question": "cup and handle handle weeks", "k": 3}))
    assert rights.status()["cleared_text_changed"] == 1
    assert any("text changed" in p for p in rights.validate(ws))
    del sqlite3


@pytest.mark.parametrize("over,needle", [
    ({"clear": False}, "did not clear"), ({"clear": "yes"}, "did not clear"),
    ({"provenance_ref": ""}, "provenance_ref is empty"), ({"rights_review_ref": " "}, "rights_review_ref is empty"),
    ({"approved_by": "1"}, "approved_by"), ({"approved_on": "2999-01-01"}, "approved_on"),
    ({"approved_on": "04/11/2026"}, "approved_on"), ({"provenance_ref": "x" * 200}, "longer than"),
])
def test_an_incomplete_decision_never_validates(kn, over, needle):
    assert any(needle in p for p in rights.validate(_filled(rights.worksheet(14), **over)))


def test_a_row_from_a_source_that_is_not_admitted_cannot_be_cleared(kn):
    ws = _filled(rights.worksheet(5))                               # intake:youtube_* — not admitted
    assert any("not admitted" in p for p in rights.validate(ws))


def test_no_bulk_readmission(kn):
    ws = _filled(rights.worksheet(14))
    with pytest.raises(ValueError, match="no bulk re-admission"):
        rights.entries([ws] * (rights.MAX_PER_RUN + 1))
    with pytest.raises(ValueError, match="same kb_id"):
        rights.entries([ws, ws])
    other = _filled(rights.worksheet(10), ref="RR-14")              # a second row reusing the first row's review
    with pytest.raises(ValueError, match="own review record"):
        rights.entries([ws, other])
    with pytest.raises(ValueError):
        rights.entries([])


def test_entries_are_all_or_nothing(kn):
    good, bad = _filled(rights.worksheet(14)), _filled(rights.worksheet(10), ref="RR-10", approved_by="")
    with pytest.raises(ValueError, match="kb_id 10"):
        rights.entries([good, bad])


def test_a_forged_or_foreign_worksheet_is_refused(kn):
    ws = _filled(rights.worksheet(14))
    assert rights.validate({**ws, "format": "x"}) == ["not a rights worksheet (format)"]
    assert any("sha256" in p for p in rights.validate({**ws, "content_sha": "abc"}))
    assert rights.validate({**ws, "kb_id": True}) == ["kb_id must be a positive integer"]


def test_apply_replaces_an_older_entry_for_the_same_row(kn):
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"])
    res = rights.apply(rights.entries([_filled(rights.worksheet(14), ref="RR-14b")]), kn["policy"])
    assert res["added"] == 0 and res["replaced"] == 1
    rows = json.loads(kn["policy"].read_text(encoding="utf-8"))["cleared_rows"]
    assert [r["rights_review_ref"] for r in rows] == ["RR-14b"]


def test_cli_worksheet_refuses_a_path_inside_the_repository_and_status_prints_counts_only(kn, tmp_path, capsys):
    from tools import kn_rights_review as cli
    assert cli.main(["worksheet", "--kb-id", "14", "--out", str(cli.REPO / "kb14.json")]) == 2
    assert not (cli.REPO / "kb14.json").exists()
    out = tmp_path / "kb14.json"
    assert cli.main(["worksheet", "--kb-id", "14", "--out", str(out)]) == 0
    assert cli.main(["worksheet", "--kb-id", "14", "--out", str(out)]) == 2          # never overwrites
    capsys.readouterr()
    assert cli.main(["status"]) == 0
    printed = capsys.readouterr().out
    assert CUP[3] not in printed and "withheld_now" in printed


def test_cli_emit_is_a_dry_run_unless_applied(kn, tmp_path, capsys):
    from tools import kn_rights_review as cli
    out = tmp_path / "kb14.json"
    cli.main(["worksheet", "--kb-id", "14", "--out", str(out)])
    out.write_text(json.dumps(_filled(json.loads(out.read_text(encoding="utf-8")))), encoding="utf-8")
    before = kn["policy"].read_text(encoding="utf-8")
    assert cli.main(["emit", str(out), "--policy", str(kn["policy"])]) == 0
    assert kn["policy"].read_text(encoding="utf-8") == before
    assert cli.main(["emit", str(out), "--policy", str(kn["policy"]), "--apply"]) == 0
    assert json.loads(kn["policy"].read_text(encoding="utf-8"))["cleared_rows"][0]["kb_id"] == 14


def test_the_shipped_policy_clears_nothing_and_keeps_withholding():
    pol = json.loads(policy.DEFAULT_PATH.read_text(encoding="utf-8"))
    assert pol["cleared_rows"] == [] and pol["excluded_setup_mentions"]["mode"] == "withhold"
