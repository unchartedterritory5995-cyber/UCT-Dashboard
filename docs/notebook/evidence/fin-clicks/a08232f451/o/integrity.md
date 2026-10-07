# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 07:12:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\final-o; identity = abe168f55cc8c773b6cc96bba6d7fc41
- `2026-10-07 07:14:39`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:16:35`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 07:24:28`  **shutdown** — C:\data, 62 db files — CLEAN
