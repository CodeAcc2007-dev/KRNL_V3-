import io
import json
import zipfile
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from app.core.security import get_current_user
from app.services.deletion import supabase_admin

logger = logging.getLogger("uvicorn.error")

router = APIRouter()

@router.get("/user/export")
def export_user_data(current_user: dict = Depends(get_current_user)):
    """
    GDPR-compliant user data portability endpoint.
    Downloads all user information as a zipped file of structured JSON files.
    """
    user_id = current_user["user_id"]
    try:
        # Fetch profile
        profile_res = supabase_admin.table("profiles").select("*").eq("id", user_id).execute()
        # Fetch connected accounts
        accounts_res = supabase_admin.table("connected_accounts").select("*").eq("user_id", user_id).execute()
        # Fetch events
        events_res = supabase_admin.table("events").select("*").eq("user_id", user_id).execute()
    except Exception as e:
        logger.error(f"Error querying user data for export: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query error during export: {str(e)}"
        )

    # Format JSON dumps
    profile_data = profile_res.data if profile_res else []
    accounts_data = accounts_res.data if accounts_res else []
    events_data = events_res.data if events_res else []

    try:
        profile_json = json.dumps(profile_data, indent=2, default=str)
        accounts_json = json.dumps(accounts_data, indent=2, default=str)
        events_json = json.dumps(events_data, indent=2, default=str)
        
        # Create in-memory zip
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            zip_file.writestr("profiles.json", profile_json)
            zip_file.writestr("connected_accounts.json", accounts_json)
            zip_file.writestr("events.json", events_json)
            
        zip_buffer.seek(0)
    except Exception as e:
        logger.error(f"Failed to generate ZIP archive: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compile export ZIP archive: {str(e)}"
        )

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=krnl_data_export.zip"
        }
    )
