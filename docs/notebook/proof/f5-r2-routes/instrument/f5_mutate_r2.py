"""Lane F5 fix round 2 mutation proofs: each mutation must turn its rail RED; the file's bytes
are restored and verified by sha256 after every run (never `git checkout`).

Round-1 mutations that target the rewritten FloatingOrb.coachmark.test.jsx are re-run from the
round-1 harness (docs/notebook/proof/f5-r1-mutations/f5_mutate.py) on the same tree.

Usage: python f5_mutate_r2.py [id ...]   (no ids = all)
"""
import importlib.util
import json
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10s2")
_spec = importlib.util.spec_from_file_location("r1", WT / "docs/notebook/proof/f5-r1-mutations/f5_mutate.py")
R1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R1)

ORB = "src/components/voice/FloatingOrb.jsx"
ROUTES = "src/components/firstRun/viewportLockedRoutes.js"
NAV = "src/components/NavBar.jsx"
T_ORB = "src/components/voice/FloatingOrb.coachmark.test.jsx"
T_ROUTES = "src/components/firstRun/viewportLockedRoutes.test.js"

M = [
    ("M29-locked-ignored", ORB,
     " && !firstRunStageHeld && !onViewportLockedPage\n", " && !firstRunStageHeld\n", T_ORB),
    ("M30-every-route-locked", ROUTES,
     "  return LOCKED.has(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)\n", "  return true\n", T_ORB),
    ("M31-locked-page-dismisses", ORB,
     "  const hiddenOnScroll = useHideOnScroll()\n",
     "  useEffect(() => { if (onViewportLockedPage && showCoachmark) dismissCoachmark() }, [onViewportLockedPage, showCoachmark, dismissCoachmark])\n  const hiddenOnScroll = useHideOnScroll()\n",
     T_ORB),
    ("M32-measured-route-dropped", ROUTES, "  '/dashboard',\n", "", T_ROUTES),
    ("M33-unmeasured-route-added", ROUTES, "  '/community',\n", "  '/community',\n  '/settings',\n", T_ROUTES),
    ("M34-nav-route-unmeasured", NAV,
     "  { to: '/charts',       label: 'Charts',        icon: 'equity' },\n",
     "  { to: '/charts',       label: 'Charts',        icon: 'equity' },\n  { to: '/new-page',     label: 'New page',      icon: 'star' },\n",
     T_ROUTES),
    ("M35-child-routes-assumed", ROUTES,
     "  return LOCKED.has(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)\n",
     "  return VIEWPORT_LOCKED_ROUTES.some((r) => p === r || p.startsWith(`${r}/`))\n", T_ROUTES),
    ("M36-bare-prefix", ROUTES,
     "  return LOCKED.has(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)\n",
     "  return VIEWPORT_LOCKED_ROUTES.some((r) => p.startsWith(r))\n", T_ORB),
]
R1_ON_ORB_TEST = {"M1-stage-ignored", "M2-portal-to-body", "M19-card-under-help", "M21-sheet-keeps-card",
                  "M22-audio-keeps-card", "M23-sheet-dismisses", "M24-audio-dismisses", "M25-tuck-with-card"}
ALL = M + [m for m in R1.M if m[0] in R1_ON_ORB_TEST]

if __name__ == "__main__":
    ids = set(sys.argv[1:])
    results = []
    for m in ALL:
        if ids and m[0] not in ids:
            continue
        res = R1.run_one(*m)
        print(json.dumps(res), flush=True)
        results.append(res)
    bad = [r for r in results if not r.get("red")]
    print("ALL RED" if not bad else f"NOT RED: {[r['id'] for r in bad]}")
    sys.exit(0 if not bad else 1)
