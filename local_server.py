"""Local-only MarkItDown Studio server.

This server deliberately stays separate from Vercel's ``api/convert.py``
request adapter. It serves the built React app, accepts multipart uploads, and
keeps the conversion limits disabled for the local process. The browser still
talks only to 127.0.0.1, so files do not leave the laptop.
"""

from __future__ import annotations

import argparse
import cgi
import io
import json
import logging
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"

# A non-positive limit is interpreted as unlimited by api.convert. These
# defaults apply only to this local process; Vercel keeps its own environment.
os.environ.setdefault("MARKITDOWN_MAX_FILE_BYTES", "0")
os.environ.setdefault("MARKITDOWN_MAX_REQUEST_BYTES", "0")
os.environ.setdefault("MARKITDOWN_MAX_MARKDOWN_BYTES", "0")
os.environ.setdefault("MARKITDOWN_MAX_CHATGPT_PAGE_BYTES", "0")

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.convert import (  # noqa: E402
    FileConversionException,
    MissingDependencyException,
    UnsupportedFormatException,
    convert_file_stream,
    convert_payload,
    discover_plugins,
    plugin_catalog,
)


LOGGER = logging.getLogger("markitdown.local")
PLUGIN_CONFIG_DIR = Path(os.getenv("LOCALAPPDATA", str(ROOT / "local"))) / "MarkItDownStudio"
PLUGIN_CONFIG_PATH = PLUGIN_CONFIG_DIR / "plugins.json"


def _json_bytes(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _enabled_plugins() -> list[str]:
    try:
        payload = json.loads(PLUGIN_CONFIG_PATH.read_text(encoding="utf-8"))
        enabled = payload.get("enabled", []) if isinstance(payload, dict) else []
        if not isinstance(enabled, list):
            return []
        available = {spec.name for spec in discover_plugins() if spec.available}
        return sorted({name for name in enabled if isinstance(name, str) and name.strip()}.intersection(available))
    except (OSError, json.JSONDecodeError):
        return []


def _save_enabled_plugins(enabled: list[str]) -> list[str]:
    available = {spec.name for spec in discover_plugins() if spec.available}
    clean = sorted({name.strip() for name in enabled if isinstance(name, str) and name.strip()}.intersection(available))
    PLUGIN_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    PLUGIN_CONFIG_PATH.write_text(json.dumps({"enabled": clean}, indent=2) + "\n", encoding="utf-8")
    return clean


class LocalHandler(SimpleHTTPRequestHandler):
    """Serve the local SPA and a localhost-only conversion endpoint."""

    server_version = "MarkItDownStudioLocal/0.1"

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def _write_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._write_json({"ok": True, "service": "MarkItDown Studio Local"})
            return
        if path == "/api/plugins":
            self._write_json({"ok": True, "plugins": plugin_catalog(), "enabled": _enabled_plugins()})
            return
        if path.startswith("/api/"):
            self._write_json({"error": "Not found."}, status=404)
            return

        # Vite's SPA fallback is reproduced here so refreshing a browser URL
        # still returns the local app rather than a 404.
        if path != "/" and not Path(self.translate_path(path)).is_file():
            self.path = "/index.html"
        super().do_GET()

    def _multipart_conversion(self, content_type: str, content_length: int) -> dict[str, object]:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(content_length),
            },
        )
        file_field = form.getfirst("file") if "file" not in form else form["file"]
        if isinstance(file_field, list):
            file_field = file_field[0]
        if not isinstance(file_field, cgi.FieldStorage) or not file_field.filename or file_field.file is None:
            raise ValueError("The request did not include a file.")

        stream = file_field.file
        # FieldStorage may expose a TemporaryFileWrapper. MarkItDown's Magika
        # adapter requires the underlying buffered binary stream.
        if not isinstance(stream, io.BufferedIOBase):
            stream = getattr(stream, "file", stream)
        if not isinstance(stream, io.BufferedIOBase):
            stream = io.BytesIO(stream.read())
        stream.seek(0)
        byte_count = file_field.length
        if not isinstance(byte_count, int) or byte_count < 0:
            stream.seek(0, 2)
            byte_count = stream.tell()
            stream.seek(0)

        keep_data_uris = str(form.getfirst("keepDataUris", "false")).lower() == "true"
        return convert_file_stream(
            file_field.filename,
            stream,
            byte_count=byte_count,
            mime_type=file_field.type,
            options={"keepDataUris": keep_data_uris},
            plugins=_enabled_plugins(),
        )

    def do_POST(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path not in {"/api/convert", "/api/plugins"}:
            self._write_json({"error": "Not found."}, status=404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            self._write_json({"error": "The request body is empty."}, status=400)
            return

        try:
            content_type = self.headers.get("Content-Type", "").lower()
            if content_type.startswith("multipart/form-data"):
                converted = self._multipart_conversion(content_type, content_length)
            else:
                raw_body = self.rfile.read(content_length)
                payload = json.loads(raw_body.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("The request body must be a JSON object.")
                if path == "/api/plugins":
                    requested = payload.get("enabled", [])
                    if not isinstance(requested, list):
                        raise ValueError("The enabled plugin list must be an array.")
                    enabled = _save_enabled_plugins(requested)
                    self._write_json({"ok": True, "plugins": plugin_catalog(), "enabled": enabled})
                    return
                converted = convert_payload(payload)
            self._write_json({"ok": True, **converted})
        except OverflowError as exc:
            self._write_json({"error": str(exc)}, status=413)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            self._write_json({"error": str(exc)}, status=400)
        except UnsupportedFormatException:
            self._write_json({"error": "MarkItDown does not have a converter for this file type."}, status=415)
        except MissingDependencyException:
            self._write_json({"error": "This converter is not available in the local environment."}, status=422)
        except FileConversionException:
            self._write_json({"error": "MarkItDown could not read this file."}, status=422)
        except OSError:
            self._write_json({"error": "The uploaded file could not be read."}, status=422)
        except Exception:
            LOGGER.exception("Unexpected local conversion failure")
            self._write_json({"error": "Something went wrong while converting this file."}, status=500)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(description="Run MarkItDown Studio locally.")
    parser.add_argument("--host", default=os.getenv("MARKITDOWN_LOCAL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MARKITDOWN_LOCAL_PORT", "8765")))
    args = parser.parse_args()

    if not (DIST_DIR / "index.html").is_file():
        raise SystemExit("The local app is not built. Run the local launcher so it can build dist/ first.")

    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")
    server = LocalServer((args.host, args.port), LocalHandler)
    LOGGER.info("MarkItDown Studio local server listening at http://%s:%s", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping local server")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
