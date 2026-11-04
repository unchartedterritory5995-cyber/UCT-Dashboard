# R-07 — Production Agent flags: what was on before Wave 1, and since when

Read-only record (no Railway writes). Sources: the read of `railway variables --service web` at 2026-11-03 ≈04:45Z (this session), the session memory notes of earlier sessions, agent-lead's messages of 2026-11-03 02:1xZ, and the program docs. Railway keeps no variable history readable here, so "since when" is bounded by observations.

| Variable | Value observed 11-03 04:45Z | Last observed OFF / unset | Earliest evidence of ON | Who / why (as far as recorded) |
|---|---|---|---|---|
| `UCT_AGENT_SCAN` | `1` | 11-02 (Sprint 2 RC shipped flags-off) | 11-03 01:52Z (agent-lead: "scans have been ON since 01:52Z, owner decision") | owner, in agent-lead's session; owner re-confirmed keeping it on until the RC shipped F-16 ("Keep the fix up, keep the scans thing up") |
| `UCT_AGENT_DATA` + `UCT_AGENT_DATA_KINDS` (all 11 kinds incl. `bars.daily`, `fundamentals`, `earnings`, `news.company`, `themes`, `screen.*`) | `1` / full list | 11-02 19:16Z (News session verified "4 flags OFF") | 11-03 04:45Z (this session's read) | set between 19:16Z and 04:45Z, outside this session — presumably the same owner/agent-lead activation that turned scans on (the scan kinds require `UCT_AGENT_DATA=1`) |
| `UCT_AGENT_NEWS` | `1` | 11-02 19:16Z ("UCT_AGENT_NEWS OFF, verified" when #692 went live dark) | 11-03 04:45Z | same window; not recorded in any program doc; #692's "pending QA verdict" was never recorded |
| `UCT_AGENT_STREAM` | `1` | docs: "streaming deploys dark (`UCT_AGENT_STREAM` unset)" (LATENCY.md, 10-12) | 11-03 04:45Z | same window or earlier; behaviour-preserving transport |
| `UCT_AGENT_NL1` | `1` | 10-25 (NL-1 hybrid "flags OFF", re-verified on prod) | 11-03 04:45Z | unknown; inactive in practice unless a browser also sets `uct.agent.nl1='1'` (this browser: unset) — but ON server-side means any admin browser with the key gets the model-first interpreter, which was never real-model evaluated |
| `AGENT_BREADTH_CURRENT` | `1` | — | 10-12 17:57Z (memory: activated by the owner's session) | owner, 10-12 |
| `UCT_AGENT_DAILY_CAP` | `3000` | — | 10-08 (memory: cap raised to 3000, owner OK; "dev-only") | owner, 10-08 — note: this is the per-member request cap, not the $5 ledger |
| `UCT_AGENT_PLANNER` | unset (v1) | — | — | correct; v2 off |
| `UCT_AGENT_ISOLATED` | unset | — | — | correct; ratings / breadth.current kinds dormant |

## Consequences recorded
- The Wave 1 manifest's proposed activation order (stream → quote kinds → news → bars.daily → scan) was already overtaken: everything was on before the RC, including `bars.daily` (before F-23 was live) and scans (before F-16 enforcement was live; owner-accepted interim exposure). After the RC both protections are live, so the current configuration is now consistent with the plan's end state.
- `UCT_AGENT_NL1=1` server-side is the one setting the owner may not have intended: recommend confirming or unsetting (no effect on browsers without the local key; this session's Phase 1 ran with NL-1 inactive).
- `UCT_AGENT_DAILY_CAP=3000` requests/member/day is far above the $5/day ledger's reach at today's ≈$0.015/call; the ledger is the binding limit. Recommend lowering the request cap back to 300 when member rollout is considered.
- No flag was changed by the Wave 1 program at any point.

## `charts_active_template` (owner's active chart template preference)
Phase 1 saw the preference's hash change (`f072cbec3bf88418` → `e076f92e8c0b5ede`) during the test-layout create/save. The value will be read back (read-only) in the Wave 1.1 live rerun and compared with the template list; nothing writes it.
