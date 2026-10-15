# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 23:39:03`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t2a-typing-on-plain-r2; identity = 0594e53cdf5785497b020249301d6679
- `2026-10-14 23:39:50`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 23:40:16`  **shutdown** — C:\data, 62 db files — CLEAN
