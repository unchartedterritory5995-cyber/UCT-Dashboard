"""Pine support loop, Phase B: the local tool rails (``tools/support_loop``).

* member source is written ONLY under the work directory's ``reports/<id>/`` and is
  purged when the report is closed;
* the bearer secret never reaches stdout, stderr, an exception or a repr;
* a fix packet is generated from a fixture gap and a fixture report;
* the re-measure diff names gains and regressions.

The door is replaced by a fake runner that writes census-shaped rows, so these run
without node; the real door is exercised by ``doorNameCoverage.test.js`` and by the
census itself.
"""
from __future__ import annotations

import io
import json
import subprocess
import urllib.error
from pathlib import Path

import pytest

from tools.support_loop import client as client_mod
from tools.support_loop import remeasure, triage, workdir

RID = "0123456789abcdef0123456789abcdef"
SOURCE = '//@version=5\nindicator("mine")\nsecretLevelZ9 = ta.alma(close, 9, 0.85, 6)\nplot(secretLevelZ9)\n'
NOTE = "private note QX7"
SECRET = "unit-secret-77aa"


@pytest.fixture(autouse=True)
def work(tmp_path, monkeypatch):
    root = tmp_path / "outside-repo" / "work"
    monkeypatch.setenv(workdir.ENV, str(root))
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    return root


def fake_runner(token="ta.alma", guard="pine:function"):
    def run(inp, out, log):
        items = json.loads(Path(inp).read_text(encoding="utf-8"))
        with open(out, "w", encoding="utf-8") as f:
            for it in items:
                text = Path(it["path"]).read_text(encoding="utf-8").splitlines()
                line = next((i + 1 for i, l in enumerate(text) if token in l), None)
                f.write(json.dumps({"key": it["key"], "attached": False, "clean": False, "stuck": "no-progress",
                                    "steps": [{"refusals": [{"guard": guard, "token": token, "line": line,
                                                             "message": f"{token} maps to nothing",
                                                             "text": text[line - 1] if line else None}]}]}) + "\n")
        Path(log).write_text("door log", encoding="utf-8")
        return 0
    return run


class FakeClient:
    def __init__(self, status="new"):
        self.calls = []
        self._status = status

    def report(self, rid):
        return {"id": rid, "status": self._status, "source": SOURCE, "note": NOTE, "source_bytes": len(SOURCE),
                "symbol": "AAPL", "timeframe": "D", "same_script_reports": 2, "translator_version": "abc123",
                "gaps": [{"name": "ta.alma", "kind": "name-unknown"}]}

    def set_status(self, rid, status):
        self.calls.append((rid, status))
        return {"ok": True, "status": status}

    def digest(self, refresh=False):
        return {"gaps": {"fixed_on_master": [{"name": "ta.alma"}], "open": []},
                "reports": {"open": [{"id": RID, "gaps": [{"name": "ta.alma"}]}]},
                "door_manifest": {"sha": "x"}}

    def reports(self):
        return []


def files_containing(base: Path, needle: str) -> list[Path]:
    out = []
    for p in base.rglob("*"):
        if p.is_file():
            try:
                if needle in p.read_text(encoding="utf-8", errors="ignore"):
                    out.append(p)
            except OSError:
                pass
    return out


# ─── privacy: where source may live, and that it is purged ───────────────────

class TestSourceStaysInTheWorkDir:
    def test_triage_report_writes_source_only_under_reports_id(self, tmp_path, work, capsys):
        c = FakeClient()
        pk = triage.triage_report(c, RID, runner=fake_runner())
        rd = workdir.report_dir(RID)
        holders = files_containing(tmp_path, "secretLevelZ9")
        assert holders, "control: the sentinel must be findable somewhere"
        assert all(rd in p.parents for p in holders), holders
        assert pk.parent == rd and "secretLevelZ9" in pk.read_text(encoding="utf-8")
        assert c.calls == [(RID, "triaged")]                         # lifecycle: triaged
        out = capsys.readouterr()
        assert "secretLevelZ9" not in out.out + out.err and NOTE not in out.out + out.err

    def test_nothing_reaches_the_repo(self):
        before = subprocess.run(["git", "-C", str(triage.REPO), "status", "--porcelain"],
                                capture_output=True, text=True).stdout
        triage.triage_report(FakeClient(), RID, runner=fake_runner())
        after = subprocess.run(["git", "-C", str(triage.REPO), "status", "--porcelain"],
                               capture_output=True, text=True).stdout
        assert before == after

    def test_mark_fixed_closes_and_purges(self, work):
        triage.triage_report(FakeClient(), RID, runner=fake_runner())
        assert workdir.report_dir(RID).exists()
        c = FakeClient()
        done = triage.mark_fixed(c, gap="ta.alma")
        assert done == [RID] and c.calls == [(RID, "fixed")]
        assert not workdir.report_dir(RID).exists()
        assert files_containing(work, "secretLevelZ9") == []

    def test_mark_fixed_refuses_a_gap_the_server_has_not_fixed(self):
        class NotYet(FakeClient):
            def digest(self, refresh=False):
                return {"gaps": {"fixed_on_master": [], "open": []}, "reports": {"open": []},
                        "door_manifest": {"sha": "x"}}
        c = NotYet()
        with pytest.raises(SystemExit):
            triage.mark_fixed(c, gap="ta.alma")
        assert c.calls == []

    def test_purge_closed_removes_dirs_of_reports_no_longer_open(self, work):
        triage.triage_report(FakeClient(), RID, runner=fake_runner())
        assert triage.purge(FakeClient(), closed=True) == [RID]
        assert not workdir.report_dir(RID).exists()

    @pytest.mark.parametrize("fname", ["../escape.pine", "..\\escape.pine", "/abs.pine", "sub/x.pine", "", ".."])
    def test_the_writer_refuses_any_path_outside_the_report_dir(self, fname, work):
        with pytest.raises(workdir.WorkdirError):
            workdir.write_report_file(RID, fname, SOURCE)
        assert files_containing(work.parent, "secretLevelZ9") == []

    @pytest.mark.parametrize("rid", ["../" + "0" * 30, "X" * 32, "", "0" * 31])
    def test_report_ids_are_validated(self, rid):
        with pytest.raises(workdir.WorkdirError):
            workdir.write_report_file(rid, "source.pine", SOURCE)

    def test_a_work_root_inside_git_must_be_ignored(self, tmp_path, monkeypatch):
        repo = tmp_path / "gitrepo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        monkeypatch.setenv(workdir.ENV, str(repo / "work"))
        with pytest.raises(workdir.WorkdirError):
            workdir.write_report_file(RID, "source.pine", SOURCE)
        assert not (repo / "work" / "reports").exists()
        (repo / ".gitignore").write_text("/work/\n", encoding="utf-8")
        assert workdir.write_report_file(RID, "source.pine", SOURCE).exists()   # control

    def test_the_repo_default_root_is_gitignored(self, monkeypatch):
        monkeypatch.delenv(workdir.ENV, raising=False)
        probe = workdir.root() / "reports" / RID / "source.pine"
        r = subprocess.run(["git", "-C", str(triage.REPO), "check-ignore", "-q", str(probe)])
        assert r.returncode == 0


# ─── secrets ─────────────────────────────────────────────────────────────────

class TestSecretNeverLogged:
    def test_repr_and_errors_never_carry_the_secret(self):
        def boom(req, timeout=60):
            assert req.get_header("Authorization") == f"Bearer {SECRET}"      # it IS sent
            raise urllib.error.HTTPError(req.full_url, 401, f"bad Authorization: Bearer {SECRET}",
                                         {}, io.BytesIO(SECRET.encode()))
        c = client_mod.SupportLoopClient("http://127.0.0.1:9", opener=boom)
        assert SECRET not in repr(c)
        with pytest.raises(client_mod.ClientError) as e:
            c.digest()
        assert SECRET not in str(e.value) and "401" in str(e.value)

        def broken(req, timeout=60):
            raise OSError(f"connection reset while sending Authorization: Bearer {SECRET}")
        with pytest.raises(client_mod.ClientError) as e2:
            client_mod.SupportLoopClient("http://127.0.0.1:9", opener=broken).reports()
        assert SECRET not in str(e2.value)

    def test_missing_secret_refuses_without_echoing_anything(self, monkeypatch):
        monkeypatch.delenv("PUSH_SECRET", raising=False)
        with pytest.raises(client_mod.ClientError):
            client_mod.SupportLoopClient("http://127.0.0.1:9")

    def test_cli_error_path_prints_no_secret(self, capsys, monkeypatch):
        def fail(*a, **k):
            raise urllib.error.URLError(f"Bearer {SECRET} refused")
        monkeypatch.setattr(client_mod.urllib.request, "urlopen", fail)
        rc = triage.main(["--url", "http://127.0.0.1:9", "digest"])
        out = capsys.readouterr()
        assert rc == 2 and SECRET not in out.out + out.err

    def test_redact(self):
        assert client_mod.redact(f"x Bearer {SECRET} y", SECRET) == "x Bearer [redacted] y"
        assert "abc" not in client_mod.redact("authorization: Bearer abc")


# ─── packets ─────────────────────────────────────────────────────────────────

DIGEST = {"window_days": 30,
          "gaps": {"open": [{"rank": 1, "name": "ta.alma", "kind": "name-unknown", "members": 4, "hits": 9,
                             "first_day": "2026-10-02", "last_day": "2026-10-29"}],
                   "fixed_on_master": []},
          "reports": {"open": [{"id": RID, "gaps": [{"name": "ta.alma"}]}]}}


class TestPackets:
    def test_gap_packet_from_a_fixture_gap(self, work):
        pk = triage.triage_gap("ta.alma", digest=DIGEST, runner=fake_runner(), sample_scripts=2)
        t = pk.read_text(encoding="utf-8")
        for section in ("## The wall", "## Demand", "## Repro through the member door", "## Affected scripts",
                        "## Pine reference semantics", "## Suggested files", "## Parity capture",
                        "## Definition of done"):
            assert section in t, section
        assert "4 distinct member(s), 9 paste(s)" in t
        assert "#fun_ta.alma" in t
        assert "`pine:function` token `ta.alma`" in t
        assert "app/src/components/chart/engine/ast/pine.js" in t
        assert "mark-fixed --gap ta.alma" in t
        assert "**Kind:** `name-unknown`" in t                  # derived from the door's guard
        assert json.loads((pk.parent / "links.json").read_text(encoding="utf-8"))["reports"] == [RID]
        assert "MEMBER SCRIPT CONTENT" not in t               # a gap packet holds no member source

    def test_gap_kind_follows_doorCoverage_guards(self):
        pk = triage.triage_gap("request.security", digest=None, runner=fake_runner("request.security", "pine:request"),
                               sample_scripts=0)
        assert "**Kind:** `call-unmapped`" in pk.read_text(encoding="utf-8")

    def test_unknown_names_are_refused(self):
        with pytest.raises(SystemExit):
            triage.triage_gap("mySecretThing", runner=fake_runner())

    def test_report_packet_from_a_fixture_report(self):
        pk = triage.triage_report(FakeClient(), RID, runner=fake_runner())
        t = pk.read_text(encoding="utf-8")
        assert "MEMBER SCRIPT CONTENT" in t and NOTE in t
        assert "secretLevelZ9 = ta.alma(close, 9, 0.85, 6)" in t      # the refused line, quoted
        assert "## Repro through the member door" in t and "#fun_ta.alma" in t

    def test_an_already_triaged_report_is_not_patched_again(self):
        c = FakeClient(status="triaged")
        triage.triage_report(c, RID, runner=fake_runner())
        assert c.calls == []


# ─── re-measure ──────────────────────────────────────────────────────────────

class TestRemeasure:
    def _cur(self, scripts):
        n, t = len(scripts), sum(scripts.values())
        return {"sample": n, "transfer": t, "transferPct": round(100 * t / n, 1),
                "byPopulation": {"committed": {"scripts": n, "transfer": t}},
                "examples": {"total": 1, "transfer": 0}, "scripts": scripts}

    def test_dated_history_with_gains_and_regressions(self, tmp_path):
        h = tmp_path / "hist"
        row, d, md = remeasure.record(h, self._cur({"a": True, "b": False, "c": True}), sha="s1", date="2026-10-30")
        assert d["first"] and "First row" in md
        row2, d2, md2 = remeasure.record(h, self._cur({"a": True, "b": True, "c": False}), sha="s2", date="2026-10-31")
        assert d2["gained"] == ["b"] and d2["lost"] == ["c"] and d2["delta"] == 0
        assert "STOPPED transferring" in md2 and "`c`" in md2 and "Started transferring" in md2
        lines = (h / "coverage-history.jsonl").read_text(encoding="utf-8").splitlines()
        assert [json.loads(l)["date"] for l in lines] == ["2026-10-30", "2026-10-31"]
        assert (h / "coverage-latest.md").read_text(encoding="utf-8") == md2

    def test_the_headline_predicate_is_coverage_maps(self):
        from tools.pine_coverage import coverage_map as cm
        assert remeasure.cm.transfers_fully is cm.transfers_fully
        u = {"features": {"strategy-decl"}, "items": {"strategy.entry"}}
        assert cm.transfers_fully({"clean": True}, u) is False                 # orders never transfer
        assert cm.transfers_fully({"clean": True}, {"features": set(), "items": set()}) is True

    def test_sync_master_refuses_a_branch_checkout(self, tmp_path):
        repo = tmp_path / "r"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a",
                        "commit", "-q", "--allow-empty", "-m", "x"], check=True)
        with pytest.raises(SystemExit):
            remeasure.sync_master(repo)
