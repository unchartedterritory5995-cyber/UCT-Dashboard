"""Discord render V2 — the hardened runtime behind /chart, /flow, /buzz and the chart controls.

Design: docs/discord-render/03-architecture.md. Every module here ships DARK behind
DISCORD_RENDER_V2_ENABLED; with it unset the interactions endpoint runs exactly the
pre-V2 path.
"""
