"""X (Twitter) posting client for the HookSwap marketing bot.

Posts a tweet (optionally with a media image) via the X API v2 ``POST /2/tweets``,
uploading media through the v1.1 ``media/upload`` endpoint first.

Credentials come from the environment (OAuth 1.0a user context — required to
post on behalf of an account):

    X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET

HONEST NOT-CONFIGURED: if ANY required credential is missing, every call returns
``{"ok": False, "reason": "x_not_configured"}`` — it never crashes and never
fakes a post. Uses ``tweepy`` when installed, otherwise signs the requests with
``httpx`` + stdlib OAuth1 (HMAC-SHA1). ``httpx`` is a declared dependency; if it
is not installed the client reports ``{"ok": False, "reason": "x_http_dep_missing"}``.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any

_REQUIRED = ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET")

TWEETS_URL = "https://api.twitter.com/2/tweets"
MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json"


@dataclass
class XCredentials:
    api_key: str
    api_secret: str
    access_token: str
    access_secret: str

    @classmethod
    def from_env(cls) -> "XCredentials | None":
        vals = {name: os.getenv(name) for name in _REQUIRED}
        if not all(vals.values()):
            return None
        return cls(
            api_key=vals["X_API_KEY"],  # type: ignore[arg-type]
            api_secret=vals["X_API_SECRET"],  # type: ignore[arg-type]
            access_token=vals["X_ACCESS_TOKEN"],  # type: ignore[arg-type]
            access_secret=vals["X_ACCESS_SECRET"],  # type: ignore[arg-type]
        )


def _quote(s: str) -> str:
    return urllib.parse.quote(str(s), safe="~")


def _oauth1_header(
    creds: XCredentials,
    method: str,
    url: str,
    *,
    query_params: dict[str, str] | None = None,
    body_params: dict[str, str] | None = None,
) -> str:
    """Build an OAuth 1.0a ``Authorization`` header (HMAC-SHA1).

    Only form-encoded ``body_params`` participate in the signature base string;
    JSON bodies and multipart uploads do not (per the OAuth1 spec), so pass
    ``body_params`` only for form-encoded requests.
    """
    oauth = {
        "oauth_consumer_key": creds.api_key,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": creds.access_token,
        "oauth_version": "1.0",
    }
    all_params = {**oauth, **(query_params or {}), **(body_params or {})}
    param_str = "&".join(
        f"{_quote(k)}={_quote(v)}" for k, v in sorted(all_params.items())
    )
    base = "&".join([method.upper(), _quote(url), _quote(param_str)])
    signing_key = f"{_quote(creds.api_secret)}&{_quote(creds.access_secret)}"
    digest = hmac.new(signing_key.encode(), base.encode(), hashlib.sha1).digest()
    oauth["oauth_signature"] = base64.b64encode(digest).decode()
    header = ", ".join(f'{_quote(k)}="{_quote(v)}"' for k, v in sorted(oauth.items()))
    return "OAuth " + header


class XClient:
    """Thin X API v2 poster with honest not-configured behaviour."""

    def __init__(self, creds: XCredentials | None = None) -> None:
        self._creds = creds if creds is not None else XCredentials.from_env()

    def is_configured(self) -> bool:
        return self._creds is not None

    # -- public API ---------------------------------------------------------- #
    def post_tweet(
        self,
        text: str,
        *,
        media_png: bytes | None = None,
        media_mime: str = "image/png",
    ) -> dict[str, Any]:
        if self._creds is None:
            return {"ok": False, "reason": "x_not_configured",
                    "detail": "missing one or more of " + ", ".join(_REQUIRED)}

        # Prefer tweepy if present.
        try:
            import tweepy  # type: ignore

            return self._post_via_tweepy(tweepy, text, media_png, media_mime)
        except ImportError:
            pass

        try:
            import httpx  # type: ignore
        except ImportError:
            return {"ok": False, "reason": "x_http_dep_missing",
                    "detail": "install 'tweepy' or 'httpx' to post"}
        return self._post_via_httpx(httpx, text, media_png, media_mime)

    # -- tweepy path --------------------------------------------------------- #
    def _post_via_tweepy(
        self, tweepy: Any, text: str, media_png: bytes | None, media_mime: str
    ) -> dict[str, Any]:
        c = self._creds
        assert c is not None
        media_ids = None
        try:
            if media_png is not None:
                import io

                auth = tweepy.OAuth1UserHandler(
                    c.api_key, c.api_secret, c.access_token, c.access_secret
                )
                api = tweepy.API(auth)
                uploaded = api.media_upload(
                    filename="hookswap_card.png",
                    file=io.BytesIO(media_png),
                )
                media_ids = [uploaded.media_id_string]
            client = tweepy.Client(
                consumer_key=c.api_key,
                consumer_secret=c.api_secret,
                access_token=c.access_token,
                access_token_secret=c.access_secret,
            )
            resp = client.create_tweet(text=text, media_ids=media_ids)
            tweet_id = None
            if getattr(resp, "data", None):
                tweet_id = resp.data.get("id") if isinstance(resp.data, dict) else getattr(resp.data, "id", None)
            return {"ok": True, "id": tweet_id, "transport": "tweepy", "media_ids": media_ids}
        except Exception as exc:  # pragma: no cover - network path
            return {"ok": False, "reason": "x_post_failed", "detail": str(exc), "transport": "tweepy"}

    # -- httpx + OAuth1 path ------------------------------------------------- #
    def _upload_media_httpx(self, httpx: Any, media_png: bytes, media_mime: str) -> str:
        c = self._creds
        assert c is not None
        auth = _oauth1_header(c, "POST", MEDIA_UPLOAD_URL)  # multipart: no body in base
        files = {"media": ("hookswap_card.png", media_png, media_mime)}
        r = httpx.post(MEDIA_UPLOAD_URL, headers={"Authorization": auth}, files=files, timeout=30)
        r.raise_for_status()
        return str(r.json()["media_id_string"])

    def _post_via_httpx(
        self, httpx: Any, text: str, media_png: bytes | None, media_mime: str
    ) -> dict[str, Any]:
        c = self._creds
        assert c is not None
        try:
            media_ids = None
            if media_png is not None:
                media_ids = [self._upload_media_httpx(httpx, media_png, media_mime)]

            payload: dict[str, Any] = {"text": text}
            if media_ids:
                payload["media"] = {"media_ids": media_ids}
            # JSON body → not part of OAuth1 signature base.
            auth = _oauth1_header(c, "POST", TWEETS_URL)
            r = httpx.post(
                TWEETS_URL,
                headers={"Authorization": auth, "Content-Type": "application/json"},
                json=payload,
                timeout=30,
            )
            r.raise_for_status()
            data = r.json().get("data", {})
            return {"ok": True, "id": data.get("id"), "transport": "httpx", "media_ids": media_ids}
        except Exception as exc:  # pragma: no cover - network path
            return {"ok": False, "reason": "x_post_failed", "detail": str(exc), "transport": "httpx"}
