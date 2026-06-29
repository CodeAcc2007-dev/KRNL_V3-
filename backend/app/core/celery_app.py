from celery import Celery
from app.core.config import settings

celery_app = Celery(
    'krnl_tasks',
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=['app.tasks.sync_task', 'app.tasks.deletion_task']
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    # Freeze-protection: Limit local worker concurrency to 1
    worker_concurrency=1,
)

# Celery Beat schedule for periodic tasks
celery_app.conf.beat_schedule = {
    'check-matured-deletions-hourly': {
        'task': 'app.tasks.deletion_task.check_and_execute_matured_deletions',
        'schedule': 3600.0,  # hourly (in seconds)
    },
    'auto-sync-connected-accounts': {
        'task': 'app.tasks.sync_task.dispatch_all_syncs',
        'schedule': 900.0,  # every 15 minutes
    },
}

# Autodiscover tasks from 'app.tasks'
celery_app.autodiscover_tasks(['app.tasks'], force=True)
