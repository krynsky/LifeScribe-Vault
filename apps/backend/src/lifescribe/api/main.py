from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import sys

import uvicorn

from lifescribe.api.app import create_app


def _pick_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(prog="lifescribe-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--auth-token", default=None)
    args = parser.parse_args()

    token = (
        args.auth_token
        or os.environ.get("LIFESCRIBE_AUTH_TOKEN")
        or secrets.token_urlsafe(32)
    )
    port = args.port if args.port != 0 else _pick_free_port(args.host)

    print(
        json.dumps({"host": args.host, "port": port, "token": token}),
        flush=True,
        file=sys.stdout,
    )

    app = create_app(auth_token=token)
    config = uvicorn.Config(app, host=args.host, port=port, log_level="warning")
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
