from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints.profile import router as profile_router
from app.api.v1.endpoints.accounts import router as accounts_router
from app.api.v1.endpoints.sync import router as sync_router
from app.api.v1.endpoints.events import router as events_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.query import router as query_router
from app.api.v1.endpoints.user_data import router as user_data_router
from app.api.v1.endpoints.deletion import router as deletion_router
from app.api.v1.endpoints.interests import router as interests_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    debug=settings.DEBUG
)

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(profile_router, prefix="/api/v1")
app.include_router(accounts_router, prefix="/api/v1")
app.include_router(sync_router, prefix="/api/v1")
app.include_router(events_router, prefix="/api/v1")
app.include_router(health_router, prefix="/api/v1")
app.include_router(query_router, prefix="/api/v1")
app.include_router(user_data_router, prefix="/api/v1")
app.include_router(deletion_router, prefix="/api/v1")
app.include_router(interests_router, prefix="/api/v1")




