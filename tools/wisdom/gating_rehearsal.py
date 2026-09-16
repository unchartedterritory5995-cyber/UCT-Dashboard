#!/usr/bin/env python
"""R50 — run the daily chain INGEST-only against a store that HAS the four types, then ask every
member door what it returns. ⛔ Throwaway store, child process, $0.00, no network.

⚰️ WHY IT IS RE-RUN. Session 12's INGEST-only rehearsal ran against an EMPTY store and reported
"level_alerts 0 crosses, lookalike 0 scores, wisdom_records 0". True, and it settles nothing: an
empty store cannot distinguish "this consumer is gated" from "this consumer had nothing to read".
Every ungated consumer would have reported exactly the same zeros. R50 asks whether CALL / MENTION
/ LEVEL / NEGATIVE_CALL reach a member the moment EXTRACT runs, so the store has to hold them.

⛔ THE RECORDS ARE SYNTHETIC, AND THAT IS THE POINT. The question is STRUCTURAL — which door opens,
under which switch — not what any statement says. Seeding from the persisted gate runs would drag
quote-bearing text into a transcript a report is written from, which §0.4f forbids. The tickers are
fictional and the statements are placeholders.

⛔ It writes NOTHING outside its own temp directory. `conftest.shared_data_root_census()` pins every
/data literal into the sandbox BEFORE any api.** import, and the tripwire is armed in-process.

    python tools/wisdom/gating_rehearsal.py            # the transcript
    python tools/wisdom/gating_rehearsal.py --self-check   # proves a door can report OPEN
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

FOUR_TYPES = ("CALL", "MENTION", "LEVEL", "NEGATIVE_CALL")

#: The switches an INGEST-only night has ON. Everything else stays unset, which is dark.
INGEST_ONLY = {"WISDOM_INGEST_ENABLED": "1"}


def sandbox() -> pathlib.Path:
    """Pin every /data literal into a fresh temp tree. ⛔ BEFORE importing anything from api.**."""
    import conftest as root_conftest

    root = pathlib.Path(tempfile.mkdtemp(prefix="r50-rehearsal-"))
    # ⛔ ORDER IS LOAD-BEARING, and getting it wrong is how this tool's first run tripped the
    # shared-root guard: clearing every `WISDOM_*` name AFTER pinning also cleared
    # `WISDOM_DB_PATH`, so the store resolved to C:\data. Clear only the SWITCHES (`*_ENABLED`),
    # and clear them before the pins, never after.
    for key in [k for k in os.environ if k.endswith("_ENABLED")
                and (k.startswith("WISDOM_") or k.startswith("ASKAI_WISDOM_"))]:
        del os.environ[key]
    _, pins, _ = root_conftest.shared_data_root_census()
    for env, literal in pins.items():
        os.environ[env] = literal.replace("/data", str(root))
    os.environ["DATA_DIR"] = str(root)
    os.environ["WISDOM_DB_PATH"] = str(root / "wisdom.db")
    os.environ.update(INGEST_ONLY)
    return root


def seed(store, *, n_per_type: int = 3) -> dict:
    """One source, one video-stream segment, and n records of each of the four types."""
    with store.write() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_sources (source_id, stream, external_ref, version, "
            "guest_names_json, raw_sha256, incomplete, ingest_version, ingested_at) "
            "VALUES ('src-r50','zoom_live','edu_videos:9001',1,'[]','x',0,'r50','2026-09-15')")
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, ordinal, "
            "kind, text, text_sha256, normalizer_version) "
            "VALUES ('seg-r50','src-r50',1,0,'section','placeholder','h','r50')")
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(wisdom_records)")}
        # ⭐ Populate the columns each door actually branches on, so a door that is SHUT is shut
        # because of its gate and not because the fixture gave it nothing to publish. A record
        # nothing could ever publish makes every door look gated — the vacuous pass.
        # ⛔ Values from the schema's own CHECK lists and the adapters' WHERE clauses
        # (brainkb.py:119, modelbook.py:39-40) — a rejected INSERT is a fixture that seeds nothing.
        rich = {"thesis": "placeholder thesis", "direction": "long", "stance": "exited",
                "hindsight": 1, "stated_outcome": "profit", "setup_name_raw": "placeholder setup",
                "reason": "placeholder reason"}
        extra = {k: v for k, v in rich.items() if k in cols}
        names = ", ".join(extra)
        made = 0
        for rtype in FOUR_TYPES:
            for i in range(n_per_type):
                conn.execute(
                    "INSERT OR REPLACE INTO wisdom_records (record_id, record_type, segment_id, "
                    "source_id, source_version, extractor_version, record_hash, status, has_private, "
                    "created_at, extraction_confidence, stability, stability_runs, ticker, author_id, "
                    "is_guest, stated_at_et" + (", " + names if names else "") + ") "
                    "VALUES (?,?,'seg-r50','src-r50',1,'r50',?, 'confirmed',0,'2026-09-15','high',"
                    "1.0,3,'ZZZZ','tsdr',0,'2026-09-15T14:00:00-04:00'"
                    + ("".join(", ?" for _ in extra)) + ")",
                    (f"r50-{rtype}-{i}", rtype, f"h-{rtype}-{i}", *extra.values()))
                made += 1
    return {"records": made, "types": list(FOUR_TYPES), "fields": sorted(extra)}


def run_chain(chain) -> list:
    """The REAL daily chain, through its real entry point — never a re-implementation of the step
    list. `due_key=None` so it claims no slot; `dry_run=False` so every step actually runs."""
    from api.services.wisdom import registry
    from api.services.wisdom.core import timeutil

    # ⛔⛔ force=False, AND THAT IS NOT A DETAIL. `batch.run_daily:439` reads
    # `if not ctx.force and not flags.extract_enabled()` — so a FORCED chain run bypasses
    # WISDOM_EXTRACT_ENABLED, the only switch that spends. This rehearsal's first run used
    # force=True and watched `extract` report ok with the flag unset. An INGEST-only night is
    # not forced, so the honest rehearsal is not either.
    ctx = registry.JobContext(job_id="r50_gating_rehearsal", now_et=timeutil.now_et(), due_key=None,
                              force=False, dry_run=False, run_id="r50-rehearsal")
    return chain.run_chain("daily", ctx).get("steps") or []


#: ⛔⛔ THREE OUTCOMES, NEVER TWO. `shut` (the door answered and handed back nothing) and
#: `INCONCLUSIVE` (the door could not be asked — a product table this sandbox does not carry) are
#: different facts, and collapsing them is how a missing table gets published as "the gate held".
#: The CoverageLine discipline, one level down.
INCONCLUSIVE = None


def _door(fn):
    try:
        return len(fn() or [])
    except Exception as exc:
        return (INCONCLUSIVE, f"{type(exc).__name__}: {str(exc)[:80]}")


def member_doors(sym: str = "ZZZZ") -> dict:
    """Ask every door a member surface uses, through the door's OWN entry point.

    ⛔ Each probe calls what the member route calls — `ticker_mentions.mentions_for_symbol`, not
    `desk_markers.merge` — because the gate sits at the consumer, and a probe that reaches past it
    would measure the adapter rather than the door.
    """
    from api.services import ai_search_dossier, ticker_mentions
    from api.services.wisdom.publish.adapters import askai, brainkb, dossier

    def desk():
        payload = ticker_mentions.mentions_for_symbol(sym)
        rows = payload.get("mentions") if isinstance(payload, dict) else payload
        return [r for r in (rows or []) if isinstance(r, dict) and not r.get("video_id")]

    def bundle():
        # the exact call ai_search_dossier._gather_sources makes (ai_search_dossier.py:203)
        assert hasattr(ai_search_dossier, "_gather_sources"), "the dossier hook moved"
        return dossier.wisdom_lines(sym)

    def ask():
        _block, cites = askai.wisdom_block(f"what did UCT say about {sym}", user_id="member-1",
                                           question_type="other", query_tickers=[sym])
        return cites

    def kb():
        return (brainkb.export_payload() or {}).get("rows") or []

    def drafts():
        from api.services.wisdom.core import store
        with store.read() as conn:
            return list(conn.execute("SELECT draft_id FROM wisdom_drafts "
                                     "WHERE kind LIKE 'modelbook%'").fetchall())

    return {
        "desk_markers  GET /api/education/tickers/{sym}/mentions  require_paid": _door(desk),
        "dossier       POST /api/ai-search (bundle)               require_paid": _door(bundle),
        "askai         POST /api/ai-search (UCT SAID block)       require_paid": _door(ask),
        "brainkb       kb-export rows leaving                     require_push_secret": _door(kb),
        "modelbook     drafts written for owner approval          require_owner": _door(drafts),
    }


def _init_product_schemas() -> list:
    """Create the non-wisdom tables the member doors read, so a door can actually ANSWER.

    ⛔ Schema only — no rows, no member data. A door that cannot be asked reports INCONCLUSIVE,
    which is a weaker claim than `shut` and must never be printed as one.
    """
    made = []
    for label, dotted, attr in (("education", "api.services.education_service", "_init_db"),
                                ("ai_search_memory", "api.services.ai_search_memory", "_init_db")):
        try:
            import importlib

            getattr(importlib.import_module(dotted), attr)()
            made.append(label)
        except Exception as exc:
            made.append(f"{label}:UNAVAILABLE({type(exc).__name__})")
    return made


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true",
                    help="also light every member gate, proving a door CAN report OPEN")
    args = ap.parse_args()

    root = sandbox()
    print(f"sandbox {root}")
    print(f"switches ON: {sorted(INGEST_ONLY)}  (every other WISDOM_*/ASKAI_WISDOM_* unset)")

    from api.services.wisdom.core import flags, store
    from api.services.wisdom.publish import chain

    store.init_db()
    made = seed(store)
    print(f"seeded {made['records']} records over {len(made['types'])} types: {', '.join(FOUR_TYPES)}")
    print(f"master switch on: {flags.ingest_enabled()}")

    steps = run_chain(chain)
    print("\n-- daily chain, INGEST only --")
    for s in steps:
        name = s.get("step") if isinstance(s, dict) else str(s)
        status = s.get("status") if isinstance(s, dict) else ""
        note = (s.get("note") or s.get("reason") or "") if isinstance(s, dict) else ""
        print(f"  {name:20s} {status:8s} {str(note)[:60]}")

    with store.read() as conn:
        counts = {t: conn.execute(f"SELECT COUNT(*) c FROM {t}").fetchone()["c"]
                  for t in ("wisdom_records", "wisdom_level_crosses", "wisdom_lookalike_scores",
                            "wisdom_kb_rows", "wisdom_review_queue")}
    print("\n-- what the chain wrote INSIDE wisdom.db --")
    for k, v in counts.items():
        print(f"  {k:26s} {v}")

    print(f"\nproduct schemas created for the door probes: {_init_product_schemas()}")
    print("\n-- what reaches a MEMBER (rows handed back; 0 = shut, ? = could not be asked) --")
    doors = member_doors()
    for door, n in doors.items():
        print(f"  {_label(n):13s} {door}")
    leaked = {d: n for d, n in doors.items() if isinstance(n, int) and n}
    unknown = [d for d, n in doors.items() if not isinstance(n, int)]
    verdict = "OPEN" if leaked else ("SHUT" if not unknown else "SHUT_WITH_GAPS")
    print(f"\nVERDICT (INGEST only, {counts['wisdom_records']} records present): "
          f"member doors {verdict}"
          + (f" — {len(unknown)} could not be asked" if unknown else ""))

    opened = []
    if args.self_check:
        print("\n-- SELF-CHECK: the same doors with their member gates LIT --")
        for env in ("WISDOM_DESK_MARKERS_ENABLED", "WISDOM_DOSSIER_ENABLED",
                    "ASKAI_WISDOM_RETRIEVAL_ENABLED", "WISDOM_BRAINKB_PUBLISH_ENABLED",
                    "WISDOM_MODELBOOK_DRAFTS_ENABLED", "WISDOM_RETRIEVAL_INDEX_ENABLED"):
            os.environ[env] = "1"
        # ⛔ Re-run what PRODUCES each door's rows, now that the gates are lit. Without this the
        # draft and index lanes read `shut` for an ordering reason — the chain had already run
        # with them dark — and a probe artifact would be published as a product fact.
        print(f"  re-ran producers with the gates lit: {_rerun_producers()}")
        lit = member_doors()
        for door, n in lit.items():
            print(f"  {_label(n):13s} {door}")
        opened = [d for d, n in lit.items() if isinstance(n, int) and n]
        print(f"\nself-check: {len(opened)} of {len(lit)} doors report OPEN when lit")
        if not opened:
            print("⛔ INCONCLUSIVE: no door could report OPEN, so 'every door shut' above proves "
                  "nothing — the instrument cannot see a presence.")
            return 2

    print(json.dumps({"verdict": verdict, "counts": counts,
                      "doors": {d.split()[0]: (n if isinstance(n, int) else "inconclusive")
                                for d, n in doors.items()},
                      "self_check_opened": len(opened)}, indent=1))
    return 0 if verdict.startswith("SHUT") else 1


def _rerun_producers() -> list:
    """The steps whose OUTPUT a door reads: the adapters (drafts, KB rows) and the search index.

    ⚠️ The Ask-AI door needs a third thing this rig does not have — membership of the
    `wisdom-askai` cohort, which is a row in auth.db's `user_tags` (rollout.py:135-138). It is
    reported as a stated limit rather than faked: the door has TWO independent gates and this
    rehearsal can only exercise one of them.
    """
    from api.services.wisdom import registry
    from api.services.wisdom.core import timeutil

    ctx = registry.JobContext(job_id="r50_selfcheck", now_et=timeutil.now_et(), due_key=None,
                              force=False, dry_run=False, run_id="r50-selfcheck")
    done = []
    for label, dotted, attr, args in (("adapters", "api.services.wisdom.publish.adapters", "run_daily", (ctx,)),
                                      ("retrieval", "api.services.wisdom.publish.retrieval", "refresh", (ctx,))):
        try:
            import importlib

            getattr(importlib.import_module(dotted), attr)(*args)
            done.append(label)
        except Exception as exc:
            done.append(f"{label}:FAILED({type(exc).__name__})")
    return done


def _label(n) -> str:
    if not isinstance(n, int):
        return "?  (n/a)"
    return f"{'OPEN' if n else 'shut':5s} {n:4d}"


if __name__ == "__main__":
    raise SystemExit(main())
