// ── D31 RESOLVER · ENFORCEMENT (a CODE constant, never a runtime flag — design §5, AUDIT I7) ───────────────────────────────
// 'shadow'  compute and report; enforce NOTHING (the rails' decision stands, always).
// 'add'     the resolver may ADD an ask / refuse where BOTH rails allowed (most restrictive wins). It can never license.
// There is NO value that licenses: a rail's refuse / ask is never turned into an apply — not representable here.
// Moving a family from 'shadow' to 'add' is its own PR with its own AUDIT review and prod check (P2).
export const MODES = Object.freeze(['shadow', 'add'])
export const ENFORCE = Object.freeze({ removal: 'shadow' })
export const modeOf = (family) => (MODES.includes(ENFORCE[family]) ? ENFORCE[family] : 'shadow')
