import logging
from redis import Redis
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def allow_request(key: str, limit: int, window_seconds: int) -> bool:
    """Fixed-window rate limiter. Returns True if the call is within `limit`
    requests per `window_seconds` for `key`. Fails open (True) if Redis is
    unavailable so an outage never blocks a legitimate request."""
    try:
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, window_seconds)
        return count <= limit
    except Exception as e:
        logger.error(f"Rate limit check failed for {key}: {e}")
        return True
