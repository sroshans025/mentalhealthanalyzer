from conftest import entry_payload


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["database"] == "ok"


def test_index_and_security_headers(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "Mental Health Predictor" in res.text
    assert "__V__" not in res.text and "app.js?v=" in res.text
    assert "script-src 'self'" in res.headers["content-security-policy"]
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


def test_static_assets_are_served(client):
    for path in ("/static/assets/css/app.css", "/static/assets/js/app.js", "/static/assets/img/hero.svg",
                 "/static/assets/vendor/chart.umd.min.js", "/favicon.ico"):
        assert client.get(path).status_code == 200, path


def test_data_endpoints_require_a_profile_key(client):
    for method, path in (("get", "/api/entries"), ("get", "/api/stats"), ("get", "/api/insights"),
                         ("get", "/api/profile"), ("get", "/api/export"), ("get", "/api/history")):
        res = getattr(client, method)(path)
        assert res.status_code == 401, path
        assert res.json()["error"]["code"] == 401
    assert client.post("/api/entries", json=entry_payload()).status_code == 401
    bad = {"Authorization": "Bearer mhp_not-a-real-key"}
    assert client.get("/api/entries", headers=bad).status_code == 401


def test_create_entry_returns_full_analysis(client, auth):
    headers, _ = auth
    res = client.post("/api/entries", headers=headers, json=entry_payload())
    assert res.status_code == 201
    body = res.json()
    assert body["risk_level"] in {"Low", "Medium", "High"}
    assert 0 <= body["confidence"] <= 100
    assert body["emotion"] in {"joy", "neutral", "sadness", "fear", "anger"}
    assert body["tags"] == ["exercise"]
    assert {f["key"] for f in body["factors"]} == {"sentiment", "sleep", "screen", "activity"}
    assert body["suggestions"]
    assert "journal_hash" not in body and "profile_id" not in body


def test_legacy_predict_endpoint_still_works(client, auth):
    headers, _ = auth
    res = client.post("/api/predict", headers=headers, json=entry_payload(journal="Legacy client entry today."))
    assert res.status_code == 201
    assert res.json()["risk_level"] in {"Low", "Medium", "High"}


def test_healthy_and_unhealthy_days_are_ranked_sensibly(client, auth):
    headers, _ = auth
    good = client.post("/api/entries", headers=headers, json=entry_payload()).json()
    bad = client.post("/api/entries", headers=headers, json=entry_payload(
        journal="I feel hopeless, exhausted and anxious about everything.",
        sleep_hours=3.5, screen_time=12, activity_level=800, tags=[])).json()
    order = {"Low": 1, "Medium": 2, "High": 3}
    assert order[good["risk_level"]] < order[bad["risk_level"]]
    assert bad["risk_level"] == "High"


def test_crisis_language_forces_high_risk_and_flag(client, auth):
    headers, _ = auth
    res = client.post("/api/entries", headers=headers, json=entry_payload(journal="Honestly I just want to die."))
    body = res.json()
    assert body["crisis_flag"] is True
    assert body["risk_level"] == "High"


def test_validation_errors_are_readable(client, auth):
    headers, _ = auth
    res = client.post("/api/entries", headers=headers, json=entry_payload(journal="  ", sleep_hours=30, activity_level=-5))
    assert res.status_code == 422
    fields = {d["field"] for d in res.json()["error"]["details"]}
    assert fields == {"journal", "sleep_hours", "activity_level"}

    res = client.post("/api/entries", headers=headers, json=entry_payload(tags=["<script>"]))
    assert res.status_code == 422
    res = client.post("/api/entries", headers=headers, json={**entry_payload(), "unexpected": 1})
    assert res.status_code == 422
    res = client.post("/api/entries", headers=headers, json=entry_payload(journal="x" * 5001))
    assert res.status_code == 422


def test_duplicate_entries_are_rejected(client, auth):
    headers, _ = auth
    first = client.post("/api/entries", headers=headers, json=entry_payload())
    second = client.post("/api/entries", headers=headers, json=entry_payload())
    assert second.status_code == 409
    assert second.json()["error"]["details"]["entry_id"] == first.json()["id"]


def test_profiles_are_isolated(client, auth):
    headers, _ = auth
    entry = client.post("/api/entries", headers=headers, json=entry_payload()).json()
    other = {"Authorization": f"Bearer {client.post('/api/profiles').json()['token']}"}
    assert client.get(f"/api/entries/{entry['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/entries/{entry['id']}", headers=other).status_code == 404
    assert client.get("/api/entries", headers=other).json()["total"] == 0
    assert client.get(f"/api/entries/{entry['id']}", headers=headers).status_code == 200


def test_search_filter_sort_and_pagination(client, auth):
    headers, _ = auth
    texts = [
        ("Great day at the beach with friends, feeling happy.", ["friends"], 8, 2, 12000),
        ("Exam stress is making me anxious and tired.", ["study"], 5, 8, 2000),
        ("Normal day, worked and cooked dinner.", ["work"], 7, 5, 6000),
        ("Argued with my brother, so frustrated and angry.", ["family"], 6, 6, 3000),
        ("Studied for the exam all day, felt okay.", ["study"], 7.5, 7, 4000),
    ]
    for journal, tags, sleep, screen, steps in texts:
        r = client.post("/api/entries", headers=headers, json=entry_payload(
            journal=journal, tags=tags, sleep_hours=sleep, screen_time=screen, activity_level=steps))
        assert r.status_code == 201

    res = client.get("/api/entries", headers=headers, params={"q": "EXAM"}).json()
    assert res["total"] == 2
    assert client.get("/api/entries", headers=headers, params={"q": "100%_"}).json()["total"] == 0

    res = client.get("/api/entries", headers=headers, params={"tag": "study"}).json()
    assert res["total"] == 2 and all("study" in e["tags"] for e in res["items"])

    res = client.get("/api/entries", headers=headers, params={"emotion": ["anger"]}).json()
    assert all(e["emotion"] == "anger" for e in res["items"]) and res["total"] >= 1

    risks = [e["risk_score"] for e in client.get("/api/entries", headers=headers, params={"sort": "risk_desc"}).json()["items"]]
    assert risks == sorted(risks, reverse=True)

    page1 = client.get("/api/entries", headers=headers, params={"page_size": 2, "page": 1}).json()
    page3 = client.get("/api/entries", headers=headers, params={"page_size": 2, "page": 3}).json()
    assert page1["pages"] == 3 and len(page1["items"]) == 2 and len(page3["items"]) == 1

    assert client.get("/api/entries", headers=headers, params={"sort": "nonsense"}).status_code == 422
    assert client.get("/api/entries", headers=headers, params={"from": "2026-13-45"}).status_code == 422
    assert client.get("/api/entries", headers=headers, params={"from": "2026-05-02", "to": "2026-05-01"}).status_code == 422
    assert client.get("/api/tags", headers=headers).json()["tags"] == ["family", "friends", "study", "work"]


def test_delete_entry(client, auth):
    headers, _ = auth
    entry = client.post("/api/entries", headers=headers, json=entry_payload()).json()
    assert client.delete(f"/api/entries/{entry['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/entries/{entry['id']}", headers=headers).status_code == 404
    assert client.delete(f"/api/entries/{entry['id']}", headers=headers).status_code == 404


def test_stats_and_insights(client, auth):
    headers, _ = auth
    empty = client.get("/api/stats", headers=headers).json()
    assert empty["totals"]["all_time"] == 0 and empty["latest"] is None

    for i in range(4):
        client.post("/api/entries", headers=headers, json=entry_payload(journal=f"Entry number {i}, a fine day."))
    stats = client.get("/api/stats", headers=headers, params={"days": 7, "tz": 330}).json()
    assert stats["totals"]["in_range"] == 4
    assert stats["checked_in_today"] is True
    assert stats["streak"] == 1
    assert len(stats["timeline"]) == 1 and stats["timeline"][0]["count"] == 4
    assert sum(stats["emotions"].values()) == 4
    assert client.get("/api/stats", headers=headers, params={"days": 12}).status_code == 422

    insights = client.get("/api/insights", headers=headers).json()
    assert insights["ready"] is True
    assert set(insights["breakdowns"]) == {"sleep", "screen", "activity"}


def test_insights_need_three_entries(client, auth):
    headers, _ = auth
    client.post("/api/entries", headers=headers, json=entry_payload())
    res = client.get("/api/insights", headers=headers).json()
    assert res["ready"] is False and res["needed"] == 2


def test_profile_update_and_goal_validation(client, auth):
    headers, _ = auth
    res = client.patch("/api/profile", headers=headers, json={"display_name": " Sam ", "sleep_goal": 7.5, "step_goal": 9000})
    assert res.status_code == 200
    assert res.json()["display_name"] == "Sam" and res.json()["sleep_goal"] == 7.5
    assert client.patch("/api/profile", headers=headers, json={"sleep_goal": 2}).status_code == 422
    assert client.patch("/api/profile", headers=headers, json={"token_hash": "x"}).status_code == 422


def test_export_csv_and_json(client, auth):
    headers, _ = auth
    client.post("/api/entries", headers=headers, json=entry_payload(journal="=HYPERLINK(\"http://x\") test entry"))
    csv_res = client.get("/api/export", headers=headers, params={"format": "csv"})
    assert csv_res.status_code == 200
    assert "attachment" in csv_res.headers["content-disposition"]
    assert "'=HYPERLINK" in csv_res.text  # formula injection neutralised
    json_res = client.get("/api/export", headers=headers, params={"format": "json"})
    assert len(json_res.json()["entries"]) == 1


def test_delete_profile_removes_everything(client, auth):
    headers, _ = auth
    client.post("/api/entries", headers=headers, json=entry_payload())
    assert client.delete("/api/profile", headers=headers).status_code == 204
    assert client.get("/api/profile", headers=headers).status_code == 401


def test_rate_limit_on_profile_creation(client):
    codes = [client.post("/api/profiles").status_code for _ in range(31)]
    assert codes[:30] == [201] * 30 and codes[30] == 429


def test_unknown_api_route_is_json_404(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == 404


def test_ephemeral_mode_provisions_unknown_keys(client, monkeypatch):
    import app.security as security
    from dataclasses import replace

    key = "mhp_" + "a" * 43
    headers = {"Authorization": f"Bearer {key}"}
    assert client.get("/api/profile", headers=headers).status_code == 401

    monkeypatch.setattr(security, "settings", replace(security.settings, database_url="sqlite:////tmp/x.db"))
    first = client.get("/api/profile", headers=headers)
    assert first.status_code == 200
    assert client.get("/api/profile", headers=headers).json()["id"] == first.json()["id"]
    assert client.get("/api/profile", headers={"Authorization": "Bearer mhp_short"}).status_code == 401


def test_hostile_and_unusual_input_never_crashes(client, auth):
    headers, _ = auth
    for path in ("/api/entries/99999999999999999999999", "/api/entries/0", "/api/entries/-1"):
        assert client.get(path, headers=headers).status_code in (404, 422), path
        assert client.delete(path, headers=headers).status_code in (404, 422), path
    big = client.post("/api/entries", headers={**headers, "content-type": "application/json"},
                      content=b'{"journal":"' + b"x" * 70_000 + b'"}')
    assert big.status_code == 413
    nan = client.post("/api/entries", headers={**headers, "content-type": "application/json"},
                      content=b'{"journal":"nan day today","sleep_hours":NaN,"screen_time":3,"activity_level":5000}')
    assert nan.status_code == 422
    xss = "<img src=x onerror=alert(1)>"
    res = client.post("/api/entries", headers=headers, json=entry_payload(journal=xss))
    assert res.status_code == 201 and res.json()["journal"] == xss  # stored as text, escaped by the UI
    assert client.post("/api/entries", headers=headers, json=entry_payload(journal="hi\x00‮ there")).json()["journal"] == "hi there"
