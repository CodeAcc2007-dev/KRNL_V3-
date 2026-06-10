import logging
from supabase import create_client, Client
from qdrant_client.http import models as qdrant_models
from app.core.config import settings
from app.core.celery_app import celery_app
from app.services.ingestion import qdrant_client
from app.services.semantic_cache import redis_client

logger = logging.getLogger("uvicorn.error")

# Service client for admin access to bypass RLS and delete auth users
supabase_admin: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

def cancel_user_celery_tasks(user_id: str):
    """
    Query active, reserved, and scheduled tasks in Celery, find run_email_sync tasks
    associated with the given user_id, and revoke/terminate them.
    """
    try:
        inspector = celery_app.control.inspect()
        if not inspector:
            logger.warning("Celery inspector not available. Skipping Celery task revocation.")
            return

        active = inspector.active() or {}
        reserved = inspector.reserved() or {}
        scheduled = inspector.scheduled() or {}
        
        task_ids_to_revoke = set()
        
        def check_tasks(worker_tasks):
            if not worker_tasks:
                return
            for worker, tasks in worker_tasks.items():
                for t in tasks:
                    if t.get("name") == "app.tasks.sync_task.run_email_sync":
                        args = t.get("args") or []
                        kwargs = t.get("kwargs") or {}
                        # Check user_id in arguments
                        if (len(args) > 0 and str(args[0]) == str(user_id)) or str(kwargs.get("user_id")) == str(user_id):
                            task_ids_to_revoke.add(t.get("id"))
                            
        check_tasks(active)
        check_tasks(reserved)
        check_tasks(scheduled)
        
        for tid in task_ids_to_revoke:
            logger.info(f"Revoking Celery task: {tid} for user: {user_id}")
            celery_app.control.revoke(tid, terminate=True, signal="SIGTERM")
            
    except Exception as e:
        logger.error(f"Failed to cancel Celery tasks for user {user_id}: {str(e)}")

def execute_full_cascade_wipe(user_id: str):
    """
    GDPR-compliant multi-system deletion cascade.
    Wipes user data across Celery, Qdrant, Redis, Supabase DB, and Supabase Auth.
    """
    logger.info(f"Initiating full GDPR deletion cascade for user: {user_id}")
    
    # 1. Celery task cancellation
    try:
        cancel_user_celery_tasks(user_id)
        logger.info(f"Celery task revocation completed for user: {user_id}")
    except Exception as e:
        logger.error(f"Error during Celery task revocation step: {str(e)}")

    # 2. Qdrant vector footprint wipe
    try:
        qdrant_client.delete_points(
            collection_name="krnl_email_chunks",
            points=qdrant_models.Filter(
                must=[
                    qdrant_models.FieldCondition(
                        key="user_id",
                        match=qdrant_models.MatchValue(value=user_id)
                    )
                ]
            ),
            wait=True
        )
        logger.info(f"Qdrant vector footprint wiped for user: {user_id}")
    except Exception as e:
        logger.error(f"Error during Qdrant wipe step: {str(e)}")

    # 3. Redis semantic cache wipe
    try:
        pattern = f"cache:{user_id}:*"
        keys = redis_client.keys(pattern)
        if keys:
            redis_client.delete(*keys)
            logger.info(f"Deleted {len(keys)} semantic cache keys from Redis for user: {user_id}")
        else:
            logger.info(f"No semantic cache keys found in Redis for user: {user_id}")
    except Exception as e:
        logger.error(f"Error during Redis semantic cache wipe step: {str(e)}")

    # 4. Supabase DB rows (events, connected_accounts, profiles)
    try:
        # Delete events
        supabase_admin.table("events").delete().eq("user_id", user_id).execute()
        logger.info(f"Deleted events for user: {user_id}")
        
        # Delete connected accounts
        supabase_admin.table("connected_accounts").delete().eq("user_id", user_id).execute()
        logger.info(f"Deleted connected accounts for user: {user_id}")
        
        # Delete profiles
        supabase_admin.table("profiles").delete().eq("id", user_id).execute()
        logger.info(f"Deleted profile for user: {user_id}")
    except Exception as e:
        logger.error(f"Error during Supabase database deletion step: {str(e)}")

    # 5. Supabase Auth primary identity delete
    try:
        supabase_admin.auth.admin.delete_user(user_id)
        logger.info(f"Primary authentication account deleted from Supabase Auth for user: {user_id}")
    except Exception as e:
        logger.error(f"Error during Supabase Auth deletion step: {str(e)}")

    logger.info(f"GDPR deletion cascade completed for user: {user_id}")
