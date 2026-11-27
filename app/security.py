"""Authentication and request throttling.

Two ways in, both ending in a profile that owns the data:

* Guest: the browser creates a private profile and receives a random 256-bit
  key (``mhp_...``) that doubles as its recovery key.
* Account: email + password. Passwords are hashed with scrypt; signing in
  issues a per-device session token (``mhs_...``).

Only SHA-256 hashes of tokens are stored, every data endpoint requires a token
as a Bearer credential, and all queries are scoped to the resolved profile.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Any

from sqlalchemy.exc import IntegrityError

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.models import database as db

TOKEN_PREFIX = "mhp_"
SESSION_PREFIX = "mhs_"
_TOKEN_RE = re.compile(r"^mhp_[A-Za-z0-9_-]{40,64}$")
_bearer = HTTPBearer(auto_error=False)


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def new_session_token() -> str:
    return SESSION_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# scrypt parameters: ~16 MB memory, tens of milliseconds per hash.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        # Spend the same time as a real check so response timing doesn't
        # reveal whether an email is registered.
        hashlib.scrypt(password.encode("utf-8"), salt=b"0" * 16, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
        return False
    try:
        _, n, r, p, salt, expected = stored.split("$")
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt),
                                n=int(n), r=int(r), p=int(p), dklen=len(expected) // 2)
    except (ValueError, TypeError):
        return False
    return secrets.compare_digest(digest.hex(), expected)


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
    if not token.startswith((TOKEN_PREFIX, SESSION_PREFIX)) or len(token) > 128:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid profile key.",
                            headers={"WWW-Authenticate": "Bearer"})
    token_hash = hash_token(token)
    request.state.token_hash = token_hash
    if token.startswith(SESSION_PREFIX):
        profile = db.get_profile_by_session(token_hash)
        if profile is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Your session has ended. Please sign in again.",
                                headers={"WWW-Authenticate": "Bearer"})
        request.state.profile_id = profile["id"]
        return profile
    profile = db.get_profile_by_token_hash(token_hash)
    if profile is None and settings.is_ephemeral_storage and _TOKEN_RE.match(token):
        # Without a shared database each serverless instance has its own /tmp
        # copy, so a key issued by another instance is unknown here. Give it an
        # empty profile rather than a 401 so the app keeps working. Data stays
        # keyed by the token hash, so isolation between visitors is unchanged.
        profile = _provision(token_hash)
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Profile not found. It may have been deleted.",
                            headers={"WWW-Authenticate": "Bearer"})
    request.state.profile_id = profile["id"]
    return profile


def optional_profile(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any] | None:
    """The caller's profile if a valid token was sent, otherwise None."""
    if credentials is None:
        return None
    try:
        return current_profile(request, credentials)
    except HTTPException:
        return None


def _provision(token_hash: str) -> dict[str, Any] | None:
    try:
        return db.create_profile(token_hash[:32], token_hash)
    except IntegrityError:  # created concurrently by another request
        return db.get_profile_by_token_hash(token_hash)


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
