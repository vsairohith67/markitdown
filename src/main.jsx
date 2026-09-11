import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("MarkItDown Studio failed to render", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-fallback" role="alert">
          <div className="runtime-fallback-card">
            <div className="runtime-fallback-mark" aria-hidden="true">M</div>
            <h1>MarkItDown Studio</h1>
            <p>The workspace hit a rendering error. Refresh the page to try again.</p>
            <button type="button" onClick={() => window.location.reload()}>Refresh workspace</button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

document.documentElement.dataset.appReady = "true";
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
