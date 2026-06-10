from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from app.core.security import get_current_user
from app.services.deletion import supabase_admin

router = APIRouter()

class DeletionRequestPayload(BaseModel):
    confirmation: str = Field(..., description="Must be exactly 'DELETE' to confirm deletion request.")

@router.get("/user/delete-request")
def check_deletion_request(current_user: dict = Depends(get_current_user)):
    """
    Check if a deletion request is currently scheduled for the user.
    """
    user_id = current_user["user_id"]
    try:
        response = supabase_admin.table("deletion_requests").select("*").eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error checking deletion request: {str(e)}"
        )
    if response.data:
        return {"scheduled": True, "due_at": response.data[0]["due_at"]}
    return {"scheduled": False}

@router.post("/user/delete-request")
def request_deletion(payload: DeletionRequestPayload, current_user: dict = Depends(get_current_user)):
    """
    Schedule a new user deletion request with a 24-hour grace period.
    """
    if payload.confirmation != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation string must be exactly 'DELETE'."
        )
        
    user_id = current_user["user_id"]
    due_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    
    data = {
        "user_id": user_id,
        "due_at": due_at
    }
    
    try:
        response = supabase_admin.table("deletion_requests").upsert(data).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to schedule deletion: {str(e)}"
        )
        
    return {
        "status": "scheduled",
        "due_at": due_at,
        "message": "Your account deletion has been scheduled. It will be executed in 24 hours."
    }

@router.post("/user/delete-cancel")
def cancel_deletion(current_user: dict = Depends(get_current_user)):
    """
    Cancel any pending user deletion requests.
    """
    user_id = current_user["user_id"]
    try:
        response = supabase_admin.table("deletion_requests").delete().eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel deletion request: {str(e)}"
        )
        
    return {
        "status": "cancelled",
        "message": "Your account deletion request has been successfully cancelled."
    }
