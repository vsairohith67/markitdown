import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileUp,
  FileVideo2,
  LockKeyhole,
  Moon,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";

const STORAGE_KEY = "markitdown-studio-history-v1";
const THEME_KEY = "markitdown-studio-theme-v1";
const TOKEN_KEY = "markitdown-studio-access-token-v1";
const MAX_FILE_BYTES = 3_000_000;

const supportedFormats = [
  "PDF",
  "Word",
  "PowerPoint",
  "Excel",
  "images",
  "audio",
  "HTML",
  "CSV",
  "JSON",
  "ZIP",
  "EPUB",
  "and more",
];

function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Just now";
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function extensionFor(filename = "") {
  const pieces = filename.toLowerCase().split(".");
  return pieces.length > 1 ? pieces.at(-1) : "file";
}

function fileKindFor(filename = "") {
  const extension = extensionFor(filename);
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"].includes(extension)) return "image";
  if (["xlsx", "xls", "csv"].includes(extension)) return "sheet";
  if (["zip", "epub"].includes(extension)) return "archive";
  if (["mp3", "wav", "m4a"].includes(extension)) return "audio";
  if (["mp4", "mov"].includes(extension)) return "video";
  if (["docx", "pptx", "pdf"].includes(extension)) return extension;
  return "text";
}

function persistHistory(history) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 5)));
  } catch {
    // A full or privacy-restricted storage area should not interrupt conversion.
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    });
    reader.addEventListener("error", () => reject(new Error("The file could not be read.")));
    reader.readAsDataURL(file);
  });
}

function downloadMarkdown(filename, markdown) {
  const stem = filename.replace(/\.[^/.]+$/, "") || "document";
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${stem}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function FileGlyph({ filename, size = 20 }) {
  const kind = fileKindFor(filename);
  const Icon = {
    image: FileImage,
    sheet: FileSpreadsheet,
    archive: FileArchive,
    audio: FileAudio,
    video: FileVideo2,
    docx: FileType2,
    pptx: FileType2,
    pdf: FileText,
    text: FileText,
  }[kind];
  return (
    <span className={`file-glyph file-glyph-${kind}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <span className={`switch-control ${disabled ? "switch-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
      <span className="switch-track" aria-hidden="true" />
    </span>
  );
}

function MarkdownPreview({ markdown }) {
  const lines = markdown.split("\n");
  return (
    <div className="markdown-rendered" aria-label="Rendered Markdown preview">
      {lines.map((line, index) => {
        const key = `${index}-${line.slice(0, 12)}`;
        if (!line.trim()) return <div className="md-blank" key={key} aria-hidden="true" />;
        if (/^#{1,3}\s/.test(line)) {
          const level = Math.min(line.match(/^#+/)[0].length, 3);
          const title = line.replace(/^#{1,3}\s+/, "");
          if (level === 1) return <h3 key={key}>{title}</h3>;
          if (level === 2) return <h4 key={key}>{title}</h4>;
          return <h5 key={key}>{title}</h5>;
        }
        if (/^[-*]\s/.test(line)) {
          return (
            <div className="md-list-item" key={key}>
              <span aria-hidden="true">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const number = line.match(/^\d+/)[0];
          return (
            <div className="md-list-item" key={key}>
              <span aria-hidden="true">{number}.</span>
              <span>{line.replace(/^\d+\.\s+/, "")}</span>
            </div>
          );
        }
        if (line.startsWith(">")) return <blockquote key={key}>{line.replace(/^>\s?/, "")}</blockquote>;
        if (line.startsWith("|") || line === "---") {
          return <div className="md-table-row" key={key}>{line}</div>;
        }
        if (line.startsWith("```")) return <div className="md-code-marker" key={key}>{line}</div>;
        return <p key={key}>{line}</p>;
      })}
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="empty-preview">
      <div className="empty-document" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h3>Your Markdown will appear here</h3>
      <p>Choose a file to start a clean, structured preview.</p>
    </div>
  );
}

function HistoryRow({ item, onOpen }) {
  return (
    <button type="button" className="history-row" onClick={() => onOpen(item)}>
      <FileGlyph filename={item.filename} size={18} />
      <span className="history-copy">
        <strong>{item.filename}</strong>
        <span>{formatBytes(item.bytes)} · {formatRelativeTime(item.convertedAt)}</span>
      </span>
      <ChevronRight size={17} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

function App() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(() => {
    const stored = readStorage(STORAGE_KEY, []);
    return Array.isArray(stored) ? stored : [];
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("idle");
  const [viewMode, setViewMode] = useState("rendered");
  const [keepDataUris, setKeepDataUris] = useState(false);
  const [theme, setTheme] = useState(() => readStorage(THEME_KEY, "light"));
  const [accessToken, setAccessToken] = useState(() => readStorage(TOKEN_KEY, ""));
  const [draftToken, setDraftToken] = useState(accessToken);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    } catch {
      // Theme preference is optional.
    }
  }, [theme]);

  useEffect(() => {
    if (!showSettings) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setShowSettings(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showSettings]);

  const acceptFile = (candidate) => {
    if (!candidate) return;
    if (candidate.size > MAX_FILE_BYTES) {
      setError(`That file is ${formatBytes(candidate.size)}. The hosted workspace accepts files up to 3 MB.`);
      return;
    }
    setFile(candidate);
    setResult(null);
    setError("");
    setCopyState("idle");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setError("");
    setCopyState("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleConvert = async () => {
    if (!file || isConverting) return;
    setIsConverting(true);
    setError("");
    setCopyState("idle");
    const startedAt = performance.now();
    try {
      const data = await readFileAsBase64(file);
      const headers = { "Content-Type": "application/json" };
      if (accessToken.trim()) headers["X-MarkItDown-Token"] = accessToken.trim();
      const response = await fetch("/api/convert", {
        method: "POST",
        headers,
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || null,
          data,
          options: { keepDataUris },
        }),
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) throw new Error(payload.error || `Conversion failed (${response.status}).`);
      const converted = {
        ...payload,
        elapsed: (performance.now() - startedAt) / 1000,
        convertedAt: Date.now(),
      };
      setResult(converted);
      setViewMode("rendered");
      const historyItem = {
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
        filename: converted.filename || file.name,
        bytes: converted.bytes || file.size,
        markdown: converted.markdown || "",
        title: converted.title || null,
        convertedAt: converted.convertedAt,
      };
      const nextHistory = [historyItem, ...history.filter((item) => item.filename !== historyItem.filename)].slice(0, 5);
      setHistory(nextHistory);
      persistHistory(nextHistory);
    } catch (conversionError) {
      const message = conversionError instanceof TypeError
        ? "The conversion service is unavailable. Try again when the app is deployed, or run it with `vercel dev`."
        : conversionError.message;
      setError(message || "Something went wrong while converting this file.");
      setResult(null);
    } finally {
      setIsConverting(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.markdown) return;
    try {
      await copyToClipboard(result.markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setError("Clipboard access was blocked. Use the Markdown tab to select the text instead.");
    }
  };

  const handleOpenHistory = (item) => {
    setFile(null);
    setError("");
    setCopyState("idle");
    setViewMode("rendered");
    setResult({ ...item, ok: true, elapsed: null });
  };

  const saveSettings = () => {
    const cleanToken = draftToken.trim();
    setAccessToken(cleanToken);
    try {
      window.localStorage.setItem(TOKEN_KEY, JSON.stringify(cleanToken));
    } catch {
      // The token is an optional convenience for this browser.
    }
    setShowSettings(false);
  };

  const hasOutput = Boolean(result?.markdown);
  const statusText = isConverting
    ? "Converting your file"
    : hasOutput
      ? result.elapsed ? `Converted in ${result.elapsed.toFixed(1)}s` : "Loaded from this browser"
      : file
        ? "Ready to convert"
        : "Waiting for a file";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="MarkItDown Studio home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MarkItDown</span>
        </a>
        <div className="topbar-actions">
          <div className="privacy-label">
            <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Private by default</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowSettings(true)}
            aria-label="Open settings"
            title="Settings"
          >
            <Settings2 size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
          </button>
        </div>
      </header>

      <main>
        <section className="intro-section" aria-labelledby="page-title">
          <div className="intro-copy">
            <div className="accent-rule" aria-hidden="true" />
            <h1 id="page-title">Convert anything<br /><span>into clean Markdown.</span></h1>
            <p>Drop a file, keep the structure, and take your content with you.</p>
          </div>
          <div className="intro-aside">
            <div className="aside-icon"><Zap size={17} strokeWidth={1.8} /></div>
            <p>Made for thoughtful work</p>
            <span>No account required. Your recent files stay in this browser.</span>
          </div>
        </section>

        <section className="workbench" aria-label="File conversion workspace">
          <article className="panel source-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Source</p>
                <h2>Choose a file</h2>
              </div>
              <span className="quiet-status"><span className="status-dot" /> Local</span>
            </div>

            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              onChange={(event) => acceptFile(event.target.files?.[0])}
            />

            {!file ? (
              <button
                type="button"
                className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
                onDrop={handleDrop}
              >
                <span className="dropzone-icon"><UploadCloud size={25} strokeWidth={1.55} /></span>
                <strong>Drop a file here</strong>
                <span>or choose from your device</span>
                <small>Up to 3 MB · any file type supported by MarkItDown</small>
              </button>
            ) : (
              <div className="selected-file">
                <div className="selected-file-main">
                  <FileGlyph filename={file.name} size={24} />
                  <span>
                    <strong title={file.name}>{file.name}</strong>
                    <small>{formatBytes(file.size)} · {file.type || `${extensionFor(file.name).toUpperCase()} file`}</small>
                  </span>
                </div>
                <button type="button" className="icon-button subtle" onClick={clearFile} aria-label="Remove selected file" title="Remove file">
                  <X size={17} strokeWidth={1.8} />
                </button>
              </div>
            )}

            <div className="option-block">
              <div className="option-heading">
                <span>Conversion options</span>
                <CircleHelp size={15} strokeWidth={1.8} aria-label="Optional settings" />
              </div>
              <label className="option-row">
                <span className="option-copy">
                  <strong>Keep inline image data</strong>
                  <small>Preserve embedded images inside the Markdown file</small>
                </span>
                <Switch checked={keepDataUris} onChange={(event) => setKeepDataUris(event.target.checked)} label="Keep inline image data" />
              </label>
              <div className="option-row option-row-locked">
                <span className="option-copy">
                  <strong>Third-party plugins</strong>
                  <small>Disabled in the hosted workspace for safety</small>
                </span>
                <LockKeyhole size={16} strokeWidth={1.8} aria-label="Disabled for safety" />
              </div>
            </div>

            {error && <div className="error-message" role="alert"><span className="error-mark">!</span><span>{error}</span></div>}

            <button type="button" className="primary-button convert-button" onClick={handleConvert} disabled={!file || isConverting}>
              {isConverting ? <span className="button-spinner" aria-hidden="true" /> : <Sparkles size={17} strokeWidth={1.9} />}
              <span>{isConverting ? "Converting" : "Convert file"}</span>
              {!isConverting && <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />}
            </button>

            <div className="source-footer">
              <div className="status-line" aria-live="polite"><span className={`status-dot ${isConverting ? "status-dot-loading" : hasOutput ? "status-dot-done" : ""}`} />{statusText}</div>
              <span className="memory-note"><ShieldCheck size={14} strokeWidth={1.8} /> In-memory processing</span>
            </div>
          </article>

          <article className="panel preview-panel">
            <div className="panel-header preview-header">
              <div>
                <p className="section-kicker">Output</p>
                <h2>Markdown preview</h2>
              </div>
              <div className="preview-controls">
                <div className="view-switcher" role="group" aria-label="Preview mode">
                  <button type="button" className={viewMode === "rendered" ? "view-active" : ""} onClick={() => setViewMode("rendered")} disabled={!hasOutput}>Rendered</button>
                  <button type="button" className={viewMode === "markdown" ? "view-active" : ""} onClick={() => setViewMode("markdown")} disabled={!hasOutput}>Markdown</button>
                </div>
                <button type="button" className="outline-button compact-button" onClick={handleCopy} disabled={!hasOutput}>
                  {copyState === "copied" ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.8} />}
                  <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
                </button>
                <button type="button" className="outline-button compact-button" onClick={() => downloadMarkdown(result.filename, result.markdown)} disabled={!hasOutput}>
                  <Download size={15} strokeWidth={1.8} />
                  <span>Download .md</span>
                </button>
              </div>
            </div>

            <div className={`preview-canvas ${hasOutput ? "preview-has-output" : ""}`}>
              {hasOutput ? (
                viewMode === "markdown" ? (
                  <pre className="raw-markdown">{result.markdown}</pre>
                ) : (
                  <MarkdownPreview markdown={result.markdown} />
                )
              ) : <EmptyPreview />}
            </div>
            <div className="preview-footer">
              <span>{hasOutput ? `${result.markdown.length.toLocaleString()} characters` : "Ready when you are"}</span>
              <span className="preview-format"><Clipboard size={14} strokeWidth={1.8} /> Markdown</span>
            </div>
          </article>
        </section>

        <section className="below-workbench">
          <div className="history-section">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">On this browser</p>
                <h2>Recent conversions</h2>
              </div>
              {history.length > 0 && <button type="button" className="text-button" onClick={() => { setHistory([]); persistHistory([]); }}>Clear all</button>}
            </div>
            {history.length > 0 ? (
              <div className="history-list">
                {history.map((item) => <HistoryRow key={item.id} item={item} onOpen={handleOpenHistory} />)}
              </div>
            ) : (
              <div className="history-empty">
                <RotateCcw size={17} strokeWidth={1.7} />
                <span>Your last few conversions will live here, only in this browser.</span>
              </div>
            )}
          </div>

          <aside className="capability-section">
            <div className="capability-mark" aria-hidden="true"><BookOpen size={18} strokeWidth={1.7} /></div>
            <div>
              <p className="section-kicker">Powered by the open-source engine</p>
              <h2>Structure stays useful.</h2>
              <p>Headings, lists, tables, links, and document content are carried into Markdown wherever the source format allows it.</p>
              <div className="format-list" aria-label="Supported formats">
                {supportedFormats.map((format) => <span key={format}>{format}</span>)}
              </div>
            </div>
          </aside>
        </section>
      </main>

      <footer className="app-footer">
        <span>MarkItDown Studio · personal workspace</span>
        <a href="https://github.com/vsairohith67/markitdown" target="_blank" rel="noreferrer">View source <ExternalLink size={13} strokeWidth={1.8} /></a>
      </footer>

      {showSettings && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-heading">
              <div>
                <p className="section-kicker">Workspace</p>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button type="button" className="icon-button subtle" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={18} strokeWidth={1.8} /></button>
            </div>
            <label className="token-field">
              <span>Private access token <small>optional</small></span>
              <input type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder="Paste a token configured on Vercel" autoComplete="off" />
            </label>
            <p className="modal-help">If you add <code>MARKITDOWN_ACCESS_TOKEN</code> to your deployment, this browser will send the matching token with every conversion. Leave it blank for the default personal workspace.</p>
            <div className="modal-facts">
              <span><ShieldCheck size={15} strokeWidth={1.8} /> Files are processed in memory</span>
              <span><FileUp size={15} strokeWidth={1.8} /> Hosted file limit: 3 MB</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setShowSettings(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={saveSettings}>Save settings</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
