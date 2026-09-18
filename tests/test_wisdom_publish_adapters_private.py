"""Property test: no private value reaches any adapter output (W1 §0.4d; CONTRACTS §6.2, §6.6).

Seeded random records carry SENTINEL values in every level/price column on OPEN positions
and on records with a private-store row. Every adapter's member- or admin-facing output is
then produced with every flag on — the Brain KB export rows, the Ask-AI block, desk markers,
badges, dossier lines, drafts (Pattern Vision, Model Book, playbooks, style guide), the clip
export — plus the whole `run_daily` step and everything it wrote to the publish log. No
sentinel may appear anywhere, and no private column name may appear as an output key.
(The D20 scorer's internal crosses table is not an output and is not inspected.)

Also railed here: `run_daily` runs every step, reports each, and one failing step does not
stop the rest.
"""
from __future__ import annotations

import json
import random
from datetime import datetime
from types import SimpleNamespace

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import adapters, level_alerts, lookalike, retrieval
from api.services.wisdom.publish.adapters import (askai, badges, brainkb, clips, common, desk_markers, dossier,
                                                  drafts, modelbook, pv_examples, voice, voicefmt)
from tests.test_wisdom_publish_adapters_store import PASSES_FLOOR, add_record, adapters_db, seeded  # noqa: F401

SENTINELS = ("98765.4321", "87654.321", "76543.21", "65432.1987")
FLAGS = ("WISDOM_RETRIEVAL_INDEX_ENABLED", "ASKAI_WISDOM_RETRIEVAL_ENABLED", "WISDOM_DESK_MARKERS_ENABLED",
         "WISDOM_BADGES_ENABLED", "WISDOM_DOSSIER_ENABLED", "WISDOM_BRAINKB_PUBLISH_ENABLED",
         "WISDOM_PV_EXAMPLES_ENABLED", "WISDOM_MODELBOOK_DRAFTS_ENABLED", "WISDOM_VOICE_PROFILE_ENABLED")


def _ctx(dry_run=False):
    return SimpleNamespace(dry_run=dry_run, now_et=datetime(2026, 9, 11, 18, 47, tzinfo=timeutil.ET),
                           log=lambda m: None)


def _seed_private(conn, rng: random.Random, n=48):
    segments = ("segLIVE1", "segSCAN1", "segDISC1")
    sources = {"segLIVE1": "srcLIVE", "segSCAN1": "srcSCAN", "segDISC1": "srcDISC"}
    open_stances = ("watching", "taking", "in_it", "added", "trimmed")
    for i in range(n):
        seg = rng.choice(segments)
        has_private = rng.random() < 0.5
        stance = rng.choice(open_stances) if (not has_private or rng.random() < 0.5) else "exited"
        closed = stance == "exited"
        if closed and not has_private:
            stance, has_private = "in_it", False  # a closed record without a private row may publish prices; keep it open
        s = rng.sample(SENTINELS, 4)
        add_record(conn, f"recPRIV{i}", rng.choice(("CALL", "MENTION", "NEGATIVE_CALL")), seg, sources[seg],
                   author_id=rng.choice(("tsdr", "bracco", "manrav", "chartmaster")), ticker="PRIV",
                   direction="long", stance=stance, vocab_id=rng.choice(("v_ep", "v_flat_base")),
                   stated_outcome="profit" if closed else None, has_private=int(has_private),
                   entry=float(s[0]), entry_zone_lo=float(s[1]), entry_zone_hi=float(s[2]), stop=float(s[3]),
                   targets_json=[{"price": float(s[0]), "text": "t"}],
                   levels_json=[{"type": "support", "price": float(s[1]), "price_as_heard": s[1]}],
                   thesis=rng.choice(("tight base", "gap held", "strong group", None)),
                   status=rng.choice(("provisional", "confirmed")),
                   stated_at_et=f"2026-09-{rng.randint(1, 10):02d}T1{rng.randint(0, 5)}:00:00-04:00",
                   record_hash=f"priv{i}",
                   # ⛔ R89 floored all three of these types. Without a passing score every adapter
                   # output would be EMPTY, and "no private value reached any output" would be true
                   # for the most useless reason available — nothing reached any output at all.
                   # The test's own control (`outputs["desk_markers"] and ...`) catches that, and
                   # this is what keeps the control satisfiable.
                   **PASSES_FLOOR)


def _walk_keys(value, found: set):
    if isinstance(value, dict):
        for k, v in value.items():
            found.add(k)
            _walk_keys(v, found)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _walk_keys(v, found)


def test_no_private_value_reaches_any_adapter_output(seeded, monkeypatch):
    from api.services import rollout

    rng = random.Random(20260913)
    with store.write() as conn:
        _seed_private(conn, rng)
    for env in FLAGS:
        monkeypatch.setenv(env, "1")
    monkeypatch.setattr(rollout, "includes", lambda *a, **k: True)
    monkeypatch.setattr(level_alerts, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "candidate_tickers", lambda s: [])
    now = datetime(2026, 9, 11, 12, 0, tzinfo=timeutil.ET)

    outputs: dict = {}
    outputs["run_daily"] = adapters.run_daily(_ctx())
    retrieval.refresh(force=True)
    with store.write() as conn:
        brainkb.stage(conn, brainkb.build_rows(conn))
    outputs["kb_export"] = brainkb.export_payload()
    outputs["askai"] = askai.wisdom_block("what about PRIV", user_id="u", question_type="other", query_tickers=["PRIV"])
    outputs["desk_markers"] = desk_markers.wisdom_rows("PRIV")
    outputs["badges"] = badges.badges_for(["PRIV", "NVDA"], now=now)
    outputs["dossier"] = dossier.wisdom_lines("PRIV") + dossier.wisdom_lines("NVDA")
    with store.read() as conn:
        outputs["pv"] = pv_examples.build_drafts(conn)
        outputs["mb_examples"] = modelbook.build_example_drafts(conn)
        outputs["mb_playbooks"] = modelbook.build_playbook_drafts(conn)
        outputs["style"] = voice.title_style_guide(conn)
        outputs["corpus"] = voicefmt.format_archive(voicefmt.corpus_documents(conn, include_spoken=True))
        outputs["publish_log"] = [dict(r) for r in conn.execute("SELECT * FROM wisdom_publish_log")]
    outputs["drafts"] = drafts.list_drafts(limit=500)
    outputs["clips"] = [clips.clip_candidates(v) for v in (42, 77)]

    # non-vacuity: the outputs are real, and the private rows did reach the adapters
    assert outputs["desk_markers"] and outputs["badges"].get("PRIV") and outputs["dossier"]
    assert outputs["askai"][0] and outputs["kb_export"]["rows"] and outputs["drafts"]
    assert any(r["ticker"] == "PRIV" for c in outputs["clips"] for r in c["records"])

    blob = json.dumps(outputs, default=str)
    for sentinel in SENTINELS:
        assert sentinel not in blob, sentinel
    keys: set = set()
    _walk_keys(outputs, keys)
    assert not keys & common.PRIVATE_RECORD_COLUMNS, keys & common.PRIVATE_RECORD_COLUMNS


def test_the_sentinels_would_be_caught(seeded):
    """Control: the level columns really hold the sentinels, so their absence above means something."""
    rng = random.Random(20260913)
    with store.write() as conn:
        _seed_private(conn, rng, n=4)
    with store.read() as conn:
        raw = json.dumps([dict(r) for r in conn.execute("SELECT entry, stop, targets_json FROM wisdom_records "
                                                        "WHERE record_id LIKE 'recPRIV%'")])
    assert any(s in raw for s in SENTINELS)


def test_run_daily_runs_every_step_and_survives_a_failing_one(seeded, monkeypatch):
    monkeypatch.setattr(level_alerts, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "candidate_tickers", lambda s: [])

    def boom(ctx):
        raise RuntimeError("synthetic step failure")

    monkeypatch.setattr(badges, "daily_preview", boom)
    out = adapters.run_daily(_ctx())
    assert [name for name, _, _ in adapters.STEPS] == list(out["steps"])
    assert out["failed"] == ["badges"] and "synthetic step failure" in out["steps"]["badges"]["error"]
    assert out["steps"]["lookalike"]["status"] == "ok" and out["steps"]["level_alerts"]["status"] == "ok"
    with store.read() as conn:
        actions = {(r["consumer"], r["action"]) for r in conn.execute("SELECT consumer, action FROM wisdom_publish_log")}
    # every flag is off here: only would_publish previews, and no drafts beyond the D18 sourcing queue
    assert actions and {a for _, a in actions} == {"would_publish"}
    with store.read() as conn:
        kinds = {r[0] for r in conn.execute("SELECT DISTINCT kind FROM wisdom_drafts")}
    assert kinds <= {"voice_principle_sourcing"}


def test_a_dry_run_of_run_daily_writes_nothing(seeded, monkeypatch):
    monkeypatch.setattr(level_alerts, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "_daily_bars", lambda *a, **k: [])
    monkeypatch.setattr(lookalike, "candidate_tickers", lambda s: [])
    out = adapters.run_daily(_ctx(dry_run=True))
    assert out["failed"] == []
    with store.read() as conn:
        for table in ("wisdom_publish_log", "wisdom_drafts", "wisdom_kb_rows", "wisdom_d20_scoring_runs",
                      "wisdom_retrieval_docs", "wisdom_review_queue"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table
