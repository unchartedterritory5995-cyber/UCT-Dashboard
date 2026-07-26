"""Nightly rule-learner — turns the owner's free-text catalyst notes into
DURABLE curator rules, automatically, at EOD.

The owner's ✎ notes already auto-steer the live list through a rolling 14-day
window (`curator._owner_notes_block`). This closes the loop the owner asked for:
each EOD, recurring THEMES in those notes get distilled into PERMANENT rules the
curator reads on every curation — the same thing a human would do by hand (as
with the 2026-07-24 "cut completed cash acquisitions" rule), but automatic.

DESIGN — autonomous but not dangerous (the owner picked "fully autonomous"):
  - Rules live in the DATABASE (`catalyst_learned_rules`), NOT in code. So the
    loop NEVER edits source or deploys — a bad rule is reverted by flipping one
    row's `active` flag, no redeploy, no git.
  - BOUNDED: at most `CATALYST_LEARNED_RULES_MAX` (default 12) active rules; the
    distiller is shown the existing set and told to REFINE/MERGE rather than
    duplicate, and to propose retirements for rules the new notes contradict.
    Over the cap, the oldest rules are retired first.
  - DEDUPED: a proposed rule too similar (token overlap) to an existing active
    rule is skipped, so the set can't bloat with rephrasings.
  - OBSERVABLE: every run posts a Discord report (learned / retired / reviewed).
  - KILLABLE: `CATALYST_RULE_LEARNER_ENABLED=0` stops learning;
    `CATALYST_LEARNED_RULES_ENABLED=0` stops the curator applying them. Either is
    an instant, no-deploy revert.
  - Never raises; cost-guarded (one Sonnet-5 call per run, only when new notes
    exist — near-zero on a day with no notes).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Optional

from api.services.catalyst import cost_guard, store

logger = logging.getLogger(__name__)

# Reuse the curator's model for the distillation (strong judgment, cheap).
LEARNER_MODEL = os.environ.get("CATALYST_RULE_LEARNER_MODEL",
                               os.environ.get("CATALYST_CURATOR_MODEL", "claude-sonnet-5"))


def _enabled() -> bool:
    return os.environ.get("CATALYST_RULE_LEARNER_ENABLED", "1").lower() in ("1", "true", "yes")


def _intenv(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


_SYSTEM = """You maintain the DURABLE RULEBOOK for a swing-trading desk's catalyst-list curator. The head trader leaves short free-text notes on individual catalyst rows telling you what they do and don't want to see. Your job: turn RECURRING, GENERALIZABLE preferences in those notes into a small set of permanent curator rules.

A good learned rule:
- captures a GENERAL preference, not a one-off reaction to a single ticker ("cut completed all-cash acquisitions — the trade is over once the deal price is set" is good; "I don't like SAFT" is not);
- is specific enough that the curator can act on it (name the trait: setup type, catalyst type, market-cap band, sector, move size, etc.);
- is phrased as a directive to the curator (KEEP / CUT / RANK-UP / RANK-DOWN …).

STRICT rules for your output:
- Only propose a rule when the notes show a REAL, repeated or clearly-generalizable preference. One vague note is NOT enough — prefer proposing nothing over inventing a rule.
- You are shown the EXISTING active rules. Do NOT duplicate them. If a new note REFINES or CONTRADICTS an existing rule, propose retiring that rule (by id) and, if needed, a replacement.
- Never propose a rule that would gut the list (e.g. "cut all earnings") from thin evidence.
- Keep each rule to one or two sentences.

Output ONLY compact JSON:
{"new_rules": [{"rule": "...", "rationale": "why, citing the note(s)"}], "retire_ids": [12, 7]}
- new_rules: [] when the notes don't justify any permanent rule (this is the common case).
- retire_ids: ids of existing rules the new notes make obsolete or contradict; [] if none.
No prose, no fences — only the JSON object."""


def _norm(s: str) -> set[str]:
    """Token set of a rule for cheap similarity dedup."""
    return set(re.findall(r"[a-z0-9]+", (s or "").lower()))


def _too_similar(candidate: str, existing_texts: list[str]) -> bool:
    """True if `candidate` overlaps an existing rule too much to be worth adding."""
    cand = _norm(candidate)
    if not cand:
        return True
    thresh = float(os.environ.get("CATALYST_LEARNED_RULES_DEDUP", "0.6"))
    for ex in existing_texts:
        et = _norm(ex)
        if not et:
            continue
        overlap = len(cand & et) / max(1, len(cand | et))
        if overlap >= thresh:
            return True
    return False


def _build_prompt(notes: list[dict], active_rules: list[dict]) -> str:
    rules_block = "\n".join(
        f"  [id {r['id']}] {r['rule_text']}" for r in active_rules
    ) or "  (none yet)"
    note_lines = []
    for n in notes:
        t = (n.get("ticker") or "?").upper()
        md = n.get("market_date") or ""
        ctype = n.get("catalyst_type") or n.get("tag") or "?"
        gap = n.get("gap_pct")
        gap_s = f", gap {gap:+.0f}%" if isinstance(gap, (int, float)) else ""
        txt = (n.get("note") or "").strip().replace("\n", " ")[:400]
        note_lines.append(f'  - ${t} ({md}, type={ctype}{gap_s}): "{txt}"')
    return (
        f"EXISTING ACTIVE RULES:\n{rules_block}\n\n"
        f"NEW TRADER NOTES since the last run ({len(notes)}):\n"
        + "\n".join(note_lines)
        + "\n\nDistill any durable, generalizable preferences into rules. "
          "Output the compact JSON now."
    )


def _call_llm(prompt: str) -> Optional[dict]:
    """One distillation call. Returns parsed JSON dict or None. Never raises."""
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        kwargs = dict(
            model=LEARNER_MODEL,
            max_tokens=_intenv("CATALYST_RULE_LEARNER_MAX_TOKENS", 1200),
            temperature=0.2,
            thinking={"type": "disabled"},
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        try:
            msg = client.messages.create(**kwargs)
        except Exception as e:
            es = str(e).lower()
            dropped = False
            if "thinking" in es:
                kwargs.pop("thinking", None); dropped = True
            if "temperature" in es:
                kwargs.pop("temperature", None); dropped = True
            if not dropped:
                raise
            msg = client.messages.create(**kwargs)
        text = "".join(getattr(b, "text", "") or "" for b in msg.content).strip()
        try:
            in_tok = msg.usage.input_tokens
            out_tok = msg.usage.output_tokens
        except Exception:
            in_tok = out_tok = 0
        obj = _extract_json(text)
        if obj is not None:
            obj["_in_tok"] = in_tok
            obj["_out_tok"] = out_tok
        return obj
    except Exception:
        logger.exception("[rule-learner] LLM call failed")
        return None


def _extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.rstrip().endswith("```"):
            t = t.rsplit("```", 1)[0]
    start, depth, in_str, esc = t.find("{"), 0, False, False
    if start == -1:
        return None
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except (json.JSONDecodeError, ValueError):
                    return None
    return None


def _post_discord(learned: list[str], retired: list[int], reviewed: int,
                  active_total: int, note: str = "") -> None:
    """Best-effort daily report of what the learner did. Never raises."""
    if os.environ.get("CATALYST_RULE_LEARNER_DISCORD", "1").lower() not in ("1", "true", "yes"):
        return
    try:
        from api.services import discord_notify
        fields = [{"name": "Notes reviewed", "value": str(reviewed), "inline": True},
                  {"name": "Active rules", "value": str(active_total), "inline": True}]
        if learned:
            fields.append({"name": f"➕ Learned ({len(learned)})",
                           "value": "\n".join(f"• {r[:180]}" for r in learned)[:1000],
                           "inline": False})
        if retired:
            fields.append({"name": f"➖ Retired ({len(retired)})",
                           "value": ", ".join(f"#{i}" for i in retired)[:300],
                           "inline": False})
        if note:
            fields.append({"name": "Note", "value": note[:300], "inline": False})
        desc = ("The catalyst curator taught itself from your notes tonight. "
                "Rules live in the DB — revert any with "
                "`POST /api/admin/catalyst-learned-rules/{id}/retire`, or freeze "
                "learning with `CATALYST_RULE_LEARNER_ENABLED=0`.")
        discord_notify._send_webhook({
            "title": "🧠 Catalyst rule-learner — nightly report",
            "description": desc,
            "fields": fields,
            "color": 0x4AAE8C if learned else 0x888888,
        })
    except Exception:
        logger.debug("[rule-learner] discord post failed", exc_info=True)


def run_learn(now: Optional[int] = None) -> dict:
    """Read notes written since the last run, distill durable rules, store them
    (deduped + capped), retire contradicted rules, advance the watermark, and
    report to Discord. Returns a summary dict. NEVER raises."""
    summary = {"enabled": _enabled(), "reviewed": 0, "learned": [],
               "retired": [], "active_total": 0, "skipped_dup": 0}
    if not _enabled():
        return summary

    now = int(now if now is not None else time.time())
    try:
        state = store.get_learn_state()
        watermark = int(state.get("last_note_ts") or 0)
        max_notes = _intenv("CATALYST_RULE_LEARNER_MAX_NOTES", 60)
        notes = store.get_notes_since(watermark, limit=max_notes)
        summary["reviewed"] = len(notes)

        if not notes:
            store.set_learn_state(watermark, now)  # advance run time only
            summary["active_total"] = len(store.get_active_learned_rules())
            return summary

        # Cost gate: reuse the catalyst daily cap. If synthesis is capped out,
        # DON'T advance the watermark — retry the same notes tomorrow.
        market_date = time.strftime("%Y-%m-%d", time.gmtime(now))
        if not cost_guard.may_synthesize(market_date):
            logger.info("[rule-learner] cost cap reached; deferring %d notes", len(notes))
            return summary

        active = store.get_active_learned_rules()
        active_texts = [r["rule_text"] for r in active]
        active_ids = {int(r["id"]) for r in active}

        result = _call_llm(_build_prompt(notes, active))
        newest_ts = max(int(n.get("created_at") or 0) for n in notes)

        if result is None:
            # LLM failed — do NOT advance the watermark (retry these notes next run).
            _post_discord([], [], len(notes), len(active),
                          note="distillation call failed — will retry tomorrow")
            summary["active_total"] = len(active)
            return summary

        cost_guard.record(market_date, "_RULE_LEARNER", LEARNER_MODEL,
                          result.get("_in_tok", 0), result.get("_out_tok", 0),
                          was_cached=False)

        # ── retire contradicted rules ───────────────────────────────────
        retired = []
        for rid in (result.get("retire_ids") or []):
            try:
                rid = int(rid)
            except (TypeError, ValueError):
                continue
            if rid in active_ids and store.retire_learned_rule(rid):
                retired.append(rid)
                active_ids.discard(rid)
                active_texts = [r["rule_text"] for r in active
                                if int(r["id"]) not in retired]

        # ── add new rules (deduped) ─────────────────────────────────────
        learned = []
        for item in (result.get("new_rules") or []):
            rule = (item.get("rule") or "").strip() if isinstance(item, dict) else ""
            if not rule or len(rule) < 8:
                continue
            if _too_similar(rule, active_texts):
                summary["skipped_dup"] += 1
                continue
            rationale = (item.get("rationale") or "") if isinstance(item, dict) else ""
            src = {"tickers": sorted({(n.get("ticker") or "").upper()
                                      for n in notes if n.get("ticker")}),
                   "note_count": len(notes)}
            rid = store.add_learned_rule(rule, rationale, src)
            if rid:
                learned.append(rule)
                active_texts.append(rule)

        # ── enforce the cap (retire oldest active beyond the limit) ─────
        cap = _intenv("CATALYST_LEARNED_RULES_MAX", 12)
        current = store.get_active_learned_rules(limit=200)
        if len(current) > cap:
            # oldest first
            for r in sorted(current, key=lambda x: x["created_at"])[:len(current) - cap]:
                if store.retire_learned_rule(int(r["id"])):
                    retired.append(int(r["id"]))

        store.set_learn_state(newest_ts, now)
        active_total = len(store.get_active_learned_rules())
        summary.update(learned=learned, retired=retired, active_total=active_total)
        _post_discord(learned, retired, len(notes), active_total)
        logger.info("[rule-learner] reviewed=%d learned=%d retired=%d active=%d",
                    len(notes), len(learned), len(retired), active_total)
        return summary
    except Exception:
        logger.exception("[rule-learner] run_learn failed (non-fatal)")
        return summary
