import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function thirdPartyNotices(): Plugin {
  return {
    name: "third-party-notices",
    generateBundle(_, bundle) {
      const packages = new Map<string, string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const moduleId of Object.keys(output.modules)) {
          const normalized = moduleId
            .replaceAll("\0", "")
            .replaceAll("\\", "/");
          const marker = normalized.lastIndexOf("/node_modules/");
          if (marker < 0) continue;
          const prefix = normalized.slice(0, marker + "/node_modules/".length);
          const parts = normalized.slice(prefix.length).split("/");
          const first = parts[0];
          if (!first) continue;
          const name = first.startsWith("@")
            ? parts.slice(0, 2).join("/")
            : first;
          packages.set(name, prefix + name);
        }
      }
      const notices = [
        "Third-party software included in the Tudla browser build.",
      ];
      for (const [name, directory] of [...packages].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const metadata = JSON.parse(
          readFileSync(join(directory, "package.json"), "utf8"),
        );
        const files = readdirSync(directory).filter((file) =>
          /^(?:licen[sc]e|copying|notice|ofl)(?:[._-].*)?$/i.test(file),
        );
        if (!files.length) throw Error(`Missing license notice for ${name}`);
        notices.push(
          `${name}@${metadata.version}\nLicense: ${metadata.license || "See notice below"}\n\n` +
            files
              .sort()
              .map((file) => readFileSync(join(directory, file), "utf8"))
              .join("\n\n"),
        );
      }
      notices.push(
        "IBM Plex Sans fonts\n\n" +
          readFileSync(
            new URL("./public/IBM-Plex-OFL.txt", import.meta.url),
            "utf8",
          ),
      );
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_NOTICES.txt",
        source:
          notices.join("\n\n----------------------------------------\n\n") +
          "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: "LICENSE.txt",
        source: readFileSync(new URL("../../LICENSE", import.meta.url), "utf8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), thirdPartyNotices()],
  define: {
    __SAMPLE_ONLY__: process.env.VITE_LIVE_WORKSPACES !== "true",
  },
  server: { proxy: { "/api": "http://127.0.0.1:3100" } },
});
