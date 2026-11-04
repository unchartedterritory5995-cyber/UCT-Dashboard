"""Track C safeguard (a): per-row rights clearance for withheld knowledge rows (knowledge/rights.py,
tools/kn_rights_review.py). Fixture pack only; no network; Brain stays OFF in production."""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent.knowledge import index, policy, rights
from tests.test_uct_agent_knowledge import KB, _make_pack, kn as _kn_base, read  # noqa: F401

FIXED = 1_793_000_000.0                       # a pinned clock for apply (2026-10-26 UTC)
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
    res = rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
    assert res == {"added": 1, "replaced": 0, "policy_version": policy.version()}
    assert 14 in _ids(read("knowledge.search", {"question": "cup and handle handle weeks", "k": 3}))
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    assert pol["excluded_setup_mentions"]["mode"] == "withhold"       # nothing else changed
    assert rights.status()["cleared_current"] == 1


def test_changed_text_loses_the_clearance_and_a_stale_worksheet_is_refused(kn):
    import sqlite3
    import time
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
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
    rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
    res = rights.apply(rights.entries([_filled(rights.worksheet(14), ref="RR-14b")]), kn["policy"], applied_by="Reviewer One", now=FIXED)
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


def test_cli_emit_is_a_dry_run_unless_applied(kn, tmp_path, capsys, monkeypatch):
    from tools import kn_rights_review as cli
    out = tmp_path / "kb14.json"
    cli.main(["worksheet", "--kb-id", "14", "--out", str(out)])
    out.write_text(json.dumps(_filled(json.loads(out.read_text(encoding="utf-8")))), encoding="utf-8")
    before = kn["policy"].read_text(encoding="utf-8")
    monkeypatch.setattr(rights, "_clock", lambda: FIXED)
    assert cli.main(["emit", str(out), "--policy", str(kn["policy"])]) == 0
    assert kn["policy"].read_text(encoding="utf-8") == before
    assert cli.main(["emit", str(out), "--policy", str(kn["policy"]), "--apply"]) == 1          # --by is required
    assert kn["policy"].read_text(encoding="utf-8") == before
    assert cli.main(["emit", str(out), "--policy", str(kn["policy"]), "--apply", "--by", "Reviewer One"]) == 0
    assert json.loads(kn["policy"].read_text(encoding="utf-8"))["cleared_rows"][0]["kb_id"] == 14
    log = rights.read_audit(rights.audit_path_for(kn["policy"]))
    assert [(r["kb_id"], r["applied_by"], r["applied_at"]) for r in log] == [(14, "Reviewer One", "2026-10-26T07:33:20Z")]


def test_the_shipped_policy_clears_nothing_and_keeps_withholding():
    pol = json.loads(policy.DEFAULT_PATH.read_text(encoding="utf-8"))
    assert pol["cleared_rows"] == [] and pol["excluded_setup_mentions"]["mode"] == "withhold"


# ── review #793: cumulative guards and the append-only audit log (pinned clock) ─────────────────────────────────────
def _synthetic(n, start=1001):
    return [{"kb_id": start + i, "content_sha": "a" * 64, "provenance_ref": f"P-{i}", "rights_review_ref": f"R-{start + i}",
             "approved_by": "Owner Name", "approved_on": "2026-10-01"} for i in range(n)]


def test_apply_requires_the_person_applying(kn):
    with pytest.raises(ValueError, match="applied_by"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="", now=FIXED)


def test_every_applied_clearance_is_in_the_hash_chained_audit_log(kn):
    rights.apply(_synthetic(2), kn["policy"], applied_by="Reviewer One", now=FIXED)
    rights.apply(_synthetic(1, start=2001), kn["policy"], applied_by="Reviewer Two", now=FIXED + 60)
    log = rights.read_audit(rights.audit_path_for(kn["policy"]))
    assert [(r["kb_id"], r["applied_by"], r["action"]) for r in log] == [
        (1001, "Reviewer One", "added"), (1002, "Reviewer One", "added"), (2001, "Reviewer Two", "added")]
    assert log[0]["prev"] == "0" * 64 and log[1]["prev"] == log[0]["sha"]


@pytest.mark.parametrize("tamper", ["edit", "delete", "garbage"])
def test_an_edited_audit_log_blocks_every_later_apply(kn, tamper):
    rights.apply(_synthetic(2), kn["policy"], applied_by="Reviewer One", now=FIXED)
    ap = rights.audit_path_for(kn["policy"])
    lines = ap.read_text(encoding="utf-8").splitlines()
    if tamper == "edit":
        lines[0] = lines[0].replace("Reviewer One", "Someone Else")
    elif tamper == "delete":
        lines = lines[1:]
    else:
        lines.append("{not json")
    ap.write_text("\n".join(lines) + "\n", encoding="utf-8")
    before = kn["policy"].read_text(encoding="utf-8")
    with pytest.raises(ValueError, match="audit log"):
        rights.apply(_synthetic(1, start=3001), kn["policy"], applied_by="Reviewer One", now=FIXED)
    assert kn["policy"].read_text(encoding="utf-8") == before


def test_daily_cap_holds_across_runs_and_resets_the_next_utc_day(kn):
    for i in range(2):
        rights.apply(_synthetic(10, start=1001 + 10 * i), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="daily cap"):
        rights.apply(_synthetic(1, start=5001), kn["policy"], applied_by="Reviewer One", now=FIXED + 3600)
    res = rights.apply(_synthetic(1, start=5001), kn["policy"], applied_by="Reviewer One", now=FIXED + 86400)
    assert res["added"] == 1


def test_policy_cap_needs_an_owner_signed_bulk_approval(kn):
    for day in range(2):
        rights.apply(_synthetic(12, start=1001 + 12 * day), kn["policy"], applied_by="Reviewer One", now=FIXED + day * 86400)
    rights.apply(_synthetic(1, start=1100), kn["policy"], applied_by="Reviewer One", now=FIXED + 2 * 86400)   # 25 rows
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["bulk_clearance_approval"] = {"approved_by": "Owner Name", "approved_on": "2026-10-01", "max_rows": 30}  # no reason
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    pol["bulk_clearance_approval"]["reason"] = "reviewed batch of team posts"
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")
    assert rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)["added"] == 1


def test_replacing_a_row_does_not_grow_the_policy_count_but_counts_toward_the_day(kn):
    rights.apply(_synthetic(20), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="daily cap"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
