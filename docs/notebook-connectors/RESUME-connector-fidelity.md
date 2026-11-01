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
- Evernote: Dynamic client registration works without an account and accepts the production callback; refresh tokens are supported. Probe script saved at `docs/notebook-connectors/evernote_mcp_probe.py` (stdlib only: `python evernote_mcp_probe.py run` → DCR → PKCE sign-in in the browser on 127.0.0.1:8765, read scope only → token → MCP initialize + tools/list + search_notes probes + refresh-token check; outputs in `./out/`, delete `out/tokens.json` after). Results go in `docs/notebook-connectors/evernote-mcp-probe.md`, then apply the Go/No-go rule in spec §6. It needs the owner on a PAID Evernote plan.

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


## What the owner asked for (scope, verbatim intent, 2026-11-01)
- Fix links, clickable website URLs and images not transferring correctly from Obsidian, Evernote and Notion (owner does not remember specifics; the investigation findings are spec §5).
- A LIVE Evernote connector (owner will pay for a plan and do the clicks/sign-ins).
- Sync now picks up notes deleted in the source app (§7).
- The 5 small connector leftovers (§8).
- "Anything else that can be improved and perfected": repair of already-imported notes (§9), rails with messy real-world corpora (§10), and the polish items (§5.6).
- OUT of scope: Dropbox / OneNote / OneDrive app registration.
- The owner wants it FAST and fully done. Standing GO: deploy autonomously when ready, report member impact after. The classifier blocks `gh pr merge`, `railway` var sets/redeploys and killing other sessions' processes ⇒ hand those to the owner with the exact command/click.

## Work that is agreed but NOT yet planned (write these plans after A-D are underway)
- **Plan E, Evernote live sync** (spec §6 + §15 Q3 adoption of earlier .enex notes): only after the probe; Go/No-go rule in §6. If No-go: record why, keep the tile honest, and the .enex fixes in Plan B are the Evernote product.
- **Plan F, repair of already-imported notes** (spec §9 + §15 Q1): dry run with counts → owner reviews the numbers → production run. It never touches a note edited since import. It depends on A and B being live. Includes the one-time member notice for past imports with detectable losses.
- **Live gates + certification addendum** (spec §10 last bullet, §13 step 8): Notion (the owner's workspace, add messy pages), Obsidian (real vault + plugin 0.2.0 against production), Evernote (live, or a real .enex from the paid account). Then append the results to `docs/notebook-connectors/60-user-reliability-certification.md` (append, never rewrite earlier sections).

## Cross-plan reconciliation (check BEFORE executing the affected tasks)
- Plan A was edited by string replace on an overloaded box and its final grep for stale names TIMED OUT. Grep plan A for the agreed names before Task 1: `normalize_media`, `MediaRejected`, `member_media_bytes`, `MEMBER_IMPORT_MEDIA_CAP_BYTES`, `importNotice`, `linkify_doc`, `POST /api/j2/notes/media/fetch`, `POST /api/j2/notes/import/heal-links`, `evernote-title:`, `failures_json`.
- Plans A and B both edit `notes.py::import_confirm`. A changes the pending computation; B adds `guard_edits`, `mode="recover"` and the buckets `recovered`/`keptEdited`. Whichever lands second rebases, and both say they only add.
- Plan A's `evernote-title:` heal assumes `import_source = 'evernote'`: verify against Plan B's `commit.js` before Plan A Task 4.
- Shared linkify vectors: Plan A Task 10 creates `linkify_vectors.json` if Plan B has not; both sides must read the same fixture (http(s), www., email only; `NVDA.US` never links).
- Plan B's `obsidianParity.contract.test.js` goes red on `%20` fixtures until Plan A Task 3 regenerates the server parity fixtures. Expected: land A Task 3 first, or mark it a known gap.
- Plan D owns the `failures_json` DDL; Plan A only writes it.
- Plan A ordering: Task 1 (remote-revision conflict gate) before ANY converter change. Task 5 (`importNotice` node) deploys before or with Task 6. Task 10 needs Task 7 (deps) deployed.
- Plan C Task 3 waits for Plan A's `normalize_media` and `importNotice`.

## Owner click points
- Merge PR #614, and later PRs, when the classifier blocks the merge.
- Plan A Task 7: the `UCT_FLOW_OVERRIDE` step for the `requirements.txt` change, outside 9:30-16:00 ET.
- Evernote: buy or enable a paid personal plan, then approve one sign-in page (read access) when the probe opens it.
- Plan C Task 11: close Obsidian on the desktop during the E2E. After the 0.2.0 GitHub release: community.obsidian.md → sign in → developer dashboard → UCT Notebook Sync → "Check for new releases" → report the review result (a flag ⇒ 0.2.1 + the same click).
- Plan F: approve the dry-run numbers before the production repair run.
- PC: the Defender exclusion (admin PowerShell, above), and approve deleting merged worktrees after the next session lists them with their status.

## Rulings already made for the owner (spec §12 + §15; the owner may override)
- Edited + remote unchanged ⇒ skip (PR #614).
- Convert HEIC/TIFF/BMP/AVIF; keep only HEIC originals; SVG is never inline.
- Copy hotlinked images in.
- 2 GB per-member import media cap; over the cap = a visible marker, never a failed import.
- Re-import-to-recover for past file imports.
- .enex → live adoption by title + created time.
- A Sync now manual full pass is a real strike, and strike 2 counts only if ≥10 min later. Rate limit 600 s per source.
- .enex note links resolve across imports.
- Plan D branched off PR #614's branch (not master).
- The Obsidian plugin authority is the standalone repo.
