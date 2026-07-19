# tests/theme_curation/test_cli.py
import os
import subprocess
import sys

from tools.theme_curation import cli

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def test_apply_refuses_dirty_tree(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: False)
    rc = cli.main(["apply", "--taxonomy", str(tmp_path / "t.json")])   # no --force
    assert rc != 0
    assert "clean" in capsys.readouterr().out.lower()


def test_apply_requires_confirm(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: True)
    p = tmp_path / "t.json"
    p.write_text('{"version":"1.0.0","sectors":[{"id":"s","name":"S"}],'
                 '"themes":[{"id":"t","name":"T","sector_id":"s","sub_themes":[],'
                 '"holdings":[{"sym":"OLD","tier":"core"}]}]}', encoding="utf-8")
    cap = tmp_path / "cap.json"; cap.write_text('["OLD"]', encoding="utf-8")
    from tools.theme_curation.proposals import Proposal
    # A real (changing) approval so we exercise the --confirm gate, not the no-op guard.
    monkeypatch.setattr(cli, "load_approved",
                        lambda *a, **k: [Proposal("t", "drop", "OLD", 1.0, {})])
    rc = cli.main(["apply", "--taxonomy", str(p), "--cap", str(cap)])    # no --confirm
    assert rc != 0
    assert "confirm" in capsys.readouterr().out.lower()


def test_unknown_subcommand_returns_nonzero(capsys):
    assert cli.main(["bogus"]) != 0


def test_audit_command_writes_file(tmp_path):
    tax = tmp_path / "t.json"
    tax.write_text('{"version":"1.0.0","sectors":[],"themes":['
                   '{"id":"space","name":"Space","sector_id":"s","holdings":[{"sym":"DEADCO"}]}]}',
                   encoding="utf-8")
    cap = tmp_path / "cap.json"; cap.write_text('["RKLB"]', encoding="utf-8")
    outp = tmp_path / "audit.md"
    rc = cli.main(["audit", "--taxonomy", str(tax), "--cap", str(cap), "--out", str(outp)])
    assert rc == 0
    assert "DEADCO" in outp.read_text(encoding="utf-8")   # dead flagged in the written report


def test_select_themes_filters_by_sector_and_theme():
    themes = [
        {"id": "solar", "sector_id": "clean_energy"},
        {"id": "nuclear", "sector_id": "clean_energy"},
        {"id": "software", "sector_id": "technology"},
    ]
    assert {t["id"] for t in cli._select_themes(themes, sector="clean_energy")} == {"solar", "nuclear"}
    assert [t["id"] for t in cli._select_themes(themes, theme="software")] == ["software"]
    assert cli._select_themes(themes, sector="does_not_exist") == []
    assert len(cli._select_themes(themes)) == 3    # no filter = all


def test_module_is_runnable_via_dash_m(tmp_path):
    # Locks the `if __name__ == "__main__"` entry — tests call main() directly, so a
    # missing guard makes `python -m ...cli` a silent no-op (exit 0, nothing done).
    tax = tmp_path / "t.json"
    tax.write_text('{"version":"1.0.0","sectors":[],"themes":['
                   '{"id":"space","name":"Space","sector_id":"s","holdings":[{"sym":"DEADCO"}]}]}',
                   encoding="utf-8")
    cap = tmp_path / "cap.json"; cap.write_text('["RKLB"]', encoding="utf-8")
    outp = tmp_path / "audit.md"
    r = subprocess.run([sys.executable, "-m", "tools.theme_curation.cli", "audit",
                        "--taxonomy", str(tax), "--cap", str(cap), "--out", str(outp)],
                       cwd=_REPO_ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert outp.exists() and "DEADCO" in outp.read_text(encoding="utf-8")


def test_load_approved_reads_doc_and_ledger(tmp_path):
    import json
    from tools.theme_curation.ledger import Ledger
    pdir = tmp_path / "proposals"; pdir.mkdir()
    (pdir / "t.json").write_text(json.dumps({"proposals": [
        {"theme_id": "t", "action": "add", "sym": "SNDK", "confidence": 0.9, "fields": {"tier": "core"}},
        {"theme_id": "t", "action": "drop", "sym": "AUY", "confidence": 0.4, "fields": {}}]}), encoding="utf-8")
    rdir = tmp_path / "review"; rdir.mkdir()
    from tools.theme_curation.review_doc import write_review_md
    from tools.theme_curation.proposals import Proposal
    md = write_review_md([Proposal("t", "add", "SNDK", 0.9, {"tier": "core"})])
    md = md.replace("id=t::SNDK::add -->\n- [ ] APPROVE", "id=t::SNDK::add -->\n- [x] APPROVE")
    (rdir / "review.md").write_text(md, encoding="utf-8")
    lg = Ledger(str(tmp_path / "l.db")); lg.record("t", "AUY", "drop", "approve", {})
    approved = cli.load_approved(str(tmp_path / "l.db"), str(rdir), str(pdir))
    kinds = {(p.action, p.sym) for p in approved}
    assert ("add", "SNDK") in kinds     # from the review doc
    assert ("drop", "AUY") in kinds     # from the ledger
