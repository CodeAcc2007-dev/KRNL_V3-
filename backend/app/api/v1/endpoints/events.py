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

def calculate_priority(event: dict, user_interests: List[str]) -> float:
    """
    Calculates the personalized priority score (0-100) for an event.
    Base score starts at importance_score (scaled to 100 if between 0 and 1).
    Boosts by +20 if any tag matches user interests. Caps at 100.
    """
    importance = float(event.get("importance_score") or 0.0)
    # If the importance score is between 0.0 and 1.0, scale to 100
    base_score = importance * 100.0 if importance <= 1.0 else importance
    
    tags = parse_tags(event.get("tags"))
    event_tags_lower = [t.lower() for t in tags]
    
    boost = 0
    if any(interest.lower() in event_tags_lower for interest in user_interests):
        boost = 20
        
    return min(base_score + boost, 100.0)

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
    
    # Expiration check
    if parsed_dt < now_ist.replace(tzinfo=None):
        return "expired"
    elif deadline_date == today_ist:
        return "today"
    elif deadline_date == today_ist + timedelta(days=1):
        return "tomorrow"
    elif deadline_date <= today_ist + timedelta(days=7):
        return "this_week"
    else:
        return "upcoming"

@router.get("/events", response_model=List[EventResponse])
def get_events(current_user: dict = Depends(get_current_user)):
    """
    Query Supabase events for the user, apply personalized interest boosts,
    and return sorted by priority descending.
    """
    user_id = current_user["user_id"]
    
    # 1. Fetch user's profile interests
    user_interests = []
    try:
        profile_res = supabase.table("profiles").select("interests").eq("id", user_id).execute()
        if profile_res.data:
            interests_str = profile_res.data[0].get("interests") or ""
            user_interests = [i.strip() for i in interests_str.split(",") if i.strip()]
    except Exception as e:
        # Gracefully handle database/profile read errors
        user_interests = []
        
    # 2. Fetch events
    try:
        events_res = supabase.table("events").select("*").eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    events_list = []
    for row in events_res.data:
        priority = calculate_priority(row, user_interests)
        urgency = get_urgency_label(row.get("deadline"))
        
        events_list.append(EventResponse(
            id=row.get("id"),
            user_id=row.get("user_id"),
            display_name=row.get("display_name"),
            deadline=row.get("deadline"),
            venue=row.get("venue"),
            category=row.get("category"),
            tags=parse_tags(row.get("tags")),
            importance_score=float(row.get("importance_score") or 0.0),
            raw_summary=row.get("raw_summary"),
            full_body=row.get("full_body"),
            raw_body=row.get("raw_body"),
            links=row.get("links"),
            has_registration=row.get("has_registration"),
            registration_link=row.get("registration_link"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            personalized_priority=priority,
            urgency_label=urgency,
            deadline_history=row.get("deadline_history") or [],
            last_update_type=row.get("last_update_type"),
            email_date=row.get("email_date"),
        ))
        
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
        events_res = supabase.table("events").select("*").eq("user_id", user_id).not_.is_("deadline", "null").execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    # Get user profile interests for priority calculation
    user_interests = []
    try:
        profile_res = supabase.table("profiles").select("interests").eq("id", user_id).execute()
        if profile_res.data:
            interests_str = profile_res.data[0].get("interests") or ""
            user_interests = [i.strip() for i in interests_str.split(",") if i.strip()]
    except Exception:
        pass
        
    deadlines_list = []
    for row in events_res.data:
        deadline_str = row.get("deadline")
        if not deadline_str:
            continue
            
        priority = calculate_priority(row, user_interests)
        urgency = get_urgency_label(deadline_str)
        
        deadlines_list.append(EventResponse(
            id=row.get("id"),
            user_id=row.get("user_id"),
            display_name=row.get("display_name"),
            deadline=deadline_str,
            venue=row.get("venue"),
            category=row.get("category"),
            tags=parse_tags(row.get("tags")),
            importance_score=float(row.get("importance_score") or 0.0),
            raw_summary=row.get("raw_summary"),
            full_body=row.get("full_body"),
            raw_body=row.get("raw_body"),
            links=row.get("links"),
            has_registration=row.get("has_registration"),
            registration_link=row.get("registration_link"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            personalized_priority=priority,
            urgency_label=urgency,
            deadline_history=row.get("deadline_history") or [],
            last_update_type=row.get("last_update_type"),
            email_date=row.get("email_date"),
        ))
        
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
    
    # Calculate single item priorities
    user_interests = []
    try:
        profile_res = supabase.table("profiles").select("interests").eq("id", user_id).execute()
        if profile_res.data:
            interests_str = profile_res.data[0].get("interests") or ""
            user_interests = [i.strip() for i in interests_str.split(",") if i.strip()]
    except Exception:
        pass
        
    priority = calculate_priority(row, user_interests)
    urgency = get_urgency_label(row.get("deadline"))
    
    return EventResponse(
        id=row.get("id"),
        user_id=row.get("user_id"),
        display_name=row.get("display_name"),
        deadline=row.get("deadline"),
        venue=row.get("venue"),
        category=row.get("category"),
        tags=parse_tags(row.get("tags")),
        importance_score=float(row.get("importance_score") or 0.0),
        raw_summary=row.get("raw_summary"),
        full_body=row.get("full_body"),
        raw_body=row.get("raw_body"),
        links=row.get("links"),
        has_registration=row.get("has_registration"),
        registration_link=row.get("registration_link"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        personalized_priority=priority,
        urgency_label=urgency,
        deadline_history=row.get("deadline_history") or [],
        last_update_type=row.get("last_update_type"),
        email_date=row.get("email_date"),
    )
