# RESUME — RECONSTRUCTED by the discord-render session, NOT by the owning session

Captured 2026-09-13 15:43 ET at the owner's PC restart, because the session that owns this checkout could not be
reached. Nothing was merged, rebased or resolved: the working tree was captured exactly as it stood.
Everything below is inferred from the diff and the git log — verify before trusting it.

- **Checkout:** `C:\Users\Patrick\uct-dashboard`
- **Branch:** `feat/catalyst-coverage-precision` · HEAD before capture `270498f32` · capture pushed to `feat/catalyst-coverage-precision`
- **Areas touched:** .claude, AppData, api, app, check_sweep.sh, docs, err_historical_equity.txt, err_option_reconstruct.txt, err_recent_orders.txt, err_reconstruct.txt, err_service.txt, err_snaptrade_adapter.txt

## Recent commits
```
270498f32 2026-07-11 Add implementation plan: breadth grouping — Theme dimension
97c0bd320 2026-07-11 Add design spec: breadth grouping — Theme dimension
5b4bbe777 2026-07-10 Charts: drawings are directly grabbable without arming the cursor tool
a6b7887cf 2026-06-28 docs: charts fundamentals widget implementation plan
c0e6a5787 2026-06-28 docs: charts fundamentals widget design spec
119e144ce 2026-06-25 docs: implementation plan for persistent video mini-player
```

## Files in the capture (102)
- `M` api/main.py
- `M` api/routers/catalysts.py
- `M` api/routers/journal_two.py
- `M` api/services/audit.py
- `M` api/services/bars_fetch.py
- `M` api/services/bars_fetch_test.py
- `M` api/services/catalyst/filters.py
- `M` api/services/catalyst/scoring.py
- `M` api/services/catalyst/sources.py
- `M` api/services/catalyst/store.py
- `M` api/services/journal_two/accounts.py
- `M` api/services/journal_two/test_accounts.py
- `M` app/src/components/CompanyLogo.jsx
- `M` app/src/components/CompanyLogo.module.css
- `M` app/src/components/MoversSidebar.jsx
- `M` app/src/components/StockChart.jsx
- `M` app/src/components/chart/barTime.js
- `M` app/src/components/tiles/CatalystTable.jsx
- `M` app/src/components/tiles/EarningsModal.jsx
- `M` app/src/components/tiles/LeadershipTile.jsx
- `M` app/src/pages/MorningWire.module.css
- `M` app/src/pages/calendar/Calendar.module.css
- `M` app/src/pages/calendar/EarningsCard.jsx
- `M` app/src/pages/calendar/EventCard.jsx
- `M` app/src/pages/calendar/MonthView.jsx
- `M` app/src/pages/calendar/WeekView.jsx
- `M` app/src/pages/journal-2-0/components/accounts/DeleteAccountModal.jsx
- `M` tests/test_catalyst_filters.py
- `M` tests/test_catalyst_scoring.py
- `??` .claude/worktrees/agent-a0e0b21d08f84c953/
- `??` .claude/worktrees/agent-a2d7f7d184d0d0c60/
- `??` .claude/worktrees/agent-a4826da9bf0601d41/
- `??` .claude/worktrees/agent-a712b77f9274d5d7e/
- `??` .claude/worktrees/agent-aa7a553ae85bccf62/
- `??` .claude/worktrees/agent-ad25d4f92553386fc/
- `??` .claude/worktrees/indicator-ecosystem/
- `??` .claude/worktrees/wf_c1669d34-d75-1/
- `??` .claude/worktrees/wf_c1669d34-d75-2/
- `??` .claude/worktrees/wf_c1669d34-d75-3/
- `??` .claude/worktrees/wf_c1669d34-d75-4/
- `??` .claude/worktrees/wf_c1669d34-d75-5/
- `??` .claude/worktrees/wf_c1669d34-d75-6/
- `??` .claude/worktrees/wf_c1669d34-d75-7/
- `??` .claude/worktrees/wf_ec90ffe3-8dc-1/
- `??` .claude/worktrees/wf_ec90ffe3-8dc-2/
- `??` .claude/worktrees/wf_ec90ffe3-8dc-3/
- `??` .claude/worktrees/wf_ec90ffe3-8dc-4/
- `??` AppData/Local/Temp/claude/dry_comm.json
- `??` AppData/Local/Temp/claude/dryrun_community.json
- `??` api/flow_summary.py
- `??` api/routers/broker_sync.py
- `??` api/services/crypto_box.py
- `??` api/services/journal_two/broker/__init__.py
- `??` api/services/journal_two/broker/activities_store.py
- `??` api/services/journal_two/broker/connections.py
- `??` api/services/journal_two/broker/rate_limit.py
- `??` api/services/journal_two/broker/reconstruct.py
- `??` api/services/journal_two/broker/service.py
- `??` api/services/journal_two/broker/snaptrade_adapter.py
- `??` api/services/journal_two/broker/snaptrade_client.py
- `??` api/services/journal_two/broker/sync.py
- `??` app/src/components/chart/barTime.test.js
- `??` app/src/components/tiles/OptionsFlowPreview.jsx
- `??` app/src/components/tiles/OptionsFlowPreview.module.css
- `??` app/src/components/tiles/OptionsFlowPreview.test.jsx
- `??` app/src/pages/journal-2-0/components/BrokerConnectionsCard.jsx
- `??` app/src/pages/journal-2-0/components/BrokerConnectionsCard.module.css
- `??` check_sweep.sh
- `??` docs/superpowers/plans/2026-06-15-research-page-phase-1.md
- `??` docs/superpowers/plans/2026-06-19-full-market-screener.md
- `??` docs/superpowers/plans/2026-07-02-compass-brain-bridge.md
- `??` docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md
- `??` docs/superpowers/specs/2026-06-19-full-market-screener-design.md
- `??` docs/superpowers/specs/2026-07-31-indicator-platform-design.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/coordination-package.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/p0-config-runbook.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/p1-patch-spec.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/p2-gapfill-spec.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/p3-success-systems.md
- `??` docs/superpowers/specs/liveflow-deploy-survival/v2-risk-register-and-directives.md

## Excluded (still on disk, NOT pushed — the repo is public)
- docs/RESUME.md — credential-shaped content
- docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md — credential-shaped content

## Likely program and next step (inferred, unverified)
- Program: whatever `feat/catalyst-coverage-precision` names; last commit: `270498f32 2026-07-11 Add implementation plan: breadth grouping — Theme dimension`.
- Next step: read the files above, run that program's own gate on this WIP commit, then continue or amend.

## Gotchas
- The WIP commit is NOT reviewed and may not pass tests.
- If this branch tracks `origin/master`, push with an explicit refspec (`git push origin HEAD:refs/heads/<branch>`).
- One master merge at a time repo-wide; scoped pytest only (named files); see the root `CLAUDE.md`.
