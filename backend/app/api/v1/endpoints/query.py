import re
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from google.genai import types
from app.core.security import get_current_user
from app.services.retrieval import hybrid_retrieval
from app.services.semantic_cache import get_semantic_cache, set_semantic_cache
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

    # 2. Cache Miss: Perform Hybrid Retrieval
    documents = hybrid_retrieval(query_text, user_id, limit=5)

    if not documents:
        # Return fallback response if no context is found
        return QueryResponse(
            answer="I couldn't find any relevant emails or events in your KRNL inbox to answer this query.",
            citations=[]
        )

    # 3. Build context string and prompt
    context_parts = []
    for idx, doc in enumerate(documents, start=1):
        context_parts.append(
            f"Document [{idx}]:\n"
            f"Source Event: {doc['display_name']} (ID: {doc['event_id']})\n"
            f"Text:\n{doc['text']}"
        )
    context_str = "\n\n".join(context_parts)

    system_prompt = (
        "You are KRNL's AI Assistant. Answer the user's query ONLY using the provided email context documents.\n"
        "If you cannot find the answer, state that you do not know. Never hallucinate links.\n"
        "Cite the context documents using their index numbers (e.g. [1], [2]) at the end of statements where you use them."
    )

    user_prompt = f"Context Documents:\n{context_str}\n\nUser Query: {query_text}"

    # 4. Generate answer using Gemini 2.5 Flash
    try:
        response = genai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2
            )
        )
        answer_text = response.text or ""
    except Exception as e:
        logger.error(f"Gemini generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI Assistant service failed: {str(e)}")

    # 5. Extract citations and convert bracketed indices to superscripts (for frontend compatibility)
    superscripts = {1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵"}
    citations = []

    for idx, doc in enumerate(documents, start=1):
        bracket_str = f"[{idx}]"
        super_str = superscripts.get(idx, f"[{idx}]")

        # Check if the generated text references this document
        if bracket_str in answer_text or super_str in answer_text:
            # Standardize brackets to superscripts for the PWA renderer
            answer_text = answer_text.replace(bracket_str, super_str)
            try:
                event_id_val = int(doc["event_id"])
            except ValueError:
                event_id_val = 0

            citations.append({
                "id": idx,
                "label": doc["display_name"],
                "event_id": event_id_val
            })

    # 6. Save back to Semantic Cache
    set_semantic_cache(user_id, query_text, answer_text, citations)

    return QueryResponse(
        answer=answer_text,
        citations=[Citation(**c) for c in citations]
    )
