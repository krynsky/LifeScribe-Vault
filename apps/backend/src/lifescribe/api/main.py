from __future__ import annotations

import argparse
import json
import os
import secrets
import sys

import uvicorn

from lifescribe.api.app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="lifescribe-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--auth-token", default=None)
    args = parser.parse_args()

    token = args.auth_token or os.environ.get("LIFESCRIBE_AUTH_TOKEN") or secrets.token_urlsafe(32)
    app = create_app(auth_token=token)
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="warning")
    server = uvicorn.Server(config)

    @app.on_event("startup")
    async def _announce() -> None:
        assigned_port = None
        for s in server.servers:
            for sock in s.sockets:
                assigned_port = sock.getsockname()[1]
                break
            if assigned_port:
                break
        print(
            json.dumps({"host": args.host, "port": assigned_port, "token": token}),
            flush=True,
            file=sys.stdout,
        )

    server.run()


if __name__ == "__main__":
    main()
