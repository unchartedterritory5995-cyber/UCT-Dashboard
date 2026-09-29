# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 18:06:41`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 57a1c68076786a2174c61e9726942161
- `2026-09-28 18:07:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 18:09:26`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 18:09:40`  **shutdown** — C:\data, 62 db files — CLEAN
