import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file, so the build can be shared as a single page.
export default defineConfig({
  plugins: [viteSingleFile()],
  test: { globals: true },
});
