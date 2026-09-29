# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 17:16:53`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 037a4ff61def9e68714491bdec94c4bb
- `2026-09-28 17:17:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:19:35`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 17:19:42`  **shutdown** — C:\data, 62 db files — CLEAN
