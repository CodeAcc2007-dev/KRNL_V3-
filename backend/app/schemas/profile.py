from pydantic import BaseModel, Field
from typing import Optional, List

# FUTURE_PROOF_HOOK: Custom Tab Configuration
class ProfileUpdate(BaseModel):
    user_name: Optional[str] = None
    interests: Optional[str] = None
    roll_number: Optional[str] = None
    primary_department: Optional[str] = None
    inbox_tabs: Optional[List[str]] = None
    interest_slugs: Optional[List[str]] = None

# FUTURE_PROOF_HOOK: Custom Tab Configuration
class ProfileResponse(BaseModel):
    user_name: str
    interests: str
    roll_number: str
    primary_department: str
    inbox_tabs: List[str] = Field(
        default_factory=lambda: ["Important", "Opportunities", "Announcement", "Academic"]
    )
    interest_slugs: List[str] = Field(default_factory=list)
