from fastapi import APIRouter
from redis import Redis
from app.core.config import settings
from app.core.security import supabase
from app.services.ingestion import qdrant_client
from app.core.celery_app import celery_app

router = APIRouter()

@router.get("/health")
def health_check():
    status_map = {
        "supabase": "error",
        "redis": "error",
        "qdrant": "error",
        "celery": "error"
    }

    # 1. Supabase Check
    try:
        res = supabase.table("profiles").select("id").limit(1).execute()
        if res is not None:
            status_map["supabase"] = "ok"
    except Exception:
        pass

    # 2. Redis Check
    try:
        r = Redis.from_url(settings.REDIS_URL, socket_timeout=2.0)
        if r.ping():
            status_map["redis"] = "ok"
    except Exception:
        pass

    # 3. Qdrant Check
    try:
        qdrant_client.get_collections()
        status_map["qdrant"] = "ok"
    except Exception:
        pass

    # 4. Celery Check
    try:
        inspector = celery_app.control.inspect(timeout=1.5)
        active_workers = inspector.active()
        if active_workers is not None and len(active_workers) > 0:
            status_map["celery"] = "ok"
    except Exception:
        pass

    overall_status = "healthy" if all(v == "ok" for v in status_map.values()) else "unhealthy"

    return {
        **status_map,
        "status": overall_status
    }
