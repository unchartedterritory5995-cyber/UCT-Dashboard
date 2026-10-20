# NL-1: routes to real-model evaluation (audit, 2026-10-16)

This was a read-only audit. No key value was read, printed, copied or used: only variable **names**, docs and code were checked.

## What exists

| Candidate | Finding | Usable for NL-1 eval? |
|---|---|---|
| `ANTHROPIC_API_KEY` | UCT's production key (`.env.example`, Railway production) | **No.** It is production; the owner forbids it |
| `WISDOM_ANTHROPIC_API_KEY` | a separate credential that the wisdom extraction programme carries for itself (`api/services/wisdom/extract/batch.py`) | **No.** It belongs to another programme; repurposing it is not legitimate |
| Hub sandbox (`scripts/hub_sandbox_boot.py`) | deliberately **strips** model keys; `HUB_SANDBOX_ALLOW_MODEL_KEYS=1` would just pass through whatever production key is present | **No.** It is not a separate budget |
| A staging / preview environment | none in the deploy runbooks; Railway has the one `production` environment | **No** |
| `ant` CLI profile | not installed | **No** |
| `UCT_AGENT_EVAL_API_KEY` | the runner's separate eval key | **Yes, when configured.** Not set anywhere on this PC (checked 2026-10-16, presence only) |

## The one no-key option: Claude Code as a stand-in interpreter (needs owner approval)

A Claude Code subagent can be given the **exact NL-1 system prompt, context and message** (from the free capture) and asked to return the envelope JSON. Its output is then scored by the same free scorer.

- **Cost:** no API bill. It uses this Claude Code plan's usage. Each request is about 24k tokens of input.
- **Permissions:** this session's own login. No UCT key, no production system, nothing executed.
- **Limitations** (why it can't replace the real evaluation):
  - **Not the same model or settings.** The subagent's model tiers can be chosen, but its sampling, structured-output enforcement, system wrapping and caching are not the API's. Accuracy is indicative only.
  - **It measures nothing about cost, latency, caching or reasoning tokens.** Those are half of what the real trial measures.
  - **No structured-output guarantee,** so malformed JSON counts as a failure that the API would not produce.
  - It would be a Claude session reading prompts written by a Claude session, so there is a risk of shared blind spots.
- **Safety controls if approved:**
  - dev sets only, never sealed;
  - each subagent gets no tools beyond reading its one input file;
  - results are written to the scratchpad, never committed;
  - at most 10–40 requests;
  - reported as **proxy** results, never as NL-1's acceptance numbers.

**Recommendation.** Useful only as a cheap smoke test of the NL-1 prompt's wording on dev cases while the eval key is pending. The real gate stays the API trial T1 → T2/T3 → full eval with `UCT_AGENT_EVAL_API_KEY`, which remains a **release requirement**.

## The legitimate path to real-model evaluation
1. The owner, or the partner, creates an Anthropic Console workspace "UCT Agent eval" with a spend limit, and a key in it ([NL1-TRIAL.md](NL1-TRIAL.md) has the steps).
2. The key is set as the user-scope variable `UCT_AGENT_EVAL_API_KEY`, never pasted in chat.
3. The owner confirms the workspace and its limit. Then T1 runs (cap $0.10), and only after a report and a fresh authorization, T2 and T3, then the full eval (≤ $45 in total).
