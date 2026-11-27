"""Private device profiles and request throttling.

The app has no passwords. Each browser creates a private profile and receives
a random 256-bit token (its "recovery key"). Only a SHA-256 hash of the token
is stored, every data endpoint requires it as a Bearer token, and all queries
are scoped to that profile, so one visitor can never read another's journal.
"""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.models import database as db

TOKEN_PREFIX = "mhp_"
_bearer = HTTPBearer(auto_error=False)


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def current_profile(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="A profile key is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    if not token.startswith(TOKEN_PREFIX) or len(token) > 128:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid profile key.",
                            headers={"WWW-Authenticate": "Bearer"})
    profile = db.get_profile_by_token_hash(hash_token(token))
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Profile not found. It may have been deleted.",
                            headers={"WWW-Authenticate": "Bearer"})
    request.state.profile_id = profile["id"]
    return profile


class RateLimiter:
    """Small sliding-window limiter. Per process, which suits a single server
    or serverless instance; it blunts abuse rather than enforcing hard quotas."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float) -> None:
        if not settings.rate_limit_enabled:
            return
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                retry = int(window - (now - hits[0])) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry)},
                )
            hits.append(now)
            if len(self._hits) > 10_000:  # keep memory bounded
                for k in [k for k, v in self._hits.items() if not v][:5000]:
                    self._hits.pop(k, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(scope: str, limit: int, window: float, per: str = "profile"):
    """Dependency factory: throttle by profile (default) or client IP."""

    if per == "profile":
        def _by_profile(profile: dict[str, Any] = Depends(current_profile)) -> None:
            limiter.check(f"{scope}:{profile['id']}", limit, window)
        return _by_profile

    def _by_ip(request: Request) -> None:
        limiter.check(f"{scope}:{client_ip(request)}", limit, window)
    return _by_ip
