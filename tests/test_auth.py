from conftest import entry_payload

PASSWORD = "calm-days-2026"


def register(client, email="sam@example.com", password=PASSWORD, headers=None, **extra):
    return client.post("/api/auth/register", json={"email": email, "password": password, **extra}, headers=headers or {})


def test_register_login_and_use_session(client):
    res = register(client, display_name="Sam")
    assert res.status_code == 201
    body = res.json()
    assert body["token"].startswith("mhs_") and body["upgraded"] is False
    assert body["profile"]["email"] == "sam@example.com" and body["profile"]["has_account"] is True
    assert "password_hash" not in body["profile"]

    headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.post("/api/entries", headers=headers, json=entry_payload()).status_code == 201

    # A second device signs in and sees the same journal.
    login = client.post("/api/auth/login", json={"email": "  SAM@example.com ", "password": PASSWORD})
    assert login.status_code == 200
    other = {"Authorization": f"Bearer {login.json()['token']}"}
    assert login.json()["token"] != body["token"]
    assert client.get("/api/entries", headers=other).json()["total"] == 1


def test_wrong_password_and_unknown_email_look_the_same(client):
    register(client)
    wrong = client.post("/api/auth/login", json={"email": "sam@example.com", "password": "nope-12345"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "nope-12345"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"] == "Incorrect email or password."


def test_password_with_spaces_is_kept_exactly(client):
    register(client, password=" spaced pass 1 ")
    assert client.post("/api/auth/login", json={"email": "sam@example.com", "password": " spaced pass 1 "}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "sam@example.com", "password": "spaced pass 1"}).status_code == 401


def test_registration_validation(client):
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, password="short1").status_code == 422
    assert register(client, password="onlyletters").status_code == 422
    assert register(client).status_code == 201
    dup = register(client, email="Sam@Example.com")
    assert dup.status_code == 409


def test_guest_upgrade_keeps_journal(client, auth):
    guest_headers, guest = auth
    client.post("/api/entries", headers=guest_headers, json=entry_payload())
    res = register(client, headers=guest_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["upgraded"] is True and body["profile"]["id"] == guest["id"]
    session = {"Authorization": f"Bearer {body['token']}"}
    assert client.get("/api/entries", headers=session).json()["total"] == 1
    # An account can't be upgraded again.
    assert register(client, email="second@example.com", headers=session).status_code == 409


def test_logout_ends_only_that_session(client):
    token = register(client).json()["token"]
    second = client.post("/api/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).json()["token"]
    h1, h2 = ({"Authorization": f"Bearer {t}"} for t in (token, second))
    assert client.post("/api/auth/logout", headers=h1).status_code == 204
    res = client.get("/api/profile", headers=h1)
    assert res.status_code == 401 and "sign in again" in res.json()["error"]["message"]
    assert client.get("/api/profile", headers=h2).status_code == 200


def test_deleting_account_frees_email_and_ends_sessions(client):
    token = register(client).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.delete("/api/profile", headers=headers).status_code == 204
    assert client.get("/api/profile", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 401
    assert register(client).status_code == 201


def test_login_is_rate_limited(client):
    codes = [client.post("/api/auth/login", json={"email": "x@example.com", "password": "whatever1"}).status_code
             for _ in range(11)]
    assert codes[-1] == 429


def test_migration_adds_account_columns_to_old_database(tmp_path):
    import sqlite3

    from app.models import database as db

    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE profiles (id VARCHAR(32) PRIMARY KEY, token_hash VARCHAR(64) NOT NULL UNIQUE, "
                "display_name VARCHAR(40) NOT NULL, sleep_goal FLOAT NOT NULL, screen_limit FLOAT NOT NULL, "
                "step_goal INTEGER NOT NULL, created_at VARCHAR(32) NOT NULL, last_seen_at VARCHAR(32) NOT NULL)")
    con.execute("INSERT INTO profiles VALUES ('p1', 'h1', '', 8, 4, 7000, 'x', 'x')")
    con.commit()
    con.close()

    db.init_engine(f"sqlite:///{path.as_posix()}")
    db.init_db()
    cols = {r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(profiles)")}
    assert {"email", "password_hash"} <= cols
    assert db.get_profile_by_token_hash("h1")["has_account"] is False
    db.init_db()  # idempotent
