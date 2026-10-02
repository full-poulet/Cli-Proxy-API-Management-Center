#!/usr/bin/env python3
"""Fake backend for render-checking the Routing page without a real proxy.

Serves the built panel (dist/) as static files and answers:
  GET  /usage-api/routing      realistic sample payload (2 Claude + 2 Codex logins,
                               one exhausted, one stale, three events)
  POST /usage-api/refresh      same payload; `throttled: true` on repeat calls within 60 s
                               (requires header X-Fleet-Usage: refresh, like the real router)
  GET  /v8/management/config   `{}` so the panel's login succeeds with any key
  GET  /v8/management/credentials  the same logins, so the Quota page shows rank chips
Everything else under /v8/management answers 404.

Usage:  python3 dev/fake-usage-api.py [port]   (default 8899)
Then log in at http://127.0.0.1:<port>/ with any management key.
"""

import json
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
REFRESH_MIN_INTERVAL = 60


def hours(n: float) -> int:
    return int(n * 3600)


def payload(now: int, throttled: bool = False) -> dict:
    """Sample routing payload in the router's wire format (unix seconds, snake_case)."""
    return {
        "generated_at": now - 140,
        "next_poll_at": now + 160,
        "throttled": throttled,
        "proxy": {
            "strategy": "fill-first",
            "session_affinity": True,
            "session_affinity_ttl": "1h",
            "session_affinity_subagents": True,
            "reachable": True,
            "error": None,
        },
        "providers": [
            {
                "id": "claude",
                "label": "Claude",
                "accounts": [
                    {
                        "name": "claude-service@example.ch.json",
                        "auth_index": "a1",
                        "email": "service@example.ch",
                        "plan": "max",
                        "disabled": False,
                        "unavailable": False,
                        "rank": 1,
                        "priority": 100,
                        "state": "active",
                        "reason": "Weekly limit resets soonest (in 1 d 4 h)",
                        "windows": [
                            {"id": "seven_day", "label": "7-day limit", "weekly": True,
                             "remaining_pct": 68.0, "resets_at": now + hours(28)},
                            {"id": "five_hour", "label": "5-hour limit", "weekly": False,
                             "remaining_pct": 84.0, "resets_at": now + hours(3.2)},
                            {"id": "seven_day_opus", "label": "7-day Opus", "weekly": True,
                             "remaining_pct": 100.0, "resets_at": now + hours(28)},
                        ],
                        "source": "proxy",
                        "reported_at": now - 140,
                        "stale": False,
                        "error": None,
                    },
                    {
                        "name": "claude-office@example.ch.json",
                        "auth_index": "a2",
                        "email": "office@example.ch",
                        "plan": "max",
                        "disabled": False,
                        "unavailable": False,
                        "rank": 2,
                        "priority": 90,
                        "state": "standby",
                        "reason": "Weekly limit resets later (in 3 d 2 h); takes over when #1 cools down",
                        "windows": [
                            {"id": "seven_day", "label": "7-day limit", "weekly": True,
                             "remaining_pct": 41.0, "resets_at": now + hours(74)},
                            {"id": "five_hour", "label": "5-hour limit", "weekly": False,
                             "remaining_pct": 22.0, "resets_at": now + hours(1.1)},
                        ],
                        "source": "cache",
                        "reported_at": now - 3600 * 2,
                        "stale": True,
                        "error": None,
                    },
                ],
            },
            {
                "id": "codex",
                "label": "Codex",
                "accounts": [
                    {
                        "name": "codex-dev@example.ch.json",
                        "auth_index": "c1",
                        "email": "dev@example.ch",
                        "plan": "pro",
                        "disabled": False,
                        "unavailable": False,
                        "rank": 1,
                        "priority": 100,
                        "state": "active",
                        "reason": "Only login with weekly quota left",
                        "windows": [
                            {"id": "weekly", "label": "Weekly limit", "weekly": True,
                             "remaining_pct": 57.0, "resets_at": now + hours(50)},
                            {"id": "five_hour", "label": "5-hour limit", "weekly": False,
                             "remaining_pct": 91.0, "resets_at": now + hours(4.6)},
                        ],
                        "source": "proxy",
                        "reported_at": now - 140,
                        "stale": False,
                        "error": None,
                    },
                    {
                        "name": "codex-andreas@example.ch.json",
                        "auth_index": "c2",
                        "email": "andreas@example.ch",
                        "plan": "plus",
                        "disabled": False,
                        "unavailable": False,
                        "rank": None,
                        "priority": 0,
                        "state": "exhausted",
                        "reason": "Weekly limit used up; back in the rotation in 2 d 6 h",
                        "windows": [
                            {"id": "weekly", "label": "Weekly limit", "weekly": True,
                             "remaining_pct": 0.0, "resets_at": now + hours(54)},
                            {"id": "five_hour", "label": "5-hour limit", "weekly": False,
                             "remaining_pct": 0.0, "resets_at": now + hours(2.4)},
                        ],
                        "source": "proxy",
                        "reported_at": now - 140,
                        "stale": False,
                        "error": None,
                    },
                ],
            },
        ],
        "events": [
            {"at": now - 140, "provider": "codex",
             "text": "Codex: andreas@example.ch exhausted its weekly limit — dev@example.ch is now #1"},
            {"at": now - 3600 * 5, "provider": "claude",
             "text": "Claude: service@example.ch is now #1 — weekly resets in 1 d 9 h, office@ in 3 d 7 h"},
            {"at": now - 3600 * 26, "provider": "claude",
             "text": "Claude: office@example.ch reading failed, serving cached quota (stale)"},
        ],
    }


def auth_files(now: int) -> dict:
    """Minimal /v8/management/credentials answer that lists the same logins."""
    files = []
    for provider in payload(now)["providers"]:
        for account in provider["accounts"]:
            files.append({
                "name": account["name"],
                "type": provider["id"],
                "provider": provider["id"],
                "email": account["email"],
                "auth_index": account["auth_index"],
                "disabled": account["disabled"],
                "unavailable": account["unavailable"],
                "priority": account["priority"],
                "size": 1024,
                "modified": now - 3600,
            })
    return {"files": files}


class Handler(SimpleHTTPRequestHandler):
    last_refresh = 0.0

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        now = int(time.time())
        if path in ("/usage-api/routing", "/routing"):
            return self._json(200, payload(now))
        if path in ("/usage-api/health", "/health"):
            return self._json(200, {"ready": True})
        if path == "/v8/management/config":
            return self._json(200, {})
        if path in ("/v8/management/credentials", "/v8/management/auth-files"):
            return self._json(200, auth_files(now))
        if path.startswith("/v8/management"):
            return self._json(404, {"error": "not stubbed"})
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/usage-api/refresh", "/refresh"):
            if self.headers.get("X-Fleet-Usage") != "refresh":
                return self._json(403, {"error": "missing X-Fleet-Usage header"})
            now = time.time()
            throttled = now - Handler.last_refresh < REFRESH_MIN_INTERVAL
            if not throttled:
                Handler.last_refresh = now
            return self._json(200, payload(int(now), throttled=throttled))
        return self._json(404, {"error": "not stubbed"})

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        sys.stderr.write("%s %s\n" % (self.command, self.path))


if __name__ == "__main__":
    if not (DIST / "index.html").exists():
        sys.exit(f"dist/index.html missing — run `npm run build` first ({DIST})")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(DIST)))
    print(f"fake usage-api + panel on http://127.0.0.1:{PORT}/  (Ctrl-C to stop)")
    server.serve_forever()
