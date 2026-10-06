"""ARCHIVE-BEFORE-PRUNE: the US V2 producer may delete a vintage ONLY after Exchange Breadth's archive of it
is re-proven (`breadth_vintage_archive.verify`). Every case runs in a temp producer root + temp archive —
no test can reach a real vintage."""
from __future__ import annotations

import json
import os
import shutil
import stat
import sys

import pytest

from api.services import breadth_v2_producer as prod
from api.services import breadth_vintage_archive as va

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "breadth_exch"))
import live_core as lc  # noqa: E402

TAGS = ["p202610010000", "p202610020000", "p202610030000", "p202610040000", "p202610050000", "p202610060000"]


def _mk_vintage(root, tag, salt=""):
    vd = os.path.join(root, "vintages", tag)
    ip, gp = os.path.join(vd, "inputs_" + tag), os.path.join(vd, "grouped_" + tag)
    os.makedirs(ip)
    os.makedirs(gp)
    open(os.path.join(ip, "INPUT_MANIFEST.json"), "w").write(json.dumps({"tag": tag, "s": salt}))
    open(os.path.join(ip, "pit_reference.json"), "w").write(json.dumps({"ref": tag}))
    for i in range(3):
        open(os.path.join(gp, "2026-10-0%d_0.json" % (i + 1)), "w").write(json.dumps([tag, i]))
    open(os.path.join(vd, "compute.log"), "w").write("log\n")
    os.makedirs(os.path.join(vd, "work"))
    open(os.path.join(vd, "work", "out.json"), "w").write("{}")
    return vd


@pytest.fixture
def world(tmp_path, monkeypatch):
    root, arch = str(tmp_path / "producer"), str(tmp_path / "archive")
    monkeypatch.setattr(prod, "ROOT", root)
    monkeypatch.setattr(prod, "EXCH_ARCHIVE_DIR", arch)
    alarms = []
    monkeypatch.setattr(prod, "_alarm", lambda sev, msg, detail: alarms.append((sev, detail)))

    def add(tags, owned=True):
        for i, t in enumerate(tags):
            vd = _mk_vintage(root, t)
            with prod._state() as c:
                c.execute("INSERT INTO vintage VALUES(?,?,?,?,?,?,?,?)",
                          (t, "2026-10-0%d" % (i + 1), vd + "/grouped_" + t, vd + "/inputs_" + t, "", t[1:] + "Z",
                           "ready", "{}"))
            if owned:
                d = "2026-%s-%s" % (t[5:7], t[7:9])
                ip = os.path.join(vd, "inputs_" + t)
                prov = {"vintage_tag": t, "input_manifest_sha256": va.sha_file(os.path.join(ip, "INPUT_MANIFEST.json")),
                        "reference_sha256": va.sha_file(os.path.join(ip, "pit_reference.json"))}
                with prod._canon() as c:
                    c.execute("INSERT INTO v2_session VALUES(?,?,?,?,?)", (d, d + "-" + t, "x", json.dumps(prov), "t"))
                prod._set(d, prod.CURRENT, vintage=t)
    # created_at must sort: use the tag's digits as an ISO-ish string
    return {"root": root, "arch": arch, "alarms": alarms, "add": add,
            "src": lambda t: os.path.join(root, "vintages", t)}


def _archive(w, tags=None):
    with prod._state() as c:
        ready = [r[0] for r in c.execute("SELECT tag FROM vintage WHERE state='ready'")]
    return lc.archive_vintages(os.path.join(w["root"], "vintages"), tags if tags is not None else ready, w["arch"],
                               code_commit="test")


def _state(t):
    with prod._state() as c:
        return c.execute("SELECT state FROM vintage WHERE tag=?", (t,)).fetchone()[0]


def _writable(p):
    for dp, _d, fns in os.walk(p):
        for f in fns:
            os.chmod(os.path.join(dp, f), stat.S_IWUSR | stat.S_IRUSR)


# 1 ─ publish, archive succeeds → normal retention prunes exactly the oldest beyond KEEP
def test_01_archived_vintage_is_pruned_and_only_beyond_keep(world):
    world["add"](TAGS[:4])
    r = _archive(world)
    assert set(r.values()) == {"archived"}
    out = prod._prune_vintages()
    assert out == {"pruned": [TAGS[0]], "blocked": {}}
    assert not os.path.exists(world["src"](TAGS[0])) and _state(TAGS[0]) == "pruned"
    assert all(os.path.isdir(world["src"](t)) for t in TAGS[1:4])
    assert os.path.isdir(os.path.join(world["arch"], TAGS[0]))          # the archive copy survives


# 2 ─ archive never starts → NO PRUNE, alarm
def test_02_archive_never_started_blocks_prune(world):
    world["add"](TAGS[:4])
    out = prod._prune_vintages()
    assert out == {"pruned": [], "blocked": {TAGS[0]: "ACK_MISSING"}}
    assert os.path.isdir(world["src"](TAGS[0])) and _state(TAGS[0]) == "ready"
    assert world["alarms"] and world["alarms"][-1][0] == "warning"
    g = prod.archive_guard_status()
    assert g["prune_blocked"] == {TAGS[0]: "ACK_MISSING"} and g["level"] in ("WARNING", "CRITICAL")


# 3 ─ archive crashes midway (copy interrupted; and between the dir and SUMS renames) → no ack, no prune;
#     the next run repairs and acknowledges
def test_03_archive_crash_midway_then_recovers(world, monkeypatch):
    world["add"](TAGS[:4])
    real = shutil.copytree

    def boom(s, d, *a, **k):
        real(s, d, *a, **k)
        raise OSError("disk went away mid-copy")
    monkeypatch.setattr(shutil, "copytree", boom)
    with pytest.raises(OSError):
        _archive(world, [TAGS[0]])
    monkeypatch.setattr(shutil, "copytree", real)
    assert os.path.isdir(os.path.join(world["arch"], TAGS[0] + ".partial"))
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "ACK_MISSING"}
    # a crash between the two renames: final dir present, SUMS absent
    os.makedirs(os.path.join(world["arch"], TAGS[1]))
    r = _archive(world)
    assert r[TAGS[0]] == "archived" and r[TAGS[1]] == "archived" and TAGS[1] + "#incomplete" in r
    assert not os.path.exists(os.path.join(world["arch"], TAGS[0] + ".partial"))
    assert prod._prune_vintages()["pruned"] == [TAGS[0]]


# 4 ─ archive copies everything but its verification fails → refused, no ack, no prune
def test_04_copy_verification_failure_refuses_and_blocks(world, monkeypatch):
    world["add"](TAGS[:4])
    real = shutil.copytree

    def corrupting(s, d, *a, **k):
        real(s, d, *a, **k)
        p = os.path.join(d, "grouped_" + TAGS[0], "2026-10-01_0.json")
        if os.path.exists(p):
            open(p, "w").write("CORRUPT")
    monkeypatch.setattr(shutil, "copytree", corrupting)
    with pytest.raises(lc.Refused) as e:
        _archive(world, [TAGS[0]])
    assert e.value.reason == "ARCHIVE_COPY_MISMATCH"
    assert not os.path.exists(va.ack_path(world["arch"], TAGS[0]))
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "ACK_MISSING"}


# 5 ─ marker missing (archive + SUMS present) → no prune; the archiver backfills it
def test_05_marker_missing_blocks_then_backfills(world):
    world["add"](TAGS[:4])
    _archive(world)
    os.chmod(va.ack_path(world["arch"], TAGS[0]), stat.S_IWUSR | stat.S_IRUSR)
    os.remove(va.ack_path(world["arch"], TAGS[0]))
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "ACK_MISSING"}
    assert _archive(world)[TAGS[0]] == "acknowledged (backfill)"
    assert prod._prune_vintages()["pruned"] == [TAGS[0]]


def _rewrite_ack(w, tag, fn):
    p = va.ack_path(w["arch"], tag)
    os.chmod(p, stat.S_IWUSR | stat.S_IRUSR)
    doc = json.load(open(p))
    raw = fn(doc)
    open(p, "w").write(raw if isinstance(raw, str) else json.dumps(doc))


# 6 ─ marker malformed → no prune
@pytest.mark.parametrize("mutate", [
    lambda d: "{not json",
    lambda d: d.pop("required"),
    lambda d: d.__setitem__("protocol", "exch-vintage-archive-ack/0"),
    lambda d: d["required"].__setitem__("files", "3"),
    lambda d: d.__setitem__("complete", False),
])
def test_06_marker_malformed_blocks(world, mutate):
    world["add"](TAGS[:4])
    _archive(world)
    _rewrite_ack(world, TAGS[0], mutate)
    out = prod._prune_vintages()
    assert out["pruned"] == [] and out["blocked"][TAGS[0]] in ("ACK_MALFORMED", "ACK_INCOMPLETE")
    assert os.path.isdir(world["src"](TAGS[0]))
    assert world["alarms"][-1][0] == "critical"                 # integrity, not just lateness


# 7 ─ marker hash mismatch (SUMS identity, required listing, tag, input identity) → no prune
@pytest.mark.parametrize("mutate,why", [
    (lambda d: d["archive"].__setitem__("sums_sha256", "0" * 64), "ACK_SUMS_MISMATCH"),
    (lambda d: d["required"].__setitem__("listing_sha256", "0" * 64), "REQUIRED_LISTING_MISMATCH"),
    (lambda d: d.__setitem__("tag", "pOTHER"), "ACK_TAG_MISMATCH"),
    (lambda d: d["inputs"].__setitem__("input_manifest_sha256", "0" * 64), "ACK_INPUTS_MISMATCH"),
])
def test_07_marker_hash_mismatch_blocks(world, mutate, why):
    world["add"](TAGS[:4])
    _archive(world)
    _rewrite_ack(world, TAGS[0], mutate)
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: why}
    assert os.path.isdir(world["src"](TAGS[0]))


# 8 ─ marker valid but an archived file is later corrupted (or deleted) → no prune
@pytest.mark.parametrize("damage,why", [("corrupt", "ARCHIVE_FILE_CORRUPT"), ("delete", "ARCHIVE_FILE_MISSING")])
def test_08_archived_file_damaged_after_ack_blocks(world, damage, why):
    world["add"](TAGS[:4])
    _archive(world)
    p = os.path.join(world["arch"], TAGS[0], "grouped_" + TAGS[0], "2026-10-02_0.json")
    os.chmod(p, stat.S_IWUSR | stat.S_IRUSR)
    if damage == "corrupt":
        open(p, "w").write("bitrot")
    else:
        os.remove(p)
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: why}
    assert os.path.isdir(world["src"](TAGS[0]))


# 9 ─ a RETRY's build prunes through the SAME guarded path (and nothing else in the producer deletes)
def test_09_retry_build_cannot_bypass_the_guard(world, monkeypatch):
    world["add"](TAGS[:4])
    import inspect
    src = inspect.getsource(prod)
    assert src.count("shutil.rmtree(") == 1
    body = inspect.getsource(prod._prune_vintages)
    assert "shutil.rmtree(src" in body and body.index("va.verify(") < body.index("shutil.rmtree(src")
    assert "_prune_vintages()" in inspect.getsource(prod.build_vintage)
    assert "_prune_vintages" not in inspect.getsource(prod._retry) and "rmtree" not in inspect.getsource(prod.tick)

    def fake_tool(args, env_extra, log, timeout):              # every external step of a (retry) build
        tool = os.path.basename(args[0])
        if tool == "pit_ledger_refresh.py":
            json.dump({"dates": []}, open(args[4], "w"))
            json.dump({"ok": True}, open(args[5], "w"))
        elif tool == "acquire_all.py":
            tag = args[1]
            os.makedirs(env_extra["BV2_GROUPED_BASE"] + tag, exist_ok=True)
            ip = env_extra["BV2_INPUTS_BASE"] + tag
            os.makedirs(ip, exist_ok=True)
            open(os.path.join(ip, "INPUT_MANIFEST.json"), "w").write("{}")
        return 0
    monkeypatch.setattr(prod, "_run_tool", fake_tool)
    stamps = iter(["202610070000", "202610070100"])
    real_strftime = prod.time.strftime
    monkeypatch.setattr(prod.time, "strftime", lambda fmt, *a: next(stamps) if fmt == "%Y%m%d%H%M" else
                        real_strftime(fmt, *a))
    prod.build_vintage("2026-10-06", {})                       # first attempt
    prod.build_vintage("2026-10-06", {})                       # the retry
    assert all(os.path.isdir(world["src"](t)) for t in TAGS[:4])   # nothing archived → nothing pruned
    assert {_state(t) for t in TAGS[:4]} == {"ready"}


# 10 ─ several vintages published before the archive catches up → all blocked; catching up releases them
def test_10_many_vintages_before_archive_catches_up(world):
    world["add"](TAGS)
    assert set(prod._prune_vintages()["blocked"]) == set(TAGS[:3])
    assert all(os.path.isdir(world["src"](t)) for t in TAGS)
    assert prod.archive_guard_status()["level"] == "CRITICAL"   # 3 blocked
    _archive(world)
    assert sorted(prod._prune_vintages()["pruned"]) == TAGS[:3]


# 11 ─ mixed archived / unarchived old vintages → only the proven ones go
def test_11_mixed_archived_and_unarchived(world):
    world["add"](TAGS)
    _archive(world, [TAGS[1]])
    out = prod._prune_vintages()
    assert out["pruned"] == [TAGS[1]] and set(out["blocked"]) == {TAGS[0], TAGS[2]}
    assert os.path.isdir(world["src"](TAGS[0])) and os.path.isdir(world["src"](TAGS[2]))


# 12 / 13 ─ disk thresholds
def test_12_13_disk_warning_and_critical(world, monkeypatch):
    world["add"](TAGS[:3])
    du = shutil.disk_usage(".")
    for free, lvl in ((va.DISK_WARN_FREE_BYTES + va.GIB, "OK"), (va.DISK_WARN_FREE_BYTES - va.GIB, "WARNING"),
                      (va.DISK_CRIT_FREE_BYTES - va.GIB, "CRITICAL")):
        monkeypatch.setattr(prod.shutil, "disk_usage", lambda p, f=free: du._replace(free=f))
        g = prod.archive_guard_status()
        assert g["level"] == lvl, (free, g)
    assert va.disk_level(10 ** 13, 0, None, 0)[0] == "OK"
    assert va.disk_level(10 ** 13, 1, 1.0, 0)[0] == "WARNING"
    assert va.disk_level(10 ** 13, 1, va.BLOCKED_CRIT_AGE_HOURS + 1, 0)[0] == "CRITICAL"
    assert va.disk_level(10 ** 13, 0, None, 1)[0] == "CRITICAL"


# 14 ─ archive recovers after failure: a damaged archive with the producer copy present is quarantined
#      (renamed, never deleted) and re-archived; then the prune proceeds
def test_14_archive_recovers_after_failure(world):
    world["add"](TAGS[:4])
    _archive(world)
    p = os.path.join(world["arch"], TAGS[0], "inputs_" + TAGS[0], "pit_reference.json")
    os.chmod(p, stat.S_IWUSR | stat.S_IRUSR)
    open(p, "w").write("bitrot")
    os.chmod(va.ack_path(world["arch"], TAGS[0]), stat.S_IWUSR | stat.S_IRUSR)
    os.remove(va.ack_path(world["arch"], TAGS[0]))              # ack gone too: the archiver must re-prove
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "ACK_MISSING"}
    r = _archive(world)
    assert r[TAGS[0]] == "archived" and r[TAGS[0] + "#quarantined"].startswith("ARCHIVE_FILE_CORRUPT")
    assert any(".QUARANTINE." in f for f in os.listdir(world["arch"]))
    assert prod._prune_vintages()["pruned"] == [TAGS[0]]


# 15 ─ duplicate archive invocation is a no-op (the ack is never rewritten)
def test_15_duplicate_archive_invocation_is_idempotent(world):
    world["add"](TAGS[:4])
    _archive(world)
    before = {t: open(va.ack_path(world["arch"], t), "rb").read() for t in TAGS[:4]}
    assert set(_archive(world).values()) == {"already archived"}
    assert before == {t: open(va.ack_path(world["arch"], t), "rb").read() for t in TAGS[:4]}


# 16 ─ producer restart: the guard holds nothing in memory; its last decision persists in state.db
def test_16_producer_restart_keeps_guard_state(world):
    world["add"](TAGS[:4])
    prod._prune_vintages()
    import importlib
    importlib.reload(va)
    g = prod.archive_guard_status()
    assert g["prune_blocked"] == {TAGS[0]: "ACK_MISSING"} and g["oldest_prune_blocked"] == TAGS[0]
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "ACK_MISSING"}   # still decided by proof, not memory


# 17 ─ exchange runner restart mid-archive: the re-run completes it (see 3) and changes nothing done
def test_17_exchange_runner_restart_is_safe(world, monkeypatch):
    world["add"](TAGS[:4])
    _archive(world, [TAGS[0]])
    acked = open(va.ack_path(world["arch"], TAGS[0]), "rb").read()
    os.makedirs(os.path.join(world["arch"], TAGS[1] + ".partial"))   # a restart found a half copy
    r = _archive(world)
    assert r[TAGS[0]] == "already archived" and r[TAGS[1]] == "archived"
    assert open(va.ack_path(world["arch"], TAGS[0]), "rb").read() == acked


# ── extra contract cases ────────────────────────────────────────────────────────────────────────
def test_producer_copy_changed_after_archive_blocks(world):
    world["add"](TAGS[:4])
    _archive(world)
    open(os.path.join(world["src"](TAGS[0]), "grouped_" + TAGS[0], "2026-10-01_0.json"), "w").write("mutated")
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "SOURCE_MISMATCH"}


def test_producer_file_never_archived_blocks(world):
    world["add"](TAGS[:4])
    _archive(world)
    open(os.path.join(world["src"](TAGS[0]), "inputs_" + TAGS[0], "late.json"), "w").write("{}")
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "SOURCE_NOT_ARCHIVED"}


def test_logs_appended_after_archive_do_not_block(world):
    world["add"](TAGS[:4])
    _archive(world)
    open(os.path.join(world["src"](TAGS[0]), "compute.log"), "a").write("more\n")
    assert prod._prune_vintages()["pruned"] == [TAGS[0]]


def test_owner_provenance_must_match_the_archived_inputs(world):
    world["add"](TAGS[:4])
    _archive(world)
    with prod._canon() as c:
        d, prov = c.execute("SELECT date, provenance FROM v2_session WHERE pub_id LIKE ?", ("%" + TAGS[0],)).fetchone()
        p = json.loads(prov)
        p["reference_sha256"] = "0" * 64
        c.execute("UPDATE v2_session SET provenance=? WHERE date=?", (json.dumps(p), d))
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "OWNER_PROVENANCE_MISMATCH"}


def test_an_unexpected_guard_error_is_no_prune(world, monkeypatch):
    world["add"](TAGS[:4])
    _archive(world)
    monkeypatch.setattr(va, "verify", lambda *a, **k: (_ for _ in ()).throw(PermissionError("denied")))
    assert prod._prune_vintages()["blocked"] == {TAGS[0]: "GUARD_ERROR"}
    assert os.path.isdir(world["src"](TAGS[0]))


def test_pruned_owner_archive_is_backfilled_honestly(world):
    world["add"](TAGS[:4])
    _archive(world)
    for f in (va.ack_path(world["arch"], TAGS[0]),):
        os.chmod(f, stat.S_IWUSR | stat.S_IRUSR)
        os.remove(f)
    _writable(world["src"](TAGS[0]))
    shutil.rmtree(world["src"](TAGS[0]))
    r = _archive(world, [])
    assert r[TAGS[0]] == "acknowledged (backfill, producer copy already pruned)"
    ack = json.load(open(va.ack_path(world["arch"], TAGS[0])))
    assert ack["source"]["verified"] is False and ack["archive"]["verified"] is True


def test_status_is_cheap_and_reports_every_field(world):
    world["add"](TAGS[:4])
    _archive(world, [TAGS[3]])
    prod._prune_vintages()
    g = prod.archive_guard_status()
    for k in ("prune_blocked", "prune_blocked_count", "oldest_prune_blocked", "oldest_prune_blocked_age_hours",
              "unarchived_ready_vintages", "verification_failures", "disk", "level", "reasons", "ack_state"):
        assert k in g
    assert sorted(g["unarchived_ready_vintages"]) == TAGS[:3] and g["ack_state"][TAGS[3]] == "acked"
    assert "archive_guard" in prod.status()
