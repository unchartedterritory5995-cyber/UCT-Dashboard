# tests/theme_curation/test_cli.py
from tools.theme_curation import cli


def test_apply_refuses_dirty_tree(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: False)
    rc = cli.main(["apply", "--taxonomy", str(tmp_path / "t.json")])   # no --force
    assert rc != 0
    assert "clean" in capsys.readouterr().out.lower()


def test_apply_requires_confirm(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: True)
    p = tmp_path / "t.json"
    p.write_text('{"version":"1.0.0","sectors":[],"themes":[]}', encoding="utf-8")
    monkeypatch.setattr(cli, "load_approved", lambda *a, **k: [])
    rc = cli.main(["apply", "--taxonomy", str(p)])    # no --confirm
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
