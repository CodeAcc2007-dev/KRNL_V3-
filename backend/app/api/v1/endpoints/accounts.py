from fastapi import APIRouter, Depends, HTTPException, status
from app.core.security import get_current_user, supabase
from app.core.encryption import encrypt_token
from app.services.imap_verifier import verify_imap_connection
from app.schemas.account import ConnectIITBRequest, AccountResponse
from typing import List

router = APIRouter()

@router.get("/accounts", response_model=List[AccountResponse])
def get_accounts(current_user: dict = Depends(get_current_user)):
    """
    Get all connected email accounts for the authenticated user.
    """
    user_id = current_user["user_id"]
    try:
        response = supabase.table("connected_accounts").select("*").eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    accounts_list = []
    for row in response.data:
        accounts_list.append(AccountResponse(
            id=row.get("id"),
            account_type=row.get("account_type"),
            email_address=row.get("email_address"),
            imap_username=row.get("imap_username"),
            connection_status=row.get("connection_status") or "connected",
            last_synced_at=row.get("last_synced_at"),
            created_at=row.get("created_at")
        ))
    return accounts_list

@router.post("/accounts/iitb", response_model=AccountResponse)
def connect_iitb_account(
    payload: ConnectIITBRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Connect a new IIT Bombay email account.
    First verifies credentials by attempting to connect to the IMAP server.
    """
    user_id = current_user["user_id"]
    
    # 1. Verify IMAP credentials synchronously
    try:
        verify_imap_connection(payload.imap_username, payload.sso_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"IMAP verification failed: {str(e)}"
        )
        
    # 2. Encrypt LDAP access token
    try:
        encrypted_token = encrypt_token(payload.sso_token)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Encryption failed: {str(e)}"
        )
        
    # 3. Save as new row in Supabase
    data = {
        "user_id": user_id,
        "account_type": "iitb_imap",
        "email_address": payload.email_address,
        "imap_username": payload.imap_username,
        "encrypted_token": encrypted_token,
        "connection_status": "connected"
    }
    
    try:
        response = supabase.table("connected_accounts").insert(data).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account in database"
        )
        
    row = response.data[0]
    return AccountResponse(
        id=row.get("id"),
        account_type=row.get("account_type"),
        email_address=row.get("email_address"),
        imap_username=row.get("imap_username"),
        connection_status=row.get("connection_status") or "connected",
        last_synced_at=row.get("last_synced_at"),
        created_at=row.get("created_at")
    )

@router.delete("/accounts/{account_id}")
def delete_account(
    account_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a connected email account.
    """
    user_id = current_user["user_id"]
    try:
        response = supabase.table("connected_accounts").delete().eq("id", account_id).eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )
        
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found or you are not authorized to delete it"
        )
        
    return {"success": True}
