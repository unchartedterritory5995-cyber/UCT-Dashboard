# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:24:45`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-a11y; identity = 428420747689730881cd3043be9e940a
- `2026-10-07 07:25:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:27:27`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:29:18`  **shutdown** — C:\data, 62 db files — CLEAN
