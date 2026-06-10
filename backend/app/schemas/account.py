from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ConnectIITBRequest(BaseModel):
    imap_username: str
    sso_token: str
    email_address: str

class AccountResponse(BaseModel):
    id: int
    account_type: str
    email_address: str
    imap_username: Optional[str] = None
    connection_status: str
    last_synced_at: Optional[datetime] = None
    created_at: datetime
