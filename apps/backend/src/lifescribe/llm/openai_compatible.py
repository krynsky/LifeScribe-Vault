from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from lifescribe.llm.base import (
    ChatChunk,
    ChatRequest,
    CredentialMissing,
    ModelInfo,
    UpstreamError,
    UpstreamTimeout,
)
from lifescribe.llm.privacy import check_url_allowed


@dataclass
class ChatResult:
    content: str
    finish_reason: str | None


class OpenAICompatibleClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str | None,
        local: bool,
        requires_token: bool = False,
        connect_timeout: float = 5.0,
        read_timeout: float = 60.0,
        provider_id: str = "",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.local = local
        self.requires_token = requires_token
        self.provider_id = provider_id
        self._timeout = httpx.Timeout(read_timeout, connect=connect_timeout)

    def _headers(self) -> dict[str, str]:
        h = {"Accept": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _check_credential(self) -> None:
        if self.requires_token and not self.token:
            raise CredentialMissing(self.provider_id or "unknown")

    async def list_models(self, *, privacy_mode: bool) -> list[ModelInfo]:
        check_url_allowed(self.base_url, privacy_mode=privacy_mode)
        self._check_credential()
        url = f"{self.base_url}/models"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise UpstreamTimeout() from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(0, f"network error: {exc}") from exc
        if resp.status_code >= 400:
            raise UpstreamError(resp.status_code, f"HTTP {resp.status_code}", body=resp.text)
        data = resp.json().get("data", [])
        return [ModelInfo(id=item["id"], context_length=item.get("context_length")) for item in data]

    async def chat(self, req: ChatRequest, *, privacy_mode: bool) -> ChatResult:
        check_url_allowed(self.base_url, privacy_mode=privacy_mode)
        self._check_credential()
        payload = _build_payload(req, stream=False)
        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
        except httpx.TimeoutException as exc:
            raise UpstreamTimeout() from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(0, f"network error: {exc}") from exc
        if resp.status_code >= 400:
            raise UpstreamError(resp.status_code, f"HTTP {resp.status_code}", body=resp.text)
        body = resp.json()
        choice = body["choices"][0]
        return ChatResult(
            content=choice["message"]["content"],
            finish_reason=choice.get("finish_reason"),
        )

    async def stream_chat(
        self, req: ChatRequest, *, privacy_mode: bool
    ) -> AsyncIterator[ChatChunk]:
        check_url_allowed(self.base_url, privacy_mode=privacy_mode)
        self._check_credential()
        payload = _build_payload(req, stream=True)
        url = f"{self.base_url}/chat/completions"
        headers = {**self._headers(), "Accept": "text/event-stream"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if resp.status_code >= 400:
                        body_bytes = await resp.aread()
                        raise UpstreamError(
                            resp.status_code,
                            f"HTTP {resp.status_code}",
                            body=body_bytes.decode("utf-8", "replace"),
                        )
                    async for chunk in _iter_sse_chunks(resp):
                        yield chunk
            except httpx.TimeoutException as exc:
                raise UpstreamTimeout() from exc
            except httpx.HTTPError as exc:
                raise UpstreamError(0, f"network error: {exc}") from exc


def _build_payload(req: ChatRequest, *, stream: bool) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": req.model,
        "messages": [m.model_dump() for m in req.messages],
        "stream": stream,
    }
    if req.temperature is not None:
        payload["temperature"] = req.temperature
    if req.max_tokens is not None:
        payload["max_tokens"] = req.max_tokens
    return payload


async def _iter_sse_chunks(resp: httpx.Response) -> AsyncIterator[ChatChunk]:
    log = logging.getLogger(__name__)
    async for line in resp.aiter_lines():
        if not line or not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            return
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            log.warning("skipping malformed SSE line")
            continue
        choices = obj.get("choices") or []
        if not choices:
            continue
        delta = (choices[0].get("delta") or {}).get("content", "")
        finish_reason = choices[0].get("finish_reason")
        yield ChatChunk(delta=delta, finish_reason=finish_reason)
