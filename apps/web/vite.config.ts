import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webPort = Number(process.env.VITE_PORT ?? 5173);
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: webPort,
    proxy: {
      "/api": apiOrigin,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "markdown",
              test: /node_modules[\\/](?:react-markdown|remark-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|unified|unist-[^\\/]+|vfile[^\\/]*|property-information|decode-named-character-reference|character-entities[^\\/]*|ccount|markdown-table|longest-streak|devlop|bail|trough|zwitch|html-url-attributes|space-separated-tokens|comma-separated-tokens|parse-entities|stringify-entities|trim-lines)[\\/]/,
            },
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
