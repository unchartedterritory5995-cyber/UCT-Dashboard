# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ADD TO YOUR EXISTING main.py
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1. Import the new router and startup function
from .uw_ws_router import router as ws_router
from .uw_websocket import start_uw_listener

# 2. Include the WebSocket router (add alongside your existing routers)
app.include_router(ws_router)

# 3. Start the UW listener on app startup
@app.on_event("startup")
async def startup_event():
    start_uw_listener()
    # ... your other startup tasks ...

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ALSO: pip install websockets (add to requirements.txt)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
