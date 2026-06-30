"""Scheduled notification tasks: 24h deadline reminders and the weekly digest."""
import logging
from datetime import datetime, timezone, timedelta
from app.core.celery_app import celery_app
from app.core.security import supabase as supabase_service
from app.services.push import send_to_user

logger = logging.getLogger("uvicorn.error")

# Deadlines are stored as naive IST wall-clock (see ingestion + Deadlines view),
# so reminder windows are computed in IST too.
IST = timezone(timedelta(hours=5, minutes=30))


def _parse_deadline(value: str):
    """Parse a stored deadline into naive IST wall-clock, or None."""
    try:
        dl = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    # Any tz-aware value is normalized into IST then made naive; naive values
    # are already IST wall-clock and used as-is.
    if dl.tzinfo is not None:
        dl = dl.astimezone(IST).replace(tzinfo=None)
    return dl


@celery_app.task
def send_due_reminders() -> dict:
    """Push a one-time reminder for events whose deadline is within the next 24h."""
    now = datetime.now(IST).replace(tzinfo=None)
    horizon = now + timedelta(hours=24)
    try:
        rows = supabase_service.table("events").select(
            "id,user_id,display_name,deadline,deadline_reminded"
        ).eq("deadline_reminded", False).not_.is_("deadline", "null").execute().data or []
    except Exception as e:
        logger.error(f"reminder query failed: {e}")
        return {"reminded": 0}

    reminded = 0
    for ev in rows:
        dl = _parse_deadline(ev.get("deadline") or "")
        if not dl:
            continue
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


@celery_app.task
def send_weekly_digest() -> dict:
    """One weekly catch-up push per subscribed user."""
    try:
        subs = supabase_service.table("push_subscriptions").select("user_id").execute().data or []
    except Exception as e:
        logger.error(f"digest subscriber query failed: {e}")
        return {"users": 0}

    user_ids = {s["user_id"] for s in subs if s.get("user_id")}
    for uid in user_ids:
        payload = {"title": "Your week in KRNL",
                   "body": "Catch up on this week's important mail and deadlines.",
                   "url": "/"}
        try:
            send_to_user(supabase_service, uid, payload, "digest")
        except Exception as e:
            logger.warning(f"digest send failed for {uid}: {e}")
    logger.info(f"Weekly digest sent to {len(user_ids)} user(s).")
    return {"users": len(user_ids)}
