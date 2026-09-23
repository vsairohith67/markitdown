import { useEffect, useMemo, useRef, useState } from "react";
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
  Link2,
  LockKeyhole,
  Moon,
  Plus,
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
const IS_LOCAL_RUNTIME = typeof window !== "undefined"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const CHATGPT_SHARE_HOSTS = ["chatgpt.com", "chat.openai.com"];
const MAX_RENDERED_PREVIEW_LINES = 1000;

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
  return pieces.length > 1 ? pieces[pieces.length - 1] : "file";
}

function isChatGPTShareUrl(value) {
  try {
    const parsed = new URL(value.trim());
    const path = parsed.pathname || "";
    return parsed.protocol === "https:"
      && CHATGPT_SHARE_HOSTS.indexOf(parsed.hostname.toLowerCase()) !== -1
      && path.indexOf("/share/") === 0
      && Boolean(path.slice("/share/".length).split("/", 1)[0]);
  } catch {
    return false;
  }
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

function safeMarkdownFilename(value, fallback = "document.md") {
  const base = String(value || fallback)
    .replace(/\.[^/.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 120);
  return `${base || fallback.replace(/\.md$/, "")}.md`;
}

function uniqueMarkdownFilename(value, usedNames, fallback = "document.md") {
  const initial = safeMarkdownFilename(value, fallback);
  const stem = initial.replace(/\.md$/, "");
  let candidate = initial;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${index}.md`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(signature, nameLength, size, checksum, offset = 0) {
  const length = signature === 0x04034b50 ? 30 : 46;
  const header = new Uint8Array(length);
  const view = new DataView(header.buffer);
  view.setUint32(0, signature, true);
  if (signature === 0x04034b50) {
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameLength, true);
    view.setUint16(28, 0, true);
  } else {
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, checksum, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
  }
  return header;
}

function makeMarkdownZip(items) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralChunks = [];
  let offset = 0;
  let entryCount = 0;
  for (const item of items) {
    if (!item || !item.ok || !item.markdown) continue;
    const nameBytes = encoder.encode(item.filename);
    const dataBytes = encoder.encode(item.markdown);
    const checksum = crc32(dataBytes);
    const localHeader = zipHeader(0x04034b50, nameBytes.length, dataBytes.length, checksum);
    chunks.push(localHeader, nameBytes, dataBytes);
    centralChunks.push(zipHeader(0x02014b50, nameBytes.length, dataBytes.length, checksum, offset), nameBytes);
    offset += localHeader.length + nameBytes.length + dataBytes.length;
    entryCount += 1;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entryCount, true);
  endView.setUint16(10, entryCount, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  chunks.push(...centralChunks, end);
  return new Blob(chunks, { type: "application/zip" });
}

function downloadMarkdownZip(items) {
  const blob = makeMarkdownZip(items);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "markitdown-converted-files.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
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
  const { lines, isTruncated } = useMemo(() => {
    const allLines = markdown.split("\n");
    return {
      lines: allLines.slice(0, MAX_RENDERED_PREVIEW_LINES),
      isTruncated: allLines.length > MAX_RENDERED_PREVIEW_LINES,
    };
  }, [markdown]);
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
      {isTruncated && (
        <div className="md-preview-note">
          Preview trimmed for speed. The full conversation is available in the Markdown tab and Download .md.
        </div>
      )}
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
      <p>Choose a file or paste a ChatGPT link to start a clean, structured preview.</p>
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
  const [files, setFiles] = useState([]);
  const [sourceMode, setSourceMode] = useState("file");
  const [chatgptLinks, setChatgptLinks] = useState([{ url: "", branchOnly: false }]);
  const [result, setResult] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [batchProgress, setBatchProgress] = useState(null);
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
  const [plugins, setPlugins] = useState([]);
  const [enabledPlugins, setEnabledPlugins] = useState([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginNotice, setPluginNotice] = useState("");

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

  useEffect(() => {
    if (!IS_LOCAL_RUNTIME) return undefined;
    let cancelled = false;
    setPluginsLoading(true);
    fetch("/api/plugins")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Plugin discovery failed.")))
      .then((payload) => {
        if (cancelled) return;
        setPlugins(Array.isArray(payload.plugins) ? payload.plugins : []);
        setEnabledPlugins(Array.isArray(payload.enabled) ? payload.enabled : []);
      })
      .catch(() => {
        if (!cancelled) setPluginNotice("Plugin discovery is unavailable until the local server is running.");
      })
      .finally(() => {
        if (!cancelled) setPluginsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const chooseSourceMode = (mode) => {
    if (mode === sourceMode) return;
    setSourceMode(mode);
    setFiles([]);
    setChatgptLinks([{ url: "", branchOnly: false }]);
    setResult(null);
    setBatchResults([]);
    setBatchProgress(null);
    setError("");
    setCopyState("idle");
    setIsDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const acceptFiles = (candidates) => {
    const incoming = Array.from(candidates || []).filter(Boolean);
    if (!incoming.length) return;
    const accepted = [];
    const rejected = [];
    for (const candidate of incoming) {
      if (!IS_LOCAL_RUNTIME && candidate.size > MAX_FILE_BYTES) {
        rejected.push(`${candidate.name} (${formatBytes(candidate.size)})`);
      } else {
        accepted.push(candidate);
      }
    }
    if (!accepted.length) {
      if (rejected.length) setError(`${rejected.join(", ")} exceed the hosted 3 MB per-file limit.`);
      return;
    }
    setSourceMode("file");
    setFiles((current) => {
      const seen = new Set(current.map((item) => `${item.name}:${item.size}:${item.lastModified}`));
      return [...current, ...accepted.filter((item) => {
        const key = `${item.name}:${item.size}:${item.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
    setResult(null);
    setBatchResults([]);
    setError(rejected.length
      ? `${rejected.join(", ")} exceed the hosted 3 MB per-file limit. Other files were added.`
      : "");
    setCopyState("idle");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const files = event.dataTransfer && event.dataTransfer.files;
    acceptFiles(files);
  };

  const clearFiles = () => {
    setFiles([]);
    setResult(null);
    setBatchResults([]);
    setBatchProgress(null);
    setError("");
    setCopyState("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (indexToRemove) => {
    setFiles((current) => current.filter((_, index) => index !== indexToRemove));
    setResult(null);
    setBatchResults([]);
  };

  const updateChatgptLink = (index, patch) => {
    setChatgptLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setResult(null);
    setBatchResults([]);
    setError("");
    setCopyState("idle");
  };

  const addChatgptLink = () => {
    setChatgptLinks((current) => [...current, { url: "", branchOnly: false }]);
  };

  const removeChatgptLink = (indexToRemove) => {
    setChatgptLinks((current) => current.length === 1
      ? [{ url: "", branchOnly: false }]
      : current.filter((_, index) => index !== indexToRemove));
    setResult(null);
    setBatchResults([]);
  };

  const selectBatchResult = (index) => {
    const selected = batchResults[index];
    if (!selected || !selected.ok) return;
    setActiveBatchIndex(index);
    setResult(selected);
    setViewMode("rendered");
  };

  const savePluginSelection = async (nextEnabled) => {
    if (!IS_LOCAL_RUNTIME) return;
    setPluginNotice("Saving plugin selection…");
    try {
      const response = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Plugin settings could not be saved.");
      setPlugins(Array.isArray(payload.plugins) ? payload.plugins : plugins);
      setEnabledPlugins(Array.isArray(payload.enabled) ? payload.enabled : nextEnabled);
      setPluginNotice("Saved. Enabled plugins apply to the next conversion.");
    } catch (pluginError) {
      setPluginNotice(pluginError.message || "Plugin settings could not be saved.");
    }
  };

  const togglePlugin = (pluginName) => {
    const nextEnabled = enabledPlugins.includes(pluginName)
      ? enabledPlugins.filter((name) => name !== pluginName)
      : [...enabledPlugins, pluginName];
    setEnabledPlugins(nextEnabled);
    savePluginSelection(nextEnabled);
  };

  const handleConvert = async () => {
    if (isConverting) return;
    const cleanLinks = chatgptLinks.map((link) => ({ ...link, url: link.url.trim() })).filter((link) => link.url);
    if (sourceMode === "file" && !files.length) return;
    if (sourceMode === "chatgpt" && (!cleanLinks.length || cleanLinks.some((link) => !isChatGPTShareUrl(link.url)))) {
      setError("Check each link. Public ChatGPT links must start with https://chatgpt.com/share/.");
      return;
    }
    setIsConverting(true);
    setError("");
    setCopyState("idle");
    setResult(null);
    setBatchResults([]);
    setBatchProgress({ current: 0, total: sourceMode === "file" ? files.length : cleanLinks.length });
    const startedAt = performance.now();
    const sources = sourceMode === "file" ? files : cleanLinks;
    const usedNames = new Set();
    const convertedItems = [];

    const requestConversion = async (source, index) => {
      const headers = {};
      if (accessToken.trim()) headers["X-MarkItDown-Token"] = accessToken.trim();
      let body;
      if (sourceMode === "chatgpt") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({
          source: "chatgpt",
          url: source.url,
          options: { keepDataUris, branchOnly: Boolean(source.branchOnly) },
        });
      } else if (IS_LOCAL_RUNTIME) {
        const formData = new FormData();
        formData.append("source", "file");
        formData.append("file", source, source.name);
        formData.append("keepDataUris", String(keepDataUris));
        body = formData;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({
          filename: source.name,
          mimeType: source.type || null,
          data: await readFileAsBase64(source),
          options: { keepDataUris },
        });
      }
      const response = await fetch("/api/convert", { method: "POST", headers, body });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) throw new Error(payload.error || `Conversion failed (${response.status}).`);
      return payload;
    };

    try {
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        setBatchProgress({ current: index, total: sources.length, name: sourceMode === "file" ? source.name : source.url });
        try {
          const payload = await requestConversion(source, index);
          const requestedName = sourceMode === "chatgpt"
            ? sources.length > 1
              ? (payload.title || `chatgpt-conversation-${index + 1}`)
              : (payload.filename || "chatgpt-conversation.md")
            : (payload.filename || source.name);
          const filename = uniqueMarkdownFilename(requestedName, usedNames, `chatgpt-conversation-${index + 1}.md`);
          convertedItems.push({
            ok: true,
            ...payload,
            filename,
            sourceName: sourceMode === "file" ? source.name : source.url,
            branchOnly: Boolean(source.branchOnly),
            elapsed: (performance.now() - startedAt) / 1000,
            convertedAt: Date.now(),
          });
        } catch (conversionError) {
          convertedItems.push({
            ok: false,
            filename: sourceMode === "file" ? source.name : `ChatGPT link ${index + 1}`,
            sourceName: sourceMode === "file" ? source.name : source.url,
            error: conversionError.message || "Conversion failed.",
          });
        }
        setBatchProgress({ current: index + 1, total: sources.length, name: sourceMode === "file" ? source.name : source.url });
      }

      const successfulItems = convertedItems.filter((item) => item.ok && item.markdown);
      setBatchResults(convertedItems);
      const firstSuccessIndex = convertedItems.findIndex((item) => item.ok && item.markdown);
      if (firstSuccessIndex >= 0) {
        setActiveBatchIndex(firstSuccessIndex);
        setResult(successfulItems[0]);
        setViewMode("rendered");
        const historyItems = successfulItems.map((converted) => ({
          id: window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now()}-${converted.filename}`,
          filename: converted.filename,
          bytes: converted.bytes || 0,
          markdown: converted.markdown || "",
          title: converted.title || null,
          convertedAt: converted.convertedAt,
        }));
        setHistory((current) => {
          const seen = new Set();
          const nextHistory = [...historyItems, ...current].filter((item) => {
            const key = item.filename.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 5);
          persistHistory(nextHistory);
          return nextHistory;
        });
      }
      const failedItems = convertedItems.filter((item) => !item.ok);
      if (failedItems.length) {
        setError(`${failedItems.length} of ${convertedItems.length} item${convertedItems.length === 1 ? "" : "s"} failed. Open the batch list for details.`);
      } else {
        setError("");
      }
    } catch (conversionError) {
      const message = conversionError instanceof TypeError
        ? IS_LOCAL_RUNTIME
          ? "The local conversion service is unavailable. Start MarkItDown Studio from its desktop shortcut and try again."
          : "The conversion service is unavailable. Try again when the app is deployed, or run it with `vercel dev`."
        : conversionError.message;
      setError(message || "Something went wrong while converting this source.");
      setResult(null);
    } finally {
      setIsConverting(false);
      setBatchProgress(null);
    }
  };

  const handleCopy = async () => {
    if (!result || !result.markdown) return;
    try {
      await copyToClipboard(result.markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setError("Clipboard access was blocked. Use the Markdown tab to select the text instead.");
    }
  };

  const handleOpenHistory = (item) => {
    setSourceMode("file");
    setFiles([]);
    setChatgptLinks([{ url: "", branchOnly: false }]);
    setError("");
    setCopyState("idle");
    setBatchResults([]);
    setBatchProgress(null);
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

  const hasOutput = Boolean(result && result.markdown);
  const successfulBatchResults = batchResults.filter((item) => item.ok && item.markdown);
  const failedBatchResults = batchResults.filter((item) => !item.ok);
  const statusText = isConverting
    ? sourceMode === "chatgpt" ? "Fetching conversation" : "Converting your file"
    : hasOutput
      ? result.elapsed ? `Converted in ${result.elapsed.toFixed(1)}s` : "Loaded from this browser"
      : sourceMode === "chatgpt"
        ? chatgptLinks.some((link) => link.url.trim())
          ? `${chatgptLinks.filter((link) => link.url.trim()).length} link${chatgptLinks.filter((link) => link.url.trim()).length === 1 ? "" : "s"} ready`
          : "Waiting for a public link"
        : files.length
          ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
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
            <span>{IS_LOCAL_RUNTIME ? "Local-only" : "Private by default"}</span>
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
            <p>{IS_LOCAL_RUNTIME ? "Convert large files privately on this laptop." : "Drop a file, keep the structure, and take your content with you."}</p>
          </div>
          <div className="intro-aside">
            <div className="aside-icon"><Zap size={17} strokeWidth={1.8} /></div>
            <p>Made for thoughtful work</p>
            <span>{IS_LOCAL_RUNTIME ? "Files stay on this laptop. No upload cap." : "No account required. Your recent files stay in this browser."}</span>
          </div>
        </section>

        <section className="workbench" aria-label="Conversion workspace">
          <article className="panel source-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Source</p>
                <h2>{sourceMode === "chatgpt" ? "ChatGPT conversation" : "Choose a file"}</h2>
              </div>
              <span className="quiet-status"><span className="status-dot" /> {sourceMode === "chatgpt" ? "Public link" : "Local"}</span>
            </div>

            <div className="source-mode-switcher" role="tablist" aria-label="Choose source type">
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === "file"}
                className={sourceMode === "file" ? "source-mode-active" : ""}
                onClick={() => chooseSourceMode("file")}
              >
                <FileUp size={15} strokeWidth={1.8} />
                <span>File</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === "chatgpt"}
                className={sourceMode === "chatgpt" ? "source-mode-active" : ""}
                onClick={() => chooseSourceMode("chatgpt")}
              >
                <Link2 size={15} strokeWidth={1.8} />
                <span>ChatGPT link</span>
              </button>
            </div>

            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              multiple
              onChange={(event) => {
                const selectedFiles = event.target && event.target.files;
                acceptFiles(selectedFiles);
                event.target.value = "";
              }}
            />

            {sourceMode === "chatgpt" ? (
              <div className="url-source">
                <div className="url-heading">
                  <label className="url-label" htmlFor="chatgpt-url-0">Public share links</label>
                  <span className="batch-count">{chatgptLinks.length} link{chatgptLinks.length === 1 ? "" : "s"}</span>
                </div>
                <div className="chatgpt-link-list">
                  {chatgptLinks.map((link, index) => (
                    <div className="chatgpt-link-row" key={`chatgpt-link-${index}`}>
                      <div className="url-input-wrap">
                        <Link2 size={17} strokeWidth={1.8} aria-hidden="true" />
                        <input
                          id={`chatgpt-url-${index}`}
                          className="url-input"
                          type="url"
                          inputMode="url"
                          autoComplete="off"
                          spellCheck="false"
                          value={link.url}
                          onChange={(event) => updateChatgptLink(index, { url: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && link.url.trim()) handleConvert();
                          }}
                          placeholder="https://chatgpt.com/share/..."
                          aria-describedby="chatgpt-url-help"
                        />
                        <button type="button" className="url-clear" onClick={() => removeChatgptLink(index)} aria-label={`Remove ChatGPT link ${index + 1}`} title="Remove link">
                          <X size={16} strokeWidth={1.8} />
                        </button>
                      </div>
                      <label className="branch-toggle" title="Keep only the branch after the first fork in this conversation">
                        <input type="checkbox" checked={Boolean(link.branchOnly)} onChange={(event) => updateChatgptLink(index, { branchOnly: event.target.checked })} />
                        <span>Only this branch</span>
                      </label>
                    </div>
                  ))}
                </div>
                <button type="button" className="add-link-button" onClick={addChatgptLink}><Plus size={15} strokeWidth={2} /> Add another link</button>
                <p id="chatgpt-url-help" className="url-help"><ShieldCheck size={14} strokeWidth={1.8} /> Public shared conversations only. Branch mode starts at the first detected fork and keeps the selected path to the end.</p>
              </div>
            ) : !files.length ? (
              <button
                type="button"
                className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
                onClick={() => { if (inputRef.current) inputRef.current.click(); }}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
                onDrop={handleDrop}
              >
                <span className="dropzone-icon"><UploadCloud size={25} strokeWidth={1.55} /></span>
                <strong>Drop a file here</strong>
                <span>or choose from your device</span>
                <small>{IS_LOCAL_RUNTIME ? "No hosted upload cap · any file type supported by MarkItDown" : "Up to 3 MB · any file type supported by MarkItDown"}</small>
              </button>
            ) : (
              <div className="file-batch">
                <div className="selected-file-list">
                  {files.map((selectedFile, index) => (
                    <div className="selected-file" key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}>
                      <div className="selected-file-main">
                        <FileGlyph filename={selectedFile.name} size={24} />
                        <span>
                          <strong title={selectedFile.name}>{selectedFile.name}</strong>
                          <small>{formatBytes(selectedFile.size)} · {selectedFile.type || `${extensionFor(selectedFile.name).toUpperCase()} file`}</small>
                        </span>
                      </div>
                      <button type="button" className="icon-button subtle" onClick={() => removeFile(index)} aria-label={`Remove ${selectedFile.name}`} title="Remove file">
                        <X size={17} strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="file-batch-actions">
                  <button type="button" className="outline-button compact-button" onClick={() => { if (inputRef.current) inputRef.current.click(); }}><Plus size={15} strokeWidth={1.9} /> Add more files</button>
                  <button type="button" className="text-button" onClick={clearFiles}>Clear files</button>
                </div>
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
              {IS_LOCAL_RUNTIME ? (
                <div className="option-row plugin-option-row">
                  <span className="option-copy">
                    <strong>Third-party plugins</strong>
                    <small>{enabledPlugins.length ? `${enabledPlugins.length} enabled locally` : "Off by default · manage in Settings"}</small>
                  </span>
                  <button type="button" className="text-button" onClick={() => setShowSettings(true)}>Manage</button>
                </div>
              ) : (
                <div className="option-row option-row-locked">
                  <span className="option-copy">
                    <strong>Third-party plugins</strong>
                    <small>Disabled in the hosted workspace for safety</small>
                  </span>
                  <LockKeyhole size={16} strokeWidth={1.8} aria-label="Disabled for safety" />
                </div>
              )}
            </div>

            {error && <div className="error-message" role="alert"><span className="error-mark">!</span><span>{error}</span></div>}

            <button type="button" className="primary-button convert-button" onClick={handleConvert} disabled={(sourceMode === "file" ? !files.length : !chatgptLinks.some((link) => link.url.trim())) || isConverting}>
              {isConverting ? <span className="button-spinner" aria-hidden="true" /> : <Sparkles size={17} strokeWidth={1.9} />}
              <span>{isConverting
                ? (batchProgress ? `Converting ${batchProgress.current}/${batchProgress.total}` : "Converting")
                : sourceMode === "chatgpt"
                  ? `Convert ${chatgptLinks.length > 1 ? "conversations" : "conversation"}`
                  : `Convert ${files.length > 1 ? "files" : "file"}`}</span>
              {!isConverting && <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />}
            </button>

            <div className="source-footer">
              <div className="status-line" aria-live="polite"><span className={`status-dot ${isConverting ? "status-dot-loading" : hasOutput ? "status-dot-done" : ""}`} />{statusText}</div>
              <span className="memory-note"><ShieldCheck size={14} strokeWidth={1.8} /> {sourceMode === "chatgpt" ? "Link is not stored" : IS_LOCAL_RUNTIME ? "Processed on this laptop" : "In-memory processing"}</span>
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

            {batchResults.length > 1 && (
              <div className="batch-results" aria-label="Batch conversion results">
                <div className="batch-results-header">
                  <span>{successfulBatchResults.length} of {batchResults.length} converted</span>
                  {successfulBatchResults.length > 1 && (
                    <button type="button" className="outline-button compact-button" onClick={() => downloadMarkdownZip(successfulBatchResults)}>
                      <Download size={15} strokeWidth={1.8} /> Download ZIP
                    </button>
                  )}
                </div>
                <div className="batch-result-list">
                  {batchResults.map((item, index) => (
                    <button
                      type="button"
                      key={`${item.filename}-${index}`}
                      className={`batch-result-row ${item.ok ? "batch-result-success" : "batch-result-failed"} ${activeBatchIndex === index ? "batch-result-active" : ""}`}
                      onClick={() => selectBatchResult(index)}
                      disabled={!item.ok}
                    >
                      <span className="batch-result-status" aria-hidden="true">{item.ok ? "✓" : "!"}</span>
                      <span className="batch-result-copy">
                        <strong>{item.filename}</strong>
                        <small>{item.ok
                          ? `${formatBytes(item.bytes)} source · ${item.markdown.length.toLocaleString()} characters${item.branchOnly ? (item.branchDetected ? " · branch only" : " · no fork detected") : ""}`
                          : item.error}</small>
                      </span>
                      {item.ok && <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {failedBatchResults.length > 0 && <p className="batch-help">Failed items stay listed so you can fix and retry them individually.</p>}
              </div>
            )}

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
              <span><ShieldCheck size={15} strokeWidth={1.8} /> {IS_LOCAL_RUNTIME ? "Files stay on this laptop" : "Files are processed in memory"}</span>
              <span><FileUp size={15} strokeWidth={1.8} /> {IS_LOCAL_RUNTIME ? "Local mode: no hosted upload cap" : "Hosted file limit: 3 MB"}</span>
            </div>
            {IS_LOCAL_RUNTIME && (
              <div className="plugin-manager">
                <div className="plugin-manager-heading">
                  <div>
                    <p className="section-kicker">Local extensions</p>
                    <h3>Third-party plugins</h3>
                  </div>
                  <button type="button" className="text-button" onClick={() => window.location.reload()}>Refresh</button>
                </div>
                <p className="modal-help plugin-warning"><LockKeyhole size={14} strokeWidth={1.8} /> Plugins execute Python code on this laptop. Enable only packages you trust; multiple plugins can be enabled together.</p>
                {pluginsLoading ? (
                  <div className="plugin-empty">Discovering local plugins…</div>
                ) : plugins.length ? (
                  <div className="plugin-list">
                    {plugins.map((plugin) => (
                      <label className={`plugin-card ${plugin.available ? "" : "plugin-card-disabled"}`} key={plugin.name}>
                        <input
                          type="checkbox"
                          checked={enabledPlugins.includes(plugin.name)}
                          disabled={!plugin.available}
                          onChange={() => togglePlugin(plugin.name)}
                        />
                        <span className="plugin-card-copy">
                          <strong>{plugin.package} <small>v{plugin.version}</small></strong>
                          <span>{plugin.description}</span>
                          <small>{plugin.source}{plugin.available ? "" : ` · ${plugin.loadError || "unavailable"}`}</small>
                          {plugin.name === "ocr" && <em>Scanned-image OCR needs an OpenAI-compatible client and model; without them it falls back to normal extraction.</em>}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="plugin-empty">No MarkItDown plugins are installed. Add one to the local `.venv`, then refresh.</div>
                )}
                <div className="plugin-install-help">
                  <strong>Add another trusted plugin</strong>
                  <span>Install a package exposing the <code>markitdown.plugin</code> entry point, then refresh this page.</span>
                  <code> .venv\Scripts\python.exe -m pip install &lt;plugin-package&gt;</code>
                </div>
                {pluginNotice && <p className="plugin-notice" aria-live="polite">{pluginNotice}</p>}
              </div>
            )}
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
