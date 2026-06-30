from fastapi import APIRouter, Depends, Body
from app.core.security import get_current_user, supabase
from app.core.config import settings

router = APIRouter()


@router.get("/notifications/vapid-public-key")
def get_vapid_public_key(current_user: dict = Depends(get_current_user)):
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/notifications/subscribe")
def subscribe(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    keys = payload.get("keys") or {}
    row = {
        "user_id": current_user["user_id"],
        "endpoint": payload.get("endpoint"),
        "p256dh": keys.get("p256dh"),
        "auth": keys.get("auth"),
    }
    supabase.table("push_subscriptions").upsert(row, on_conflict="endpoint").execute()
    return {"status": "subscribed"}


@router.post("/notifications/unsubscribe")
def unsubscribe(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    endpoint = payload.get("endpoint")
    if endpoint:
        supabase.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
    return {"status": "unsubscribed"}
