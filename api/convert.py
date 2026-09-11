"""Small, memory-only HTTP adapter for the MarkItDown package.

The public UI sends one base64-encoded file at a time. Nothing is written to
disk by this adapter, and the underlying package is imported from this
checkout so the web surface tracks the repository's conversion behavior.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import io
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any


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


def convert_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a validated JSON payload and return a serializable result."""

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
