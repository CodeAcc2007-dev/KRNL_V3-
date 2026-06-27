import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from google.genai import types
from app.core.security import get_current_user
from app.services.retrieval import hybrid_retrieval, get_upcoming_agenda
from app.services.semantic_cache import get_semantic_cache, set_semantic_cache
from app.services.answer_context import (
    SYSTEM_PROMPT, build_source_set, render_context, map_citations,
)
from app.utils.dates import today_anchor
from app.services.ingestion import genai_client

logger = logging.getLogger("uvicorn.error")

router = APIRouter()

class QueryRequest(BaseModel):
    query: str

class Citation(BaseModel):
    id: int
    label: str
    event_id: int

class QueryResponse(BaseModel):
    answer: str
    citations: List[Citation]

@router.post("/query", response_model=QueryResponse)
def query_ai_assistant(request: QueryRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    query_text = request.query.strip()

    if not query_text:
        raise HTTPException(status_code=400, detail="Query text cannot be empty.")

    # 1. Check Semantic Cache
    cached_res = get_semantic_cache(user_id, query_text)
    if cached_res:
        # Map cache citations to Citation model format
        citations_mapped = []
        for c in cached_res.get("citations") or []:
            citations_mapped.append(Citation(
                id=c["id"],
                label=c["label"],
                event_id=c["event_id"]
            ))
        return QueryResponse(
            answer=cached_res["answer"],
            citations=citations_mapped
        )

    # 2. Cache miss: gather the upcoming agenda (recall) + retrieval detail.
    agenda = get_upcoming_agenda(user_id)
    rag_docs = hybrid_retrieval(query_text, user_id, limit=5)

    sources = build_source_set(agenda, rag_docs)
    if not sources:
        return QueryResponse(
            answer="I couldn't find any relevant emails or events in your KRNL inbox to answer this query.",
            citations=[],
        )

    context_str = render_context(sources, today_anchor())
    user_prompt = f"{context_str}\n\nUser question: {query_text}"

    # 3. Generate the answer.
    try:
        response = genai_client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
            ),
        )
        answer_text = response.text or ""
    except Exception as e:
        logger.error(f"Assistant generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Assistant service failed: {str(e)}")

    # 4. Map citations over the unified source set.
    answer_text, citations = map_citations(answer_text, sources)

    # 5. Save back to the cache.
    set_semantic_cache(user_id, query_text, answer_text, citations)

    return QueryResponse(
        answer=answer_text,
        citations=[Citation(**c) for c in citations],
    )
