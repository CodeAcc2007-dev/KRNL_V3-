import logging
from datetime import datetime
from typing import Optional

from google.genai import types
from qdrant_client.http import models as qdrant_models
from app.services.ingestion import generate_embeddings, qdrant_client, genai_client

logger = logging.getLogger("uvicorn.error")


def parse_deadline(value: Optional[str]) -> Optional[datetime]:
    """Parse a stored deadline string (date or datetime) into a datetime, else None."""
    if not value:
        return None
    s = str(value).replace("Z", "").replace("T", " ").split(".")[0].strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def should_apply_extension(current: Optional[str], new: Optional[str]) -> bool:
    """Forward-only guard: true only when both parse and `new` is strictly later."""
    c = parse_deadline(current)
    n = parse_deadline(new)
    if c is None or n is None:
        return False
    return n > c


def confirm_same_event(email_text: str, event: dict) -> bool:
    """Confirm via a single yes/no check whether the email updates the given event."""
    prompt = (
        "Does the following email provide an update (e.g. a new deadline) for the event "
        f"named \"{event.get('display_name')}\"? Answer with only YES or NO.\n\n"
        f"Email:\n{email_text[:2000]}"
    )
    try:
        resp = genai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0),
        )
        return (resp.text or "").strip().upper().startswith("YES")
    except Exception as e:
        logger.error(f"confirm_same_event failed: {e}")
        return False


def find_matching_event(user_id: str, email_text: str, supabase, limit: int = 3) -> Optional[dict]:
    """Find the existing active event an update email refers to, or None.

    Embedding shortlist via Qdrant -> active events from Supabase -> yes/no confirm of
    the single top active candidate.
    """
    try:
        vector = generate_embeddings(email_text)
    except Exception as e:
        logger.error(f"find_matching_event embedding failed: {e}")
        return None

    try:
        res = qdrant_client.query_points(
            collection_name="krnl_email_chunks",
            query=vector,
            query_filter=qdrant_models.Filter(must=[
                qdrant_models.FieldCondition(
                    key="user_id", match=qdrant_models.MatchValue(value=user_id)
                )
            ]),
            limit=limit * 2,
        )
        points = res.points
    except Exception as e:
        logger.error(f"find_matching_event qdrant search failed: {e}")
        return None

    # Ordered, de-duplicated candidate event_ids.
    candidate_ids: list[int] = []
    for p in points:
        eid = (p.payload or {}).get("event_id")
        try:
            eid_int = int(eid)
        except (TypeError, ValueError):
            continue
        if eid_int not in candidate_ids:
            candidate_ids.append(eid_int)
        if len(candidate_ids) >= limit:
            break
    if not candidate_ids:
        return None

    try:
        rows = supabase.table("events").select("*").in_("id", candidate_ids).eq("user_id", user_id).execute().data or []
    except Exception as e:
        logger.error(f"find_matching_event supabase fetch failed: {e}")
        return None

    today = datetime.utcnow()
    by_id = {r["id"]: r for r in rows}
    for eid in candidate_ids:  # preserve Qdrant rank order
        event = by_id.get(eid)
        if not event:
            continue
        dl = parse_deadline(event.get("deadline"))
        if dl is None or dl < today:  # active = future deadline
            continue
        # Confirm only the top active candidate (caps the model call at one per email).
        return event if confirm_same_event(email_text, event) else None
    return None


def apply_extension(event: dict, new_deadline: str, update_type: Optional[str],
                    message_id: str, supabase) -> None:
    """Move the original event's deadline forward and record the change."""
    history = list(event.get("deadline_history") or [])
    history.append({
        "old": event.get("deadline"),
        "new": new_deadline,
        "message_id": message_id,
        "at": datetime.utcnow().isoformat(),
    })
    supabase.table("events").update({
        "deadline": new_deadline,
        "deadline_history": history,
        "last_update_type": update_type,
    }).eq("id", event["id"]).execute()
