#!/usr/bin/env python3
"""Fake backend for render-checking the Routing page without a real proxy.

Serves the built panel (dist/) as static files and answers:
  GET  /usage-api/routing      realistic sample payload (2 Claude + 2 Codex logins,
                               one exhausted, one stale, three events)
  POST /usage-api/refresh      same payload; `throttled: true` on repeat calls within 60 s
                               (requires header X-Fleet-Usage: refresh, like the real router)
  GET  /v8/management/config   `{}` so the panel's login succeeds with any key
  GET  /v8/management/credentials  the same logins, so the Quota page shows rank chips
  POST /v8/management/requests/api-call  the upstream calls the Quota page makes, answered
                               by URL: Claude usage (5-hour / 7-day / 7-day Opus windows plus a
                               weekly_scoped Fable 5 limit) + profile + reset-grant status, Codex
                               wham/usage (with rate_limit_reset_credits) + subscriptions +
                               reset-credits list. Numbers differ per auth_index.
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
                            # Stale reading whose 5-hour reset had passed: the router rolled
                            # it forward one period and flags the projection.
                            {"id": "five_hour", "label": "5-hour limit", "weekly": False,
                             "remaining_pct": 100.0, "resets_at": now + hours(3.9),
                             "estimated": True},
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
            item = {
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
            }
            if provider["id"] == "codex":
                # The Quota page reads the ChatGPT account id for the subscriptions call.
                item["chatgpt_account_id"] = f"acct-{account['auth_index']}"
                item["plan_type"] = account["plan"]
            files.append(item)
    return {"files": files}


def iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))


# Per-login numbers so the four rows look different (used %, hours until reset).
CLAUDE_USAGE = {
    "a1": {"five_hour": (0, None), "seven_day": (21, 28), "seven_day_opus": (0, 28), "fable": (42, 28)},
    "a2": {"five_hour": (78, 1.1), "seven_day": (59, 74), "seven_day_opus": (12, 74), "fable": (100, 74)},
}
CODEX_USAGE = {
    "c1": {"five_hour": (9, 4.6), "weekly": (43, 50), "plan": "pro", "credits": 2},
    "c2": {"five_hour": (100, 2.4), "weekly": (100, 54), "plan": "plus", "credits": 0},
}


def claude_usage(auth_index: str, now: int) -> dict:
    usage = CLAUDE_USAGE.get(auth_index, CLAUDE_USAGE["a1"])

    def window(key: str) -> dict:
        used, hours_left = usage[key]
        return {"utilization": used, "resets_at": iso(now + hours(hours_left)) if hours_left else None}

    fable_used, fable_hours = usage["fable"]
    return {
        "five_hour": window("five_hour"),
        "seven_day": window("seven_day"),
        "seven_day_opus": window("seven_day_opus"),
        "limits": [
            {
                "kind": "weekly_scoped",
                "group": "weekly",
                "percent": fable_used,
                "resets_at": iso(now + hours(fable_hours)),
                "is_active": True,
                "scope": {"model": {"id": "claude-fable-5-1", "display_name": "Fable 5"}},
            }
        ],
        "extra_usage": {"is_enabled": False, "monthly_limit": 0, "used_credits": 0, "utilization": None},
    }


def claude_reset_grants(now: int) -> dict:
    """Banked reset grants (cedar_ember) so the Claude rows show a resets-remaining count."""
    return {
        "cedar_ember": {
            "eligible": True,
            "at_limit": False,
            "grants": [
                {
                    "id": "grant-1",
                    "label": "Weekly reset",
                    "resets_total": 2,
                    "resets_left": 1,
                    "starts_at": iso(now - 3600 * 24 * 3),
                    "ends_at": iso(now + 3600 * 24 * 11),
                    "clears": ["five_hour", "seven_day"],
                    "paused": False,
                    "usable_now": True,
                    "use_requires_limit": True,
                }
            ],
            "next_grant_id": "grant-1",
        }
    }


def codex_usage(auth_index: str, now: int) -> dict:
    usage = CODEX_USAGE.get(auth_index, CODEX_USAGE["c1"])
    five_used, five_hours = usage["five_hour"]
    week_used, week_hours = usage["weekly"]
    return {
        "plan_type": usage["plan"],
        "credits": {"has_credits": True, "unlimited": False, "balance": "61216.75"},
        "rate_limit": {
            "allowed": week_used < 100,
            "limit_reached": week_used >= 100,
            "primary_window": {"used_percent": five_used, "limit_window_seconds": 18000,
                               "reset_at": now + hours(five_hours)},
            "secondary_window": {"used_percent": week_used, "limit_window_seconds": 604800,
                                 "reset_at": now + hours(week_hours)},
        },
        "rate_limit_reset_credits": {"available_count": usage["credits"],
                                     "applicable_available_count": usage["credits"]},
    }


def codex_reset_credits(auth_index: str, now: int) -> dict:
    count = CODEX_USAGE.get(auth_index, CODEX_USAGE["c1"])["credits"]
    return {
        "available_count": count,
        "credits": [
            {"id": f"credit-{auth_index}-{i + 1}", "reset_type": "codex_rate_limits", "status": "available",
             "granted_at": iso(now - 3600 * 24 * 5), "expires_at": iso(now + hours(22 * 24 + i * 7 * 24))}
            for i in range(count)
        ],
    }


def api_call(request: dict, now: int) -> dict:
    """Answer one proxied upstream call the way the real /requests/api-call does."""
    url = str(request.get("url", ""))
    auth_index = str(request.get("authIndex") or request.get("auth_index") or "")
    body = None
    if "api.anthropic.com/api/oauth/usage" in url:
        body = claude_reset_grants(now) if "cedar_ember" in url else claude_usage(auth_index, now)
    elif "api.anthropic.com/api/oauth/profile" in url:
        body = {"account": {"email": f"{auth_index}@example.ch", "has_claude_max": True,
                            "has_claude_pro": False},
                "organization": {"uuid": "11111111-2222-4333-8444-555555555555",
                                 "organization_type": "claude_max"}}
    elif "wham/rate-limit-reset-credits/consume" in url:
        body = {"ok": True}
    elif "wham/rate-limit-reset-credits" in url:
        body = codex_reset_credits(auth_index, now)
    elif "wham/usage" in url:
        body = codex_usage(auth_index, now)
    elif "backend-api/subscriptions" in url:
        body = {"active_until": iso(now + hours(21 * 24 + 5))}
    if body is None:
        return {"status_code": 404, "header": {}, "body": {"error": f"not stubbed: {url}"}}
    return {"status_code": 200, "header": {"Content-Type": ["application/json"]}, "body": body}


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
        if path == "/v8/management/requests/api-call":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                request = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                request = {}
            return self._json(200, api_call(request, int(time.time())))
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
