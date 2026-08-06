import logging
import socketio
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
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

@app.get("/", response_class=HTMLResponse)
async def root_dashboard():
    active_count = len(session_manager.active_sessions)
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Neonize WhatsApp Gateway</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }}
            body {{ background-color: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }}
            .card {{ background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; width: 100%; max-width: 500px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }}
            .header {{ display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }}
            .status-dot {{ width: 12px; height: 12px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }}
            h1 {{ font-size: 20px; font-weight: 700; color: #ffffff; }}
            p {{ color: #9ca3af; font-size: 13px; margin-bottom: 24px; line-height: 1.5; }}
            .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }}
            .stat {{ background: #1f2937; border: 1px solid #374151; padding: 14px; border-radius: 12px; }}
            .stat-label {{ font-size: 11px; color: #9ca3af; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }}
            .stat-val {{ font-size: 16px; font-weight: 700; color: #10b981; margin-top: 4px; }}
            .actions {{ display: flex; gap: 10px; }}
            a {{ flex: 1; text-align: center; text-decoration: none; padding: 10px; border-radius: 8px; font-size: 12px; font-weight: 600; transition: all 0.2s; }}
            .btn-primary {{ background: #10b981; color: #ffffff; }}
            .btn-primary:hover {{ background: #059669; }}
            .btn-secondary {{ background: #1f2937; color: #d1d5db; border: 1px solid #374151; }}
            .btn-secondary:hover {{ background: #374151; }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="header">
                <div class="status-dot"></div>
                <h1>Neonize WhatsApp Gateway</h1>
            </div>
            <p>High-performance Python microservice wrapping Go's <code>whatsmeow</code> multi-device protocol. Operating at sub-second speeds with lightweight resource consumption.</p>
            <div class="grid">
                <div class="stat">
                    <div class="stat-label">Gateway Status</div>
                    <div class="stat-val">ONLINE 🟢</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Active Sessions</div>
                    <div class="stat-val">{active_count} Sessions</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Engine Core</div>
                    <div class="stat-val">whatsmeow Go</div>
                </div>
                <div class="stat">
                    <div class="stat-label">RAM Footprint</div>
                    <div class="stat-val">~25 MB</div>
                </div>
            </div>
            <div class="actions">
                <a href="/docs" class="btn-primary" target="_blank">Interactive Swagger Docs</a>
                <a href="/health" class="btn-secondary" target="_blank">Health Check API</a>
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

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
