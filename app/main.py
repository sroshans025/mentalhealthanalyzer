import hashlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import APP_NAME, APP_VERSION, FRONTEND_DIR, settings
from app.models.database import init_db
from app.routes.api import router

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.is_ephemeral_storage:
        logger.warning("Using ephemeral /tmp SQLite storage. Set DATABASE_URL for persistent data.")
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan,
              docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

app.add_middleware(GZipMiddleware, minimum_size=1024)
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)
# The interactive API docs load assets from a CDN, so they get a looser policy.
DOCS_CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'"
)


MAX_BODY_BYTES = 64 * 1024  # a 5,000-character journal entry is far below this


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_big = int(length) > MAX_BODY_BYTES
        except ValueError:
            return _error(400, "Invalid Content-Length header.")
        if too_big:
            return _error(413, "That request is too large.")
    return await call_next(request)


@app.middleware("http")
async def security_and_logging(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        response = JSONResponse(
            status_code=500,
            content={"error": {"code": 500, "message": "Something went wrong on our side. Please try again."}},
        )
    path = request.url.path
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Content-Security-Policy", DOCS_CSP if path == "/api/docs" else CSP)
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    elif path.startswith("/static/"):
        # Asset URLs carry a version query string, so they can be cached hard.
        # Unversioned files (ES module imports, images) revalidate via ETag.
        cache = "public, max-age=31536000, immutable" if request.url.query.startswith("v=") else "no-cache"
        response.headers.setdefault("Cache-Control", cache)
    # Never log query strings or bodies: they can contain journal text.
    logger.info("%s %s %s %.0fms", request.method, path, response.status_code,
                (time.perf_counter() - started) * 1000)
    return response


def _error(status_code: int, message, details=None, headers=None) -> JSONResponse:
    body = {"error": {"code": status_code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        message = detail.get("message", "Request failed.")
        extra = {k: v for k, v in detail.items() if k != "message"} or None
        return _error(exc.status_code, message, extra, getattr(exc, "headers", None))
    if exc.status_code == 404 and detail == "Not Found":
        detail = "The requested resource was not found."
    return _error(exc.status_code, detail, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    fields = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        msg = err.get("msg", "Invalid value")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        fields.append({"field": ".".join(loc) or None, "message": msg})
    message = fields[0]["message"] if len(fields) == 1 else "Some fields need attention."
    return _error(422, message, fields)


app.include_router(router, prefix="/api")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(FRONTEND_DIR / "assets" / "img" / "favicon.svg", media_type="image/svg+xml")


def _asset_version() -> str:
    """Content hash of the frontend assets, so every deploy busts browser caches."""
    digest = hashlib.sha256()
    for path in sorted((FRONTEND_DIR / "assets").rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(FRONTEND_DIR).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()
INDEX_HTML = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8").replace("__V__", ASSET_VERSION)


@app.get("/", include_in_schema=False)
def serve_index():
    return HTMLResponse(INDEX_HTML, headers={"Cache-Control": "no-cache"})


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PATCH", "DELETE", "PUT"], include_in_schema=False)
def api_not_found(rest: str):  # noqa: ARG001 - path param required by the route
    raise HTTPException(404, "Unknown API endpoint.")
