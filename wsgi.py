"""WSGI entry point for production deployments.

Run this behind an HTTPS reverse proxy with a real WSGI server, for example:
    gunicorn wsgi:application
"""

from app import app, load_excel


try:
    load_excel()
except Exception as exc:  # pragma: no cover - deployment diagnostics
    print(f"[ScoreQuery] Excel preload failed during WSGI startup: {exc}")


application = app
