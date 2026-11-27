"""Application settings, read once from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

APP_NAME = "Mental Health Predictor"
APP_VERSION = "2.0.0"


def _default_database_url() -> str:
    # Vercel's filesystem is read-only except for /tmp, which is ephemeral.
    if os.environ.get("VERCEL") == "1":
        return "sqlite:////tmp/mental_health.db"
    return f"sqlite:///{(BASE_DIR / 'mental_health.db').as_posix()}"


def _normalise_database_url(url: str) -> str:
    """Accept the URL formats that hosted Postgres providers hand out."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: _normalise_database_url(
            os.environ.get("DATABASE_URL") or _default_database_url()
        )
    )
    # Comma separated list of extra origins allowed to call the API (the
    # bundled frontend is same-origin and needs no entry here).
    cors_origins: list[str] = field(default_factory=lambda: _env_list("CORS_ORIGINS"))
    log_level: str = field(default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO").upper())
    rate_limit_enabled: bool = field(
        default_factory=lambda: os.environ.get("RATE_LIMIT_ENABLED", "1") != "0"
    )

    @property
    def is_ephemeral_storage(self) -> bool:
        return self.database_url.startswith("sqlite:////tmp/")


settings = Settings()
