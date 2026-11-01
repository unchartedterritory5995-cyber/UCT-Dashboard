# RESUME — connector fidelity program (paused 2026-11-01 ~18:30 CT)

Paste this into a new Claude Code session:

> Resume the note-connector fidelity program. Read memory `project_connector_fidelity_2026_11_01` and this file (`docs/notebook-connectors/RESUME-connector-fidelity.md` on branch `docs/connector-fidelity-design`) first, then the spec `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` and the four plans `docs/superpowers/plans/2026-11-01-connector-fidelity-{a-server,b-client,c-obsidian,d-syncnow}.md`. Check my PC load first (RAM, disk %, MsMpEng) and run only ONE implementer subagent at a time, focused test files only, never whole test directories. Then: (1) check whether PR #614 is merged; (2) finish Plan D Task 1 from WIP commit `eede09c363` on `feat/connector-syncnow` (worktree `uct-worktrees/connector-syncnow`, SDD ledger in `.superpowers/sdd/2026-11-01-connector-fidelity-d-syncnow/`), review it, continue Plan D; (3) set up the Plan A worktree `uct-worktrees/connector-server` (its creation was killed mid-checkout: verify, or `git worktree remove --force` and re-add from `origin/fix/note-sync-never-overwrites-edits`) and run Plan A starting with Task 1, the remote-revision conflict gate, which must land before any converter change; (4) then Plans B and C; (5) Evernote live sync once I'm on a paid Evernote plan (the probe script is described below). Use subagent-driven development, deploy by PR, and tell me exactly when you need my clicks.

## State at pause
- PR #614 `fix/note-sync-never-overwrites-edits` (a sync overwrote members' edits): open, needs the OWNER to merge.
- Spec + 4 plans: branch `docs/connector-fidelity-design`.
- Plan D: worktree `uct-worktrees/connector-syncnow`, branch `feat/connector-syncnow` (pushed). Task 1 = WIP `eede09c363`, UNREVIEWED. `app/node_modules` is a junction to `uct-worktrees/fill-alpha/app/node_modules` (identical lockfile).
- Plan A: worktree creation was killed; see above.
- Plan C: the plugin lives in the STANDALONE repo (`uct-worktrees/obsidian-uct-notebook-sync`, tag 0.1.4). The monorepo's `obsidian-plugin/` is a stale copy.
- Plan A Task 7 adds deps (`pi-heif`, `linkify-it-py`, Pillow>=11.3) ⇒ owner `UCT_FLOW_OVERRIDE` step, outside 9:30–16:00 ET.
- Evernote: Dynamic client registration works without an account and accepts the production callback; refresh tokens are supported. The probe was a throwaway script in the old session scratchpad (stdlib: DCR → PKCE authorize on 127.0.0.1:8765 → token → MCP initialize + tools/list + search_notes + refresh check). Rewrite it if the scratchpad is gone. It needs the owner on a PAID Evernote plan.

## PC slowness (2026-11-01)
- RAM hit 0.8 GB free (a broad pytest run + 4 planner agents), later fine (21 GB free).
- Then the disk sat at 200–360% busy: Microsoft Defender (MsMpEng ~134% CPU) was scanning 139 dirs in `uct-worktrees`, plus another session's `du -sh` over every worktree.
- Owner fixes: an admin PowerShell `Add-MpPreference -ExclusionPath "C:\Users\Patrick\uct-worktrees","C:\Users\Patrick\uct-dashboard"`; end the stray `du.exe` processes; prune finished worktrees.
- Of the 98 registered worktrees, 29 have branches merged into origin/master (deletion CANDIDATES; check each one's `git status` for uncommitted work before removing). 41 more dirs in `uct-worktrees` are not registered worktrees at all (unknown, review before deleting).
- I may not kill other sessions' processes (the classifier blocks it): owner action.

## Worktrees merged into origin/master (candidates, dirty-check first)
```
C:/Users/Patrick/.wt-chart-iq	feat/chart-iq
C:/Users/Patrick/.wt-tx-news	feat/news-match-audit
C:/Users/Patrick/uct-dashboard/.claude/worktrees/agent-a1c93e34e4d0c58ac	worktree-agent-a1c93e34e4d0c58ac
C:/Users/Patrick/uct-dashboard/.claude/worktrees/agent-a97dc1cc4cd6a1687	lane/t1-shell-reach
C:/Users/Patrick/uct-dashboard/.claude/worktrees/agent-add45e24328240b08	lane/s2-finish
C:/Users/Patrick/uct-dashboard/.claude/worktrees/agent-ae1d738e6a3de6ab2	lane/o-options-remainders
C:/Users/Patrick/uct-dashboard/.claude/worktrees/agent-af0304520e9aac101	lane/term-014-rss-episode
C:/Users/Patrick/uct-dashboard/.claude/worktrees/h5	pine/h5-host-values
C:/Users/Patrick/uct-worktrees/_hotfix-vite	fix/vite-saved-script-upgrade-arg
C:/Users/Patrick/uct-worktrees/alerts-purge	fix/account-deletion-alerts
C:/Users/Patrick/uct-worktrees/fill-alpha	fix/pine-fill-alpha
C:/Users/Patrick/uct-worktrees/fill-default	fix/pine-fill-default-linewidth
C:/Users/Patrick/uct-worktrees/fx-clock	fix/fx-clock-blank
C:/Users/Patrick/uct-worktrees/hotfix-w8r56	hotfix/notebook-unmount-retry
C:/Users/Patrick/uct-worktrees/nbw-p2-be	feat/notebook-widgets-p2-be
C:/Users/Patrick/uct-worktrees/nbw-p2-campaign	feat/notebook-widgets-p2-campaign
C:/Users/Patrick/uct-worktrees/nbw-p2-impl	feat/notebook-widgets-p2
C:/Users/Patrick/uct-worktrees/offhours	fix/scan-scope-ambiguous-ticker
C:/Users/Patrick/uct-worktrees/p3-ws0	feat/pine-p3-ws0
C:/Users/Patrick/uct-worktrees/p3-wsb	feat/pine-p3-wsb
C:/Users/Patrick/uct-worktrees/p3-wsc	feat/pine-p3-wsc-3
C:/Users/Patrick/uct-worktrees/p3-wsd	feat/pine-p3-wsd
C:/Users/Patrick/uct-worktrees/p3-wse	feat/pine-p3-wse-2
C:/Users/Patrick/uct-worktrees/p3-wsf	feat/pine-p3-wsf-2
C:/Users/Patrick/uct-worktrees/p3-wsi	feat/pine-p3-wsi
C:/Users/Patrick/uct-worktrees/prod-objcond	fix/prod-object-cond-history
C:/Users/Patrick/uct-worktrees/saved-upgrade	feat/saved-script-auto-upgrade
C:/Users/Patrick/uct-worktrees/screener-focus-layout	fix/master-green-integration
C:/Users/Patrick/uct-worktrees/themes-1week	fix/themes-period-words
```
