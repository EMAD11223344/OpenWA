import logging
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.engine.manager import NeonizeSessionManager
from app.routes import sessions, messages, contacts

logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("neonize-gateway")

# Socket.IO ASGI Server
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
session_manager = NeonizeSessionManager(data_dir=settings.DATA_DIR, socket_sio=sio)

# Provide session_manager to route modules
sessions.session_manager = session_manager
messages.session_manager = session_manager
contacts.session_manager = session_manager

app = FastAPI(
    title="Neonize WhatsApp Gateway",
    description="High-performance Python FastAPI microservice wrapping Neonize/whatsmeow multi-device engine",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(sessions.router)
app.include_router(messages.router)
app.include_router(contacts.router)

@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "engine": "Neonize",
        "activeSessions": len(session_manager.active_sessions)
    }

@sio.event
async def connect(sid, environ):
    logger.info(f"Socket.IO client connected: {sid}")

@sio.event
async def disconnect(sid):
    logger.info(f"Socket.IO client disconnected: {sid}")

# Combine FastAPI and Socket.IO into single ASGI app
asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)
