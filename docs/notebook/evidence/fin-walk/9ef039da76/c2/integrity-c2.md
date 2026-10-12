tip under test: 9ef039da76 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-12 00:22:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\nb-p1-walk\c2; identity = 113307ff8bf357548449e58ad0f7e079
- `2026-10-12 00:23:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 00:25:07`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-12 00:48:52`  **shutdown** — C:\data, 62 db files — CLEAN
