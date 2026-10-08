tip under test: dda0515427 (configuration keyedai)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-08 00:35:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-walk-ai2\keyedai; identity = 9bd985089998482974827c3cd35dc8eb
- `2026-10-08 00:36:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-08 00:38:11`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-08 00:45:17`  **shutdown** — C:\data, 62 db files — CLEAN
