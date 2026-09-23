# MarkItDown Studio — local edition

This edition runs the React app and MarkItDown conversion engine on the laptop.
It is separate from the Vercel deployment and accepts local multipart uploads
without the hosted 3 MB base64/request limit.

## Start

Use the desktop shortcut **MarkItDown Studio (Local)**. It starts the local
Python server at `http://127.0.0.1:8765/` and opens it in the default browser.

To recreate the shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\local\install-desktop-shortcut.ps1
```

The local server uses the repository's `.venv` when available. It processes
files on this laptop; it does not upload them to Vercel. MarkItDown conversion
is CPU/RAM based by default. Large files still depend on available disk,
memory, converter support, and the source format's own requirements.
