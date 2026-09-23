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

## Batch conversion

Choose multiple files at once, or use **ChatGPT link** and press **Add another
link** for multiple public share URLs. Every item is converted separately. If
more than one item succeeds, use **Download ZIP** in the output panel to save
the Markdown files together; individual `.md` downloads are also available.

Each ChatGPT row has an **Only this branch** toggle. It trims from the first
fork only when the public share page exposes a conversation mapping with a
fork. Otherwise the selected path is converted in full and the result says
that no fork was detected.

## Plugins

Open Settings to manage local MarkItDown plugins. The list currently includes
the bundled `markitdown-ocr` plugin, and it also discovers any package installed
in the local `.venv` that exposes the `markitdown.plugin` entry point. Plugins
are disabled by default, and you can check multiple plugins; changes apply to
the next conversion. To install another compatible plugin:

```powershell
.venv\Scripts\python.exe -m pip install <plugin-package>
```

Refresh Settings after installation. Plugins execute Python code locally, so
only enable packages you trust. The hosted Vercel edition deliberately keeps
third-party plugins disabled.
