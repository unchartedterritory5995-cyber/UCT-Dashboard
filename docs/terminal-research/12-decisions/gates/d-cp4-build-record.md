---
id: d-cp4-build-record
unit: D CP4
packet: packet-d-nav-tabs-gate
merges-after: E CP38
status: UNSIGNED
---

# D CP4 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  45472396e
SCOPE APPROVED:   CP4 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **D CP4 — F-NAV-1's DEFAULTABLE resolution: two routes get a sidebar entry.**
> Scope is `app/src/components/NavBar.jsx`, `app/src/components/navGroups.js`, and
> `CLAUDE.md`'s Nav Tabs section, as enumerated by `git show --stat` of this unit's
> commit.

⛔ **Collision proof:** packet D's own CP3 finding (F-NAV-1) named the gap; CP1-CP3
are the only prior D checkpoints. **CP4 free.**

## 1 · What F-NAV-1 found, and the default that resolves it

F-NAV-1 (packet-d-nav-tabs-gate CP3): nine reachable member-facing routes carried no
sidebar entry. The owner's R-NAV default (this session's prompt): a route gets a
sidebar entry when it has real inbound links AND non-zero traffic over the last 16
days, read from live production `auth.db.page_views`.

Applied (via a fork this session, verified independently by re-running
`tools/nav_manifest.mjs` after the code change — see §3):

| route | inbound links | 16-day traffic | verdict |
|---|---|---|---|
| `/formulas/reference` | yes | 5 | **sidebar entry** |
| `/catalysts/history` | yes | 3 | **sidebar entry** |
| `/live-flow`, `/dark-pool`, `/post-market`, `/setup-library`, `/journal-2-0/report` | yes | 0 | stays unlisted |
| `/educational-videos` | no | 0 | stays unlisted |
| `/traders` | — | — | follows its own existing decision (voice-assistant door) |

## 2 · The fix

- `app/src/components/NavBar.jsx`: two new `NAV_ITEMS` entries — `Catalysts History`
  (`/catalysts/history`, icon `star`) and `Formula Reference` (`/formulas/reference`,
  icon `chart`) — both existing UIcon registry glyphs, verified present.
- `app/src/components/navGroups.js`: both routes added to their group's exact-match
  `routes` array (`markets` for `/catalysts/history` — it already carried the
  `/catalysts` match-prefix; `charts` for `/formulas/reference`, alongside Model
  Book/Setup Library). `GROUPED_NAV_ITEMS` matches by exact string
  (`group.routes.includes(item.to)`), so the `NAV_ITEMS` addition alone would have
  silently landed both in the headingless orphan bucket without this.
- `CLAUDE.md`: Nav Tabs section regenerated via `node tools/nav_manifest.mjs`
  (16 → 18 entries; unlisted-route count 7 → 5, with the `/live-flow` candidate
  independently confirmed by the regenerated diff to be a `LegacyRedirect`, not a
  real page — corroborating the O.3 fork's suspicion rather than counting as a gap).

## 3 · Controls

```
node tools/nav_manifest.mjs --self-check                       PASS
node tools/nav_manifest.mjs                                     18 entries, navWithoutRoute=0,
                                                                  5 unlisted (down from 7)
npx vitest run src/components/navGroups.test.js
              src/components/navGroups.route.test.jsx           15 passed, 0 failed
```

## 4 · Files

```
app/src/components/NavBar.jsx      +2 lines: two NAV_ITEMS entries
app/src/components/navGroups.js    +2 route strings across two existing groups
CLAUDE.md                          Nav Tabs section regenerated (mechanical, from the tool)
```

## 5 · Drafted ledger row — NOT written

| 124 | `<this commit>` | 2026-09-18 | UI | 1 | D CP4: F-NAV-1's owner-set default (inbound links + non-zero 16-day production traffic) applied — `/catalysts/history` and `/formulas/reference` gain sidebar entries; the other five candidate routes stay unlisted (zero traffic each), and `/live-flow` turns out to be a `LegacyRedirect` rather than a real gap, confirmed by the regenerated nav↔route diff. |
