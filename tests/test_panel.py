"""Run against the application sources used by the existing NightScout service."""

import contextlib
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from local_preview import DEMO_PASSWORD, DEMO_USER, create_preview


@pytest.fixture
def setup():
    deployed = Path(os.environ["TRIBALCORE_QA_DEPLOYED"]).resolve(strict=True)
    runtime = deployed / "runtime"
    runtime.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="tribalcore-test-", dir=runtime) as folder:
        yield create_preview(folder, deployed=deployed, primary=os.environ["TRIBALCORE_QA_PRIMARY"],
                             local_http=False)


BASE = "https://127.0.0.1"


def field(response, name):
    match = re.search(rb'name="' + name.encode() + rb'" value="([^"]+)"', response.data)
    assert match is not None, name
    return match.group(1).decode()


def login(app, username=DEMO_USER):
    client = app.test_client()
    response = client.get("/login", base_url=BASE)
    result = client.post("/login", base_url=BASE, data={
        "username": username, "password": DEMO_PASSWORD, "csrf": field(response, "csrf"),
    })
    return client, result


def get(client, path):
    return client.get(path, base_url=BASE)


def proposal(client, channel_id, category, decision):
    page = get(client, "/nightscout/channel/" + channel_id)
    assert page.status_code == 200
    assert b"https://www.youtube.com/channel/" in page.data
    assert b"https://www.youtube.com/watch?v=Demo" in page.data
    data = {name: field(page, name) for name in ("csrf", "assignment", "version")}
    data.update(category=category, decision=decision)
    return data


def test_private_surface_and_login(setup):
    app, _, _ = setup
    anonymous = app.test_client()
    assert b"TRIBALCORE" in get(anonymous, "/").data
    case = get(anonymous, "/projects/nightscout")
    assert case.status_code == 200 and b"UC_demo_" not in case.data
    for path in ("/nightscout", "/nightscout/continue", "/nightscout/queue", "/nightscout/channel/UC_demo_lens",
                 "/nightscout/assets/panel.js"):
        response = get(anonymous, path)
        assert response.status_code == 302 and response.location == "/login"
        assert response.headers["Cache-Control"] == "no-store"
        assert b"UC_demo_lens" not in response.data
    assert get(anonymous, "/assets/preview.db").status_code == 404
    assert anonymous.get("/login", base_url="http://127.0.0.1").status_code == 400
    assert login(app, "inactive")[1].status_code == 401

    client, response = login(app)
    assert response.status_code == 303 and response.location.rstrip("/") == "/nightscout"
    cookie = response.headers["Set-Cookie"]
    assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Lax"))
    queue = get(client, "/nightscout/queue")
    assert queue.status_code == 200
    assert queue.headers["Cache-Control"] == "no-store"
    assert queue.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert "Strict-Transport-Security" in queue.headers
    assert "frame-ancestors 'none'" in queue.headers["Content-Security-Policy"]
    assert "Set-Cookie" not in queue.headers
    assert "Проанализировано</span><strong>4</strong>".encode() in queue.data
    assert "Завершил работу".encode() in queue.data


def test_filters_and_review_are_canonical(setup):
    app, db, category = setup
    client, _ = login(app)
    search = get(client, "/nightscout/?q=РЕКИ")
    assert "Реки и тропы".encode() in search.data and b"UC_demo_lens" not in search.data
    assert b"UC_demo_lens" in get(client, "/nightscout/queue?q=@lens-on-road").data

    approve = proposal(client, "UC_demo_river", category, "suitable")
    assert client.post("/nightscout/review", base_url=BASE, data=approve,
                       headers={"Origin": "https://other.example"}).status_code == 400
    assert client.post("/nightscout/review", base_url=BASE,
                       data={**approve, "csrf": "wrong"}).status_code == 400
    saved = client.post("/nightscout/review", base_url=BASE, data=approve)
    assert saved.status_code == 303 and saved.location == "/nightscout/continue"
    next_card = get(client, saved.location)
    assert next_card.status_code == 302
    assert next_card.location.startswith("/nightscout/channel/") and "UC_demo_river" not in next_card.location
    assert client.post("/nightscout/review", base_url=BASE, data=approve).status_code == 409
    assert b"UC_demo_river" in get(client, "/nightscout/queue?status=approved").data

    reject = proposal(client, "UC_demo_lens", category, "unsuitable")
    assert client.post("/nightscout/review", base_url=BASE,
                       data={**reject, "reason": "Test rejection"}).status_code == 303
    assert b"UC_demo_lens" in get(client, "/nightscout/queue?status=rejected").data

    skip = proposal(client, "UC_demo_travel", category, "later")
    assert client.post("/nightscout/review", base_url=BASE, data=skip).status_code == 303
    assert b"UC_demo_travel" in get(client, "/nightscout/queue?status=later").data
    assert b"UC_demo_travel" not in get(client, "/nightscout/queue").data
    second, _ = login(app, "reviewer")
    assert b"UC_demo_travel" in get(second, "/nightscout/queue").data
    assert b"Night Worker" not in get(second, "/nightscout/queue").data
    assert get(second, "/nightscout/channel/UC_demo_river").status_code == 403

    page = get(client, "/nightscout/channel/UC_demo_forest")
    form = page.data.split(b'id="channel-review"', 1)[1].split(b"</form>", 1)[0]
    first_submit = re.search(rb"<button[^>]*>", form).group(0)
    assert b'type="submit"' in first_submit and b"disabled" in first_submit, "Enter must not approve"

    with db.readonly_session() as connection:
        states = dict(connection.execute("SELECT channel_id, manual_status FROM channels"))
        assert states["UC_demo_river"] == "manual_accepted"
        assert states["UC_demo_lens"] == "manual_rejected"
        assert states["UC_demo_travel"] == "pending_review"
        queued = [tuple(row) for row in connection.execute("SELECT channel_id,status FROM submission_queue")]
        assert queued == [("UC_demo_river", "queued")]
    store = app.extensions["review_store"]
    with contextlib.closing(store.connect()) as con:
        history = con.execute("SELECT reason FROM mr_proposals WHERE decision='unsuitable'").fetchone()
        assert history["reason"] == "Test rejection"


def test_owner_can_undo_last_decision(setup):
    app, db, category = setup
    client, _ = login(app)
    assert client.post("/nightscout/undo", base_url=BASE,
                       data={"csrf": field(get(client, "/nightscout/"), "csrf")}).status_code == 303

    reject = proposal(client, "UC_demo_lens", category, "unsuitable")
    assert client.post("/nightscout/review", base_url=BASE, data=reject).status_code == 303
    after = get(client, "/nightscout/")
    assert "«Линза в пути» отклонён.".encode() in after.data
    assert "Отменить решение".encode() in after.data

    undone = client.post("/nightscout/undo", base_url=BASE, data={"csrf": field(after, "csrf")})
    assert undone.status_code == 303 and undone.location == "/nightscout/channel/UC_demo_lens"
    card = get(client, undone.location)
    assert "Канал снова на проверке".encode() in card.data and b'id="channel-review"' in card.data
    with db.readonly_session() as connection:
        status = connection.execute("SELECT manual_status FROM channels WHERE channel_id='UC_demo_lens'").fetchone()[0]
        assert status == "pending_review"
    # The undo token is single use.
    again = client.post("/nightscout/undo", base_url=BASE, data={"csrf": field(card, "csrf")})
    assert again.status_code == 303 and again.location == "/nightscout/"

    reviewer, _ = login(app, "reviewer")
    # The owner's card view reserved the next channel for the owner, so the reviewer takes theirs from /continue.
    start = get(reviewer, "/nightscout/continue")
    assert start.status_code == 302 and start.location.startswith("/nightscout/channel/")
    skip = proposal(reviewer, start.location.rsplit("/", 1)[1], category, "later")
    assert reviewer.post("/nightscout/review", base_url=BASE, data=skip).status_code == 303
    assert "Отменить решение".encode() not in get(reviewer, "/nightscout/").data


def test_decision_opens_reserved_next_channel(setup):
    app, _, category = setup
    client, _ = login(app)
    card = get(client, "/nightscout/channel/UC_demo_river")
    assert "Мой сеанс".encode() in card.data and "Сегодня</span>\n    <strong>0".encode() in card.data
    reserved = field(card, "next")
    assert reserved != "UC_demo_river"
    assert f'data-next-youtube="https://www.youtube.com/channel/{reserved}"'.encode() in card.data
    for code in (b"KeyA", b"KeyR", b"KeyS"):
        assert b'data-code="' + code + b'"' in card.data

    # The reserved channel is held for this reviewer only.
    other, _ = login(app, "reviewer")
    assert reserved.encode() not in get(other, "/nightscout/queue").data

    data = {name: field(card, name) for name in ("csrf", "assignment", "version")}
    saved = client.post("/nightscout/review", base_url=BASE,
                        data={**data, "category": category, "decision": "suitable", "next": reserved})
    assert saved.status_code == 303 and saved.location == "/nightscout/channel/" + reserved
    landed = get(client, saved.location)
    assert landed.status_code == 200 and b'id="channel-review"' in landed.data
    assert "Сегодня</span>\n    <strong>1".encode() in landed.data
    assert b'class="ok" title="\xd0\x9e\xd0\xb4\xd0\xbe\xd0\xb1\xd1\x80\xd0\xb5\xd0\xbd\xd0\xbe">\xe2\x9c\x93 1' in landed.data


def test_bad_next_falls_back_to_continue(setup):
    app, _, category = setup
    client, _ = login(app)
    for wanted in ("../../login", "https://evil.example/x", "a" * 65):
        card = get(client, "/nightscout/channel/UC_demo_lens")
        if b'id="channel-review"' not in card.data:
            break
        data = {name: field(card, name) for name in ("csrf", "assignment", "version")}
        saved = client.post("/nightscout/review", base_url=BASE,
                            data={**data, "category": category, "decision": "later", "next": wanted})
        assert saved.status_code == 303 and saved.location == "/nightscout/continue"


def test_new_session_resets_counter_and_stays_on_panel(setup):
    app, _, category = setup
    client, _ = login(app)
    approve = proposal(client, "UC_demo_river", category, "suitable")
    assert client.post("/nightscout/review", base_url=BASE, data=approve).status_code == 303
    page = get(client, "/nightscout/")
    assert "✓ 1".encode() in page.data
    for back, expected in (("/nightscout/channel/UC_demo_lens", "/nightscout/channel/UC_demo_lens"),
                           ("https://evil.example/", "/nightscout/"), ("//evil.example", "/nightscout/"),
                           ("/login", "/nightscout/")):
        reset = client.post("/nightscout/session/new", base_url=BASE, data={"csrf": field(page, "csrf"), "back": back})
        assert reset.status_code == 303 and reset.location == expected
    assert client.post("/nightscout/session/new", base_url=BASE, data={"csrf": "wrong"}).status_code == 400
    fresh = get(client, "/nightscout/")
    assert "✓ 0".encode() in fresh.data and "Начат новый сеанс".encode() in fresh.data
    assert "Сегодня</span>\n    <strong>1".encode() in fresh.data  # today keeps counting
