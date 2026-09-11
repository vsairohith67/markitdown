import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: [
        "chrome >= 60",
        "safari >= 10.1",
        "ios_saf >= 10.3",
        "firefox >= 52",
        "edge >= 15",
      ],
      modernPolyfills: true,
    }),
  ],
});
