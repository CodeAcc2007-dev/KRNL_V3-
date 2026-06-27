import logging
import concurrent.futures
from datetime import date, timedelta
from qdrant_client.http import models as qdrant_models
from app.services.ingestion import generate_embeddings, qdrant_client
from app.core.security import supabase
from app.utils.dates import ist_today, parse_deadline_date

logger = logging.getLogger("uvicorn.error")

def hybrid_retrieval(query: str, user_id: str, limit: int = 5) -> list[dict]:
    """
    Performs hybrid retrieval using Qdrant vector search and Supabase text search,
    merging the results with Reciprocal Rank Fusion (RRF).
    """
    if not query or not query.strip():
        return []

    try:
        query_vector = generate_embeddings(query)
    except Exception as e:
        logger.error(f"Failed to generate query embedding in hybrid_retrieval: {e}")
        return []

    def search_qdrant():
        try:
            res = qdrant_client.query_points(
                collection_name="krnl_email_chunks",
                query=query_vector,
                query_filter=qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="user_id",
                            match=qdrant_models.MatchValue(value=user_id)
                        )
                    ]
                ),
                limit=limit * 2
            )
            return res.points
        except Exception as e:
            logger.error(f"Qdrant vector search failed in hybrid_retrieval: {e}")
            return []

    def search_supabase():
        try:
            res = supabase.table("events").select("*").eq("user_id", user_id).text_search("full_body", query, options={"config": "english"}).execute()
            return res.data or []
        except Exception as e:
            logger.warning(f"Supabase text_search failed: {e}. Falling back to ilike search...")
            try:
                res = supabase.table("events").select("*").eq("user_id", user_id).ilike("full_body", f"%{query}%").execute()
                return res.data or []
            except Exception as ex:
                logger.error(f"Supabase search fallback failed: {ex}")
                return []

    # Run search queries in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_qdrant = executor.submit(search_qdrant)
        future_supabase = executor.submit(search_supabase)

        vector_results = future_qdrant.result()
        text_results = future_supabase.result()

    K = 60
    rrf_scores = {}

    # Map vector results (scored points) to (event_id, text)
    vector_docs = []
    for p in vector_results:
        eid = str(p.payload.get("event_id")) if p.payload else None
        txt = p.payload.get("chunk_text") if p.payload else None
        if eid and txt:
            vector_docs.append((eid, txt))

    # Map text search results (events) to (event_id, text)
    text_docs = []
    for row in text_results:
        eid = str(row.get("id"))
        txt = row.get("full_body") or row.get("raw_summary") or ""
        if eid and txt:
            text_docs.append((eid, txt))

    # Calculate RRF score for vector search
    for rank, doc in enumerate(vector_docs, start=1):
        if doc not in rrf_scores:
            rrf_scores[doc] = 0.0
        rrf_scores[doc] += 1.0 / (K + rank)

    # Calculate RRF score for text search
    for rank, doc in enumerate(text_docs, start=1):
        if doc not in rrf_scores:
            rrf_scores[doc] = 0.0
        rrf_scores[doc] += 1.0 / (K + rank)

    # Sort and slice to limit
    sorted_docs = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
    top_docs = sorted_docs[:limit]

    # Batch fetch event metadata from Supabase
    event_ids = list(set([doc[0] for doc in top_docs]))
    events_metadata = {}
    if event_ids:
        try:
            ids_int = []
            for eid in event_ids:
                try:
                    ids_int.append(int(eid))
                except ValueError:
                    pass
            if ids_int:
                res = supabase.table("events").select("*").in_("id", ids_int).execute()
                for row in res.data:
                    events_metadata[str(row["id"])] = row
        except Exception as e:
            logger.error(f"Error fetching event metadata for RRF: {e}")

    # Format return payload
    final_results = []
    for event_id, text in top_docs:
        meta = events_metadata.get(event_id, {})
        final_results.append({
            "event_id": event_id,
            "text": text,
            "display_name": meta.get("display_name") or "Unknown Event",
            "category": meta.get("category") or "General",
            "deadline": meta.get("deadline"),
            "venue": meta.get("venue"),
            "importance_score": meta.get("importance_score") or 0.1,
            "links": meta.get("links") or []
        })

    return final_results


def _select_upcoming(rows: list[dict], today: date, grace_days: int = 1) -> list[dict]:
    """Filter deadline rows to upcoming (>= today - grace_days), sorted ascending."""
    cutoff = today - timedelta(days=grace_days)
    kept = []
    for row in rows:
        deadline_str = row.get("deadline")
        d = parse_deadline_date(deadline_str)
        if d is None or d < cutoff:
            continue
        kept.append((deadline_str, row))
    kept.sort(key=lambda pair: pair[0] or "")
    return [
        {
            "event_id": str(row.get("id")),
            "display_name": row.get("display_name") or "Unknown Event",
            "deadline": row.get("deadline"),
            "venue": row.get("venue"),
            "category": row.get("category") or "General",
        }
        for _, row in kept
    ]


def get_upcoming_agenda(user_id: str, grace_days: int = 1, limit: int = 25) -> list[dict]:
    """Pull deadline-bearing events for the user (same source as the task view)
    and return the soonest `limit` upcoming agenda items."""
    try:
        res = (
            supabase.table("events")
            .select("*")
            .eq("user_id", user_id)
            .not_.is_("deadline", "null")
            .execute()
        )
        rows = res.data or []
    except Exception as e:
        logger.error(f"Failed to fetch agenda in get_upcoming_agenda: {e}")
        return []
    return _select_upcoming(rows, ist_today(), grace_days=grace_days)[:limit]
