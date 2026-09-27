# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 21:25:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = f807eff0e538ce07a4621a17f029cdd8
- `2026-09-26 21:26:34`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 21:27:42`  **shutdown** — C:\data, 62 db files — CLEAN
