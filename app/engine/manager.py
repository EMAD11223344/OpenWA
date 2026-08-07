import os
import asyncio
import logging
from typing import Dict, Optional, Any
from neonize.client import NewClient
from neonize.events import ConnectedEv, MessageEv, PairStatusEv, QREv

logger = logging.getLogger("neonize-gateway")

class SessionInfo:
    def __init__(self, session_id: str, db_path: str):
        self.session_id = session_id
        self.db_path = db_path
        self.client: Optional[NewClient] = None
        self.status = "DISCONNECTED" # DISCONNECTED, CONNECTING, SCANNED, CONNECTED
        self.qr_code: Optional[str] = None
        self.phone_number: Optional[str] = None
        self.push_name: Optional[str] = None

def _clean_db_files(db_path: str):
    for suffix in ["", "-wal", "-shm", "-journal"]:
        target = db_path + suffix if suffix else db_path
        if os.path.exists(target):
            try:
                os.remove(target)
            except Exception as e:
                logger.warning(f"Could not remove SQLite file {target}: {e}")

class NeonizeSessionManager:
    def __init__(self, data_dir: str = "./data", socket_sio: Any = None):
        self.data_dir = data_dir
        self.sessions_dir = os.path.join(data_dir, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        self.sio = socket_sio
        self.active_sessions: Dict[str, SessionInfo] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        try:
            self.loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def set_sio(self, sio_instance: Any):
        self.sio = sio_instance
        try:
            self.loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def get_session(self, session_id: str) -> Optional[SessionInfo]:
        return self.active_sessions.get(session_id)

    async def emit_event(self, event_name: str, payload: dict):
        if self.sio:
            try:
                await self.sio.emit(event_name, payload)
            except Exception as e:
                logger.error(f"Error emitting Socket.IO event {event_name}: {e}")

    def create_session(self, session_id: str) -> SessionInfo:
        if session_id in self.active_sessions:
            return self.active_sessions[session_id]

        db_path = os.path.join(self.sessions_dir, f"{session_id}.sqlite3")
        _clean_db_files(db_path)
        session = SessionInfo(session_id, db_path)
        
        try:
            client = NewClient(db_path)
            session.client = client
            session.status = "CONNECTING"
            self._register_client_events(session)
        except Exception as e:
            logger.error(f"Failed to create Neonize client for session {session_id}: {e}")
            session.status = "ERROR"

        self.active_sessions[session_id] = session
        return session

    def _register_client_events(self, session: SessionInfo):
        client = session.client
        if not client:
            return

        @client.event(QREv)
        def on_qr(client_inst: NewClient, qr: QREv):
            session.status = "CONNECTING"
            session.qr_code = qr.code
            logger.info(f"[{session.session_id}] New QR Code generated")
            if self.sio:
                target_loop = self.loop or asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(
                    self.emit_event("session.qr", {
                        "sessionId": session.session_id,
                        "qr": qr.code
                    }),
                    target_loop
                )

        @client.event(ConnectedEv)
        def on_connected(client_inst: NewClient, evt: ConnectedEv):
            session.status = "CONNECTED"
            session.qr_code = None
            if hasattr(client_inst, "me") and client_inst.me:
                session.phone_number = getattr(client_inst.me, "User", "")
                session.push_name = getattr(client_inst.me, "PushName", None)
            logger.info(f"[{session.session_id}] Connected as {session.phone_number}")
            if self.sio:
                target_loop = self.loop or asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(
                    self.emit_event("session.status", {
                        "sessionId": session.session_id,
                        "status": "CONNECTED",
                        "phoneNumber": session.phone_number,
                        "displayName": session.push_name
                    }),
                    target_loop
                )

        @client.event(MessageEv)
        def on_message(client_inst: NewClient, message: MessageEv):
            sender = getattr(message.Info, "Sender", "")
            msg_id = getattr(message.Info, "ID", "")
            timestamp = getattr(message.Info, "Timestamp", 0)
            is_group = getattr(message.Info, "IsGroup", False)
            logger.info(f"[{session.session_id}] Received message from {sender}")
            if self.sio:
                target_loop = self.loop or asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(
                    self.emit_event("message.received", {
                        "sessionId": session.session_id,
                        "from": str(sender),
                        "id": str(msg_id),
                        "timestamp": timestamp,
                        "isGroup": is_group,
                        "message": str(message.Message)
                    }),
                    target_loop
                )

    def start_session(self, session_id: str):
        session = self.get_session(session_id)
        if not session:
            session = self.create_session(session_id)

        if session.client:
            def _connect():
                import time
                max_retries = 5
                for attempt in range(1, max_retries + 1):
                    try:
                        logger.info(f"[{session_id}] Connecting to WhatsApp Web (attempt {attempt}/{max_retries})...")
                        session.client.connect()
                        break
                    except Exception as e:
                        err_msg = str(e)
                        logger.error(f"[{session_id}] Neonize connect error (attempt {attempt}): {err_msg}")
                        if attempt < max_retries:
                            logger.warning(f"[{session_id}] Network timeout/error. Retrying in 3s (attempt {attempt + 1}/{max_retries})...")
                            time.sleep(3)
                        else:
                            logger.error(f"[{session_id}] Max connection retries ({max_retries}) reached.")

            loop = asyncio.get_event_loop()
            self.loop = loop
            loop.run_in_executor(None, _connect)
        return session

    def stop_session(self, session_id: str) -> bool:
        session = self.active_sessions.get(session_id)
        if not session:
            return False
        
        if session.client:
            try:
                session.client.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting session {session_id}: {e}")
        
        session.status = "DISCONNECTED"
        return True

    def delete_session(self, session_id: str) -> bool:
        self.stop_session(session_id)
        session = self.active_sessions.pop(session_id, None)
        if session:
            _clean_db_files(session.db_path)
        return True
