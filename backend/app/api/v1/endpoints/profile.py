from fastapi import APIRouter, Depends, HTTPException, status
from app.core.security import get_current_user, supabase
from app.schemas.profile import ProfileUpdate, ProfileResponse
from datetime import datetime, timezone

router = APIRouter()

# FUTURE_PROOF_HOOK: Custom Tab Configuration
DEFAULT_TABS = ["Important", "Opportunities", "Announcement", "Academic"]

@router.get("/profile", response_model=ProfileResponse)
def get_profile(current_user: dict = Depends(get_current_user)):
    """
    Get the authenticated user's profile from Supabase.
    If no profile row exists, returns a safe default profile response.
    """
    user_id = current_user["user_id"]
    try:
        response = supabase.table("profiles").select("*").eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
    
    # Safely return default profile if row does not exist
    if not response.data:
        return ProfileResponse(
            user_name="IITB Student",
            interests="",
            roll_number="",
            primary_department="",
            inbox_tabs=DEFAULT_TABS
        )
    
    profile_data = response.data[0]
    # Handle DB missing column or null value fallback
    inbox_tabs = profile_data.get("inbox_tabs")
    if inbox_tabs is None:
        inbox_tabs = DEFAULT_TABS

    return ProfileResponse(
        user_name=profile_data.get("user_name") or "IITB Student",
        interests=profile_data.get("interests") or "",
        roll_number=profile_data.get("roll_number") or "",
        primary_department=profile_data.get("primary_department") or "",
        inbox_tabs=inbox_tabs
    )

@router.post("/profile", response_model=ProfileResponse)
def update_profile(
    payload: ProfileUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Upsert the payload into the Supabase 'profiles' table for the authenticated user.
    """
    user_id = current_user["user_id"]
    
    data = payload.model_dump(exclude_unset=True)
    data["id"] = user_id
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    try:
        response = supabase.table("profiles").upsert(data, default_to_null=False).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile"
        )
        
    profile_data = response.data[0]
    inbox_tabs = profile_data.get("inbox_tabs")
    if inbox_tabs is None:
        inbox_tabs = DEFAULT_TABS

    return ProfileResponse(
        user_name=profile_data.get("user_name") or "IITB Student",
        interests=profile_data.get("interests") or "",
        roll_number=profile_data.get("roll_number") or "",
        primary_department=profile_data.get("primary_department") or "",
        inbox_tabs=inbox_tabs
    )
