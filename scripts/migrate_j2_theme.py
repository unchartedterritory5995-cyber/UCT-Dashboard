"""One-shot J2.0 theme migration: swap cool slate/blue palette + Inter font
for the dashboard's warm earthy tokens (var(--bg-surface), var(--ut-gold),
var(--font-sans), etc.). Structure (radius, padding, layout) is preserved.

Run from repo root:
    python scripts/migrate_j2_theme.py

Idempotent — safe to re-run; once a value is a token reference it won't
re-match the literal pattern. Files outside journal-2-0 are not touched.
"""
from __future__ import annotations
from pathlib import Path

ROOT = Path("app/src/pages/journal-2-0")

# Order matters — longer/more-specific patterns first so prefixes don't
# get clobbered by shorter ones.
CSS_REPLACEMENTS: list[tuple[str, str]] = [
    # ── Fonts ───────────────────────────────────────────────────────────────
    ("Inter, system-ui, sans-serif", "var(--font-sans)"),
    ("Inter, sans-serif", "var(--font-sans)"),
    ("'IBM Plex Mono', 'SF Mono', Menlo, monospace", "var(--font-mono)"),
    ("'IBM Plex Mono', 'SF Mono', monospace", "var(--font-mono)"),

    # ── Status RGBA fills (must precede solid hex swaps for the same colors) ─
    ("rgba(34, 197, 94, 0.1)", "var(--gain-bg)"),
    ("rgba(34, 197, 94, 0.15)", "var(--gain-bg)"),
    ("rgba(34, 197, 94, 0.2)", "var(--gain-bg)"),
    ("rgba(34, 197, 94, 0.25)", "var(--gain-border)"),
    ("rgba(34, 197, 94, 0.3)", "var(--gain-border)"),
    ("rgba(34, 197, 94, 0.35)", "var(--gain-border)"),
    ("rgba(34, 197, 94, 0.4)", "var(--gain-border)"),

    ("rgba(239, 68, 68, 0.1)", "var(--loss-bg)"),
    ("rgba(239, 68, 68, 0.15)", "var(--loss-bg)"),
    ("rgba(239, 68, 68, 0.2)", "var(--loss-bg)"),
    ("rgba(239, 68, 68, 0.25)", "var(--loss-border)"),
    ("rgba(239, 68, 68, 0.3)", "var(--loss-border)"),
    ("rgba(239, 68, 68, 0.35)", "var(--loss-border)"),
    ("rgba(239, 68, 68, 0.4)", "var(--loss-border)"),

    ("rgba(234, 179, 8, 0.1)", "var(--warn-bg)"),
    ("rgba(234, 179, 8, 0.15)", "var(--warn-bg)"),
    ("rgba(234, 179, 8, 0.2)", "var(--warn-bg)"),
    ("rgba(234, 179, 8, 0.3)", "var(--warn-border)"),
    ("rgba(234, 179, 8, 0.35)", "var(--warn-border)"),

    # ── Blue accent → gold ─────────────────────────────────────────────────
    ("rgba(59, 130, 246, 0.08)", "var(--ut-gold-dim)"),
    ("rgba(59, 130, 246, 0.1)", "var(--ut-gold-dim)"),
    ("rgba(59, 130, 246, 0.12)", "var(--ut-gold-dim)"),
    ("rgba(59, 130, 246, 0.15)", "var(--ut-gold-dim)"),
    ("rgba(59, 130, 246, 0.2)", "var(--ut-gold-glow)"),
    ("rgba(59, 130, 246, 0.25)", "var(--ut-gold-glow)"),
    ("rgba(59, 130, 246, 0.3)", "var(--ut-gold-glow)"),
    ("rgba(59, 130, 246, 0.35)", "var(--ut-gold-glow)"),
    ("rgba(59, 130, 246, 0.4)", "var(--ut-gold-glow)"),

    # ── Solid status hexes ─────────────────────────────────────────────────
    ("#22c55e", "var(--gain)"),
    ("#16a34a", "var(--ut-green)"),
    ("#ef4444", "var(--loss)"),
    ("#dc2626", "var(--ut-red)"),
    ("#ef8d8d", "var(--loss)"),
    ("#eab308", "var(--warn)"),
    ("#facc15", "var(--warn)"),

    # ── Blue accent solid → gold ───────────────────────────────────────────
    ("#3b82f6", "var(--ut-gold)"),
    ("#2563eb", "var(--ut-gold)"),
    ("#1d4ed8", "var(--ut-gold)"),
    ("#6366f1", "var(--ut-gold)"),       # purple-blue used in initials gradient
    ("#60a5fa", "var(--ut-gold)"),

    # ── Cool background grays → warm earthy backgrounds ────────────────────
    ("#080a0e", "var(--bg)"),
    ("#0b0d11", "var(--bg)"),
    ("#0d0f13", "var(--bg-surface)"),
    ("#10131a", "var(--bg-surface)"),
    ("#121417", "var(--bg-elevated)"),
    ("#141720", "var(--bg-hover)"),
    ("#181b22", "var(--border)"),       # used as table cell border-bottom
    ("#1b1e25", "var(--bg-hover)"),
    ("#252935", "var(--bg-hover)"),

    # ── Slate borders → warm borders ───────────────────────────────────────
    ("#20232b", "var(--border)"),
    ("#242730", "var(--border)"),
    ("#2a2e38", "var(--border-accent)"),
    ("#2e323c", "var(--border-accent)"),

    # ── Cool text grays → warm cream text ──────────────────────────────────
    ("#f0f2f5", "var(--text-heading)"),
    ("#e6e8eb", "var(--text-bright)"),
    ("#d1d5db", "var(--text-bright)"),
    ("#c2c6cf", "var(--text-bright)"),
    ("#9ca3af", "var(--text-muted)"),
    ("#8b92a1", "var(--text-muted)"),
    ("#7c8290", "var(--text-muted)"),
    ("#6b7280", "var(--text-muted)"),
    ("#5a606c", "var(--text-muted)"),

    # ── Second-pass stragglers ─────────────────────────────────────────────
    ("rgba(234, 179, 8, 0.08)", "var(--warn-bg)"),
    ("rgba(59, 130, 246, 0.18)", "var(--ut-gold-glow)"),
    ("#f5c858", "var(--warn)"),       # caution-yellow used in CSV importer
    ("#9cb7e8", "var(--info)"),       # tip blue in modal hint
    ("#121722", "var(--bg-elevated)"),
    ("#141c2e", "var(--bg-hover)"),
    ("#3b4354", "var(--border-accent)"),

    # ── Button text contrast — every #fff in J2.0 sits on a gold fill ─────
    # White on light gold = poor contrast; swap to the deep dashboard bg.
    ("color: #fff;", "color: var(--bg);"),
]

# JSX inline-style swaps (object-literal values, single-quoted strings).
JSX_REPLACEMENTS: list[tuple[str, str]] = [
    ("background: '#0d0f13'", "background: 'var(--bg-surface)'"),
    ("border: '1px solid #242730'", "border: '1px solid var(--border)'"),
    ("accentColor: '#3b82f6'", "accentColor: 'var(--ut-gold)'"),
    ("color: '#e6e8eb'", "color: 'var(--text-bright)'"),
]


def migrate(path: Path, replacements: list[tuple[str, str]]) -> int:
    text = path.read_text(encoding="utf-8")
    n = 0
    for old, new in replacements:
        if old in text:
            n += text.count(old)
            text = text.replace(old, new)
    if n:
        path.write_text(text, encoding="utf-8")
    return n


def main() -> None:
    css_files = sorted(ROOT.rglob("*.module.css"))
    jsx_files = sorted(ROOT.rglob("*.jsx"))

    total = 0
    for f in css_files:
        n = migrate(f, CSS_REPLACEMENTS)
        if n:
            print(f"  [css]  {n:3d}  {f.relative_to(ROOT)}")
            total += n
    for f in jsx_files:
        n = migrate(f, JSX_REPLACEMENTS)
        if n:
            print(f"  [jsx]  {n:3d}  {f.relative_to(ROOT)}")
            total += n
    print(f"\nTotal substitutions: {total} across {len(css_files)} CSS + {len(jsx_files)} JSX files")


if __name__ == "__main__":
    main()
