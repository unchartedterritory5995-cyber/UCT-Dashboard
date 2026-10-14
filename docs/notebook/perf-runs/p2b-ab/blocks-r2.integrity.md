# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 13:37:25`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-typing-ab-r4; identity = 3db78284bac4270e524239ba69059e19
- `2026-10-14 13:38:02`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 13:38:27`  **shutdown** — C:\data, 62 db files — CLEAN
