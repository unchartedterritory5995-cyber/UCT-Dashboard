tip under test: d947280a46 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-11 11:19:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = %TEMP%/nb-p0walk/final3/c2; identity = 99c29e25b05c273cdc2f0e36e2d63f80
- `2026-10-11 11:20:09`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-11 11:22:02`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-11 11:44:34`  **shutdown** — C:\data, 62 db files — CLEAN
