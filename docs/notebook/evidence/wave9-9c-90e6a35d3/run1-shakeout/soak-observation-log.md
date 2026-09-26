# Wave Q1 — observation log

Appended by `tools/nb_observe.py`, every 2 hours, unattended. **Numbers, not
hypotheses.** One row per run; a run that could not take the rig profile writes a
SKIPPED row with its reason, so a gap in this log is never silent.

⛔ **Outbox stuck >5 min is not observable fleet-wide and the rig runs opted out.
It is covered only by real-door canary runs (rig, layer on) and by member
reports. A canary any time this weekend fills that datapoint; the sampler does
not.**

⛔ **`opt-in (windowed)` IS NOT A LIFETIME COUNT.** It reads the last 200
population activity rows, so it can DECREASE as old events roll off — it did,
20 → 19, which is what exposed the original `member = total − 20` column as one
that could only ever say zero. **Read `latest opt-in` instead:** it moves when a
new event arrives regardless of roll-off. Every opt-in up to
`2026-09-12 05:17:56` was the rig opting itself in and out during canary runs;
the rig never opts in during a sampler run, so a latest NEWER than that, with no
canary running, is a REAL MEMBER.

⛔⛔ **THREE POPULATIONS, NEVER ONE `members` FIGURE** (owner ruling 2026-09-13).
Column 2 reads `organic N · synthetic M · rig/owner K`, counted **by distinct
identity** and never summed. **ORGANIC** is a person who is not us, and is the
only number the *zero blocked-baseline events* claim may be divided by.
**SYNTHETIC** is an account we provisioned: it proves the path is reachable and
says nothing about adoption. **RIG/OWNER** is the instrument and the owner's own
browsing.

⚰️ It was one number, counted by ROW, and on 2026-09-13 it reported our own T-12
smoke account as **seven independent members** — 7 events from 1 identity, and
that identity was not on the exclusion list because it is `member-smoke@…`, not
`smoke@…`. ⭐ **Seven opt-ins from seven fresh browser contexts is EXPECTED, not a
dedupe failure:** the opt-in dedupe marker is per tab/context by design.

⛔ An unknown address on `@uctintelligence.internal` is **flagged as an ANOMALY**,
never counted as organic. That domain is reserved and unroutable, so nobody
outside this programme can hold one — a new one is a synthetic account somebody
provisioned without declaring it.

⛔⛔ WAVE K COLUMN — `config-served (members)`. K-1 flips the compile-time
constant to `false` so an unreachable auth payload fails to OFF; its precondition
is a **config-served rate of 100% over the K window, measured by identity, rig and
owner-browser excluded** (owner ruling 2026-09-12). The column reads
`served/total` over DISTINCT member identities, where a member is an identity that
is neither the shared owner+rig account nor the smoke account — the same exclusion
the opt-in column uses, because two exclusion lists over one question is how they
drift. ⛔ `0/0` is NOT 100%: an empty population cannot satisfy a rate, and the
column prints `0/0` rather than a percentage so nobody can read it as one.

| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) | blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | console errors (rig) | flag |
|---|---|---|---|---|---|---|---|---|
| 2026-09-25 23:44 ET | 2026-09-26 03:44:18 · organic 1 · synthetic 0 · rig/owner 0 · ⛔ UNKNOWN INTERNAL 1 | 2 | 0/0 — no member reported | 1 | 0 | 0 | 0 | OK (SANDBOX exercise of the observer's reads; not a production row) |
