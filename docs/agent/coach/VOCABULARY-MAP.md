# UCT Agent coach — vocabulary map (coach concepts → Trading Brain setup templates)

**Owner rule (2026-11-03):** the Wisdom vocabulary is authoritative, and the Trading Brain kinds
(`knowledge.search`, `setup.playbook`, `setup.record` — PR #735, flag `UCT_AGENT_KNOWLEDGE`) are the source of
UCT's setup definitions. The coach's 13 curated concepts (`concepts/*.md`) are **generic trading education**;
they never define a UCT setup. When a member asks about a named setup, the answer comes from the Brain
(`setup.playbook`), not from a coach note.

This map ties each coach concept to the Brain's **canonical template names** it is related to, so that
(a) the coach can point at the right template, and (b) a reviewer can see at a glance that no coach note
restates or contradicts a template. Names are copied exactly from the Brain's 48 canonical templates; nothing
here is a definition. "Related" means the concept is background a member needs to read that template —
not that the concept describes it.

| Coach concept (slug) | Related Brain templates (canonical names) |
|---|---|
| `breakouts-and-failure` | Stage 2 Breakout, Green Line Breakout, Pocket Pivot, Power Play, U&R, Oops Reversal, Stage 4 Breakdown |
| `consolidation-tightness` | VCP, Tight Flag, HTF, Flat Base, Base-on-Base, Cup with Handle, Low-Cheat, Launchpad, Box Theory, Rectangle, Ascending Triangle, Descending Triangle, Symmetrical Triangle |
| `drawdown` | generic education — no template |
| `earnings-gaps` | EP, BGU, Gap-and-Go, Open Bull Gap Support, Kicker Candle, PEG |
| `expectancy` | generic education — no template (a template's historical record is `setup.record`, never this note) |
| `market-conditions-breadth` | FTD, Go Signal |
| `moving-averages-context` | 20EMA Hold, EMA Crossback, EMA Crossover, Remount, Wedge Pop, Mean Reversion, Stage 2 Momentum |
| `price-action-basics` | Red to Green, Kicker Candle, HVC, Late-Stage Climax, Parabolic Short, Measured Move |
| `relative-strength` | Stage 2 Momentum, Power Play, HTF |
| `risk-per-trade-position-sizing` | generic education — no template (each template's max stop comes from `setup.playbook`) |
| `stop-placement` | generic education — no template (each template's stop methods come from `setup.playbook`) |
| `support-resistance` | Double Bottom, Head & Shoulders, Rectangle, Box Theory, Open Bull Gap Support, Measured Move |
| `volume-relative-volume` | Pocket Pivot, HVC, Wyckoff Accumulation, Wyckoff Distribution, Wyckoff SOS, Wyckoff LPSY, Short Squeeze |

## Templates with no coach concept

7-Week Short Rule — no coach concept covers it; the Brain's template is the only source.

All other 47 canonical names appear in at least one row above (a name may sit under more than one concept).

## Aliases and near-overlaps with the Wisdom vocabulary

The Wisdom vocabulary (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`) is authoritative. A coach alias must never
capture a word that names a Wisdom setup or a UCT tool, so these aliases were **dropped** (W3 review, 2026-11-03):
`flag`, `breakdown`, `false breakout`, `gap up`, `gap and go`, and the bare generic words `volume`, `stop`, `stops`,
`support`, `levels`, `base`, `edge`, `ma`, `rs`, `breadth`, `tape`, `leader` (they also made ordinary chart commands
such as "add volume" or "move my stop" coach turns). Railed by `tests/test_uct_agent_coach.py`.

Near-overlaps that remain (a coach concept is background for these Wisdom setups; it never defines them — the setup
question goes to the Brain):

| Wisdom setup | Coach concept nearby | Note |
|---|---|---|
| `vcp` | `consolidation-tightness` (tight range, range contraction, coiling) | Brain template VCP is the definition |
| `20ema_tap` | `moving-averages-context` | Brain template 20EMA Hold |
| `high_volume_close` | `volume-relative-volume` (volume spike) | Brain template HVC |
| `follow_through_day` | `breakouts-and-failure` (the doc's "follow-through"), `market-conditions-breadth` | Brain template FTD |
| `undercut_and_rally` | `stop-placement` (the doc's "undercut ... shakeout") | Brain template U&R |
| `earnings_gap_up` | `earnings-gaps` | Brain template PEG (approximate) |
| `open_bull_gap` | `earnings-gaps` | Brain template Open Bull Gap Support |
| `range_breakout` | `breakouts-and-failure`, `consolidation-tightness` | Brain templates Flat Base, Rectangle (both approximate) |
| `failed_breakdown`, `breakout_retest` | `breakouts-and-failure` | "breakdown" alias dropped |
| (none) | `earnings-gaps` | Brain templates EP and Gap-and-Go have NO Wisdom vocab_id (agent-kn, 2026-11-03) |
| Wyckoff accumulation / distribution | `volume-relative-volume` (aliases `accumulation`, `distribution`) | generic volume sense only; the Wyckoff templates are the Brain's |

## How the coach uses the Brain (W3-4b)

`coach.explain` **prefers a Brain passage**: when the server serves the gateway kind `knowledge.search`
(`/api/agent/config` lists it in `data_kinds`, which needs `UCT_AGENT_DATA`, the kind enabled and
`UCT_AGENT_KNOWLEDGE=1`), the answer leads with the top approved passage — read strictly through the gateway
(`app/src/agent/coach/brain.js` → `marketdata/client.readData`, the open turn's id; the coach never imports the knowledge package) — and the
curated coach note follows as the generic background. The combined text passes the same mirror guard (its
inputs are exactly the passage and the note); if the guard would replace it, if the read is refused, empty or
fails, or if the kind is not served, the answer is exactly the curated note as before.

### Owner decision N5 (2026-11-03): named setups are taught FROM the playbook

The approved UCT playbook (`setup.playbook`, `knowledge.search`) and the Wisdom vocabulary are authoritative for
setup definitions and methodology. The coach does educational interpretation, interactive teaching and helping the
member apply those definitions — **no competing setup definitions**.

- When the topic names one of the 48 templates (`coach/brain.js` `setupNamed`; EP and PEG only in capitals),
  `coach.explain` reads `setup.playbook` (when served) and teaches FROM the template: its own fields (what it is,
  entry, stop, invalidation, common mistakes), cited as UCT's setup template with the Setup Library link, then an
  "Applying it" paragraph. No approved definition (not served / refused / guard-replaced) → the answer first says
  plainly "UCT can't currently retrieve an approved playbook definition for <setup>" and never invents one; then the
  closest approved `knowledge.search` passage (cited) when served. A concept note may follow ONLY under the heading
  "General background (not the UCT playbook definition):", and only when the
  source policy allows it (the note exists, is a generic concept note, and names no setup). Otherwise: the
  statement only.
- **What `setup.playbook` actually serves (agent-kn, N3):** only 8 templates are served — 20EMA Hold, Go Signal,
  HVC, Open Bull Gap Support, Red to Green, Remount, Tight Flag and U&R. The other 40 are refused, so "UCT can't
  currently retrieve an approved playbook definition for <setup>" is the EXPECTED answer for them. For EP, VCP,
  HTF and similar, the fallback `knowledge.search` passage will usually be a team post, not a playbook entry (it is
  cited as a passage, never presented as the definition).
- Setup names (review B4): the 48 canonical names AND their spelled-out forms (power earnings gap → PEG, episodic
  pivot → EP, volatility contraction pattern → VCP, undercut and rally → U&R, follow-through day → FTD, cup and
  handle → Cup with Handle …), matched LONGEST form first. **Ambiguous forms** (agent-kn, overrides the earlier B4
  note): "high tight flag" is an alias of BOTH HTF and Tight Flag and `setup.playbook` refuses it as ambiguous, so
  the coach resolves it to neither — no read, no background: the no-definition statement and "which one do you
  mean?" (`SETUP_AMBIGUOUS`). The lists live in `app/src/agent/coach/brain.js` and `api/services/uct_agent/coach/setups.py` (a pytest
  keeps them identical). Every matched form takes the playbook path; none reaches a plain concept-note answer.
- Model-written replies (server, deterministic): a coach reply that DEFINES a named setup ("A VCP is a …",
  "High tight flag: …", "In a VCP, price …", "VCPs form when …", "The VCP pattern is a …") is replaced
  (`coach_guard` code `definition`) unless coach.explain taught THAT template from `setup.playbook` earlier in the
  conversation, as its stored citation marker shows (`setup template "VCP"`). Free text never counts as a citation:
  "UCT's playbook", "approved playbook", a copied template header or team commentary (#751 B-1).
- The 13 concept docs stay generic education (price action, volume, risk, sizing, market conditions …): a test
  fails if any concept file names a canonical template.
- Routing: the coach group's words and the `coach.explain` fast path cover COACHING phrasings ("coach me on",
  "teach me", "help me understand how to apply", "quiz me on", "walk me through"), not bare "what is X?" questions —
  those belong to the playbook group (agent-kn). The server coach block tells the model the same.

## Keeping it honest

- The template names are checked against this file by `app/src/agent/agentCoachVocab.test.js`: every name in
  the table is one of the 48 canonical names, every concept slug is a real `concepts/*.md`, and every
  canonical name appears here.
- A concept note must never redefine a template. If the Brain renames or adds a template, update this table
  (and the canonical list in the test) in the same change.
- Mapping is by name and meaning as the coach team reads it; the Brain owner (agent-kn) reviews it.
