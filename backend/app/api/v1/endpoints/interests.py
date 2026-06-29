from fastapi import APIRouter, Depends
from app.core.security import get_current_user, supabase
from app.services.interests import fetch_active_catalog

router = APIRouter()


@router.get("/interests/catalog")
def get_interest_catalog(current_user: dict = Depends(get_current_user)):
    """Active interest catalog for the Settings/onboarding picker."""
    return fetch_active_catalog(supabase)
