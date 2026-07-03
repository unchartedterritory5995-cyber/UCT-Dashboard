"""Awareness Engine — Milestone 1.

A pure PRODUCER of voice_proactive_insights rows. All existing delivery
surfaces (session-start speak, chat-thread mirror, /api/voice/insights,
away-delivery via email/Discord) consume rows written here unchanged.

Gated behind two independent flags, both default OFF:
  - COMPASS_AUTOMATION_ENABLED (existing master switch; gates scheduler
    job REGISTRATION via api/main.py's _add_compass_job)
  - AWARENESS_ENGINE_ENABLED (new; checked inside engine.run_awareness_scan()
    AND inside the scheduler job function itself)

See docs/superpowers/plans/2026-07-02-awareness-engine-m1.md.
"""
