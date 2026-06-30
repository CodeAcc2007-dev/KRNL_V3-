"""Web Push delivery: gate by prefs, send via pywebpush, prune dead subscriptions."""
import json
import logging
from pywebpush import webpush, WebPushException
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

DEFAULT_PREFS = {"master": True, "important": True, "reminders": True, "digest": True}


def _prefs_for(client, user_id: str) -> dict:
    try:
        res = client.table("profiles").select("notification_prefs").eq("id", user_id).execute()
        if res.data:
            return {**DEFAULT_PREFS, **(res.data[0].get("notification_prefs") or {})}
    except Exception as e:
        logger.warning(f"notification_prefs load failed for {user_id}: {e}")
    return dict(DEFAULT_PREFS)


def _send_one(sub: dict, payload: dict) -> None:
    """Send one push. Raises WebPushException on transport failure."""
    webpush(
        subscription_info={
            "endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
        },
        data=json.dumps(payload),
        vapid_private_key=settings.VAPID_PRIVATE_KEY.replace("\\n", "\n"),
        vapid_claims={"sub": settings.VAPID_SUBJECT},
    )


def send_to_user(client, user_id: str, payload: dict, kind: str) -> int:
    """Push `payload` to all of the user's subscriptions if prefs allow. Returns count sent."""
    if not settings.VAPID_PRIVATE_KEY:
        return 0
    prefs = _prefs_for(client, user_id)
    if not prefs.get("master") or not prefs.get(kind):
        return 0
    try:
        subs = client.table("push_subscriptions").select("*").eq("user_id", user_id).execute().data or []
    except Exception as e:
        logger.warning(f"subscription load failed for {user_id}: {e}")
        return 0

    sent = 0
    for sub in subs:
        try:
            _send_one(sub, payload)
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                try:
                    client.table("push_subscriptions").delete().eq("endpoint", sub["endpoint"]).execute()
                except Exception as del_err:
                    logger.warning(f"failed to prune dead subscription: {del_err}")
            else:
                logger.warning(f"push failed (endpoint kept): {e}")
        except Exception as e:
            logger.warning(f"push error: {e}")
    return sent
