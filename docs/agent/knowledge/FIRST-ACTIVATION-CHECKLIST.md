# Before the FIRST safe Brain activation test (admin-only, minimal configuration)

Status: 2026-11-04. Brain is OFF everywhere. E-1 (#781) is merged DARK (`e6690e67f1`). Nothing below is done unless marked.

| # | Item | Blocker | Owner | Paid call? |
|---|---|---|---|---|
| 1 | Minimal mode merged (`UCT_AGENT_KN_MINIMAL`, this branch #793) | independent QA, then a dark merge | AUDIT, then the owner | no |
| 2 | E-1 reroute judge-cache follow-up (`b267586cb4`, after the #781 merge) | a small PR plus review | AUDIT | no |
| 3 | Transcript storage for Brain answers: citation only (#794 `UCT_AGENT_KN_RETENTION`) | #794 merge, plus the owner's retention decision (period, pinned chats, account deletion) | owner | no |
| 4 | Provider checks A1–A3 (Anthropic retention / ZDR), plus P1–P3, R1–R3, S1 | owner-only account checks (RETENTION-CODE.md) | owner | no |
| 5 | Production pack and index present and healthy (`/data/agent_knowledge_health.json` counts; build id stable) | an ops check after deploy | AUDIT / ops | no |
| 6 | Judge accuracy on the reviewer's SEALED hidden-method set (today: deterministic checks 7/16 blocked; the judge is unmeasured) | the owner authorizes a small paid run | owner, then the reviewer | **yes** (about 16 judge calls, under $0.01) |
| 7 | Classifier and judge eval: the labelled set (≥ 600 playbook-class prompts, 0 misses) plus the seed files | budget approval | owner | **yes** |
| 8 | Live admin acceptance on a dark admin flag, with the same prompts, before any member | items 1–7 | owner | **yes** (admin turns) |
| 9 | Switches for the test, admin-only (the Agent is admin-only while dark): `UCT_AGENT_KNOWLEDGE=1`, `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=knowledge.search`, `UCT_AGENT_KN_MINIMAL=1`, `UCT_AGENT_KN_E1=1`, `UCT_AGENT_KN_RETENTION=1`; `UCT_KN_RIGHTS_KEY` stays UNSET | items 1–8 | owner | yes, while on |

**Not needed for the minimal test:**
- the Rights store (#793 implementation);
- calculation-date attestations (#789; records are not served in minimal mode);
- planner v2 (E-1 refuses it).

**Known limitations to accept or fix first:**
- With E-1 on, research answers and rerouted turns are still judged, inside the $0.25 per-turn cap.
- Chart and general answers never stream while Brain is on.
