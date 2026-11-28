"""Persistence layer.

SQLAlchemy Core is used so the same code runs on SQLite (local development,
default) and on PostgreSQL (set ``DATABASE_URL`` for durable hosted storage).
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    and_,
    create_engine,
    delete,
    event,
    func,
    insert,
    inspect,
    text,
    or_,
    select,
    update,
)
from sqlalchemy.engine import Engine

from app.config import settings

logger = logging.getLogger(__name__)

metadata = MetaData()

profiles = Table(
    "profiles",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("display_name", String(40), nullable=False, default=""),
    Column("sleep_goal", Float, nullable=False, default=8.0),
    Column("screen_limit", Float, nullable=False, default=4.0),
    Column("step_goal", Integer, nullable=False, default=7000),
    Column("created_at", String(32), nullable=False),
    Column("last_seen_at", String(32), nullable=False),
    # Set when a guest creates an account (or someone registers directly).
    Column("email", String(254), nullable=True),
    Column("password_hash", String(255), nullable=True),
)
profiles_email_index = Index("ux_profiles_email", profiles.c.email, unique=True)

# Sign-in sessions for accounts: one row per signed-in device.
sessions = Table(
    "sessions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_id", String(32), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("created_at", String(32), nullable=False),
    Column("last_used_at", String(32), nullable=False),
)

entries = Table(
    "entries",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("profile_id", String(32), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", String(32), nullable=False),
    Column("journal", Text, nullable=False),
    Column("journal_hash", String(64), nullable=False),
    Column("sleep_hours", Float, nullable=False),
    Column("screen_time", Float, nullable=False),
    Column("activity_level", Integer, nullable=False),
    Column("sentiment_score", Float, nullable=False),
    Column("emotion", String(16), nullable=False),
    Column("risk_level", String(8), nullable=False),
    Column("risk_score", Integer, nullable=False),
    Column("confidence", Float, nullable=False),
    Column("explanation", Text, nullable=False),
    Column("factors", Text, nullable=False, default="[]"),
    Column("tags", String(255), nullable=False, default=""),
    Column("crisis_flag", Boolean, nullable=False, default=False),
    Index("ix_entries_profile_created", "profile_id", "created_at"),
)

RISK_SCORES = {"Low": 1, "Medium": 2, "High": 3}

_engine: Engine | None = None


def utcnow_iso() -> str:
    """ISO-8601 UTC timestamp with a fixed width so string ordering == time ordering."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        init_engine(settings.database_url)
    assert _engine is not None
    return _engine


def init_engine(url: str) -> Engine:
    """(Re)create the engine. Tests call this with a temporary database."""
    global _engine
    if _engine is not None:
        _engine.dispose()
    kwargs: dict[str, Any] = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # Serverless: a few connections per instance, recycled before hosted
        # poolers drop idle ones. Prepared statements are disabled because
        # transaction-mode poolers (e.g. Neon's PgBouncer endpoint) can route
        # consecutive statements to different server connections.
        kwargs.update(pool_size=3, max_overflow=2, pool_recycle=240, pool_timeout=10)
        kwargs["connect_args"] = {"prepare_threshold": None, "connect_timeout": 5}
    _engine = create_engine(url, **kwargs)

    if url.startswith("sqlite"):
        @event.listens_for(_engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - driver hook
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

    return _engine


def init_db(attempts: int = 3) -> None:
    """Create tables and run migrations. Retries because several serverless
    instances can start at once and race to create the same objects."""
    engine = get_engine()
    for attempt in range(1, attempts + 1):
        try:
            metadata.create_all(engine)
            _migrate(engine)
            logger.info("Database ready (%s)", engine.url.get_backend_name())
            return
        except Exception:
            if attempt == attempts:
                logger.exception("Database setup failed; requests will retry the connection")
                return
            logger.warning("Database setup attempt %d failed, retrying", attempt)
            time.sleep(0.5 * attempt)


def _migrate(engine: Engine) -> None:
    """Add columns introduced after a database was first created."""
    existing = {c["name"] for c in inspect(engine).get_columns("profiles")}
    with engine.begin() as conn:
        for name, ddl in (("email", "VARCHAR(254)"), ("password_hash", "VARCHAR(255)")):
            if name not in existing:
                conn.execute(text(f"ALTER TABLE profiles ADD COLUMN {name} {ddl}"))
                logger.info("Migrated: added profiles.%s", name)
    profiles_email_index.create(engine, checkfirst=True)


def ping() -> bool:
    try:
        with get_engine().connect() as conn:
            conn.execute(select(1))
        return True
    except Exception:  # pragma: no cover - only on infrastructure failure
        logger.exception("Database ping failed")
        return False


# --------------------------------------------------------------------------- #
# Serialisation helpers
# --------------------------------------------------------------------------- #

def _tags_to_db(tags: Iterable[str]) -> str:
    cleaned = sorted({t for t in tags if t})
    return "," + ",".join(cleaned) + "," if cleaned else ""


def _tags_from_db(raw: str | None) -> list[str]:
    return [t for t in (raw or "").split(",") if t]


def _entry_to_dict(row: Any, include_journal: bool = True) -> dict[str, Any]:
    data = dict(row._mapping)
    data.pop("journal_hash", None)
    data.pop("profile_id", None)
    data["tags"] = _tags_from_db(data.get("tags"))
    try:
        data["factors"] = json.loads(data.get("factors") or "[]")
    except ValueError:
        data["factors"] = []
    data["crisis_flag"] = bool(data.get("crisis_flag"))
    if not include_journal:
        data.pop("journal", None)
    return data


def _profile_to_dict(row: Any) -> dict[str, Any]:
    data = dict(row._mapping)
    data.pop("token_hash", None)
    data.pop("password_hash", None)
    data["has_account"] = bool(data.get("email"))
    return data


# --------------------------------------------------------------------------- #
# Profiles
# --------------------------------------------------------------------------- #

def create_profile(profile_id: str, token_hash: str, display_name: str = "") -> dict[str, Any]:
    now = utcnow_iso()
    values = {
        "id": profile_id,
        "token_hash": token_hash,
        "display_name": display_name,
        "sleep_goal": 8.0,
        "screen_limit": 4.0,
        "step_goal": 7000,
        "created_at": now,
        "last_seen_at": now,
    }
    with get_engine().begin() as conn:
        conn.execute(insert(profiles).values(**values))
    values.pop("token_hash")
    values.update(email=None, has_account=False)
    return values


def get_profile_by_token_hash(token_hash: str) -> dict[str, Any] | None:
    with get_engine().connect() as conn:
        row = conn.execute(select(profiles).where(profiles.c.token_hash == token_hash)).first()
    return _profile_to_dict(row) if row else None


def touch_profile(profile_id: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(update(profiles).where(profiles.c.id == profile_id).values(last_seen_at=utcnow_iso()))


def update_profile(profile_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"display_name", "sleep_goal", "screen_limit", "step_goal"}
    changes = {k: v for k, v in changes.items() if k in allowed}
    with get_engine().begin() as conn:
        if changes:
            conn.execute(update(profiles).where(profiles.c.id == profile_id).values(**changes))
        row = conn.execute(select(profiles).where(profiles.c.id == profile_id)).first()
    return _profile_to_dict(row) if row else None


def delete_profile(profile_id: str) -> None:
    with get_engine().begin() as conn:
        # Explicit child deletes: SQLite only cascades with the FK pragma on.
        conn.execute(delete(entries).where(entries.c.profile_id == profile_id))
        conn.execute(delete(sessions).where(sessions.c.profile_id == profile_id))
        conn.execute(delete(profiles).where(profiles.c.id == profile_id))


# --------------------------------------------------------------------------- #
# Accounts and sessions
# --------------------------------------------------------------------------- #

def get_credentials(email: str) -> tuple[str, str] | None:
    """(profile_id, password_hash) for an email address, if registered."""
    with get_engine().connect() as conn:
        row = conn.execute(
            select(profiles.c.id, profiles.c.password_hash).where(profiles.c.email == email)
        ).first()
    return (row[0], row[1]) if row and row[1] else None


def email_taken(email: str) -> bool:
    with get_engine().connect() as conn:
        return conn.execute(select(profiles.c.id).where(profiles.c.email == email)).first() is not None


def set_credentials(profile_id: str, email: str, password_hash: str, display_name: str | None = None) -> dict[str, Any] | None:
    values: dict[str, Any] = {"email": email, "password_hash": password_hash}
    if display_name:
        values["display_name"] = display_name
    with get_engine().begin() as conn:
        conn.execute(update(profiles).where(profiles.c.id == profile_id).values(**values))
        row = conn.execute(select(profiles).where(profiles.c.id == profile_id)).first()
    return _profile_to_dict(row) if row else None


def create_session(session_id: str, profile_id: str, token_hash: str) -> None:
    now = utcnow_iso()
    with get_engine().begin() as conn:
        conn.execute(insert(sessions).values(
            id=session_id, profile_id=profile_id, token_hash=token_hash, created_at=now, last_used_at=now))


def get_profile_by_session(token_hash: str) -> dict[str, Any] | None:
    with get_engine().begin() as conn:
        row = conn.execute(
            select(profiles).join(sessions, sessions.c.profile_id == profiles.c.id)
            .where(sessions.c.token_hash == token_hash)
        ).first()
        if row:
            conn.execute(update(sessions).where(sessions.c.token_hash == token_hash).values(last_used_at=utcnow_iso()))
    return _profile_to_dict(row) if row else None


def delete_session(token_hash: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(delete(sessions).where(sessions.c.token_hash == token_hash))


# --------------------------------------------------------------------------- #
# Entries
# --------------------------------------------------------------------------- #

def find_recent_duplicate(profile_id: str, journal_hash: str, within_seconds: int = 600) -> int | None:
    """Return the id of an identical entry saved within the window, if any."""
    since = (datetime.now(timezone.utc) - timedelta(seconds=within_seconds)).strftime(
        "%Y-%m-%dT%H:%M:%S.%f"
    )[:-3] + "Z"
    with get_engine().connect() as conn:
        row = conn.execute(
            select(entries.c.id).where(
                and_(
                    entries.c.profile_id == profile_id,
                    entries.c.journal_hash == journal_hash,
                    entries.c.created_at >= since,
                )
            )
        ).first()
    return row[0] if row else None


def save_entry(profile_id: str, data: dict[str, Any]) -> dict[str, Any]:
    values = {
        "profile_id": profile_id,
        "created_at": utcnow_iso(),
        "journal": data["journal"],
        "journal_hash": data["journal_hash"],
        "sleep_hours": data["sleep_hours"],
        "screen_time": data["screen_time"],
        "activity_level": data["activity_level"],
        "sentiment_score": data["sentiment_score"],
        "emotion": data["emotion"],
        "risk_level": data["risk_level"],
        "risk_score": RISK_SCORES[data["risk_level"]],
        "confidence": data["confidence"],
        "explanation": data["explanation"],
        "factors": json.dumps(data.get("factors", [])),
        "tags": _tags_to_db(data.get("tags", [])),
        "crisis_flag": bool(data.get("crisis_flag", False)),
    }
    with get_engine().begin() as conn:
        result = conn.execute(insert(entries).values(**values))
        entry_id = result.inserted_primary_key[0]
        row = conn.execute(select(entries).where(entries.c.id == entry_id)).first()
    return _entry_to_dict(row)


def get_entry(profile_id: str, entry_id: int) -> dict[str, Any] | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(entries).where(and_(entries.c.id == entry_id, entries.c.profile_id == profile_id))
        ).first()
    return _entry_to_dict(row) if row else None


def delete_entry(profile_id: str, entry_id: int) -> bool:
    with get_engine().begin() as conn:
        result = conn.execute(
            delete(entries).where(and_(entries.c.id == entry_id, entries.c.profile_id == profile_id))
        )
    return result.rowcount > 0


_SORTS = {
    "newest": [entries.c.created_at.desc(), entries.c.id.desc()],
    "oldest": [entries.c.created_at.asc(), entries.c.id.asc()],
    "risk_desc": [entries.c.risk_score.desc(), entries.c.created_at.desc()],
    "risk_asc": [entries.c.risk_score.asc(), entries.c.created_at.desc()],
    "sentiment_desc": [entries.c.sentiment_score.desc(), entries.c.created_at.desc()],
    "sentiment_asc": [entries.c.sentiment_score.asc(), entries.c.created_at.desc()],
}


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_entries(
    profile_id: str,
    *,
    q: str | None = None,
    risk: list[str] | None = None,
    emotion: list[str] | None = None,
    tag: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = "newest",
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    conditions = [entries.c.profile_id == profile_id]
    if q:
        pattern = f"%{_escape_like(q.lower())}%"
        conditions.append(
            or_(
                func.lower(entries.c.journal).like(pattern, escape="\\"),
                func.lower(entries.c.explanation).like(pattern, escape="\\"),
            )
        )
    if risk:
        conditions.append(entries.c.risk_level.in_(risk))
    if emotion:
        conditions.append(entries.c.emotion.in_(emotion))
    if tag:
        conditions.append(entries.c.tags.like(f"%,{_escape_like(tag)},%", escape="\\"))
    if date_from:
        conditions.append(entries.c.created_at >= date_from)
    if date_to:
        conditions.append(entries.c.created_at <= date_to)

    where = and_(*conditions)
    with get_engine().connect() as conn:
        total = conn.execute(select(func.count()).select_from(entries).where(where)).scalar_one()
        rows = conn.execute(
            select(entries)
            .where(where)
            .order_by(*_SORTS.get(sort, _SORTS["newest"]))
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
    pages = max(1, -(-total // page_size))
    return {
        "items": [_entry_to_dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


def entries_since(profile_id: str, since_iso: str | None = None) -> list[dict[str, Any]]:
    """All of a profile's entries (oldest first), optionally from a point in time."""
    conditions = [entries.c.profile_id == profile_id]
    if since_iso:
        conditions.append(entries.c.created_at >= since_iso)
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(entries).where(and_(*conditions)).order_by(entries.c.created_at.asc())
        ).all()
    return [_entry_to_dict(r) for r in rows]


def list_tags(profile_id: str) -> list[str]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(entries.c.tags).where(and_(entries.c.profile_id == profile_id, entries.c.tags != ""))
        ).all()
    found: set[str] = set()
    for (raw,) in rows:
        found.update(_tags_from_db(raw))
    return sorted(found)
