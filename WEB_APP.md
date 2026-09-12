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

## Deployment

The project is configured for a single Vercel project:

- Vite publishes `dist/`.
- `api/convert.py` is exposed at `/api/convert`.
- The function calls `MarkItDown.convert_stream()` with an in-memory stream.
- Plugins and Azure integrations are disabled in the hosted adapter.
- The UI also accepts canonical public ChatGPT share links and fetches only
  allowlisted `chatgpt.com/share/...` (or legacy `chat.openai.com/share/...`)
  pages. Redirects remain inside that allowlist; arbitrary URL fetching is not
  exposed.

Vercel's function request and response payload ceiling means the UI keeps the
  default hosted upload limit at 3 MB. Larger files should be converted with
  the package locally or through a separately managed worker/container. The
  optional `MARKITDOWN_ACCESS_TOKEN` environment variable enables a simple
  private gate; the Settings panel can store the matching token in the current
  browser.

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
