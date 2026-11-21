# Rights clearances: one authoritative server store (design note, QA #793 round 3)

Status: PROPOSAL, 2026-11-04 (owner: write the redesign only; no implementation yet). No code yet. Brain stays OFF; nothing is cleared anywhere.

## Problem
Clearances live in `policy.json` and an audit log that ship through the repository, but the anchor that protects
them lives on whichever machine ran `apply`. Production's `/data` has no anchor, so production would serve nothing,
and the only fix (`reanchor`) trusts whatever files were deployed. Layering MACs over editable repository files keeps
producing new holes. (Volume and database access is trusted; see the trust model below.)

## Proposal
- **One store, on the production server:** `/data/kn_rights.db` (env `UCT_KN_RIGHTS_DB`). It has two tables:
  - `kn_cleared_rows`: `kb_id`, `content_sha`, the review refs, `approved_by`, `approved_on`, `applied_by`,
    `applied_at`;
  - `kn_rights_events`: append-only, recording every add, replace, revoke and bulk approval, with who and when.
- **That store is the source of truth.** The runtime (`kinds`) serves a cleared row only from it, and only while the
  row's current `content_sha` still matches. `policy.json` `cleared_rows` is ignored (removed). `bulk_clearance_approval`
  and the anchor, MAC chain and `reanchor` go away.
- **Writes only through the keyed CLI, run against production:** `apply`, `revoke` and `approve-bulk`, run in a shell
  INSIDE the production web container (`railway ssh` into the web service). Never `railway run`: that runs locally
  with production variables and would create the store on the local machine. Each write needs `UCT_KN_RIGHTS_KEY` (set only on the production service) and `--by NAME`.
  Each write is a single `BEGIN IMMEDIATE` transaction that enforces the per-run limit (10), the daily limit (20,
  counted from the events table, which cannot be trimmed from the repository) and the total limit (25, or a bulk
  approval's `max_rows` ≤ 200 with an expiry ≤ 90 days, itself an event written by the owner).
- **The repository holds an export only:** `export` writes the store's current clearances and events to
  `docs/agent/knowledge/cleared-rows.export.json` for review and history. The runtime never reads it.
- **Trust model, stated plainly:** access to the production volume or database is trusted, as it is for every other
  server table (accounts, alerts, transcripts). The store adds no cryptography against that access. The key stops
  anyone without production shell access, and any repository edit, from clearing anything. The events table is the
  audit trail. **The tool cannot verify that a human review happened; that is process, and the owner signs.**

## Authorization, tamper detection, recovery
- **Authorization:**
  - A write needs all three: a production shell (a trusted operator), `UCT_KN_RIGHTS_KEY` present on that service
    (the CLI refuses without it), and `--by NAME`. The name is recorded, not verified: it is an attribution, not an
    identity check.
  - No HTTP route writes the store, so the web surface gains nothing.
  - The runtime only reads the store.
  - Usage limits are enforced inside the same transaction as the write, from the events table, which is the record of
    usage: 10 per run, 20 per UTC day, 25 in total, or a bulk approval's `max_rows` up to 200.
- **Tamper detection (detection, not prevention):**
  - Each event row stores `prev_hash` and `hash = sha256(prev_hash + canonical row)`.
  - Every CLI write and a daily health check walk the chain and recompute the cleared set from the events.
  - A mismatch (an edited, deleted or reordered event, or a `kn_cleared_rows` row with no event behind it) does three
    things: the runtime serves NO cleared rows, the CLI refuses further writes, and the existing Agent health alert
    fires.
  - Someone with database access can still rewrite the whole chain consistently. That is the stated trust boundary,
    the same as for every other server table.
- **Recovery:**
  - A failed write rolls back as one transaction, leaving no half-written state.
  - A broken chain is resolved by the owner with `verify` (it names the first bad event) and then
    `rebuild --by NAME --reason TEXT`. `rebuild` re-derives `kn_cleared_rows` from the verified events up to the
    first break. Any row that ANY event after the break touches is treated as REVOKED, because the events after a
    break cannot be trusted to say it is still cleared, so a row revoked after the break is never restored. It records
    a `rebuilt` event, and never accepts state from the repository export.
  - The store is covered by the platform's volume backups like `/data`; a restore is a rollback the owner chooses
    knowingly.

## How it deploys
- The tables are created on the first write, and production starts empty: nothing is cleared, exactly as today.
- No migration is needed: no environment has a real clearance.
- With Brain OFF, no runtime path reads the store.
- The code changes: `rights.py` gets the store, the CLI and the runtime read; `kinds` reads the store. The anchor,
  MAC chain and policy-file writes are removed. Tests move to a temporary database. The worksheet / validate flow and
  the 10 / 20 / 25 / 200 limits are unchanged.

## How the owner clears a row in practice
1. In a shell inside the production web container (`railway ssh`): `python tools/kn_rights_review.py worksheet --kb-id N --out /tmp/kbN.json`. This is the
   production pack, so the reviewed text and its sha are what will be served. Read the row's text there.
2. Do the provenance and rights review (outside the tool). Fill the decision: `clear`, refs, name, date.
3. `python tools/kn_rights_review.py apply /tmp/kbN.json --by "Owner Name"` validates, enforces the limits, and writes
   the row and an event in one transaction.
4. `python tools/kn_rights_review.py export`, then commit the export through a normal PR, for the record.
5. To withdraw it: `revoke --kb-id N --by NAME --reason TEXT`. The row stops being served at once, and the event
   stays.

## A minimal Brain without the Rights subsystem (owner question, 2026-11-04)
**Configuration:**
- `UCT_AGENT_KNOWLEDGE=1`, `UCT_AGENT_DATA=1` and `UCT_AGENT_DATA_KINDS=knowledge.search` only;
- the shipped `policy.json`;
- `UCT_KN_RIGHTS_KEY` UNSET and no rights store;
- for any member-facing answer, also E-1 from #781 (`UCT_AGENT_KN_E1=1` plus a pack), see below.

**Dependency boundaries, demonstrated in `tests/test_uct_agent_kn_minimal.py`:**
- **Rights readers at runtime:**
  - `knowledge.search`: `kinds._blocked_snapshot` → `rights.authorized()`. With no key it returns `{}`, so every row
    naming an excluded setup stays withheld, even when `policy.json` lists a "cleared" row (a forged entry is tested).
  - `setup.playbook`: `policy.classify_template` → `rights_cleared_concepts`, which is empty in the shipped policy.
  - `setup.record` reads no rights.
- **What serves:** only the admitted, team-owned sources (`setup_knowledge`, `trader_archive`), with
  `licence = team_owned`. Never intake, self-review, manual, chart-intake, Wisdom or unknown sources; never rows naming
  an excluded (third-party or unresolved) setup; never excluded categories.
- **Writes:** none. No rights code path writes in this configuration; no anchor or log is created (tested).
- **Template and record kinds** are not served at all: they are not in the data kinds (tested). So no third-party
  template and no unattested statistic can appear.

**Positive controls (QA round 4):** a legitimately edited policy DOES change serving, and the shipped one does not.
This is tested for each of these fields: admitting a source (`self_review`), `excluded_setup_mentions.mode =
serve_flagged` (commentary rows only; a definitional row never), adding an origin to `team_origins`, and a complete
`rights_cleared_concepts` entry (an incomplete one changes nothing). So the negative tests are meaningful. **These
fields carry no key: `policy.json` is the reviewed source policy, and PR review of every change to it is the gate.**
Only `cleared_rows` moves to the authoritative store in this design.

**Minimal mode enforces it in code (owner, 2026-11-04):** `UCT_AGENT_KN_MINIMAL=1` pins the baseline in code and
ignores every `policy.json` field that could widen serving without a verified path:
- sources beyond `setup_knowledge` / `trader_archive`;
- extra `team_origins`;
- `rights_cleared_concepts`;
- `serve_flagged`;
- `cleared_rows`, which are ignored even when signed, with the key and an anchor.

Setup templates and records are refused even if listed in the data kinds. `policy.json` may still NARROW.
- **Fail-closed switch:** unset or an off-word (`0`, `false`, `off`, `no`) means off. ANY other value (`enabled`, `Y`,
  `2`, ...) means ON.
- **The other fields minimal mode would read are pinned, so they can only narrow:** excluded categories (TEST is always
  excluded), dated categories (MACRO / REGIME / SECTOR are always dated), the maximum age of dated rows (never above
  30 days), and trader attribution aliases (the pinned baseline; `policy.json` aliases are ignored). Tested, with a
  positive control that the same edits do change these values with minimal mode off.

Tests (`test_minimal_mode_*`): each edit is served with minimal mode off (positive control) and blocked with it on.
So the block, and nothing else, is what stops it.

**What this does NOT show:**
- Answer safety. With Brain on and E-1 off, the planner can still write a definition in its own words.
- A member-facing test therefore needs E-1 (#781) as well. Otherwise use admin-only direct reads of
  `knowledge.search`, which is a retrieval test.

**Independence:**
- Every path is dark behind `UCT_AGENT_KNOWLEDGE` (plus `UCT_AGENT_KN_E1` for E-1). Nothing in the Rights or Brain
  code runs with those flags off.
- The only shared code touched is `budget.Meter.call(counts_as_call=…)`, already on master. Brain blocks no other
  Agent feature.

## Decision needed
Approve this design (or amend it) before it is built. Until then #793 stays as it is: dark, nothing cleared.
