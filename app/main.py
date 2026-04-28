from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routes.api import router
from app.models.database import init_db
import os

app = FastAPI(title="AI Mental Health Risk Analyzer")

# Initialize database on startup
@app.on_event("startup")
def on_startup():
    init_db()

# Include API routes
app.include_router(router, prefix="/api")

# Serve the frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))
