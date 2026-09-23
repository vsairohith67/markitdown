# MarkItDown Studio

MarkItDown Studio is a small, responsive web companion for this repository's
Python conversion engine. It keeps the package-only project boundary intact:
the interface lives at the repository root and imports the local
`packages/markitdown` source from the serverless adapter.

## Local development

Install the JavaScript dependencies and build the interface:

```sh
npm install
npm run build
```

For the full interface plus the Python function, use the Vercel development
runtime from the repository root:

```sh
npx vercel dev
```

The interface is available at `http://localhost:3000`. The Python adapter can
also be exercised directly with a Python environment that has the packages in
`requirements.txt` installed.

### Local desktop edition

The local edition is independent from the hosted Vercel function. Run
`local\\install-desktop-shortcut.ps1` once to create **MarkItDown Studio
(Local)** on the Windows desktop. Opening that shortcut builds `dist/` when
needed, starts `local_server.py` on `127.0.0.1:8765`, and opens the browser.

Local file conversions use multipart uploads and the local `.venv`, so they do
not use the hosted 3 MB base64/request limit. Files stay on the laptop. The
local process uses the available CPU and RAM; GPU acceleration is not required
by the built-in MarkItDown converters. Practical limits still come from the
laptop's available memory, disk, and the individual converter.

The local file picker accepts multiple files. Each file is converted as its
own Markdown result, and the Output panel can download all successful results
as one ZIP. Failed files remain visible in the batch list so they can be
retried separately. The ChatGPT link tab also supports multiple public share
links through **Add another link**. Each link is fetched and saved separately.
The **Only this branch** toggle uses the conversation mapping exposed by the
share page: when a fork is detectable, conversion starts at the first fork on
the selected path; when the page exposes no fork, the full selected path is
kept and the result is marked accordingly.

### Local plugins

Open Settings in the local edition to see the discovered `markitdown.plugin`
entry points. Plugins are off by default, and multiple available plugins can
be enabled together; the selection is saved under the user's local application
data and applies to the next file conversion. The checkout includes the
`markitdown-ocr` plugin for OCR-aware PDF, DOCX, PPTX, and XLSX conversion. To
add another compatible plugin to the local environment, install it into the
same virtual environment and refresh Settings:

```powershell
.venv\Scripts\python.exe -m pip install <plugin-package>
```

The local manager only enables packages that expose MarkItDown's plugin entry
point. Plugin code runs on the laptop, so enable only packages you trust.
Hosted Vercel requests keep third-party plugins disabled.

## Deployment

The project is configured for a single Vercel project:

- Vite publishes `dist/`.
- `api/convert.py` is exposed at `/api/convert`.
- The function calls `MarkItDown.convert_stream()` with an in-memory stream.
- Plugins and Azure integrations are disabled in the hosted adapter.
- The UI also accepts canonical public ChatGPT share links and fetches only
  allowlisted `chatgpt.com/share/...` (or legacy `chat.openai.com/share/...`)
  pages. Large React streaming responses are reduced to the selected
  conversation branch before Markdown conversion. Redirects remain inside that
  allowlist; arbitrary URL fetching is not exposed.

Vercel's function request and response payload ceiling means the UI keeps the
  default hosted upload limit at 3 MB. Larger files should be converted with
  the package locally or through a separately managed worker/container. The
  optional `MARKITDOWN_ACCESS_TOKEN` environment variable enables a simple
  private gate; the Settings panel can store the matching token in the current
  browser. ChatGPT share pages up to 50 MB are accepted so large conversations
  with streamed page data can still be reduced in memory.

## Privacy posture

The adapter does not write uploaded bytes to disk or persist conversion data.
Recent conversion results are stored only in the browser's local storage so a
user can reopen them on the same device. A public deployment without
`MARKITDOWN_ACCESS_TOKEN` should still be treated as a personal utility and
not as a place for sensitive files. ChatGPT links must be public shared links;
private `/c/...` conversation URLs require a ChatGPT login and cannot be read
securely by this standalone deployment. The fetched share page is processed in
memory and the resulting Markdown is kept only in the browser history.

## Supported formats

The UI follows the engine's built-in converters: PDF, DOCX, PPTX, XLSX, XLS,
images, audio, HTML, plain text, CSV, JSON, XML, ZIP, EPUB, Jupyter notebooks,
Outlook MSG, RSS, Wikipedia pages, YouTube URLs, and Bing result pages. The
hosted UI accepts files plus public ChatGPT shared conversations. Other
URL-oriented converters remain deliberately disabled.
