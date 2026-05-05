"""Massive WebSocket protocol verification.

Run before starting Phase 4 to confirm:
  1. The WebSocket URL accepts our connection
  2. The auth handshake format is what we assume (Polygon-compatible)
  3. The subscribe message format is what we assume
  4. The inbound event shape matches our parser

Usage (from project root):
    MASSIVE_API_KEY=<your-key> python scripts/test_massive_ws.py

Optional env vars:
    MASSIVE_WS_URL  default: wss://socket.massive.com/stocks
    TEST_SYMBOL     default: AAPL
    MAX_FRAMES      default: 10  (script exits after this many frames)
    TIMEOUT_SEC     default: 20  (max time to wait for the first AM frame)

Outside US market hours you'll still see auth_success / subscribe_success
status frames — that's enough to confirm URL and protocol. AM data frames
only fire 9:30-16:00 ET.
"""
import asyncio
import json
import os
import sys

URL = os.environ.get("MASSIVE_WS_URL", "wss://socket.massive.com/stocks")
KEY = os.environ.get("MASSIVE_API_KEY", "")
SYM = os.environ.get("TEST_SYMBOL", "AAPL").upper()
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "10"))
TIMEOUT = int(os.environ.get("TIMEOUT_SEC", "20"))


async def main() -> int:
    if not KEY:
        print("ERROR: MASSIVE_API_KEY not set in environment", file=sys.stderr)
        print("Run as: MASSIVE_API_KEY=<your-key> python scripts/test_massive_ws.py", file=sys.stderr)
        return 1

    try:
        import websockets
    except ImportError:
        print("ERROR: `websockets` package not installed. Run: pip install websockets", file=sys.stderr)
        return 1

    print(f"[test] Connecting to {URL}")
    try:
        async with websockets.connect(URL, ping_interval=30, ping_timeout=10) as ws:
            print("[test] TCP/TLS connected. Sending auth...")
            await ws.send(json.dumps({"action": "auth", "params": KEY}))

            print(f"[test] Sending subscribe AM.{SYM}...")
            await ws.send(json.dumps({"action": "subscribe", "params": f"AM.{SYM}"}))

            print(f"[test] Listening for up to {MAX_FRAMES} frames (or {TIMEOUT}s)...\n")
            frames_seen = 0
            try:
                while frames_seen < MAX_FRAMES:
                    raw = await asyncio.wait_for(ws.recv(), timeout=TIMEOUT)
                    frames_seen += 1
                    print(f"--- Frame #{frames_seen} ---")
                    try:
                        parsed = json.loads(raw)
                        print(json.dumps(parsed, indent=2))
                    except json.JSONDecodeError:
                        print(repr(raw))
                    print()
            except asyncio.TimeoutError:
                print(f"[test] No more frames in {TIMEOUT}s. Closing.")
                if frames_seen == 0:
                    print("[test] WARNING: did not receive ANY frame after auth+subscribe.", file=sys.stderr)
                    print("[test] If this is during market hours, the URL or auth format is likely wrong.", file=sys.stderr)
                    return 2

            print(f"\n[test] Saw {frames_seen} frame(s). Verification complete.")
            return 0
    except Exception as e:
        print(f"[test] Connection error: {type(e).__name__}: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
