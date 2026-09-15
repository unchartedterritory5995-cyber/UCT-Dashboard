---
id: WISDOM-HARD-RULES
title: UCT Wisdom Loop — the owner's HARD RULES (§0.4), copied verbatim
status: verbatim copy — this file is NOT the authority, the source below is
---

# UCT Wisdom Loop — HARD RULES

⛔⛔ **THIS IS A COPY. The authority is the owner's Wave 1 GO, which is NOT in git.**

| | |
|---|---|
| source | `data/wisdom/WAVE1-PROMPT-v2.0.md` |
| lines copied | **15–24** (§0.4 in full) and **231** (§11.3, secrets) |
| source modified | 2026-09-13 10:57:58 |
| source size | 39,085 bytes, sha256 `46e279ff129352b4…` |
| source tracked by git? | **NO — gitignored** (`.gitignore:11: data/`) |
| copied | 2026-09-14, session 4, owner ruling **R1_HARD_RULES_FILE: YES** |

⚠️ **The source is gitignored because `data/wisdom/` is the programme's quote-bearing tree** —
paid transcript text and golden labels — which §0.4f itself forbids in git. That is a property of
the DIRECTORY, not of this text: the lines below are policy prose. Before copying them they were
scanned for double-quoted spans, dollar and bare-decimal price levels, share/contract counts,
credential-shaped literals, secret-name assignments, email addresses and @handles. **The only
match was the string `11.3` — the section number of the secrets rule itself** — confirmed against
a control proving the level detector still sees a real price on the same line. Nothing else
tripped, so the block is reproduced verbatim rather than redacted.

⛔ **If the source and this file ever disagree, the source wins and this file is the thing that
drifted.** It carries no authority of its own; it exists so a fresh clone of this public repo can
read the rules at all. Re-copy it rather than editing it in place.

⭐ The in-repo *restatements* are `docs/wisdom/PROGRAM-MANIFEST.md` §0 (12 standing rules) and
`docs/wisdom/CONTRACTS.md:110-121` (an off-limits path list LONGER than §0.4i's). Neither is the
owner's text. This file is.

---

## §0.4 — verbatim

```
0.4 Hard rules NOT subject to 0.1 — enforced in code, not settings, each with a CI + pre-merge check:
  a) Sunday Scans: published Substack post only, never drafts. Wisdom never imports the Substack publisher or the Sunday Scans publish/run/promo modules, never reads the saved Substack login, and you may not open substack.com in the browser under this program except to fetch a public post URL for a body-text diff (§2.3). The §0.9 import-ban check stands.
  b) Journal / J2 / Notebook / broker-synced fills are OUT OF SCOPE for reading, ingestion, matching, or search (Part 10).
  c) Nothing member-visible changes without a flag flip; flag flips are mine. (Notebook-program standing rulings on Notebook keys do not transfer here.)
  d) Private data from the content streams (position sizes, share counts, stated entry prices on open positions) lives in the owner-only private store and is import-banned from every member-facing module.
  e) No member messages are ever ingested. Only the authors in §2.1. Quoted or replied-to member text inside an author's message is stripped before storage.
  f) Public repo: no transcript text, golden quotes, private levels, positions, or credentials in git. gitignored data/wisdom/ only. Committed files carry locators (video id + cue timestamp; issue + section + paragraph) and paraphrases; verbatim quotes only from Sunday Scans (free, public).
  g) Paid content (Sunday Scans bodies, live-session and workshop transcripts) is served only to entitled members through the existing plan/role checks; during dark phases, admin cohort only via the S12 user_tags cohort predicate.
  h) One master merge at a time; Railway web SUCCESS before the next; ledger row per commit on program paths; docs/runbooks/deploy-windows.md is the deploy authority. Parallel BUILD is required (Part 8); parallel MERGE is not.
  i) Off-limits paths: app/src/pages/journal-2-0/, lib/offline/, OptionsFlow.jsx, the Discord render hardening program's files (docs/discord-render/, chart-renderer service), and the Data Charts overhaul files (app/src/pages/BreadthCharts.jsx, PresetRow.jsx, MetricReadout.jsx). Read through their APIs; never edit.
```

## §11.3 — verbatim (secrets)

```
11.3 Secrets stay in Railway env / the existing secret store; never in files; never printed in logs or reports.
```

---

## Appended notes — NOT part of the verbatim text above

⛔ Everything above this line is the owner's text, copied byte-for-byte. Everything below is this
programme's own record. Never edit upward across this line.

### 2026-09-14 — Q17: what "stability = 1.0 (3/3)" means as a rule

The Wave 1.5 item-3 publication floor is written in `SESSION-STATE.md` as *"no PRINCIPLE or
MARKET_SIGNAL publishes under a named author unless **stability = 1.0 (3/3)**"*. Session 4 found
that this phrasing has two readings that agree at N=3 and disagree elsewhere, and asked which
governs (Q17).

**Owner ruling, 2026-09-14 — `R17_VOTING_RULE: FLOOR`, `R17_MIN_RUNS: 3`.** The rule is:

> a record publishes only when `stability >= golden.STABILITY_FLOOR` **and**
> `stability_runs >= 3`.

⭐ **"3/3" is the N=3 INSTANCE of that rule, not a separate rule.** `stability` is
`runs_present / N`, so at N=3 the attainable values are 0, ⅓, ⅔ and 1 — and only **1.0** clears a
0.8 floor. The two spellings pick out exactly the same records at the intended run count.

⚠️ **They diverge above N=3, and FLOOR is what governs there.** At N=5 the attainable values
include **0.8**, so **4/5 passes** — a record present in four of five passes publishes. If that is
ever not what you want, this is the line to change, and changing it means changing the ruling, not
the code.

⛔ **`MIN_RUNS = 3` exists because a score is only a measurement if enough passes went into it.**
Without it `stability = 1.0` computed over a SINGLE run clears the floor — one run agreeing with
itself is not agreement, and 1/1 = 1.0 is the most confident-looking number the pipeline can
produce for the least evidence. A run count below the minimum, or an unrecorded one, is treated
exactly like NULL: it blocks.

**Where it lives:** `api/services/wisdom/publish/floor.py` — `MIN_RUNS` (one literal, no env
override, because a publication floor that can be lowered from the environment is not a floor) and
`floor_value()`, which reads `golden.STABILITY_FLOOR` and never restates it. All four enforcement
points consume that one predicate. Rails: `tests/test_wisdom_item3_floor.py`, including a
boundary test that pins the threshold to `STABILITY_FLOOR` exactly rather than to a near
neighbour, and behavioural tests at each of the four sites.
