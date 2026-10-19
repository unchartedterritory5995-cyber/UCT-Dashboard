tip under test: 479e39270c

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 19:43:19`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p5walk2; identity = 46f66ff2532d45086c4175f454447c66
- `2026-10-18 19:44:03`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 19:45:55`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 19:56:21`  **shutdown** — C:\data, 62 db files — CLEAN
