def upload(client, data, name="statement.csv"):
    r = client.post("/api/statements", files=[("files", (name, data, "text/csv"))])
    assert r.status_code == 200
    return r.json()["results"][0]


def test_upload_and_duplicate_detection(client, sample_bytes):
    first = upload(client, sample_bytes)
    assert first["status"] == "imported" and first["inserted"] == 357 and first["balance_mismatches"] == 0
    again = upload(client, sample_bytes)
    assert again["status"] == "duplicate" and again["inserted"] == 0
    assert len(client.get("/api/statements").json()) == 1


def test_overlapping_statement_only_adds_new_rows(client, sample_bytes):
    lines = sample_bytes.decode().splitlines(keepends=True)
    header_at = next(i for i, l in enumerate(lines) if l.startswith("Sl. No."))
    head, body = lines[:header_at + 1], lines[header_at + 1:]
    upload(client, "".join(head + body[:200]).encode(), "part1.csv")
    res = upload(client, "".join(head + body[150:]).encode(), "part2.csv")
    assert res["duplicates"] > 0
    assert client.get("/api/meta").json()["transactions"] == 357


def test_dashboard_totals_match_transactions(client, sample_bytes):
    upload(client, sample_bytes)
    d = client.get("/api/dashboard").json()
    t = client.get("/api/transactions", params={"page_size": 500}).json()
    assert round(d["kpis"]["spend"], 2) == round(t["sum_withdrawal"], 2)
    assert round(d["kpis"]["income"], 2) == round(t["sum_deposit"], 2)
    assert round(sum(m["spend"] for m in d["monthly"]), 2) == round(d["kpis"]["spend"], 2)
    assert d["kpis"]["opening_balance"] == 184250.75
    assert any(r["name"] == "Landlord Rent" for r in d["recurring"])


def test_date_filter_and_previous_period(client, sample_bytes):
    upload(client, sample_bytes)
    d = client.get("/api/dashboard", params={"start": "2026-06-01", "end": "2026-06-30"}).json()
    assert d["range"] == {"start": "2026-06-01", "end": "2026-06-30", "days": 30}
    assert [m["month"] for m in d["monthly"]] == ["2026-06"]
    assert d["kpis"]["previous"]["start"] == "2026-05-02"


def test_entities_and_detail(client, sample_bytes):
    upload(client, sample_bytes)
    ents = client.get("/api/entities", params={"direction": "out"}).json()
    assert ents[0]["name"] == "Landlord Rent" and ents[0]["paid"] == 192000
    det = client.get("/api/entities/detail", params={"name": "Swiggy"}).json()
    assert det["stats"]["payments"] == len(det["transactions"])
    assert client.get("/api/entities/detail", params={"name": "Nobody"}).status_code == 404


def test_rename_merges_payees_and_rules_reapply(client, sample_bytes):
    upload(client, sample_bytes)
    client.post("/api/entities/rename", json={"name": "Swiggy", "new_name": "Food delivery"}).raise_for_status()
    client.post("/api/entities/rename", json={"name": "Zomato", "new_name": "Food delivery", "category": "Eating out"}).raise_for_status()
    names = {e["name"] for e in client.get("/api/entities").json()}
    assert "Food delivery" in names and "Swiggy" not in names and "Zomato" not in names
    rules = client.get("/api/rules").json()
    assert len(rules) == 2 and sum(r["hits"] for r in rules) > 0
    for r in rules:
        assert client.delete(f"/api/rules/{r['id']}").status_code == 204
    assert "Swiggy" in {e["name"] for e in client.get("/api/entities").json()}


def test_rule_validation_and_crud(client, sample_bytes):
    upload(client, sample_bytes)
    assert client.post("/api/rules", json={"pattern": "(", "match_mode": "regex", "set_category": "X"}).status_code == 422
    assert client.post("/api/rules", json={"pattern": "uber"}).status_code == 422
    r = client.post("/api/rules", json={"pattern": "uber", "set_category": "Commute"}).json()
    assert r["hits"] > 0
    cats = {c["name"] for c in client.get("/api/dashboard").json()["categories"]}
    assert "Commute" in cats
    upd = client.put(f"/api/rules/{r['id']}", json={"pattern": "uber", "set_category": "Taxi"}).json()
    assert upd["set_category"] == "Taxi"


def test_transactions_paging_sorting_and_export(client, sample_bytes):
    upload(client, sample_bytes)
    page = client.get("/api/transactions", params={"sort": "withdrawal", "order": "desc", "page_size": 5}).json()
    amounts = [i["withdrawal"] for i in page["items"]]
    assert amounts == sorted(amounts, reverse=True) and page["total"] == 357
    assert client.get("/api/transactions", params={"sort": "nope"}).status_code == 422
    csv = client.get("/api/transactions/export", params={"category": "Fuel"})
    assert csv.headers["content-type"].startswith("text/csv") and csv.text.count("\n") > 10


def test_bad_upload_reports_error(client):
    res = upload(client, b"just,some,columns\n1,2,3\n", "bad.csv")
    assert res["status"] == "error" and "header" in res["message"]


def test_delete_statement_and_wipe(client, sample_bytes):
    upload(client, sample_bytes)
    sid = client.get("/api/statements").json()[0]["id"]
    assert client.delete(f"/api/statements/{sid}").status_code == 204
    assert client.get("/api/meta").json()["transactions"] == 0


def test_upload_password_protected(client):
    from tests.test_parsing import _encrypted_xlsx

    data = _encrypted_xlsx("secret")
    files = [("files", ("Email_Statement.xlsx", data, "application/vnd.ms-excel"))]
    r = client.post("/api/statements", files=files).json()["results"][0]
    assert r["status"] == "password_required" and not r["wrong_password"]
    r = client.post("/api/statements", files=files, data={"password": "nope"}).json()["results"][0]
    assert r["status"] == "password_required" and r["wrong_password"]
    r = client.post("/api/statements", files=files, data={"password": "secret"}).json()["results"][0]
    assert r["status"] == "imported" and r["inserted"] == 1
