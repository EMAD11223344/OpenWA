from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from neonize.types import JID
from app.routes.sessions import get_manager, NeonizeSessionManager

router = APIRouter(prefix="/messages", tags=["Messages"])

class SendTextRequest(BaseModel):
    sessionId: str
    to: str
    body: str
    replyToId: Optional[str] = None

class MessageResponse(BaseModel):
    success: bool
    messageId: Optional[str] = None
    detail: Optional[str] = None

def format_jid(phone: str) -> JID:
    clean_phone = phone.replace("+", "").replace(" ", "").replace("-", "")
    if "@s.whatsapp.net" not in clean_phone and "@g.us" not in clean_phone:
        clean_phone += "@s.whatsapp.net"
    return JID.from_string(clean_phone)

@router.post("/send-text", response_model=MessageResponse)
async def send_text(req: SendTextRequest, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.get_session(req.sessionId)
    if not session or not session.client or session.status != "CONNECTED":
        raise HTTPException(status_code=400, detail="Session not active or connected")

    try:
        jid = format_jid(req.to)
        resp = session.client.send_message(jid, req.body)
        msg_id = str(resp.ID) if hasattr(resp, "ID") else "sent"
        return MessageResponse(success=True, messageId=msg_id)
    except Exception as e:
        return MessageResponse(success=False, detail=str(e))

class ReactRequest(BaseModel):
    sessionId: str
    to: str
    messageId: str
    emoji: str

@router.post("/react", response_model=MessageResponse)
async def react_message(req: ReactRequest, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.get_session(req.sessionId)
    if not session or not session.client or session.status != "CONNECTED":
        raise HTTPException(status_code=400, detail="Session not active or connected")

    try:
        jid = format_jid(req.to)
        # Send reaction
        session.client.react(jid, req.messageId, req.emoji)
        return MessageResponse(success=True, messageId=req.messageId)
    except Exception as e:
        return MessageResponse(success=False, detail=str(e))
