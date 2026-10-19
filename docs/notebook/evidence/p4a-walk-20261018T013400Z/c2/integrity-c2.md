tip under test: cb4482ba96 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 20:34:11`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p4awalk3\c2; identity = 0fffb8b87d96134f453cf07e4890973e
- `2026-10-17 20:34:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 20:36:36`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 20:37:14`  **shutdown** — C:\data, 62 db files — CLEAN
