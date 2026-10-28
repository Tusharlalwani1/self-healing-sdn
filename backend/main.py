import logging
import os
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import FRONTEND_DIST, HOST, PORT
from backend.database.db import init_db, get_event_logs
from backend.websocket.manager import ws_manager
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.api import (
    system_router,
    controllers_router,
    simulation_router,
    topology_router,
    links_router,
    traffic_router,
    experiments_router,
    reports_router
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] (backend) %(message)s'
)
logger = logging.getLogger("sdn.main")

app = FastAPI(
    title="Self-Healing SDN Control Center",
    description="Professional Network Operations Center (NOC) Dashboard for OpenFlow 1.3 Self-Healing SDN",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(system_router)
app.include_router(controllers_router)
app.include_router(simulation_router)
app.include_router(topology_router)
app.include_router(links_router)
app.include_router(traffic_router)
app.include_router(experiments_router)
app.include_router(reports_router)

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing SQLite database...")
    init_db()
    logger.info("SDN Control Center backend initialized.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down SDN Control Center backend...")
    try:
        await controller_manager.stop_controller()
    except Exception as e:
        logger.warning(f"Error stopping controller on shutdown: {e}")
    try:
        await mininet_client.stop_simulation()
    except Exception as e:
        logger.warning(f"Error stopping Mininet on shutdown: {e}")

@app.websocket("/ws/events")
async def websocket_events_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Send initial state snapshot on connection
        await websocket.send_json({
            "event_type": "INITIAL_STATE",
            "controller": controller_manager.active_controller,
            "controller_status": controller_manager.status,
            "simulation_state": mininet_client.simulation_state,
            "active_paths": controller_manager.active_paths,
            "timestamp": time.time()
        })
        while True:
            # Keep-alive ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.debug(f"WebSocket client error: {e}")
        await ws_manager.disconnect(websocket)

@app.get("/api/events/logs")
async def get_system_event_logs(limit: int = 100):
    return get_event_logs(limit)

# Mount static files if frontend is built
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return None
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=False)
