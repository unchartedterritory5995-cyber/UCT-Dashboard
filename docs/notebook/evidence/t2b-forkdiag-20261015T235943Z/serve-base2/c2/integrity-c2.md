tip under test: 4649e2d03e (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-15 20:03:46`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-forkdiag-base2\c2; identity = 17138a8eac8d0cf9618a2c1ff3175693
- `2026-10-15 20:04:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 20:06:23`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-15 20:06:54`  **shutdown** — C:\data, 62 db files — CLEAN
