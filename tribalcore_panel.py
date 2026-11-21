"""Register a portfolio-facing review view on the deployed NightScout Flask app."""

import re
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

from flask import (
    Blueprint, abort, flash, g, make_response, redirect, render_template,
    request, session, url_for,
)
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
SCOPES = {
    "queue": "На проверке",
    "approved": "Одобрено",
    "rejected": "Отклонено",
    "later": "Пропущено",
    "checked": "История",
}
DECISIONS = {"suitable": "Одобрено", "unsuitable": "Отклонено", "later": "Пропущено"}
MACHINE = {
    "needs_review": "Нужна ручная проверка",
    "auto_approved": "Автоматически одобрен",
    "auto_filtered": "Автоматически отсеян",
}
PAGE_SIZE = 25
UNDO_KEY = "tribalcore_undo"
TOMSK = timezone(timedelta(hours=7))
CHANNEL_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# How many queue candidates to try when reserving the next channel in advance.
NEXT_TRIES = 3


def youtube_channel(channel_id):
    return f"https://www.youtube.com/channel/{channel_id}"


def register_panel(app, *, site_host="tribalcore.bond", local_preview=False):
    from store import CATEGORIES, CandidateDatabase, Conflict, Denied
    from review_presentation import reason_view

    store = app.extensions["review_store"]
    if not callable(getattr(store, "submit", None)):
        raise RuntimeError("The portfolio panel requires the deployed shared review store.")

    panel = Blueprint(
        "tribalcore_panel", __name__, url_prefix="/nightscout",
        template_folder=str(ROOT / "templates"),
        static_folder=str(ROOT / "private_assets"), static_url_path="/assets",
    )

    def current_site():
        return urlsplit("//" + request.host).hostname == site_host

    def private_path(path):
        return path == "/nightscout" or path.startswith("/nightscout/") or path in {"/login", "/logout"}

    if not local_preview:
        original_wsgi = app.wsgi_app
        proxy_wsgi = ProxyFix(original_wsgi, x_for=1, x_proto=1)

        def behind_nginx(environ, start_response):
            host = urlsplit("//" + environ.get("HTTP_HOST", "")).hostname
            if host == site_host and environ.get("REMOTE_ADDR") in {"127.0.0.1", "::1"}:
                return proxy_wsgi(environ, start_response)
            return original_wsgi(environ, start_response)

        app.wsgi_app = behind_nginx

    @app.before_request
    def require_https():
        if current_site() and private_path(request.path) and not local_preview and not request.is_secure:
            abort(400)

    @panel.before_request
    def require_site_and_account():
        if not current_site():
            abort(404)
        if g.user["role"] not in {"owner", "reviewer"}:
            abort(403)

    def filters():
        scope = request.args.get("status", "queue")
        if scope not in SCOPES:
            scope = "queue"
        return {
            "status": scope, "q": request.args.get("q", "").strip()[:120],
            "page": max(1, min(request.args.get("page", 1, type=int), 100000)),
        }

    def listing(uid, params, counts):
        """Search the selected shared queue, including candidates beyond its first page."""
        scope, query, page = params["status"], params["q"].casefold(), params["page"]
        start = (page - 1) * PAGE_SIZE
        if not query:
            return store.listing(uid, scope, limit=PAGE_SIZE, offset=start), counts[scope]

        matching = []
        total = 0
        handle_query = query.removeprefix("@")
        for offset in range(0, counts[scope], 200):
            for row in store.listing(uid, scope, limit=200, offset=offset):
                handle = str(row.get("channel_handle") or "").casefold().removeprefix("@")
                if not (query in str(row.get("channel_name") or "").casefold()
                        or query in row["channel_id"].casefold()
                        or handle_query and handle_query in handle):
                    continue
                if start <= total < start + PAGE_SIZE:
                    matching.append(row)
                total += 1
        return matching, total

    def context():
        params = filters()
        uid = g.user["id"]
        counts = {name: store.listing(uid, name, count=True) for name in SCOPES}
        items, total = listing(uid, params, counts)
        worker = None
        with CandidateDatabase(store.path).readonly_session() as connection:
            if g.user["role"] == "owner":
                latest = connection.execute("""
                    SELECT status, started_at, finished_at
                    FROM night_worker_runs
                    ORDER BY started_at DESC
                    LIMIT 1
                """).fetchone()
                worker = dict(latest) if latest is not None else {}
            # Shared progress, the same for every reviewer.
            analyzed = connection.execute("""
                SELECT COUNT(DISTINCT channel_id)
                FROM channel_analysis_runs
                WHERE provider = 'gateway' AND analysis_mode = 'frames' AND status = 'completed'
            """).fetchone()[0]
            waiting = connection.execute(
                "SELECT COUNT(*) FROM channels WHERE status = 'analysis_pending'"
            ).fetchone()[0]
        return {
            "items": items, "scopes": SCOPES, "counts": counts, "params": params,
            "total": total, "pages": max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
            "worker": worker, "analyzed": analyzed, "decisions": DECISIONS,
            "undo": session.get(UNDO_KEY),
            "progress": {
                "queue": counts["queue"], "analyzed": analyzed, "waiting": waiting,
                "analyzed_share": round(100 * analyzed / (analyzed + waiting)) if analyzed + waiting else 100,
                "today": decided_today(uid),
            },
        }

    def decided_today(uid):
        """Channels this reviewer decided since midnight in Tomsk, undone decisions excluded."""
        midnight = datetime.now(TOMSK).replace(hour=0, minute=0, second=0, microsecond=0)
        since = midnight.astimezone(timezone.utc).isoformat()
        with closing(store.connect()) as connection:
            return connection.execute("""
                SELECT COUNT(DISTINCT p.channel_id) FROM mr_proposals p
                WHERE p.reviewer_id = ? AND p.created_at >= ?
                AND p.decision IN ('suitable', 'unsuitable', 'later')
                AND NOT EXISTS (SELECT 1 FROM mr_events e WHERE e.proposal_id = p.id
                    AND e.action IN ('proposal_undone', 'confirmation_undone'))
            """, (uid, since)).fetchone()[0]

    def reserve_next(uid, current):
        """Reserve the channel after `current` for this reviewer, so it can open in YouTube
        the moment a decision is made and no other reviewer gets the same channel."""
        for _ in range(NEXT_TRIES):
            # Same request-local snapshot the queue counters already built, so this costs nothing extra.
            with closing(store.connect()) as connection:
                pool = store.pool(connection, uid)
            candidates = [row["channel_id"] for row in pool if row["channel_id"] != current]
            if not candidates:
                return None
            try:
                store.claim(uid, candidates[0])
                return candidates[0]
            except Conflict:
                # Taken a moment ago or no longer reviewable: drop the request-local snapshot and retry.
                getattr(g, "shared_pool", {}).clear()
        return None

    @panel.get("")
    @panel.get("/")
    def index():
        return render_template("tribalcore_panel.html", **context(), channel=None)

    @panel.get("/continue")
    def continue_review():
        candidate_id = store.review_pass(g.user["id"])["channel_id"]
        if candidate_id:
            return redirect(url_for(".channel_detail", channel_id=candidate_id))
        flash("В очереди больше нет доступных каналов.")
        return redirect(url_for(".index"))

    @panel.get("/queue")
    def queue_fragment():
        response = make_response(render_template("tribalcore_queue.html", **context()))
        # Refresh the queue without extending the lifetime of the login.
        session.modified = False
        return response

    @panel.get("/channel/<channel_id>")
    def channel_detail(channel_id):
        channel = store.channel(g.user["id"], channel_id)
        titles = {video["video_id"]: video.get("title") for video in channel["videos"]}
        for video in channel["video_cards"]:
            video_id = video.get("video_id")
            video["title"] = titles.get(video_id) or video.get("title")
            if not video.get("youtube_url") and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or ""):
                video["youtube_url"] = f"https://www.youtube.com/watch?v={video_id}"
        page = context()
        assignment = channel.get("assignment")
        reviewable = bool(assignment and assignment["state"] == "queued"
                          and channel.get("manual_status") == "pending_review")
        next_channel = reserve_next(g.user["id"], channel_id) if reviewable else None
        return render_template(
            "tribalcore_panel.html", **page, channel=channel, machine=MACHINE,
            reason_view=reason_view, categories=CATEGORIES, reviewable=reviewable,
            youtube=youtube_channel(channel_id), next_channel=next_channel,
            next_youtube=youtube_channel(next_channel) if next_channel else None,
        )

    def assignment_channel(aid):
        with closing(store.connect()) as connection:
            row = connection.execute(
                "SELECT c.channel_id, c.channel_name FROM mr_assignments a "
                "JOIN channels c ON c.channel_id = a.channel_id WHERE a.id = ?", (aid,),
            ).fetchone()
        if not row:
            return None, "Канал"
        return row["channel_id"], row["channel_name"] or row["channel_id"]

    def next_destination(uid, wanted):
        """The channel reserved on the previous card, if it is still this reviewer's; else the queue."""
        if wanted and CHANNEL_ID.fullmatch(wanted):
            try:
                store.claim(uid, wanted)
                return url_for(".channel_detail", channel_id=wanted)
            except Conflict:
                pass
        return url_for(".continue_review")

    @panel.post("/review")
    def review():
        decision = request.form.get("decision")
        category = request.form.get("category")
        aid = request.form.get("assignment", type=int)
        version = request.form.get("version", type=int)
        if decision not in DECISIONS or category not in CATEGORIES or aid is None or version is None:
            abort(400)
        pid = store.submit(g.user["id"], aid, version, decision, category,
                           reason=request.form.get("reason", "").strip()[:240])
        decided, title = assignment_channel(aid)
        session.pop(UNDO_KEY, None)
        # The canonical store reverses only the owner's own finalized verdicts.
        if decision != "later" and g.user["role"] == "owner":
            session[UNDO_KEY] = {"pid": pid, "title": title, "channel_id": decided}
        flash({
            "suitable": f"«{title}» одобрен. Решение сохранено в NightScout.",
            "unsuitable": f"«{title}» отклонён.",
            "later": f"«{title}» отложен для вас и доступен другим проверяющим.",
        }[decision])
        # Start a fresh read after the canonical transaction commits: straight to the channel
        # reserved on this card (the one YouTube already shows), or the queue if it is gone.
        return redirect(next_destination(g.user["id"], request.form.get("next", "")), code=303)

    @panel.post("/session/new")
    def new_session():
        # The deployed app's own reset redirects to its old UI, which this site does not serve.
        session["review_statistics_anchor"] = store.review_session_snapshot(g.user["id"])
        flash("Начат новый сеанс подсчёта. Все решения остались в истории.")
        back = request.form.get("back", "")
        if not (back == "/nightscout" or back.startswith("/nightscout/")):
            back = url_for(".index")  # only ever return inside the panel
        return redirect(back, code=303)

    @panel.post("/undo")
    def undo_review():
        action = session.pop(UNDO_KEY, None)
        if not action:
            flash("Отменять нечего: последнее решение уже отменено или сохранено окончательно.")
            return redirect(url_for(".index"), code=303)
        try:
            channel_id = store.undo_confirmation(g.user["id"], action["pid"])
        except Conflict:
            flash(f"Решение по «{action['title']}» отменить нельзя: канал уже ушёл дальше или карточка изменилась.")
            return redirect(url_for(".index"), code=303)
        flash(f"Решение по «{action['title']}» отменено. Канал снова на проверке.")
        return redirect(url_for(".channel_detail", channel_id=channel_id), code=303)

    @panel.errorhandler(Conflict)
    def conflict(error):
        return render_template("tribalcore_error.html", title="Карточка обновилась",
                               message="Откройте очередь заново, чтобы получить актуальную карточку."), 409

    @panel.errorhandler(Denied)
    @panel.errorhandler(403)
    def denied(error):
        return render_template("tribalcore_error.html", title="Доступ ограничен",
                               message="У вашей учётной записи нет доступа к этой карточке."), 403

    app.register_blueprint(panel)
    original_login = app.view_functions["login"]

    @wraps(original_login)
    def branded_login():
        if not current_site():
            return original_login()
        if request.method == "POST":
            result = make_response(original_login())
            if result.status_code == 302:
                return redirect(url_for("tribalcore_panel.index"), code=303)
            return render_template("tribalcore_login.html", failed=True), 401
        return render_template("tribalcore_login.html", failed=False)

    app.view_functions["login"] = branded_login

    @app.after_request
    def private_headers(response):
        if current_site() and private_path(request.path):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response
