import time
import logging
import uuid
from datetime import datetime
from celery import shared_task
from imap_tools import MailBox, AND
from supabase import create_client
from app.core.config import settings
from app.core.encryption import decrypt_token
from app.services.ingestion import (
    extract_event_intelligence, 
    generate_embeddings, 
    chunk_text, 
    clean_email_body,
    qdrant_client
)
from qdrant_client.http import models as qdrant_models

logger = logging.getLogger("uvicorn.error")

# Initialize service client for tasks bypass
supabase_service = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

@shared_task(bind=True, name="app.tasks.sync_task.run_email_sync", max_retries=3)
def run_email_sync(self, user_id: str, account_id: int, max_emails: int = 10):
    """
    Celery task to run email synchronization.

    max_emails caps how many messages are fetched per run. The synchronous
    dev fallback (no Redis/Celery) passes a small value so the blocking HTTP
    request returns quickly instead of timing out on the 13s-per-email throttle.
    """
    logger.info(f"Starting email sync task for user {user_id}, account {account_id} (max_emails={max_emails})")
    
    try:
        # 1. Query connected_accounts using the service role key
        account_response = supabase_service.table("connected_accounts").select("*").eq("id", account_id).eq("user_id", user_id).execute()
        if not account_response.data:
            logger.error(f"Connected account {account_id} not found for user {user_id}")
            return {"status": "failed", "error": "Account not found"}
        
        account = account_response.data[0]
        imap_username = account.get("imap_username")
        encrypted_token = account.get("encrypted_token")
        last_synced_at = account.get("last_synced_at")
        
        if not encrypted_token or not imap_username:
            logger.error(f"Missing credentials for account {account_id}")
            return {"status": "failed", "error": "Missing credentials"}
            
        # 2. Decrypt the encrypted_token
        decrypted_token = decrypt_token(encrypted_token)
        
        # 3. Log into 'imap.iitb.ac.in' via imap_tools
        logger.info(f"Connecting to imap.iitb.ac.in for {imap_username}...")
        
        criteria = 'ALL'
        if last_synced_at:
            try:
                dt = datetime.fromisoformat(last_synced_at.replace('Z', '+00:00'))
                # Filter for emails since last synced date
                criteria = AND(date_gte=dt.date())
            except Exception as e:
                logger.warning(f"Failed to parse last_synced_at: {e}")
                
        with MailBox('imap.iitb.ac.in').login(imap_username, decrypted_token, 'INBOX') as mailbox:
            if criteria != 'ALL':
                logger.info(f"Fetching new emails since date {criteria}...")
                messages = list(mailbox.fetch(criteria, reverse=True))
                if len(messages) > max_emails:
                    messages = messages[:max_emails]
            else:
                logger.info(f"Fetching last {max_emails} emails from inbox...")
                messages = list(mailbox.fetch(limit=max_emails, reverse=True))
                
            logger.info(f"Found {len(messages)} emails to process.")
            
            emails_processed = 0
            for idx, msg in enumerate(messages):
                subject = msg.subject or "No Subject"
                sender = msg.from_ or "Unknown Sender"
                msg_date = msg.date.isoformat() if msg.date else datetime.utcnow().isoformat()
                body = msg.text if msg.text else msg.html
                if not body:
                    body = "[Empty Body]"
                    
                logger.info(f"Processing email {idx+1}/{len(messages)}: '{subject}'")
                
                # 4a. Run extract_event_intelligence
                extracted = extract_event_intelligence(subject, body, msg_date)
                
                # 4b. Format and save event to Supabase 'events'
                links = extracted.get("links") or []
                has_registration = len(links) > 0
                registration_link = links[0] if has_registration else None
                
                event_data = {
                    "user_id": user_id,
                    "display_name": extracted.get("display_name") or subject,
                    "deadline": extracted.get("deadline"),
                    "venue": extracted.get("venue"),
                    "category": extracted.get("category") or "General",
                    "tags": ", ".join(extracted.get("tags") or []) if isinstance(extracted.get("tags"), list) else (extracted.get("tags") or ""),
                    "importance_score": int((extracted.get("importance_score") or 0.1) * 100),
                    "raw_summary": extracted.get("raw_summary") or "",
                    "full_body": clean_email_body(body),
                    "raw_body": body,
                    "links": links,
                    "has_registration": has_registration,
                    "registration_link": registration_link
                }
                
                try:
                    event_response = supabase_service.table("events").insert(event_data).execute()
                    if event_response.data:
                        event_id = event_response.data[0]["id"]
                    else:
                        logger.error("Failed to insert event into database (empty return)")
                        continue
                except Exception as e:
                    logger.error(f"Failed to save event to database: {e}")
                    continue
                    
                # 4c. Chunk body, generate embeddings, and upsert to Qdrant
                try:
                    cleaned_body = clean_email_body(body)
                    chunks = chunk_text(cleaned_body, chunk_size=500, overlap=100)
                    
                    points = []
                    for chunk_idx, chunk in enumerate(chunks):
                        embedding = generate_embeddings(chunk)
                        point_id = str(uuid.uuid4())
                        points.append(
                            qdrant_models.PointStruct(
                                id=point_id,
                                vector=embedding,
                                payload={
                                    "user_id": user_id,
                                    "event_id": str(event_id),
                                    "account_id": account_id,
                                    "chunk_index": chunk_idx,
                                    "chunk_text": chunk
                                }
                            )
                        )
                    if points:
                        qdrant_client.upsert(
                            collection_name="krnl_email_chunks",
                            points=points
                        )
                        logger.info(f"Upserted {len(points)} email chunks to Qdrant collection for event {event_id}")
                except Exception as e:
                    logger.error(f"Failed to process and index email chunks in Qdrant: {e}")
                
                emails_processed += 1
                
                # 4d. Cooldown sleep between emails
                if idx < len(messages) - 1:
                    logger.info("Sleeping 13 seconds between iterations...")
                    time.sleep(13)
                    
        # Update last_synced_at on success
        supabase_service.table("connected_accounts").update({
            "last_synced_at": datetime.utcnow().isoformat()
        }).eq("id", account_id).execute()
        
        logger.info(f"Email sync completed successfully. Processed {emails_processed} emails.")
        return {"status": "success", "processed": emails_processed}
        
    except Exception as exc:
        logger.error(f"Exception during email sync: {exc}")
        # If running synchronously, do not retry, just raise the exception
        if not getattr(self, "request", None) or getattr(self.request, "called_directly", True):
            raise exc
        raise self.retry(exc=exc, countdown=60)
