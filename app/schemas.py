"""Request validation models."""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

JOURNAL_MAX = 5000
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9 \-]{0,22}[a-z0-9]$|^[a-z0-9]$")


def clean_text(value: str) -> str:
    """Strip control characters (keeping newlines/tabs) and surrounding whitespace."""
    value = unicodedata.normalize("NFC", value)
    value = "".join(ch for ch in value if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    return value.strip()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AnalyzeRequest(_Strict):
    journal: str = Field(..., max_length=JOURNAL_MAX)

    @field_validator("journal")
    @classmethod
    def _journal(cls, v: str) -> str:
        return clean_text(v)


class EntryCreate(_Strict):
    journal: str = Field(..., max_length=JOURNAL_MAX)
    sleep_hours: float = Field(..., ge=0, le=24)
    screen_time: float = Field(..., ge=0, le=24)
    activity_level: int = Field(..., ge=0, le=100_000)
    tags: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("journal")
    @classmethod
    def _journal(cls, v: str) -> str:
        v = clean_text(v)
        if len(re.sub(r"\s", "", v)) < 3:
            raise ValueError("Write at least a few words about your day.")
        return v

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for tag in v:
            tag = re.sub(r"\s+", " ", clean_text(tag).lower())
            if not tag:
                continue
            if not TAG_RE.match(tag):
                raise ValueError("Tags may only contain letters, numbers, spaces and dashes (max 24 characters).")
            if tag not in out:
                out.append(tag)
        return out


class ProfileUpdate(_Strict):
    display_name: Optional[str] = Field(None, max_length=40)
    sleep_goal: Optional[float] = Field(None, ge=4, le=12)
    screen_limit: Optional[float] = Field(None, ge=0.5, le=16)
    step_goal: Optional[int] = Field(None, ge=1000, le=50_000)

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return clean_text(v) if v is not None else v


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _clean_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address.")
    return value


class _Credentials(BaseModel):
    # No whitespace stripping: spaces are a legitimate part of a password.
    model_config = ConfigDict(extra="forbid")


class LoginRequest(_Credentials):
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _clean_email(v)


class RegisterRequest(_Credentials):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)
    display_name: Optional[str] = Field(None, max_length=40)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _clean_email(v)

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Use at least 8 characters for your password.")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("Use at least one letter and one number in your password.")
        return v

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return clean_text(v) if v is not None else v
