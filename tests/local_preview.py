"""Loopback preview using a temporary database and the VPS application factory."""

import argparse
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from flask import Flask, send_from_directory

ROOT = Path(__file__).resolve().parents[1]
DEMO_USER = "owner"
DEMO_PASSWORD = "nightscout-preview-only"
HOST = "127.0.0.1"
CASE_PATH = "/projects/nightscout"


def create_preview(directory, *, deployed, primary, local_http=True):
    os.environ["NIGHTSCOUT_PRIMARY_DIR"] = str(Path(primary).resolve(strict=True))
    sys.path[:0] = [str(ROOT), str(Path(deployed).resolve(strict=True))]
    from app import create_app
    from store import CandidateDatabase, CATEGORIES, Store
    from tribalcore_panel import register_panel

    path = Path(directory) / "preview.db"
    Store(path).initialize()
    db = CandidateDatabase(path)
    app = create_app(path, secret_key=secrets.token_hex(48), local_http=local_http,
                     allowed_hosts=(HOST,), shared_review=True)
    store = app.extensions["review_store"]
    store.create_user(DEMO_USER, "owner", DEMO_PASSWORD)
    store.create_user("reviewer", "reviewer", DEMO_PASSWORD)
    store.create_user("inactive", "reviewer", DEMO_PASSWORD, active=False)

    category = "Природа" if "Природа" in CATEGORIES else CATEGORIES[0]
    examples = [
        ("UC_demo_river", "Реки и тропы", "river-trails", 87),
        ("UC_demo_lens", "Линза в пути", "lens-on-road", 73),
        ("UC_demo_travel", "За горизонтом", "beyond-horizon", 66),
        ("UC_demo_forest", "Лесные маршруты", "forest-routes", 80),
    ]
    for index, (channel_id, title, handle, score) in enumerate(examples, start=1):
        db.upsert_channel({
            "channel_id": channel_id, "channel_name": title, "channel_handle": handle,
            "channel_url": f"https://www.youtube.com/channel/{channel_id}", "status": "needs_review",
            "probable_category": category, "category_confidence": 0.92,
        })
        run = db.start_gateway_run(channel_id)
        for number in (1, 2):
            video_id = f"Demo0000{index:02d}{number}"
            db.upsert_video({
                "video_id": video_id, "channel_id": channel_id,
                "video_url": f"https://www.youtube.com/watch?v={video_id}",
                "title": f"Пример видео {number}", "duration_seconds": 175,
            })
            db.save_video_analysis(video_id, "gateway", "fixture", "1", {
                "video_id": video_id, "probable_category": category, "category_confidence": 0.92,
                "summary": "Пример результата анализа для локального предпросмотра.",
            }, run)
        db.finish_gateway_run(run, completed=True, model_used="fixture")
        db.update_channel_analysis(channel_id, category, .92, "needs_review", "")
        db.set_machine_decision(channel_id, {
            "decision": "needs_review", "score": score, "reasons": ["uncertain_video_evidence"],
            "sample": {"checked": 2, "eligible": 1, "ineligible": 0, "uncertain": 1},
        })

    finished = datetime.now(timezone.utc)
    db.start_night_worker_run("demo", (finished - timedelta(minutes=4)).isoformat(), {})
    db.finish_night_worker_run(
        "demo", status="completed", finished_at=finished.isoformat(), duration_seconds=240,
        discovery=None, hydration=None, candidates=None, counters={}, queue=None, errors=[],
        stop_reason=None, report_path=None,
    )
    register_panel(app, site_host=HOST, local_preview=local_http)
    public = Flask("tribalcore_preview", static_folder=None)

    @public.get("/")
    def portfolio():
        return send_from_directory(ROOT / "public", "index.html")

    @public.get(CASE_PATH, strict_slashes=False)
    def nightscout_case():
        return send_from_directory(ROOT / "public" / "projects" / "nightscout", "index.html")

    @public.get("/assets/<path:filename>")
    def assets(filename):
        return send_from_directory(ROOT / "public" / "assets", filename)

    private_wsgi = app.wsgi_app

    def local_server(environ, start_response):
        path_info = environ.get("PATH_INFO", "")
        if path_info in {"/", CASE_PATH, CASE_PATH + "/"} or path_info.startswith("/assets/"):
            return public.wsgi_app(environ, start_response)
        return private_wsgi(environ, start_response)

    app.wsgi_app = local_server
    return app, db, category


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--deployed", required=True)
    args.add_argument("--primary", required=True)
    args.add_argument("--port", type=int, default=8766)
    flags = args.parse_args()
    runtime = Path(flags.deployed).resolve() / "runtime"
    runtime.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="tribalcore-preview-", dir=runtime) as folder:
        app, _, _ = create_preview(folder, deployed=flags.deployed, primary=flags.primary)
        app.run(host=HOST, port=flags.port, debug=False)
