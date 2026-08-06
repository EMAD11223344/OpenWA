from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from app.engine.manager import NeonizeSessionManager

router = APIRouter(prefix="/sessions", tags=["Sessions"])

# Global session manager reference (injected by main app)
session_manager: Optional[NeonizeSessionManager] = None

def get_manager() -> NeonizeSessionManager:
    if not session_manager:
        raise HTTPException(status_code=500, detail="Session manager not initialized")
    return session_manager

class CreateSessionRequest(BaseModel):
    sessionId: str

class SessionStatusResponse(BaseModel):
    sessionId: str
    status: str
    qrCode: Optional[str] = None
    phoneNumber: Optional[str] = None
    displayName: Optional[str] = None

@router.post("", response_model=SessionStatusResponse)
async def create_session(req: CreateSessionRequest, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.create_session(req.sessionId)
    manager.start_session(req.sessionId)
    return SessionStatusResponse(
        sessionId=session.session_id,
        status=session.status,
        qrCode=session.qr_code,
        phoneNumber=session.phone_number,
        displayName=session.push_name
    )

@router.get("/{session_id}", response_model=SessionStatusResponse)
async def get_session_status(session_id: str, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStatusResponse(
        sessionId=session.session_id,
        status=session.status,
        qrCode=session.qr_code,
        phoneNumber=session.phone_number,
        displayName=session.push_name
    )

@router.get("/{session_id}/qr")
async def get_session_qr(session_id: str, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"sessionId": session_id, "qrCode": session.qr_code}

@router.post("/{session_id}/start")
async def start_session(session_id: str, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.start_session(session_id)
    return {"sessionId": session_id, "status": session.status}

@router.post("/{session_id}/stop")
async def stop_session(session_id: str, manager: NeonizeSessionManager = Depends(get_manager)):
    success = manager.stop_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"sessionId": session_id, "status": "DISCONNECTED"}

@router.delete("/{session_id}")
async def delete_session(session_id: str, manager: NeonizeSessionManager = Depends(get_manager)):
    success = manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"sessionId": session_id, "deleted": True}

@router.get("", response_model=List[SessionStatusResponse])
async def list_sessions(manager: NeonizeSessionManager = Depends(get_manager)):
    res = []
    for s_id, session in manager.active_sessions.items():
        res.append(SessionStatusResponse(
            sessionId=session.session_id,
            status=session.status,
            qrCode=session.qr_code,
            phoneNumber=session.phone_number,
            displayName=session.push_name
        ))
    return res
