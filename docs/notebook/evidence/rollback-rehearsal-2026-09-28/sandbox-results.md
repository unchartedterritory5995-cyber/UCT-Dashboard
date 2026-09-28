# Sandbox results, raw (lane R1, 2026-09-28)

Data dir `C:\data-w10rb`, port 8229, one boot per row, in this order. Fixtures seeded by the first tip run.

## Integrity (first line of each boot's sandbox-integrity.txt)

- **p00-tip-seed-run1** (build rc 0, 32 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; tip 38bb9a421 (control); tree 075e4ff735bc819e55a76196a27ce32449f6b452; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p00-tip/sandbox-integrity.md
- **p00-tip-run1** (build rc 0, 32 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; tip 38bb9a421 (control); tree 075e4ff735bc819e55a76196a27ce32449f6b452; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p00-tip/sandbox-integrity.md
- **p01-38bb9a421-run1** (build rc 0, 29 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 1: revert 38bb9a421 (L1c #228); tree e3c33fb5728aef2a104a10db6119a9262c9bde9e; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p01-38bb9a421/sandbox-integrity.md
- **p02-4bba30b73-run1** (build rc 0, 32 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 2: revert 4bba30b73 (#225 skip-link H14); tree 59f78d3b8b2c06b4782f72000ee5687393ecae64; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p02-4bba30b73/sandbox-integrity.md
- **p03-d9e887ca0-run1** (build rc 0, 30 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 3: revert d9e887ca0 (L1b #224); tree c356e39b5dcff633a1d6472123c806bbef57673b; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p03-d9e887ca0/sandbox-integrity.md
- **p00-tip** (build rc 0, 32 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; tip 38bb9a421 (control); tree 075e4ff735bc819e55a76196a27ce32449f6b452; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p00-tip/sandbox-integrity.md
- **p01-38bb9a421** (build rc 0, 29 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 1: revert 38bb9a421 (L1c #228); tree e3c33fb5728aef2a104a10db6119a9262c9bde9e; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p01-38bb9a421/sandbox-integrity.md
- **p02-4bba30b73** (build rc 0, 32 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 2: revert 4bba30b73 (#225 skip-link H14); tree 59f78d3b8b2c06b4782f72000ee5687393ecae64; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p02-4bba30b73/sandbox-integrity.md
- **p03-d9e887ca0** (build rc 0, 30 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 3: revert d9e887ca0 (L1b #224); tree c356e39b5dcff633a1d6472123c806bbef57673b; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p03-d9e887ca0/sandbox-integrity.md
- **p04-4f708a0d2** (build rc 0, 30 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 4: revert 4f708a0d2 (L1a #205); tree 9e3d0a1c75e636291ab31061944a8d79f07447fa; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p04-4f708a0d2/sandbox-integrity.md
- **p07-1c4b0bf74** (build rc 0, 28 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 7: revert 1c4b0bf74 (wave 9 #202); tree 2c11feb7b0cda4675c70f8f26bacdeeccba43a55; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p07-1c4b0bf74/sandbox-integrity.md
- **p08-7e3f9e117** (build rc 0, 37 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 8: revert 7e3f9e117 (#201 toolbar H14); tree 26993a3d497aea0c084d1e1f2f74ac8a6adb2dce; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p08-7e3f9e117/sandbox-integrity.md
- **p09-caf6d1b9e** (build rc 0, 27 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 9: revert caf6d1b9e (wave 8 #198); tree 15d62478c889693a667104acbd45af33bfa41eb6; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p09-caf6d1b9e/sandbox-integrity.md
- **p10-2e0598bfa** (build rc 0, 24 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 10: revert 2e0598bfa (9C soak #197); tree c6c1c879de7b07647899acefc096be8c68a8ae54; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p10-2e0598bfa/sandbox-integrity.md
- **p11-f883e0996** (build rc 0, 23 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 11: revert f883e0996 (wave 7 #196); tree 2662dcf76c7196b7a7edf7702b5a39ad7a2dcabd; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p11-f883e0996/sandbox-integrity.md
- **p12-271a078b6** (build rc 0, 24 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 12: revert 271a078b6 (wave 6 #193); tree ed399878987c00eec66dde7975f74e1e4daa4e6a; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p12-271a078b6/sandbox-integrity.md
- **p13b-fd87271fd** (build rc 0, 23 s): SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; step 13b: cherry-pick fd87271fd (re-apply guard fd87271fd); tree 900580af6379b84fe29b3721d4131edaf786afa8; log: docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox/p13b-fd87271fd/sandbox-integrity.md

## A. One door per landing (HTTP status; the recall row also counts body matches)

| boot | L1c recall | L1b slo | L1a unbuildable | #203 depth | w9 bogus fmt | w8 share | w8 publish | 9C soak | w7 tokens | w6 templates | w5 switcher | skip link pointer-events | pane heading position |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p00-tip-seed-run1 | 200 (1 by text) | 200 | 400 | 400 | 422 | 200 | 200 | 422 | 200 | 200 | 200 | auto | absolute |
| p00-tip-run1 | 200 (1 by text) | 200 | 400 | 400 | 422 | 200 | 200 | 422 | 200 | 200 | 200 | none | absolute |
| p01-38bb9a421-run1 | 200 (0 by text) | 200 | 400 | 400 | 422 | 200 | 200 | 422 | 200 | 200 | 200 | none | absolute |
| p02-4bba30b73-run1 | 200 (0 by text) | 200 | 400 | 400 | 422 | 200 | 200 | 422 | 200 | 200 | 200 | auto | absolute |
| p03-d9e887ca0-run1 | 200 (0 by text) | 200 | 400 | 400 | 422 | 200 | 200 | 422 | 200 | 200 | 200 | auto | absolute |
| p00-tip | 200 (1 by text) | 200 json | 400 | 400 | 422 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | none | absolute |
| p01-38bb9a421 | 200 (0 by text) | 200 json | 400 | 400 | 422 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | none | absolute |
| p02-4bba30b73 | 200 (0 by text) | 200 json | 400 | 400 | 422 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | auto | absolute |
| p03-d9e887ca0 | 200 (0 by text) | 200 text/html | 400 | 400 | 422 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | auto | absolute |
| p04-4f708a0d2 | 200 (0 by text) | 200 text/html | 200 | 400 | 422 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | auto | absolute |
| p07-1c4b0bf74 | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | auto | absolute |
| p08-7e3f9e117 | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 json | 200 json | 422 json | 200 json | 200 json | 200 json | auto | static |
| p09-caf6d1b9e | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 text/html | 200 text/html | 422 json | 200 json | 200 json | 200 json | absent | absent |
| p10-2e0598bfa | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 text/html | 200 text/html | 200 text/html | 200 json | 200 json | 200 json | absent | absent |
| p11-f883e0996 | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 text/html | 200 text/html | 200 text/html | 200 text/html | 200 json | 200 json | absent | absent |
| p12-271a078b6 | 200 (0 by text) | 200 text/html | 200 | 400 | 200 | 200 text/html | 200 text/html | 200 text/html | 200 text/html | 200 text/html | 200 json | absent | absent |
| p13b-fd87271fd | 404 (0 by text) | 200 text/html | 200 | 400 | 405 | 200 text/html | 200 text/html | 200 text/html | 200 text/html | 200 text/html | 404 json | absent | absent |

## B. The never-revert set: the three tip-made notes in the served editor

| boot | note | editor mounted | editable | notice on page | body PUT schema headers | PUT statuses | stored keeps node/mark | typed words stored | page errors |
|---|---|---|---|---|---|---|---|---|---|
| p00-tip-seed-run1 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip-seed-run1 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip-seed-run1 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip-run1 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip-run1 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip-run1 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421-run1 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421-run1 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421-run1 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73-run1 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73-run1 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73-run1 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p03-d9e887ca0-run1 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p03-d9e887ca0-run1 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p03-d9e887ca0-run1 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p00-tip | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p01-38bb9a421 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p02-4bba30b73 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p03-d9e887ca0 | n2 | True | True | - | 2 | none | True | True | 0 |
| p03-d9e887ca0 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p03-d9e887ca0 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p04-4f708a0d2 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p04-4f708a0d2 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p04-4f708a0d2 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p07-1c4b0bf74 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p07-1c4b0bf74 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p07-1c4b0bf74 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p08-7e3f9e117 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p08-7e3f9e117 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p08-7e3f9e117 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p09-caf6d1b9e | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p09-caf6d1b9e | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p09-caf6d1b9e | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p10-2e0598bfa | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p10-2e0598bfa | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p10-2e0598bfa | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p11-f883e0996 | n2 | True | True | - | 2 | 200 | True | True | 0 |
| p11-f883e0996 | n1 | True | True | - | 2 | 200 | True | True | 0 |
| p11-f883e0996 | n0 | True | True | - | 2 | 200 | True | True | 0 |
| p12-271a078b6 | n2 | True | False | newer version of the app, Reload to edit it | none | none | True | False | 0 |
| p12-271a078b6 | n1 | True | True | - | 1 | 200 | True | True | 0 |
| p12-271a078b6 | n0 | True | True | - | 1 | 200 | True | True | 0 |
| p13b-fd87271fd | n2 | True | True | newer version of the app, Reload to edit it | 0, 0 | 409, 409 | True | False | 0 |
| p13b-fd87271fd | n1 | True | True | newer version of the app, Reload to edit it | 0, 0 | 409, 409 | True | False | 0 |
| p13b-fd87271fd | n0 | True | True | - | 0 | 200 | True | True | 0 |

## C. The procedure's check list, inside each step tree

| boot | pytest tests/test_notebook_schema_guard.py | vitest list (--maxWorkers=2) |
|---|---|---|
| p00-tip-seed-run1 | not run | not run |
| p00-tip-run1 | not run | not run |
| p01-38bb9a421-run1 | not run | not run |
| p02-4bba30b73-run1 | not run | not run |
| p03-d9e887ca0-run1 | not run | not run |
| p00-tip | NO TOTALS LINE | not run |
| p01-38bb9a421 | not run | not run |
| p02-4bba30b73 | not run | not run |
| p03-d9e887ca0 | not run | not run |
| p04-4f708a0d2 | not run | not run |
| p07-1c4b0bf74 | not run | not run |
| p08-7e3f9e117 | not run | not run |
| p09-caf6d1b9e | not run | not run |
| p10-2e0598bfa | not run | not run |
| p11-f883e0996 | not run | not run |
| p12-271a078b6 | not run | not run |
| p13b-fd87271fd | not run | not run |
