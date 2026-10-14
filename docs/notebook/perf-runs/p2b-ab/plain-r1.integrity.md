# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 13:31:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-typing-ab-r1; identity = ccae8a188e14d7d2a4379125eb8c18e5
- `2026-10-14 13:32:27`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 13:32:50`  **shutdown** — C:\data, 62 db files — CLEAN
