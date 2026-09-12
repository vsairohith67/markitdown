"""Small, memory-only HTTP adapter for the MarkItDown package.

The public UI sends one base64-encoded file or one allowlisted ChatGPT share
URL at a time. Nothing is written to disk by this adapter, and the underlying
package is imported from this checkout so the web surface tracks the
repository's conversion behavior.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import io
import json
import logging
import os
import re
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_SRC = ROOT / "packages" / "markitdown" / "src"
if str(PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC))

from markitdown import (  # noqa: E402
    FileConversionException,
    MarkItDown,
    MissingDependencyException,
    UnsupportedFormatException,
    StreamInfo,
)


LOGGER = logging.getLogger("markitdown.web")
MAX_FILE_BYTES = int(os.getenv("MARKITDOWN_MAX_FILE_BYTES", "3000000"))
MAX_REQUEST_BYTES = int(os.getenv("MARKITDOWN_MAX_REQUEST_BYTES", "4400000"))
MAX_MARKDOWN_BYTES = int(os.getenv("MARKITDOWN_MAX_MARKDOWN_BYTES", "4000000"))
MAX_FILENAME_LENGTH = 180
MAX_CHATGPT_PAGE_BYTES = int(os.getenv("MARKITDOWN_MAX_CHATGPT_PAGE_BYTES", "50000000"))
MAX_CHATGPT_REDIRECTS = 3
CHATGPT_SHARE_HOSTS = {"chatgpt.com", "chat.openai.com"}
CHATGPT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml",
    "User-Agent": "MarkItDown-Studio/0.1 (+https://markitdown-studio.vercel.app)",
}


def _json_response(payload: dict[str, Any], status: int = 200) -> tuple[int, bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return status, body


def _safe_filename(value: Any) -> str:
    if not isinstance(value, str):
        return "upload"
    filename = Path(value.replace("\\", "/")).name.strip()
    filename = "".join(character for character in filename if character.isprintable())
    return filename[:MAX_FILENAME_LENGTH] or "upload"


def _extension_for(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    return suffix if suffix and len(suffix) <= 20 else None


def _decode_file(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("The request did not include file data.")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("The uploaded file data is not valid base64.") from exc
    if not decoded:
        raise ValueError("The uploaded file is empty.")
    if len(decoded) > MAX_FILE_BYTES:
        limit_mb = MAX_FILE_BYTES / 1_000_000
        raise OverflowError(f"This hosted workspace accepts files up to {limit_mb:g} MB.")
    return decoded


def _validate_chatgpt_share_url(value: Any) -> str:
    """Allow only canonical public ChatGPT conversation share URLs."""

    if not isinstance(value, str) or not value.strip():
        raise ValueError("Paste a ChatGPT shared conversation link first.")
    raw_url = value.strip()
    if len(raw_url) > 2048:
        raise ValueError("That ChatGPT link is too long.")

    parsed = urlparse(raw_url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("That ChatGPT link is not valid.") from exc
    hostname = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if (
        parsed.scheme.lower() != "https"
        or parsed.username
        or parsed.password
        or port is not None
        or hostname not in CHATGPT_SHARE_HOSTS
        or not path.startswith("/share/")
        or not path.removeprefix("/share/").split("/", 1)[0]
    ):
        if path.startswith("/c/"):
            raise ValueError("Private ChatGPT /c/ links need your ChatGPT login. Use Share, then Copy link.")
        raise ValueError("Use a public ChatGPT shared link that starts with https://chatgpt.com/share/.")

    # Fragments never reach the server and are intentionally dropped. Query
    # parameters are retained because ChatGPT may use them for share variants.
    return urlunparse(("https", hostname, path, "", parsed.query, ""))


def _fetch_chatgpt_share_html(url: str) -> tuple[bytes, str]:
    """Fetch a share page while keeping redirects inside the allowlist."""

    current_url = _validate_chatgpt_share_url(url)
    for redirect_count in range(MAX_CHATGPT_REDIRECTS + 1):
        try:
            response = requests.get(
                current_url,
                headers=CHATGPT_REQUEST_HEADERS,
                timeout=(5, 20),
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException as exc:
            raise ValueError("ChatGPT could not be reached. Check the link and try again.") from exc

        try:
            if response.is_redirect or response.is_permanent_redirect:
                location = response.headers.get("Location")
                if not location or redirect_count >= MAX_CHATGPT_REDIRECTS:
                    raise ValueError("The ChatGPT share link redirected too many times.")
                current_url = _validate_chatgpt_share_url(urljoin(current_url, location))
                continue

            if response.status_code != 200:
                raise ValueError("That ChatGPT shared conversation is unavailable or no longer public.")

            content_type = response.headers.get("Content-Type", "").lower()
            if content_type and "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                raise ValueError("That ChatGPT link did not return a readable conversation page.")

            content_length = response.headers.get("Content-Length")
            try:
                declared_length = int(content_length) if content_length else 0
            except ValueError:
                declared_length = 0
            if declared_length > MAX_CHATGPT_PAGE_BYTES:
                raise OverflowError("The ChatGPT share page is too large to process here.")

            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_CHATGPT_PAGE_BYTES:
                    raise OverflowError("The ChatGPT share page is too large to process here.")
                chunks.append(chunk)
            return b"".join(chunks), current_url
        except requests.RequestException as exc:
            raise ValueError("ChatGPT could not be reached. Check the link and try again.") from exc
        finally:
            response.close()

    raise ValueError("The ChatGPT share link could not be opened safely.")


def _message_text(value: Any) -> str:
    """Extract text from the common ChatGPT message/content shapes."""

    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(text for text in (_message_text(item) for item in value) if text).strip()
    if isinstance(value, dict):
        for key in ("parts", "text", "value", "content"):
            if key in value:
                text = _message_text(value[key])
                if text:
                    return text
    return ""


def _message_role(value: dict[str, Any]) -> str:
    author = value.get("author")
    if isinstance(author, dict):
        role = author.get("role")
    else:
        role = value.get("role")
    return role.strip().lower() if isinstance(role, str) else ""


def _collect_json_messages(value: Any, messages: list[tuple[str, str]], seen: set[tuple[str, str]]) -> None:
    if isinstance(value, dict):
        role = _message_role(value)
        if role in {"user", "assistant", "system", "tool"} and "content" in value:
            text = _message_text(value.get("content"))
            key = (role, text)
            if text and key not in seen:
                seen.add(key)
                messages.append(key)
        for child in value.values():
            _collect_json_messages(child, messages, seen)
    elif isinstance(value, list):
        for child in value:
            _collect_json_messages(child, messages, seen)


def _script_json_values(soup: BeautifulSoup) -> list[Any]:
    values: list[Any] = []
    for script in soup.find_all("script"):
        raw = script.string or script.get_text()
        if not raw or len(raw) > 2_500_000:
            continue
        candidate = raw.strip()
        if not candidate.startswith(("{", "[")):
            assignment = re.search(r"=\s*([\[{].*[\]}])\s*;?\s*$", candidate, re.DOTALL)
            candidate = assignment.group(1) if assignment else ""
        if not candidate:
            continue
        try:
            values.append(json.loads(candidate))
        except (json.JSONDecodeError, TypeError):
            continue
    return values


def _resolve_react_router_value(stream: list[Any], index: Any, memo: dict[int, Any]) -> Any:
    """Resolve the compact reference array used by ChatGPT's share payload."""

    if not isinstance(index, int):
        return index
    if index < 0:
        return None
    if index >= len(stream):
        return index
    if index in memo:
        return memo[index]

    value = stream[index]
    if isinstance(value, dict):
        resolved: dict[str, Any] = {}
        memo[index] = resolved
        for raw_key, raw_value in value.items():
            key_index = int(raw_key[1:]) if raw_key.startswith("_") else raw_key
            key = _resolve_react_router_value(stream, key_index, memo) if isinstance(key_index, int) else key_index
            resolved[str(key)] = _resolve_react_router_value(stream, raw_value, memo)
        return resolved
    if isinstance(value, list):
        resolved_list: list[Any] = []
        memo[index] = resolved_list
        for item in value:
            resolved_list.append(_resolve_react_router_value(stream, item, memo))
        return resolved_list
    return value


def _react_router_stream_messages(soup: BeautifulSoup) -> tuple[str | None, list[tuple[str, str]]]:
    """Extract the selected conversation branch from ChatGPT's RSC stream."""

    decoder = json.JSONDecoder()
    for script in soup.find_all("script"):
        raw = script.string or script.get_text()
        if not raw or "streamController.enqueue" not in raw:
            continue
        match = re.search(r"streamController\.enqueue\(\s*", raw)
        if not match:
            continue
        try:
            encoded_stream, _ = decoder.raw_decode(raw[match.end():])
            stream = json.loads(encoded_stream) if isinstance(encoded_stream, str) else encoded_stream
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
        if not isinstance(stream, list):
            continue

        root = _resolve_react_router_value(stream, 0, {})
        loader_data = root.get("loaderData") if isinstance(root, dict) else None
        if not isinstance(loader_data, dict):
            continue
        route_data = next(
            (
                value
                for value in loader_data.values()
                if isinstance(value, dict) and isinstance(value.get("serverResponse"), dict)
            ),
            None,
        )
        server_response = route_data.get("serverResponse") if isinstance(route_data, dict) else None
        conversation = server_response.get("data") if isinstance(server_response, dict) else None
        mapping = conversation.get("mapping") if isinstance(conversation, dict) else None
        current_node = conversation.get("current_node") if isinstance(conversation, dict) else None
        if not isinstance(mapping, dict) or not isinstance(current_node, str):
            continue

        branch: list[tuple[str, str]] = []
        visited: set[str] = set()
        while current_node and current_node not in visited:
            visited.add(current_node)
            node = mapping.get(current_node)
            if not isinstance(node, dict):
                break
            message = node.get("message")
            if isinstance(message, dict):
                role = _message_role(message)
                text = _message_text(message.get("content"))
                if role in {"user", "assistant"} and text:
                    branch.append((role, text))
            parent = node.get("parent")
            current_node = parent if isinstance(parent, str) else ""

        if branch:
            title = conversation.get("title")
            return title if isinstance(title, str) and title.strip() else None, list(reversed(branch))
    return None, []


def _chatgpt_title(soup: BeautifulSoup) -> str:
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    if title:
        title = re.sub(r"\s+\|\s+ChatGPT$", "", title, flags=re.IGNORECASE).strip()
    return title or "ChatGPT conversation"


def _chatgpt_html_to_markdown(html: bytes) -> tuple[str, str]:
    """Prefer message-aware extraction, with MarkItDown's HTML converter as fallback."""

    soup = BeautifulSoup(html, "html.parser")
    title = _chatgpt_title(soup)
    messages: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for node in soup.select("[data-message-author-role]"):
        role = (node.get("data-message-author-role") or "").strip().lower()
        text = re.sub(r"\n{3,}", "\n\n", node.get_text("\n", strip=True)).strip()
        key = (role, text)
        if role and text and key not in seen:
            seen.add(key)
            messages.append(key)

    if not messages:
        for value in _script_json_values(soup):
            _collect_json_messages(value, messages, seen)

    if not messages:
        stream_title, stream_messages = _react_router_stream_messages(soup)
        if stream_messages:
            title = stream_title.strip() if stream_title else title
            messages.extend(stream_messages)

    if messages:
        markdown_parts = [f"# {title}"]
        for role, text in messages:
            markdown_parts.extend(["", f"## {role.title()}", "", text])
        return title, "\n".join(markdown_parts).strip() + "\n"

    unavailable_text = soup.get_text(" ", strip=True).lower()
    if (
        "can't load shared conversation" in unavailable_text
        or "couldn't load shared conversation" in unavailable_text
        or "shared conversation not found" in unavailable_text
    ):
        raise ValueError("That ChatGPT shared conversation is unavailable or no longer public.")

    # A share page may change its HTML shell over time. Let the repository's
    # native HTML converter handle a readable page when message markers move.
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer"]):
        tag.decompose()
    content = soup.find("main") or soup.body or soup
    converted = MarkItDown(enable_plugins=False).convert_stream(
        io.BytesIO(str(content).encode("utf-8")),
        stream_info=StreamInfo(mimetype="text/html", extension=".html", filename="chatgpt-share.html"),
    )
    markdown = converted.markdown.strip()
    if not markdown:
        raise ValueError("The shared page did not contain readable conversation messages.")
    if not markdown.startswith("# "):
        markdown = f"# {title}\n\n{markdown}"
    return title, markdown.rstrip() + "\n"


def _convert_chatgpt_payload(payload: dict[str, Any]) -> dict[str, Any]:
    url = _validate_chatgpt_share_url(payload.get("url"))
    html, final_url = _fetch_chatgpt_share_html(url)
    title, markdown = _chatgpt_html_to_markdown(html)
    if len(markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise OverflowError("The Markdown result is too large to return from the hosted workspace.")
    return {
        "filename": "chatgpt-conversation.md",
        "bytes": len(html),
        "title": title,
        "markdown": markdown,
        "sourceUrl": final_url,
    }


def convert_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a validated JSON payload and return a serializable result."""

    source = payload.get("source", "file")
    if source == "chatgpt":
        return _convert_chatgpt_payload(payload)
    if source != "file":
        raise ValueError("The request specified an unsupported source.")

    filename = _safe_filename(payload.get("filename"))
    data = _decode_file(payload.get("data"))
    mime_type = payload.get("mimeType")
    if not isinstance(mime_type, str) or ";" in mime_type:
        mime_type = None

    options = payload.get("options")
    if not isinstance(options, dict):
        options = {}

    # Hosted plugins can execute arbitrary third-party code, so they are kept
    # disabled even if a client sends an option attempting to enable them.
    converter = MarkItDown(enable_plugins=False)
    result = converter.convert_stream(
        io.BytesIO(data),
        stream_info=StreamInfo(
            mimetype=mime_type,
            extension=_extension_for(filename),
            filename=filename,
        ),
        keep_data_uris=bool(options.get("keepDataUris", False)),
    )
    if len(result.markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise OverflowError("The Markdown result is too large to return from the hosted workspace.")

    return {
        "filename": filename,
        "bytes": len(data),
        "title": result.title,
        "markdown": result.markdown,
    }


class handler(BaseHTTPRequestHandler):
    """Vercel's Python runtime entry point."""

    server_version = "MarkItDownStudio/0.1"

    def _write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        status, body = _json_response(payload, status)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/api/convert":
            self._write_json({"ok": True, "service": "MarkItDown Studio"})
            return
        self._write_json({"error": "Not found."}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/api/convert":
            self._write_json({"error": "Not found."}, status=404)
            return

        expected_token = os.getenv("MARKITDOWN_ACCESS_TOKEN")
        if expected_token:
            supplied_token = self.headers.get("X-MarkItDown-Token", "")
            if not hmac.compare_digest(supplied_token, expected_token):
                self._write_json({"error": "This workspace is private."}, status=401)
                return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._write_json(
                {"error": "The request is too large for the hosted workspace."},
                status=413,
            )
            return

        try:
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("The request body must be a JSON object.")
            converted = convert_payload(payload)
            self._write_json({"ok": True, **converted})
        except OverflowError as exc:
            self._write_json({"error": str(exc)}, status=413)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            self._write_json({"error": str(exc)}, status=400)
        except UnsupportedFormatException:
            self._write_json(
                {"error": "MarkItDown does not have a converter for this file type."},
                status=415,
            )
        except MissingDependencyException:
            self._write_json(
                {"error": "This converter is not available in the hosted runtime."},
                status=422,
            )
        except FileConversionException:
            self._write_json(
                {"error": "MarkItDown could not read this file."}, status=422
            )
        except OSError:
            self._write_json(
                {"error": "The uploaded file could not be read."}, status=422
            )
        except Exception:
            LOGGER.exception("Unexpected conversion failure")
            self._write_json(
                {"error": "Something went wrong while converting this file."},
                status=500,
            )

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)
