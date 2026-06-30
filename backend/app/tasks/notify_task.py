"""Scheduled notification tasks: 24h deadline reminders and the weekly digest."""
import logging
from datetime import datetime, timezone, timedelta
from supabase import create_client
from app.core.celery_app import celery_app
from app.core.config import settings
from app.services.push import send_to_user

logger = logging.getLogger("uvicorn.error")

supabase_service = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def _parse_deadline(value: str):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


@celery_app.task
def send_due_reminders() -> dict:
    """Push a one-time reminder for events whose deadline is within the next 24h."""
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=24)
    try:
        rows = supabase_service.table("events").select(
            "id,user_id,display_name,deadline,deadline_reminded"
        ).eq("deadline_reminded", False).execute().data or []
    except Exception as e:
        logger.error(f"reminder query failed: {e}")
        return {"reminded": 0}

    reminded = 0
    for ev in rows:
        dl = _parse_deadline(ev.get("deadline") or "")
        if not dl:
            continue
        if dl.tzinfo is None:
            dl = dl.replace(tzinfo=timezone.utc)
        if not (now <= dl <= horizon):
            continue
        payload = {"title": "Deadline tomorrow", "body": ev.get("display_name") or "",
                   "url": f"/?event={ev['id']}"}
        try:
            send_to_user(supabase_service, ev["user_id"], payload, "reminders")
            supabase_service.table("events").update(
                {"deadline_reminded": True}).eq("id", ev["id"]).execute()
            reminded += 1
        except Exception as e:
            logger.warning(f"reminder send failed for event {ev['id']}: {e}")
    logger.info(f"Deadline reminders sent: {reminded}")
    return {"reminded": reminded}
