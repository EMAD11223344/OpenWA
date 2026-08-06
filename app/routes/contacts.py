from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from app.routes.sessions import get_manager, NeonizeSessionManager
from app.routes.messages import format_jid

router = APIRouter(prefix="/contacts", tags=["Contacts"])

class ContactResponse(BaseModel):
    jid: str
    name: Optional[str] = None
    isOnWhatsApp: bool = True

@router.get("/{session_id}/{phone}", response_model=ContactResponse)
async def check_contact(session_id: str, phone: str, manager: NeonizeSessionManager = Depends(get_manager)):
    session = manager.get_session(session_id)
    if not session or not session.client or session.status != "CONNECTED":
        raise HTTPException(status_code=400, detail="Session not active or connected")

    try:
        jid = format_jid(phone)
        res = session.client.is_on_whatsapp(jid)
        return ContactResponse(
            jid=str(jid),
            isOnWhatsApp=res.IsIn or True
        )
    except Exception as e:
        return ContactResponse(jid=phone, isOnWhatsApp=False)
