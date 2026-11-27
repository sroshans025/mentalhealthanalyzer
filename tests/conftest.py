import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("LOG_LEVEL", "WARNING")

from fastapi.testclient import TestClient  # noqa: E402

from app.models import database as db  # noqa: E402
from app.security import limiter  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    db.init_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    limiter.reset()
    from app.main import app

    with TestClient(app) as c:
        yield c
    db.get_engine().dispose()


@pytest.fixture()
def auth(client):
    """Create a profile and return (headers, profile)."""
    res = client.post("/api/profiles")
    assert res.status_code == 201
    body = res.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["profile"]


def entry_payload(**overrides):
    payload = {
        "journal": "Had a calm day, went for a long walk and felt good.",
        "sleep_hours": 8,
        "screen_time": 3,
        "activity_level": 9000,
        "tags": ["exercise"],
    }
    payload.update(overrides)
    return payload
