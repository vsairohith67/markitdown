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
- Plugins, Azure integrations, and remote URL fetching are disabled in the
  hosted adapter.

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
not as a place for sensitive files.

## Supported formats

The UI follows the engine's built-in converters: PDF, DOCX, PPTX, XLSX, XLS,
images, audio, HTML, plain text, CSV, JSON, XML, ZIP, EPUB, Jupyter notebooks,
Outlook MSG, RSS, Wikipedia pages, YouTube URLs, and Bing result pages. The
hosted UI accepts files only; URL-oriented converters are deliberately not
exposed because a public URL fetcher needs additional SSRF controls and a
separate product decision.
