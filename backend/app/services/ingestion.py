import re
import logging
from html import unescape
from typing import Optional, List
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

# Initialize Gemini Client
genai_client = genai.Client(api_key=settings.GEMINI_API_KEY)

# Initialize Qdrant Client
qdrant_client = QdrantClient(
    url=settings.QDRANT_URL,
    api_key=settings.QDRANT_API_KEY if settings.QDRANT_API_KEY else None,
    timeout=60
)

class EmailExtractionModel(BaseModel):
    display_name: str = Field(description="The primary actionable or event name described in the email")
    deadline: Optional[str] = Field(description="Deadline or event date/time in YYYY-MM-DD HH:MM:SS format, or null/None if no deadline is present")
    category: Optional[str] = Field(description="Event category classification (e.g. Academic, Career, Cultural, Technical, General)")
    venue: Optional[str] = Field(description="Event location or venue, or null/None if not specified")
    tags: List[str] = Field(default_factory=list, description="Array of relevant keywords or tags")
    importance_score: float = Field(description="Calculated importance score from 0.0 (low priority) to 1.0 (critical priority)")
    raw_summary: str = Field(description="Brief 2-3 sentence summary of the email context and its requirements")
    links: List[str] = Field(default_factory=list, description="Array of registration, document, or reference URLs extracted from the email body")
    is_update: bool = Field(default=False, description="True if this email is a follow-up/update about a PREVIOUSLY announced event (e.g. deadline extended, venue changed, reminder, cancellation) rather than a brand-new announcement")
    update_type: Optional[str] = Field(default=None, description="When is_update is true, the kind of update: one of 'deadline_extension', 'reminder', 'venue_change', 'cancellation', or 'other'; otherwise null/None")

def init_qdrant_collection():
    """
    Checks if 'krnl_email_chunks' exists in Qdrant; creates it if not.
    """
    collection_name = "krnl_email_chunks"
    try:
        collections_response = qdrant_client.get_collections()
        exists = any(col.name == collection_name for col in collections_response.collections)
        if not exists:
            logger.info(f"Creating Qdrant collection: '{collection_name}'")
            qdrant_client.create_collection(
                collection_name=collection_name,
                vectors_config=qdrant_models.VectorParams(
                    size=768,
                    distance=qdrant_models.Distance.COSINE
                )
            )
            # Index on user_id for filtering
            qdrant_client.create_payload_index(
                collection_name=collection_name,
                field_name="user_id",
                field_schema=qdrant_models.PayloadSchemaType.KEYWORD
            )
            logger.info(f"Successfully created '{collection_name}' collection")
        else:
            logger.info(f"Qdrant collection '{collection_name}' already exists.")
    except Exception as e:
        logger.error(f"Failed to initialize Qdrant collection: {str(e)}")

# Initialize Qdrant DB collection
init_qdrant_collection()

def clean_email_body(raw_body: str) -> str:
    """
    Cleans raw HTML email body by removing script/style tags and raw tags.
    """
    if not raw_body:
        return ""
    # Strip javascript and stylesheets
    clean = re.sub(r'<(script|style)[^>]*>([\s\S]*?)<\/\1>', ' ', raw_body, flags=re.IGNORECASE)
    # Convert common layout tags to newlines
    clean = re.sub(r'<(br|p|div|tr|h1|h2|h3)[^>]*/?>', '\n', clean, flags=re.IGNORECASE)
    # Strip all remaining tags
    clean = re.sub(r'<[^>]+>', ' ', clean)
    # Decode HTML entities
    clean = unescape(clean)
    # Normalize whitespaces
    lines = [line.strip() for line in clean.splitlines() if line.strip()]
    return "\n".join(lines)

def extract_event_intelligence(subject: str, body: str, msg_date: str) -> dict:
    """
    Structured event details extraction.
    """
    clean_body = clean_email_body(body)
    prompt = (
        "Analyze the email Subject and Body provided below. Extract the key metadata "
        "and details in structured JSON format according to the schema.\n"
        f"This email was received on {msg_date}. Resolve every date relative to that "
        "received date: if the year is not stated, infer it from the received date "
        "(events are upcoming or very recent, never years in the past). When the email "
        "states a specific time of day, include it in the deadline as HH:MM:SS; if no "
        "time is given, output the date only (YYYY-MM-DD).\n\n"
        f"Subject: {subject}\n\nBody:\n{clean_body}"
    )
    try:
        response = genai_client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=EmailExtractionModel,
                temperature=0.0
            )
        )
        extracted = EmailExtractionModel.model_validate_json(response.text)
        return extracted.model_dump()
    except Exception as e:
        logger.error(f"Structured extraction with Gemini failed: {str(e)}")
        return {
            "display_name": subject,
            "deadline": None,
            "category": "General",
            "venue": None,
            "tags": [],
            "importance_score": 0.1,
            "raw_summary": "Failed to run AI feature extraction on this email.",
            "links": [],
            "is_update": False,
            "update_type": None
        }

def generate_embeddings(text: str) -> list:
    """
    Generates 768-dimensional embeddings for the text.
    """
    if not text or not text.strip():
        return [0.0] * 768
    try:
        response = genai_client.models.embed_content(
            model="models/gemini-embedding-001",
            contents=text.strip(),
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        if not response or not response.embeddings or not response.embeddings[0].values:
            raise ValueError("Empty embedding response returned from Gemini API.")
        return response.embeddings[0].values
    except Exception as e:
        raise RuntimeError(f"Google GenAI Embedding service failed: {str(e)}")

def generate_embeddings_batch(texts: List[str]) -> List[list]:
    """
    Generates 768-dim embeddings for many texts in a single Gemini call.

    Returns one vector per input, in order. Blank/whitespace entries are
    assigned a zero vector and are NOT sent to the API (saving quota), so the
    output stays index-aligned with the input.
    """
    if not texts:
        return []

    cleaned = [(t or "").strip() for t in texts]
    nonempty_idx = [i for i, t in enumerate(cleaned) if t]
    results: List[list] = [[0.0] * 768 for _ in texts]
    if not nonempty_idx:
        return results

    payload = [cleaned[i] for i in nonempty_idx]
    try:
        response = genai_client.models.embed_content(
            model="models/gemini-embedding-001",
            contents=payload,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
    except Exception as e:
        raise RuntimeError(f"Google GenAI batch embedding service failed: {str(e)}")

    if not response or not response.embeddings or len(response.embeddings) != len(payload):
        raise RuntimeError("Batch embedding response size mismatch from Gemini API.")

    for slot, emb in zip(nonempty_idx, response.embeddings):
        if not emb.values:
            raise RuntimeError("Empty embedding returned from Gemini API.")
        results[slot] = emb.values
    return results

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list:
    """
    Helper to chunk text by word counts with overlap.
    """
    words = text.split()
    if not words:
        return []
    chunks = []
    i = 0
    while i < len(words):
        segment = " ".join(words[i:i + chunk_size])
        chunks.append(segment)
        i += (chunk_size - overlap)
        if i >= len(words) or (chunk_size - overlap) <= 0:
            break
    return chunks
