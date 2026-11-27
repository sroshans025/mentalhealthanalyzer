"""HTTP API. Every data route is scoped to the caller's private profile."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse

from app.config import APP_VERSION, settings
from app.models import database as db
from app.models.ml_model import get_predictor
from app.schemas import AnalyzeRequest, EntryCreate, ProfileUpdate
from app.security import current_profile, hash_token, new_token, rate_limit
from app.services.insights import compute_insights, compute_stats, iso_utc
from app.utils.nlp import EMOTIONS, analyze

logger = logging.getLogger(__name__)
router = APIRouter()

Profile = dict[str, Any]
RiskLevel = Literal["Low", "Medium", "High"]
Emotion = Literal["joy", "neutral", "sadness", "fear", "anger"]
SortKey = Literal["newest", "oldest", "risk_desc", "risk_asc", "sentiment_desc", "sentiment_asc"]
TzOffset = Query(0, ge=-14 * 60, le=14 * 60, description="Client UTC offset in minutes (east positive)")


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #

@router.get("/health", tags=["system"])
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "database": "ok" if db.ping() else "unavailable",
        "storage": "ephemeral" if settings.is_ephemeral_storage else "persistent",
    }


# --------------------------------------------------------------------------- #
# Profile
# --------------------------------------------------------------------------- #

@router.post("/profiles", status_code=status.HTTP_201_CREATED, tags=["profile"],
             dependencies=[Depends(rate_limit("profile-create", 30, 3600, per="ip"))])
def create_profile() -> dict[str, Any]:
    token = new_token()
    profile = db.create_profile(uuid.uuid4().hex, hash_token(token))
    logger.info("Profile created %s", profile["id"][:8])
    return {"profile": profile, "token": token}


@router.get("/profile", tags=["profile"])
def read_profile(profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    db.touch_profile(profile["id"])
    return profile


@router.patch("/profile", tags=["profile"])
def patch_profile(body: ProfileUpdate, profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    updated = db.update_profile(profile["id"], body.model_dump(exclude_none=True))
    if updated is None:  # pragma: no cover - deleted mid-request
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found.")
    return updated


@router.delete("/profile", status_code=status.HTTP_204_NO_CONTENT, tags=["profile"])
def remove_profile(profile: Profile = Depends(current_profile)) -> Response:
    db.delete_profile(profile["id"])
    logger.info("Profile deleted %s", profile["id"][:8])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Analysis
# --------------------------------------------------------------------------- #

@router.post("/analyze", tags=["analysis"],
             dependencies=[Depends(rate_limit("analyze", 90, 60))])
def analyze_preview(body: AnalyzeRequest, _: Profile = Depends(current_profile)) -> dict[str, Any]:
    """Live, unsaved tone preview while the user is still writing."""
    result = analyze(body.journal) if body.journal else None
    return {
        "sentiment_score": result.sentiment_score if result else 0.0,
        "emotion": result.emotion if result else "neutral",
        "crisis_flag": result.crisis_flag if result else False,
        "word_count": result.word_count if result else 0,
    }


def _run_prediction(body: EntryCreate) -> dict[str, Any]:
    text = analyze(body.journal)
    pred = get_predictor().predict_full(
        sentiment_score=text.sentiment_score,
        sleep=body.sleep_hours,
        screen=body.screen_time,
        activity=body.activity_level,
        crisis_flag=text.crisis_flag,
    )
    return {
        "journal": body.journal,
        "journal_hash": hashlib.sha256(body.journal.encode("utf-8")).hexdigest(),
        "sleep_hours": body.sleep_hours,
        "screen_time": body.screen_time,
        "activity_level": body.activity_level,
        "tags": body.tags,
        "sentiment_score": round(text.sentiment_score, 2),
        "emotion": text.emotion,
        "crisis_flag": text.crisis_flag,
        "risk_level": pred.risk_level,
        "confidence": pred.confidence,
        "probabilities": pred.probabilities,
        "explanation": pred.explanation,
        "factors": [f.__dict__ for f in pred.factors],
        "suggestions": pred.suggestions,
    }


@router.post("/entries", status_code=status.HTTP_201_CREATED, tags=["entries"],
             dependencies=[Depends(rate_limit("entries", 30, 60))])
def create_entry(body: EntryCreate, profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    result = _run_prediction(body)
    duplicate = db.find_recent_duplicate(profile["id"], result["journal_hash"])
    if duplicate is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"message": "You already saved this exact entry a few minutes ago.", "entry_id": duplicate},
        )
    saved = db.save_entry(profile["id"], result)
    saved["probabilities"] = result["probabilities"]
    saved["suggestions"] = result["suggestions"]
    logger.info("Entry %s saved (risk=%s)", saved["id"], saved["risk_level"])
    return saved


# Kept for compatibility with earlier clients of the API.
@router.post("/predict", status_code=status.HTTP_201_CREATED, tags=["entries"], include_in_schema=False,
             dependencies=[Depends(rate_limit("entries", 30, 60))])
def predict_risk(body: EntryCreate, profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    return create_entry(body, profile)


# --------------------------------------------------------------------------- #
# Entries
# --------------------------------------------------------------------------- #

def _parse_date(value: Optional[str], end: bool, tz_offset: int) -> Optional[str]:
    """Turn a local YYYY-MM-DD date into a UTC ISO bound."""
    if not value:
        return None
    try:
        d = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(422, "Dates must use the YYYY-MM-DD format.")
    if end:
        d = d + timedelta(days=1) - timedelta(milliseconds=1)
    return iso_utc(d.replace(tzinfo=timezone.utc) - timedelta(minutes=tz_offset))


@router.get("/entries", tags=["entries"])
def list_entries(
    profile: Profile = Depends(current_profile),
    q: Optional[str] = Query(None, max_length=100),
    risk: Optional[list[RiskLevel]] = Query(None),
    emotion: Optional[list[Emotion]] = Query(None),
    tag: Optional[str] = Query(None, max_length=24),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    sort: SortKey = "newest",
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(10, ge=1, le=100),
    tz: int = TzOffset,
) -> dict[str, Any]:
    start, end = _parse_date(date_from, False, tz), _parse_date(date_to, True, tz)
    if start and end and start > end:
        raise HTTPException(422, "The start date must be before the end date.")
    return db.list_entries(
        profile["id"], q=(q or "").strip() or None, risk=risk, emotion=emotion,
        tag=(tag or "").strip().lower() or None, date_from=start, date_to=end,
        sort=sort, page=page, page_size=page_size,
    )


@router.get("/entries/{entry_id}", tags=["entries"])
def read_entry(entry_id: int, profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    entry = db.get_entry(profile["id"], entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found.")
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["entries"])
def remove_entry(entry_id: int, profile: Profile = Depends(current_profile)) -> Response:
    if not db.delete_entry(profile["id"], entry_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/tags", tags=["entries"])
def tags(profile: Profile = Depends(current_profile)) -> dict[str, list[str]]:
    return {"tags": db.list_tags(profile["id"])}


@router.get("/history", tags=["entries"])
def history(profile: Profile = Depends(current_profile)) -> dict[str, Any]:
    """Most recent 30 entries, newest first (compact form)."""
    page = db.list_entries(profile["id"], page_size=30)
    return {"history": [
        {"id": e["id"], "timestamp": e["created_at"], "risk_level": e["risk_level"], "emotion": e["emotion"]}
        for e in page["items"]
    ]}


# --------------------------------------------------------------------------- #
# Dashboard, insights and export
# --------------------------------------------------------------------------- #

@router.get("/stats", tags=["insights"])
def stats(
    profile: Profile = Depends(current_profile),
    days: int = Query(30, description="One of 0 (all time), 7, 30, 90, 365"),
    tz: int = TzOffset,
) -> dict[str, Any]:
    if days not in (0, 7, 30, 90, 365):
        raise HTTPException(422, "days must be one of 0, 7, 30, 90 or 365.")
    return compute_stats(db.entries_since(profile["id"]), profile, days, tz)


@router.get("/insights", tags=["insights"])
def insights(profile: Profile = Depends(current_profile), tz: int = TzOffset) -> dict[str, Any]:
    since = iso_utc(datetime.now(timezone.utc) - timedelta(days=365))
    return compute_insights(db.entries_since(profile["id"], since), profile, tz)


EXPORT_FIELDS = ["id", "created_at", "journal", "tags", "sleep_hours", "screen_time", "activity_level",
                 "sentiment_score", "emotion", "risk_level", "confidence", "explanation", "crisis_flag"]


@router.get("/export", tags=["insights"],
            dependencies=[Depends(rate_limit("export", 20, 60))])
def export(profile: Profile = Depends(current_profile),
           format: Literal["csv", "json"] = "csv") -> StreamingResponse:
    rows = db.entries_since(profile["id"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    if format == "json":
        payload = json.dumps({
            "exported_at": iso_utc(datetime.now(timezone.utc)),
            "profile": {k: profile[k] for k in ("display_name", "sleep_goal", "screen_limit", "step_goal")},
            "entries": rows,
        }, indent=2, ensure_ascii=False)
        media, body = "application/json", payload
    else:
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            r = dict(r, tags=";".join(r["tags"]))
            # Neutralise spreadsheet formula injection in free text.
            for key in ("journal", "explanation", "tags"):
                if isinstance(r[key], str) and r[key][:1] in ("=", "+", "-", "@", "\t", "\r"):
                    r[key] = "'" + r[key]
            writer.writerow(r)
        media, body = "text/csv; charset=utf-8", "﻿" + buf.getvalue()
    filename = f"wellbeing-journal-{stamp}.{format}"
    return StreamingResponse(
        iter([body]), media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


__all__ = ["router", "EMOTIONS"]
