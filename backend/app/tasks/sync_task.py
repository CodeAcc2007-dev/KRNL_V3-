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
    generate_embeddings_batch,
    chunk_text,
    clean_email_body,
    qdrant_client
)
from app.utils.dedup import get_message_id
from app.services.event_merge import find_matching_event, should_apply_extension, apply_extension
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
                
            logger.info(f"Found {len(messages)} emails fetched.")

            # Dedup: skip emails we've already ingested for this user. The DB has a
            # unique (user_id, message_id) constraint as the hard guard; this set
            # avoids wasting Gemini quota re-extracting messages we already have.
            seen_message_ids = set()
            try:
                existing = supabase_service.table("events").select("message_id").eq("user_id", user_id).execute()
                seen_message_ids = {row["message_id"] for row in (existing.data or []) if row.get("message_id")}
                logger.info(f"User has {len(seen_message_ids)} previously-ingested message_ids.")
            except Exception as e:
                logger.warning(f"Could not load existing message_ids for dedup: {e}")

            emails_processed = 0
            emails_skipped = 0
            for idx, msg in enumerate(messages):
                message_id = get_message_id(msg)
                if message_id in seen_message_ids:
                    logger.info(f"Skipping already-ingested email {idx+1}/{len(messages)} (message_id={message_id})")
                    emails_skipped += 1
                    continue
                # Reserve so duplicates within this same batch are also skipped.
                seen_message_ids.add(message_id)

                subject = msg.subject or "No Subject"
                sender = msg.from_ or "Unknown Sender"
                msg_date = msg.date.isoformat() if msg.date else datetime.utcnow().isoformat()
                body = msg.text if msg.text else msg.html
                if not body:
                    body = "[Empty Body]"
                    
                logger.info(f"Processing email {idx+1}/{len(messages)}: '{subject}'")
                
                # 4a. Run extract_event_intelligence
                extracted = extract_event_intelligence(subject, body, msg_date)

                # Deadline-extension merge: if this email updates an event we already
                # have, move that event's deadline forward and show this email in the
                # inbox without its own deadline (so it doesn't double-list in Deadlines).
                matched_event = None
                if extracted.get("is_update") and extracted.get("update_type") == "deadline_extension" \
                        and extracted.get("deadline"):
                    try:
                        matched_event = find_matching_event(user_id, clean_email_body(body), supabase_service)
                    except Exception as e:
                        logger.error(f"Deadline-extension matching failed: {e}")
                    if matched_event and should_apply_extension(matched_event.get("deadline"), extracted.get("deadline")):
                        try:
                            apply_extension(matched_event, extracted.get("deadline"),
                                            extracted.get("update_type"), message_id, supabase_service)
                            logger.info(f"Applied deadline extension to event {matched_event['id']} "
                                        f"({matched_event.get('deadline')} -> {extracted.get('deadline')})")
                        except Exception as e:
                            logger.error(f"Failed to apply deadline extension: {e}")

                # 4b. Format and save event to Supabase 'events'
                links = extracted.get("links") or []
                has_registration = len(links) > 0
                registration_link = links[0] if has_registration else None
                
                event_data = {
                    "user_id": user_id,
                    "message_id": message_id,
                    "display_name": extracted.get("display_name") or subject,
                    "deadline": None if matched_event else extracted.get("deadline"),
                    "venue": extracted.get("venue"),
                    "category": extracted.get("category") or "General",
                    "tags": ", ".join(extracted.get("tags") or []) if isinstance(extracted.get("tags"), list) else (extracted.get("tags") or ""),
                    "importance_score": int((extracted.get("importance_score") or 0.1) * 100),
                    "raw_summary": extracted.get("raw_summary") or "",
                    "full_body": clean_email_body(body),
                    "raw_body": body,
                    "links": links,
                    "has_registration": has_registration,
                    "registration_link": registration_link,
                    "last_update_type": extracted.get("update_type") if extracted.get("is_update") else None
                }

                try:
                    event_response = supabase_service.table("events").insert(event_data).execute()
                    if event_response.data:
                        event_id = event_response.data[0]["id"]
                    else:
                        logger.error("Failed to insert event into database (empty return)")
                        continue
                except Exception as e:
                    # A unique (user_id, message_id) violation means a concurrent run
                    # already ingested this email — that's a successful no-op, not an error.
                    if "duplicate key" in str(e).lower() or "23505" in str(e):
                        logger.info(f"Email already ingested by a concurrent run (message_id={message_id}); skipping.")
                        emails_skipped += 1
                        continue
                    logger.error(f"Failed to save event to database: {e}")
                    continue
                    
                # 4c. Chunk body, generate embeddings, and upsert to Qdrant
                try:
                    cleaned_body = clean_email_body(body)
                    chunks = chunk_text(cleaned_body, chunk_size=500, overlap=100)

                    # One embedding API call for ALL chunks of this email (Phase 1
                    # quota fix) instead of one call per chunk.
                    embeddings = generate_embeddings_batch(chunks)

                    points = []
                    for chunk_idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
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
        
        logger.info(f"Email sync completed successfully. Processed {emails_processed}, skipped {emails_skipped} (already ingested).")
        return {"status": "success", "processed": emails_processed, "skipped": emails_skipped}
        
    except Exception as exc:
        logger.error(f"Exception during email sync: {exc}")
        # If running synchronously, do not retry, just raise the exception
        if not getattr(self, "request", None) or getattr(self.request, "called_directly", True):
            raise exc
        raise self.retry(exc=exc, countdown=60)
