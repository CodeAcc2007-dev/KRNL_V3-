from fastapi import APIRouter, Depends, HTTPException, status
from app.core.security import get_current_user, supabase
from app.core.celery_app import celery_app
from app.tasks.sync_task import run_email_sync
from celery.result import AsyncResult
from typing import List, Dict, Any

router = APIRouter()

@router.post("/sync/trigger", status_code=status.HTTP_202_ACCEPTED)
def trigger_sync(current_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Finds active connected accounts for the user, triggers the Celery email sync task,
    and returns the task_id immediately.
    """
    user_id = current_user["user_id"]
    try:
        # Fetch connected accounts for user
        response = supabase.table("connected_accounts").select("*").eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    accounts = response.data
    # Filter for active accounts (connection_status='connected')
    active_accounts = [acc for acc in accounts if acc.get("connection_status") == "connected"]
    
    if not active_accounts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active connected email accounts found. Connect an account in Settings first."
        )
        
    task_ids = []
    for account in active_accounts:
        # Trigger Celery task asynchronously
        task = run_email_sync.delay(user_id, account["id"])
        task_ids.append(task.id)
        
    return {
        "status": "triggered",
        "task_id": task_ids[0] if task_ids else None,
        "task_ids": task_ids
    }

@router.get("/sync/status/{task_id}")
def get_sync_status(task_id: str) -> Dict[str, Any]:
    """
    Returns the task execution state (PENDING, STARTED, SUCCESS, FAILURE, etc.).
    """
    res = AsyncResult(task_id, app=celery_app)
    return {
        "task_id": task_id,
        "status": res.state
    }
