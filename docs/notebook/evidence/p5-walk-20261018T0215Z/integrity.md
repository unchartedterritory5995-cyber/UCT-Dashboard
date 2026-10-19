tip under test: b70b158b28

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-18 20:55:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-p5walk6; identity = 7c7a2f242a557699442f425eb7548784
- `2026-10-18 20:55:55`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 20:57:48`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-18 21:01:41`  **shutdown** — C:\data, 62 db files — CLEAN
