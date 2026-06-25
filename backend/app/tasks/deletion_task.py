import logging
from app.core.celery_app import celery_app
from datetime import datetime, timezone
from app.services.deletion import execute_full_cascade_wipe, supabase_admin

logger = logging.getLogger("celery")

@celery_app.task(name="app.tasks.deletion_task.check_and_execute_matured_deletions")
def check_and_execute_matured_deletions():
    """
    Celery periodic task to find matured account deletion requests (older than 24 hours)
    and execute the full cascade data wipe.
    """
    logger.info("Running matured account deletion checker task...")
    
    now_str = datetime.now(timezone.utc).isoformat()
    try:
        # Query deletion_requests where due_at is less than or equal to current time
        response = supabase_admin.table("deletion_requests").select("user_id, due_at").lte("due_at", now_str).execute()
    except Exception as e:
        logger.error(f"Failed to query matured deletion requests from Supabase: {str(e)}")
        return {"status": "error", "message": f"Query failed: {str(e)}"}
        
    matured_requests = response.data or []
    if not matured_requests:
        logger.info("No matured deletion requests found.")
        return {"status": "success", "processed": 0}
        
    logger.info(f"Found {len(matured_requests)} matured deletion requests to execute.")
    processed_count = 0
    
    for req in matured_requests:
        user_id = req.get("user_id")
        due_at = req.get("due_at")
        logger.info(f"Executing scheduled wipe for user {user_id} (scheduled due_at: {due_at})")
        try:
            # Execute full cascade wipe across all microservices and databases
            execute_full_cascade_wipe(user_id)
            
            # Remove from deletion_requests
            supabase_admin.table("deletion_requests").delete().eq("user_id", user_id).execute()
            processed_count += 1
        except Exception as e:
            logger.error(f"Error executing cascade wipe for user {user_id}: {str(e)}")
            
    logger.info(f"Finished processing deletions. Successfully wiped {processed_count} matured users.")
    return {"status": "success", "processed": processed_count}
