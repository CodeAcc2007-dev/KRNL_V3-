import json
import hashlib
import logging
import numpy as np
from redis import Redis
from app.core.config import settings
from app.services.ingestion import generate_embeddings

logger = logging.getLogger("uvicorn.error")

# Initialize Redis client with decode_responses=True for text keys/values
redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)

def get_semantic_cache(user_id: str, query: str) -> dict | None:
    """
    Checks the Redis semantic cache for matching user queries based on cosine similarity > 0.92.
    """
    if not query or not query.strip():
        return None

    try:
        query_vector = generate_embeddings(query)
    except Exception as e:
        logger.error(f"Embedding generation failed in get_semantic_cache: {e}")
        return None

    # Fetch all cache keys for this user
    pattern = f"cache:{user_id}:*"
    try:
        keys = redis_client.keys(pattern)
        if not keys:
            return None

        # Fetch cache items in batch
        values = redis_client.mget(keys)
    except Exception as e:
        logger.error(f"Redis cache fetch failed: {e}")
        return None

    best_similarity = 0.0
    best_match = None

    q_arr = np.array(query_vector)

    for val in values:
        if not val:
            continue
        try:
            item = json.loads(val)
            cached_emb = item.get("embedding")
            if not cached_emb or len(cached_emb) != len(query_vector):
                continue

            c_arr = np.array(cached_emb)
            dot = np.dot(q_arr, c_arr)
            norm_q = np.linalg.norm(q_arr)
            norm_c = np.linalg.norm(c_arr)
            if norm_q == 0 or norm_c == 0:
                similarity = 0.0
            else:
                similarity = float(dot / (norm_q * norm_c))

            if similarity > best_similarity:
                best_similarity = similarity
                best_match = item
        except Exception as e:
            logger.warning(f"Error parsing cache item: {e}")
            continue

    if best_similarity > 0.92 and best_match:
        logger.info(f"Semantic Cache HIT! Similarity: {best_similarity:.4f}")
        return {
            "answer": best_match["answer"],
            "citations": best_match.get("citations") or []
        }

    logger.info(f"Semantic Cache MISS. Best Similarity: {best_similarity:.4f}")
    return None

def set_semantic_cache(user_id: str, query: str, answer: str, citations: list[dict]) -> None:
    """
    Saves a query, its embedding, and the generated answer + citations to the semantic cache with a 24-hour expiration.
    """
    if not query or not query.strip():
        return

    try:
        query_vector = generate_embeddings(query)
    except Exception as e:
        logger.error(f"Embedding generation failed in set_semantic_cache: {e}")
        return

    try:
        query_hash = hashlib.md5(query.strip().lower().encode("utf-8")).hexdigest()
        key = f"cache:{user_id}:{query_hash}"

        cache_item = {
            "query": query,
            "embedding": query_vector,
            "answer": answer,
            "citations": citations
        }

        # Expire after 24 hours (86400 seconds)
        redis_client.setex(key, 86400, json.dumps(cache_item))
        logger.info(f"Saved query to semantic cache: {key}")
    except Exception as e:
        logger.error(f"Failed to set semantic cache in Redis: {e}")
