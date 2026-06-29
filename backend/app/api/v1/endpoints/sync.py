from fastapi import APIRouter, Depends, HTTPException, status
from app.core.security import get_current_user, supabase
from app.core.celery_app import celery_app
from app.core.rate_limit import allow_request
from app.tasks.sync_task import run_email_sync
from celery.result import AsyncResult
from typing import List, Dict, Any
import logging

logger = logging.getLogger("uvicorn.error")
router = APIRouter()

@router.post("/sync/trigger", status_code=status.HTTP_202_ACCEPTED)
def trigger_sync(current_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Finds active connected accounts for the user, triggers the Celery email sync task,
    and returns the task_id immediately. If Celery/Redis is down, falls back to
    synchronous execution.
    """
    user_id = current_user["user_id"]

    # One trigger per user per minute — each fans out real IMAP + throttled Gemini work.
    if not allow_request(f"ratelimit:sync:{user_id}", limit=1, window_seconds=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A sync was just triggered. Please wait a moment before syncing again."
        )

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
    fallback_executed = False
    for account in active_accounts:
        try:
            # Trigger Celery task asynchronously
            task = run_email_sync.delay(user_id, account["id"])
            task_ids.append(task.id)
        except Exception as e:
            logger.warning(f"Failed to queue celery task for account {account['id']}: {e}. Falling back to sync execution.")
            try:
                # Fallback to synchronous run using .apply(). Cap emails low so the
                # blocking request returns quickly (13s/email throttle) instead of timing out.
                run_email_sync.apply(args=[user_id, account["id"], 3])
                fallback_executed = True
            except Exception as sync_err:
                logger.error(f"Synchronous fallback sync failed: {sync_err}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Email sync failed: {str(sync_err)}"
                )
        
    return {
        "status": "completed" if fallback_executed else "triggered",
        "task_id": task_ids[0] if task_ids else None,
        "task_ids": task_ids
    }

@router.get("/sync/status/{task_id}")
def get_sync_status(
    task_id: str, current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Returns the task execution state (PENDING, STARTED, SUCCESS, FAILURE, etc.).
    """
    res = AsyncResult(task_id, app=celery_app)
    return {
        "task_id": task_id,
        "status": res.state
    }
