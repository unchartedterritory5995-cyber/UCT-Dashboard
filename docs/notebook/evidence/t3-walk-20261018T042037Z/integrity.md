tip under test: 4f50a8ba72

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:20:44`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3walk; identity = 52c054c8436a548c763fe484e6f8507b
- `2026-10-17 23:21:22`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:23:14`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:25:15`  **shutdown** — C:\data, 62 db files — CLEAN
