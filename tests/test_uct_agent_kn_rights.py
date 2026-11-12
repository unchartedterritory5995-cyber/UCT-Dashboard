"""Track C safeguard (a): per-row rights clearance for withheld knowledge rows (knowledge/rights.py,
tools/kn_rights_review.py). Fixture pack only; no network; Brain stays OFF in production."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent.knowledge import index, policy, rights
from tests.test_uct_agent_knowledge import KB, _make_pack, kn as _kn_base, read  # noqa: F401

KEY = "test-server-held-rights-key-0123456789abcdef"
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
    monkeypatch.setenv(rights.KEY_ENV, KEY)                        # the server-held secret (test value)
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


def _fill_to_cap(kn):
    for day in range(2):
        rights.apply(_synthetic(12, start=1001 + 12 * day), kn["policy"], applied_by="Reviewer One", now=FIXED + day * 86400)
    rights.apply(_synthetic(1, start=1100), kn["policy"], applied_by="Reviewer One", now=FIXED + 2 * 86400)   # 25 rows


def _set_bulk(kn, b):
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["bulk_clearance_approval"] = b
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")


def test_policy_cap_needs_a_bulk_approval_signed_with_the_server_key(kn, monkeypatch):
    _fill_to_cap(kn)
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    # any name in policy.json is NOT an approval (review #793: genuine server-side authorization)
    _set_bulk(kn, {"approved_by": "x x", "approved_on": "2026-10-01", "max_rows": 30, "reason": "trust me"})
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    good = rights.sign_bulk("Owner Name", "2026-10-01", 30, "reviewed batch of team posts", "2026-11-30", kn["policy"])
    _set_bulk(kn, {**good, "max_rows": 31})                                   # a signed approval, edited
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    fields = {k: v for k, v in good.items() if k != "signature"}             # the same approval, signed with ANOTHER key
    other = {**fields, "signature": rights._mac(b"another-key-0123456789abcdef0123456789", "bulk|" + rights._bulk_fields(fields))}
    _set_bulk(kn, other)
    with pytest.raises(ValueError, match="policy cap"):
        rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)
    _set_bulk(kn, good)
    assert rights.apply(_synthetic(1, start=1200), kn["policy"], applied_by="Reviewer One", now=FIXED + 3 * 86400)["added"] == 1


@pytest.mark.parametrize("n", [25, 201, 10 ** 9, True, "30", 0, -5])
def test_bulk_approvals_have_a_hard_upper_bound(kn, n):
    with pytest.raises(ValueError, match="max_rows"):
        rights.sign_bulk("Owner Name", "2026-10-01", n, "r", "2026-11-30", kn["policy"])
    import hashlib
    import hmac
    b = {"approved_by": "Owner Name", "approved_on": "2026-10-01", "max_rows": n, "reason": "r"}
    sig = hmac.new(KEY.encode(), ("bulk|" + rights._bulk_fields(b)).encode(), hashlib.sha256).hexdigest()
    assert rights.bulk_cap({"bulk_clearance_approval": {**b, "signature": sig}}) == rights.POLICY_CAP


def test_without_the_server_key_nothing_is_cleared_or_served(kn, monkeypatch):
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
    q = {"question": "cup and handle handle weeks", "k": 3}
    assert 14 in _ids(read("knowledge.search", q))
    monkeypatch.delenv(rights.KEY_ENV)
    assert rights.authorized() == {} and 14 not in _ids(read("knowledge.search", q))
    with pytest.raises(ValueError, match="no rights key"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="no rights key"):
        rights.sign_bulk("Owner Name", "2026-10-01", 30, "r", "2026-11-30", kn["policy"])
    monkeypatch.setenv(rights.KEY_ENV, "short")                                # a key under 32 characters is no key
    assert rights.authorized() == {}


def test_a_hand_edited_clearance_is_never_served_and_blocks_apply(kn):
    import sqlite3
    del sqlite3
    sha = rights.worksheet(14)["content_sha"]
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["cleared_rows"] = [{"kb_id": 14, "content_sha": sha, "provenance_ref": "P", "rights_review_ref": "R",
                            "approved_by": "Owner Name", "approved_on": "2026-10-01"}]
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")
    assert rights.authorized() == {}
    assert 14 not in _ids(read("knowledge.search", {"question": "cup and handle handle weeks", "k": 3}))
    with pytest.raises(ValueError, match="disagree"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)


@pytest.mark.parametrize("how", ["trim_end", "delete", "rotate"])
def test_trimming_deleting_or_rotating_the_log_never_resets_the_daily_cap(kn, how):
    rights.apply(_synthetic(20), kn["policy"], applied_by="Reviewer One", now=FIXED)
    ap = rights.audit_path_for(kn["policy"])
    lines = ap.read_text(encoding="utf-8").splitlines()
    if how == "trim_end":
        ap.write_text("\n".join(lines[:5]) + "\n", encoding="utf-8")
    elif how == "delete":
        ap.unlink()
    else:
        ap.rename(ap.with_suffix(".jsonl.1"))
    with pytest.raises(ValueError, match="audit log"):
        rights.apply(_synthetic(1, start=9001), kn["policy"], applied_by="Reviewer One", now=FIXED + 60)
    assert rights.authorized() == {}                                           # and nothing it backed is served


def test_concurrent_applies_never_exceed_the_daily_cap_and_keep_the_chain(kn):
    import threading
    results = []

    def go(i):
        try:
            rights.apply(_synthetic(4, start=1001 + 10 * i), kn["policy"], applied_by="Reviewer One", now=FIXED)
            results.append("ok")
        except ValueError as e:
            results.append(str(e))
    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    log = rights.read_audit(rights.audit_path_for(kn["policy"]))
    assert results.count("ok") == 5 and len(log) == 20                          # 5 x 4 = the daily cap, no more
    assert all("daily cap" in r for r in results if r != "ok")
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    assert len(pol["cleared_rows"]) == 20 and pol["audit_head"] == log[-1]["sha"]


def test_limit_exhaustion_policy_cap_holds_on_later_days(kn):
    _fill_to_cap(kn)
    for d in range(3, 6):
        with pytest.raises(ValueError, match="policy cap"):
            rights.apply(_synthetic(1, start=1300 + d), kn["policy"], applied_by="Reviewer One", now=FIXED + d * 86400)
    assert len(rights.authorized()) == rights.POLICY_CAP                     # every signed row is served, none more


def test_replacing_a_row_does_not_grow_the_policy_count_but_counts_toward_the_day(kn):
    rights.apply(_synthetic(20), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="daily cap"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)


# ── QA #793: signed revocations, expiring / bound bulk approvals, key strength, stale lock ─────────────────────────
TODAY_FIXED = __import__("datetime").date(2026, 11, 4)


def test_a_revocation_is_signed_and_a_hand_readd_is_never_served(kn):
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
    entry = json.loads(kn["policy"].read_text(encoding="utf-8"))["cleared_rows"][0]
    q = {"question": "cup and handle handle weeks", "k": 3}
    assert 14 in _ids(read("knowledge.search", q))
    assert rights.revoke([14], kn["policy"], revoked_by="Owner Name", reason="rights withdrawn", now=FIXED + 60)["revoked"] == 1
    log = rights.read_audit(rights.audit_path_for(kn["policy"]))
    assert log[-1]["action"] == "revoked" and log[-1]["applied_by"] == "Owner Name"
    assert 14 not in _ids(read("knowledge.search", q)) and rights.authorized() == {}
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["cleared_rows"] = [entry]                                              # someone re-adds the old entry by hand
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")
    assert rights.authorized() == {} and 14 not in _ids(read("knowledge.search", q))
    with pytest.raises(ValueError, match="disagree"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED + 120)


def test_a_hand_removal_without_revoke_serves_nothing_until_fixed(kn):
    rights.apply(_synthetic(3), kn["policy"], applied_by="Reviewer One", now=FIXED)
    assert len(rights.authorized()) == 3
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["cleared_rows"] = pol["cleared_rows"][:2]
    kn["policy"].write_text(json.dumps(pol), encoding="utf-8")
    assert rights.authorized() == {}                                           # the log and the policy disagree: nothing


def test_revoke_needs_the_key_a_name_a_reason_and_a_cleared_row(kn, monkeypatch):
    rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="reason"):
        rights.revoke([1001], kn["policy"], revoked_by="Owner Name", reason=" ", now=FIXED)
    with pytest.raises(ValueError, match="not cleared"):
        rights.revoke([4242], kn["policy"], revoked_by="Owner Name", reason="x", now=FIXED)
    monkeypatch.delenv(rights.KEY_ENV)
    with pytest.raises(ValueError, match="no rights key"):
        rights.revoke([1001], kn["policy"], revoked_by="Owner Name", reason="x", now=FIXED)


def test_a_revocation_does_not_count_toward_the_daily_cap(kn):
    rights.apply(_synthetic(20), kn["policy"], applied_by="Reviewer One", now=FIXED)
    rights.revoke([1001, 1002], kn["policy"], revoked_by="Owner Name", reason="x", now=FIXED + 10)
    with pytest.raises(ValueError, match="daily cap"):
        rights.apply(_synthetic(1, start=7001), kn["policy"], applied_by="Reviewer One", now=FIXED + 20)


def test_a_bulk_approval_expires_and_is_bound_to_its_policy_file(kn, tmp_path):
    b = rights.sign_bulk("Owner Name", "2026-10-01", 30, "batch", "2026-11-30", kn["policy"])
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    pol["bulk_clearance_approval"] = b
    aid = b["anchor_id"]
    assert rights.bulk_cap(pol, today=TODAY_FIXED, anchor_id=aid) == 30
    assert rights.bulk_cap(pol, today=__import__("datetime").date(2026, 12, 1), anchor_id=aid) == rights.POLICY_CAP  # expired
    other = {**pol, "rights_policy_id": "f" * 32}                              # copied into another policy file
    assert rights.bulk_cap(other, today=TODAY_FIXED, anchor_id=aid) == rights.POLICY_CAP
    # QA #793 round 2: copying rights_policy_id along with it does not help: the approval is bound to THIS server's anchor
    assert rights.bulk_cap(pol, today=TODAY_FIXED, anchor_id="e" * 32) == rights.POLICY_CAP
    assert rights.bulk_cap(pol, today=TODAY_FIXED) == rights.POLICY_CAP
    assert rights.bulk_cap({**pol, "bulk_clearance_approval": {**b, "expires_on": "2026-12-30"}},
                           today=TODAY_FIXED, anchor_id=aid) == rights.POLICY_CAP     # edited after signing
    with pytest.raises(ValueError, match="at most 90 days"):
        rights.sign_bulk("Owner Name", "2026-10-01", 30, "batch", "2027-03-01", kn["policy"])
    with pytest.raises(ValueError, match="expires_on"):
        rights.sign_bulk("Owner Name", "2026-10-01", 30, "batch", "2026-09-01", kn["policy"])


@pytest.mark.parametrize("weak", ["a" * 40, "ab" * 20, "0123456789" * 4, "short-but-varied-key"])
def test_a_weak_key_is_no_key(monkeypatch, weak):
    monkeypatch.setenv(rights.KEY_ENV, weak)
    assert rights._key() is None


def test_a_stale_lock_fails_closed_and_says_how_to_recover(kn, monkeypatch):
    monkeypatch.setattr(rights, "LOCK_WAIT_S", 0.2)
    lock = Path(str(kn["policy"]) + ".lock")
    lock.write_text('{"pid": 1, "at": 0}', encoding="utf-8")
    with pytest.raises(ValueError, match="delete that file"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    lock.unlink()
    assert rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)["added"] == 1


# ── QA #793 round 2: the server-side anchor defeats a rollback of the editable files ──────────────────────────────
def test_the_reviewers_rollback_never_restores_a_revoked_row(kn):
    ws = _filled(rights.worksheet(14))
    rights.apply(rights.entries([ws]), kn["policy"], applied_by="Reviewer One", now=FIXED)
    before = kn["policy"].read_text(encoding="utf-8")
    ap = rights.audit_path_for(kn["policy"])
    log_before = ap.read_text(encoding="utf-8")
    rights.revoke([14], kn["policy"], revoked_by="Owner Name", reason="rights withdrawn", now=FIXED + 60)
    q = {"question": "cup and handle handle weeks", "k": 3}
    assert 14 not in _ids(read("knowledge.search", q))
    # the rollback: truncate the log to the line before the revoke, audit_head = that line's sha, old cleared_rows back
    ap.write_text(log_before, encoding="utf-8")
    kn["policy"].write_text(before, encoding="utf-8")
    assert rights.authorized() == {}
    assert 14 not in _ids(read("knowledge.search", q))
    with pytest.raises(ValueError, match="anchored state"):
        rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED + 120)


def test_rollback_plus_a_resigned_bulk_approval_is_still_refused(kn):
    _fill_to_cap(kn)
    before, log_before = kn["policy"].read_text(encoding="utf-8"), rights.audit_path_for(kn["policy"]).read_text(encoding="utf-8")
    rights.revoke([1001], kn["policy"], revoked_by="Owner Name", reason="x", now=FIXED + 3 * 86400)
    kn["policy"].write_text(before, encoding="utf-8")
    rights.audit_path_for(kn["policy"]).write_text(log_before, encoding="utf-8")
    with pytest.raises(ValueError, match="anchored state"):                    # signing needs a verified state too
        rights.sign_bulk("Owner Name", "2026-10-01", 30, "after a rollback", "2026-11-30", kn["policy"])
    assert rights.authorized() == {}


def test_an_edited_or_missing_anchor_serves_nothing(kn):
    import sqlite3
    rights.apply(_synthetic(2), kn["policy"], applied_by="Reviewer One", now=FIXED)
    assert len(rights.authorized()) == 2
    c = sqlite3.connect(str(rights.anchor_path()))
    c.execute("UPDATE rights_anchor SET seq = seq + 5")
    c.commit()
    c.close()
    assert rights.authorized() == {}                                           # the MAC no longer verifies
    rights.anchor_path().unlink()
    assert rights.authorized() == {}                                           # a policy with clearances needs its anchor
    with pytest.raises(ValueError, match="no rights anchor"):
        rights.apply(_synthetic(1, start=3001), kn["policy"], applied_by="Reviewer One", now=FIXED)


def test_a_crash_before_the_anchor_write_fails_closed_and_the_owner_can_reanchor(kn, monkeypatch):
    rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    real = rights._write_anchor
    monkeypatch.setattr(rights, "_write_anchor", lambda *a, **k: (_ for _ in ()).throw(OSError("crash")))
    with pytest.raises(OSError):
        rights.apply(_synthetic(1, start=2001), kn["policy"], applied_by="Reviewer One", now=FIXED)
    monkeypatch.setattr(rights, "_write_anchor", real)
    assert rights.authorized() == {}                                           # the files are ahead of the anchor
    with pytest.raises(ValueError, match="reason"):
        rights.reanchor(kn["policy"], by="Owner Name", reason="")
    assert rights.reanchor(kn["policy"], by="Owner Name", reason="crash recovery")["seq"] == 2
    assert len(rights.authorized()) == 2


def test_the_anchor_lives_outside_the_editable_files(kn):
    rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    a = rights.anchor_path()
    assert a.exists() and a.parent != kn["policy"].parent                     # the server volume, not the policy's folder
    pol = json.loads(kn["policy"].read_text(encoding="utf-8"))
    assert "seq" not in json.dumps(pol) and "rights_anchor" not in json.dumps(pol)



# ── QA #793 round 4: recovery can never restore a revoked row ─────────────────────────────────────────────────────
def _break_line(kn, idx, mutate):
    ap = rights.audit_path_for(kn["policy"])
    lines = ap.read_text(encoding="utf-8").splitlines()
    lines[idx] = mutate(lines[idx])
    ap.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_rebuild_treats_rows_touched_after_the_break_as_revoked(kn):
    rights.apply(_synthetic(3), kn["policy"], applied_by="Reviewer One", now=FIXED)            # 1001 1002 1003
    rights.revoke([1002], kn["policy"], revoked_by="Owner Name", reason="withdrawn", now=FIXED + 10)   # line 4
    rights.apply(_synthetic(1, start=1004), kn["policy"], applied_by="Reviewer One", now=FIXED + 20)  # line 5
    # break line 4 (the revoke) so that, naively, 1002 would look active again from the prefix
    _break_line(kn, 3, lambda ln: ln.replace("withdrawn", "WITHDRAWN"))
    assert rights.authorized() == {}
    res = rights.rebuild(kn["policy"], by="Owner Name", reason="log edited", now=FIXED + 30)
    assert res["broken_at_line"] == 4
    active = rights.active_from_log(rights.read_audit(rights.audit_path_for(kn["policy"])))
    assert 1002 not in active                        # revoked after/at the break: NEVER restored
    assert 1004 not in active                        # added after the break: not trusted, revoked
    # QA round 5: the break sits INSIDE the anchored history (the prefix is short of the anchored seq), so every row is
    # revoked; untouched rows survive only a break AFTER the anchored state (test_rebuild_keeps_untouched_rows_...)
    assert active == {} and rights.authorized() == {}


def test_rebuild_with_an_unreadable_line_revokes_everything(kn):
    rights.apply(_synthetic(3), kn["policy"], applied_by="Reviewer One", now=FIXED)
    _break_line(kn, 2, lambda ln: "{not json")
    rights.rebuild(kn["policy"], by="Owner Name", reason="corrupt", now=FIXED + 5)
    assert rights.active_from_log(rights.read_audit(rights.audit_path_for(kn["policy"]))) == {}
    assert rights.authorized() == {}


def test_rebuild_refuses_a_log_that_verifies_and_needs_the_key(kn, monkeypatch):
    rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    with pytest.raises(ValueError, match="nothing to rebuild"):
        rights.rebuild(kn["policy"], by="Owner Name", reason="x")
    monkeypatch.delenv(rights.KEY_ENV)
    with pytest.raises(ValueError, match="no rights key"):
        rights.rebuild(kn["policy"], by="Owner Name", reason="x")


def test_reanchor_only_moves_forward_never_back_over_a_revocation(kn):
    rights.apply(_synthetic(1), kn["policy"], applied_by="Reviewer One", now=FIXED)
    before = kn["policy"].read_text(encoding="utf-8")
    log_before = rights.audit_path_for(kn["policy"]).read_text(encoding="utf-8")
    rights.revoke([1001], kn["policy"], revoked_by="Owner Name", reason="withdrawn", now=FIXED + 10)
    kn["policy"].write_text(before, encoding="utf-8")                                      # roll the files back
    rights.audit_path_for(kn["policy"]).write_text(log_before, encoding="utf-8")
    with pytest.raises(ValueError, match="only moves forward"):
        rights.reanchor(kn["policy"], by="Owner Name", reason="trying to undo the revoke")
    assert rights.authorized() == {}


# ── QA #793 round 5: a key-less editor cuts the log back before a revocation, breaks it, restores cleared_rows ─────
def _setup_revoked(kn):
    rights.apply(_synthetic(3), kn["policy"], applied_by="Reviewer One", now=FIXED)            # 1001 1002 1003
    pol_before = kn["policy"].read_text(encoding="utf-8")
    ap = rights.audit_path_for(kn["policy"])
    lines_before = ap.read_text(encoding="utf-8").splitlines()
    rights.revoke([1002], kn["policy"], revoked_by="Owner Name", reason="withdrawn", now=FIXED + 10)
    return pol_before, ap, lines_before


def _rebuild_never_restores(kn):
    rights.rebuild(kn["policy"], by="Owner Name", reason="log broken", now=FIXED + 100)
    active = rights.active_from_log(rights.read_audit(rights.audit_path_for(kn["policy"])))
    assert 1002 not in active and 1002 not in rights.authorized()
    assert active == {}                                                         # prefix short of the anchor: all revoked


def test_B_truncate_before_the_revoke_and_append_a_forged_line(kn):
    pol_before, ap, lines_before = _setup_revoked(kn)
    forged = json.dumps({"kb_id": 1002, "action": "added", "prev": "x", "sha": "y"})
    ap.write_text("\n".join(lines_before + [forged]) + "\n", encoding="utf-8")
    kn["policy"].write_text(pol_before, encoding="utf-8")
    _rebuild_never_restores(kn)


def test_C_delete_exactly_the_revoke_line(kn):
    pol_before, ap, lines_before = _setup_revoked(kn)
    lines = ap.read_text(encoding="utf-8").splitlines()
    rights.apply(_synthetic(1, start=1004), kn["policy"], applied_by="Reviewer One", now=FIXED + 20)
    lines = ap.read_text(encoding="utf-8").splitlines()
    del lines[3]                                                                # the revoke of 1002
    ap.write_text("\n".join(lines) + "\n", encoding="utf-8")
    kn["policy"].write_text(pol_before, encoding="utf-8")
    _rebuild_never_restores(kn)


def test_G_truncate_and_append_a_line_naming_another_row(kn):
    pol_before, ap, lines_before = _setup_revoked(kn)
    other = json.dumps({"kb_id": 1003, "action": "revoked", "prev": "x", "sha": "y"})
    ap.write_text("\n".join(lines_before + [other]) + "\n", encoding="utf-8")
    kn["policy"].write_text(pol_before, encoding="utf-8")
    _rebuild_never_restores(kn)


def test_rebuild_keeps_untouched_rows_when_the_prefix_reaches_the_anchor(kn):
    rights.apply(_synthetic(3), kn["policy"], applied_by="Reviewer One", now=FIXED)
    ap = rights.audit_path_for(kn["policy"])
    ap.write_text(ap.read_text(encoding="utf-8") + json.dumps({"kb_id": 1003, "action": "added", "prev": "x", "sha": "y"}) + "\n",
                  encoding="utf-8")                                             # a forged line AFTER the anchored state
    rights.rebuild(kn["policy"], by="Owner Name", reason="forged append", now=FIXED + 5)
    assert set(rights.active_from_log(rights.read_audit(ap))) == {1001, 1002}   # only the touched row (1003) revoked


# ── QA #793 round 6: no anchor + a clean rollback before a revoke ───────────────────────────────────────────────────
def test_round6_no_anchor_and_a_clean_rollback_cannot_be_reanchored_only_rebuilt_to_nothing(kn):
    pol_before, ap, lines_before = _setup_revoked(kn)             # 1001-1003 cleared, then 1002 revoked
    ap.write_text("\n".join(lines_before) + "\n", encoding="utf-8")  # clean rollback to before the revoke
    kn["policy"].write_text(pol_before, encoding="utf-8")
    rights.anchor_path().unlink()                                 # the anchor is gone (lost / fresh volume)
    assert rights.authorized() == {}
    with pytest.raises(ValueError, match="no rights anchor"):
        rights.reanchor(kn["policy"], by="Owner Name", reason="volume restored")
    assert rights.authorized() == {} and 1002 not in rights.authorized()
    res = rights.rebuild(kn["policy"], by="Owner Name", reason="anchor lost", now=FIXED + 50)
    assert res["kept"] == 0 and res["revoked"] == 3
    assert rights.active_from_log(rights.read_audit(ap)) == {} and rights.authorized() == {}
    # deliberate re-clearing works afterwards
    assert rights.apply(_synthetic(1, start=1001), kn["policy"], applied_by="Owner Name", now=FIXED + 60)["replaced"] == 0
    assert set(rights.authorized()) == {1001}


def test_round6_a_fresh_policy_with_nothing_cleared_can_still_be_reanchored(kn):
    rights.policy_id(kn["policy"], create=True)
    assert rights.reanchor(kn["policy"], by="Owner Name", reason="fresh")["seq"] == 0
