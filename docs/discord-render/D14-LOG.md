# D-14 run log

Append-only. A dated section per checklist state change. No interim reports to the
owner; if the session dies, this file plus `D14-CHECKLIST.md` IS the report.

---

## 2026-09-15 21:35 ET — W0 opened

```
================================================================================
D-14 W0 — autonomy infrastructure opened
master 9ccb3f795 | hardening b94ffb1b2 | gate ccf4fbcb6 live (RenderGate)
================================================================================

DONE
  A1  D14-CHECKLIST.md written -- the resume point.
  A6  this log.

REVISED, AND THE REVISIONS ARE OPERATIVE
  A4  the session does NOT self-grant via ~/.claude/settings.json. On a denial:
      retry once with the action restated; if denied again, record
      BLOCKED-permission with the exact settings block the owner needs, and
      continue with unblocked work. Grounds: the owner's own standing preference
      feedback_when_blocked_enumerate_tool_paths -- "never self-grant via
      settings.json". A denial is the human-in-the-loop control working.
  A3  the Playwright/debug-port rig is NOT built. No device-pick prompt was
      observed on 2026-09-15; tabs_context_mcp returned tabs directly and five
      smoke rows were driven through the MCP browser. The real friction was
      document.visibilityState == "hidden", fixed with PowerShell UI Automation.
      Relaunching the owner's logged-in Chrome with --remote-debugging-port would
      kill their working windows and expose an authenticated browser to anything
      on localhost -- real cost, for a blocker not in evidence.

CARRIED FORWARD FROM THE PRE-FLIGHT (all read-only, 2026-09-15 evening)
  OI-45 named: loop_stalled has never been able to fire in production. One
    Observer instantiation (commands.py:144), one caller (main.py:7816), inside
    if _render_v2.enabled(); V2 unset. Corroborated in-process by /renderhealth's
    own "Renderer: not probed yet". OI-43 fixed the instrument, not its reader.
  Delivery path for the fix verified LIVE and not V2-gated: chart_health_alerts
    .emit(key, severity, message); pages only at severity "critical"; on web the
    webhook is present and CHART_HEALTH_DISCORD_ENABLED is unset -> ON.
  Webhook target GREEN: #system-alerts, guild UCT Intelligence, 4 members -- NOT
    the ~750-member guild. Zero member exposure. Privacy rests on guild
    membership, not an @everyone VIEW deny -> OI-46, non-blocking.
  R34 tier-1 rationale corrected: the 20,446.6 ms stall occurred at uptime
    670-893 s, BELOW the 900 s floor. Tier 1 is the working path for that class,
    not a backstop above it. Tier-1 page volume is unknown; n=2.
  conftest.shared_data_root_census() confirmed at conftest.py:266 returning
    (literals, env_pins, unpinnable); SharedDataRootWrite at :159; idiom
    auth_db.py:10. Both /data writers must use it or they trip the tripwire.

NEXT UNBLOCKED
  A5 monitors. Note: background pollers die with the session -- overnight
  coverage needs a Task Scheduler entry, which is an owner action, so the
  overnight boot-window sample is opportunistic, not guaranteed.
  W1 is clock-gated to Wed >= 09:00 ET and is the next substantive item.

================================================================================
master 9ccb3f795 | W0 opened, no production change, budget intact
================================================================================
```
