from fastapi import APIRouter, Depends, HTTPException, status
from app.core.security import get_current_user, supabase
from app.schemas.event import EventResponse
from typing import List
from datetime import datetime, timezone, timedelta

router = APIRouter()

def parse_tags(tags_data) -> List[str]:
    """
    Safely parses tags which could be stored as a list, a comma-separated string,
    or a Postgres array representation like '{tag1,tag2}'.
    """
    if not tags_data:
        return []
    if isinstance(tags_data, list):
        return [str(t) for t in tags_data]
    if isinstance(tags_data, str):
        # Handle postgres array format: {tag1,tag2}
        if tags_data.startswith("{") and tags_data.endswith("}"):
            return [t.strip().strip('"') for t in tags_data[1:-1].split(",") if t.strip()]
        return [t.strip() for t in tags_data.split(",") if t.strip()]
    return []

IMPORTANT_THRESHOLD = 60.0

# Columns for list endpoints. Omits the large HTML blobs (full_body, raw_body);
# those are loaded lazily by the single-event detail endpoint when a mail is opened.
LIST_COLUMNS = (
    "id,user_id,display_name,deadline,venue,category,tags,interest_tags,"
    "importance_score,raw_summary,links,has_registration,registration_link,"
    "created_at,updated_at,deadline_history,last_update_type,email_date"
)

# Consequence floor (0-100): mail carrying these signals is consequential if ignored
# (fees, payments, account/admin actions, mandatory deadlines). Floored so it clears the
# Important bar even when extraction under-rated it. Tunable.
CONSEQUENCE_FLOOR = 75.0
CONSEQUENCE_SIGNALS = (
    "fee", "payment", "due", "dues", "fine", "penalty", "overdue",
    "account", "deactivat", "blacklist", "mandatory", "last date",
    "registration deadline",
)


def _has_consequence(event: dict) -> bool:
    """True if the email's name/summary carries a consequence signal."""
    text = f"{event.get('display_name') or ''} {event.get('raw_summary') or ''}".lower()
    return any(sig in text for sig in CONSEQUENCE_SIGNALS)


def _grade_relevance(match_count: int) -> float:
    """Graded interest overlap: 0 -> 0, 1 -> 60, 2+ -> 100."""
    if match_count <= 0:
        return 0.0
    if match_count == 1:
        return 60.0
    return 100.0


def calculate_priority(event: dict, user_interests: List[str]) -> float:
    """
    Personalized priority (0-100), boost-only: interests promote, never demote.
    importance = importance_score scaled to 0-100, floored for consequential mail.
    With interests: max(importance, 0.4*importance + 0.6*relevance).
    Without: importance only (graceful fallback).
    """
    importance = float(event.get("importance_score") or 0.0)
    importance = importance * 100.0 if importance <= 1.0 else importance
    importance = min(importance, 100.0)

    if _has_consequence(event):
        importance = max(importance, CONSEQUENCE_FLOOR)

    if not user_interests:
        return round(importance, 1)

    event_slugs = {s.lower() for s in parse_tags(event.get("interest_tags"))}
    interest_set = {s.lower() for s in user_interests}
    relevance = _grade_relevance(len(event_slugs & interest_set))
    blend = 0.4 * importance + 0.6 * relevance
    return round(min(max(importance, blend), 100.0), 1)

def get_urgency_label(deadline_str: str) -> str:
    """
    Calculates relative urgency label relative to current local date in IST (+05:30).
    """
    if not deadline_str:
        return "upcoming"
        
    try:
        # Clean timestamp format to allow unified parsing
        clean_ts = deadline_str.replace("Z", "").replace("T", " ")
        # Handle decimal fractional seconds if present
        clean_ts = clean_ts.split(".")[0]
        parsed_dt = datetime.strptime(clean_ts, "%Y-%m-%d %H:%M:%S")
    except Exception:
        try:
            parsed_dt = datetime.strptime(clean_ts.split()[0], "%Y-%m-%d")
        except Exception:
            return "upcoming"
            
    # Indian Standard Time (+05:30)
    ist_offset = timedelta(hours=5, minutes=30)
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc + ist_offset
    
    today_ist = now_ist.date()
    deadline_date = parsed_dt.date()
    
    # Expiration check (compare by date so a deadline due today isn't
    # treated as expired just because it is stored at midnight)
    if deadline_date < today_ist:
        return "expired"
    elif deadline_date == today_ist:
        return "today"
    elif deadline_date == today_ist + timedelta(days=1):
        return "tomorrow"
    elif deadline_date <= today_ist + timedelta(days=7):
        return "this_week"
    else:
        return "upcoming"

def _get_user_interests(user_id: str) -> List[str]:
    """Fetch the user's selected interest slugs; [] on any error."""
    try:
        res = supabase.table("profiles").select("interest_slugs").eq("id", user_id).execute()
        if res.data:
            return parse_tags(res.data[0].get("interest_slugs"))
    except Exception:
        pass
    return []

def _to_event_response(row: dict, user_interests: List[str]) -> EventResponse:
    """Map a DB events row to EventResponse (shared by all event endpoints)."""
    return EventResponse(
        id=row.get("id"),
        user_id=row.get("user_id"),
        display_name=row.get("display_name"),
        deadline=row.get("deadline"),
        venue=row.get("venue"),
        category=row.get("category"),
        tags=parse_tags(row.get("tags")),
        interest_tags=parse_tags(row.get("interest_tags")),
        importance_score=float(row.get("importance_score") or 0.0),
        raw_summary=row.get("raw_summary"),
        full_body=row.get("full_body"),
        raw_body=row.get("raw_body"),
        links=row.get("links"),
        has_registration=row.get("has_registration"),
        registration_link=row.get("registration_link"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        personalized_priority=calculate_priority(row, user_interests),
        urgency_label=get_urgency_label(row.get("deadline")),
        deadline_history=row.get("deadline_history") or [],
        last_update_type=row.get("last_update_type"),
        email_date=row.get("email_date"),
    )

@router.get("/events", response_model=List[EventResponse])
def get_events(current_user: dict = Depends(get_current_user)):
    """
    Query Supabase events for the user, apply personalized interest boosts,
    and return sorted by priority descending.
    """
    user_id = current_user["user_id"]

    user_interests = _get_user_interests(user_id)

    try:
        events_res = supabase.table("events").select(LIST_COLUMNS).eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )

    events_list = [_to_event_response(row, user_interests) for row in events_res.data]
    # Sort by latest email first (email_date), falling back to ingest time.
    events_list.sort(key=lambda e: e.email_date or e.created_at or "", reverse=True)
    return events_list

@router.get("/deadlines", response_model=List[EventResponse])
def get_deadlines(current_user: dict = Depends(get_current_user)):
    """
    Get all events with deadlines, sorted chronologically, with relative urgency labels.
    """
    user_id = current_user["user_id"]
    
    try:
        # Get events where deadline is not null
        events_res = supabase.table("events").select(LIST_COLUMNS).eq("user_id", user_id).not_.is_("deadline", "null").execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )

    user_interests = _get_user_interests(user_id)
    deadlines_list = [
        _to_event_response(row, user_interests)
        for row in events_res.data
        if row.get("deadline")
    ]
    # Sort chronologically by deadline ascending
    deadlines_list.sort(key=lambda e: e.deadline or "")
    return deadlines_list

@router.get("/events/{id}", response_model=EventResponse)
def get_event_detail(id: int, current_user: dict = Depends(get_current_user)):
    """
    Get full details of a single event by ID.
    """
    user_id = current_user["user_id"]
    try:
        res = supabase.table("events").select("*").eq("id", id).eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )
        
    row = res.data[0]
    return _to_event_response(row, _get_user_interests(user_id))
