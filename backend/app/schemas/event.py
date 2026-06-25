from pydantic import BaseModel
from typing import Optional, List, Any

class EventResponse(BaseModel):
    id: int
    user_id: str
    display_name: str
    deadline: Optional[str] = None
    venue: Optional[str] = None
    category: Optional[str] = None
    tags: Any = None  # Can be array/list or string depending on DB serialization
    importance_score: float
    raw_summary: Optional[str] = None
    full_body: Optional[str] = None
    raw_body: Optional[str] = None
    links: Optional[List[str]] = None
    has_registration: Optional[bool] = None
    registration_link: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    personalized_priority: Optional[float] = None
    urgency_label: Optional[str] = None
    deadline_history: Optional[List[Any]] = None
    last_update_type: Optional[str] = None
    email_date: Optional[str] = None
