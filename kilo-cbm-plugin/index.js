import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const NAME = "codebase-memory-mcp"
const WIN = process.platform === "win32"
const BIN = WIN ? `${NAME}.exe` : NAME

// Default install locations, taken from the upstream install.sh / install.ps1
const LOCAL = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
const DIR = WIN ? path.join(LOCAL, "Programs", NAME) : path.join(os.homedir(), ".local", "bin")

function runnable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false
    if (!WIN) fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Read-only lookup: PATH first (covers npm, brew, scoop, ... installs), then the default install dir
function locate() {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const file = path.join(dir, BIN)
    if (runnable(file)) return file
  }
  const file = path.join(DIR, BIN)
  if (runnable(file)) return file
}

export default {
  id: "kilo-cbm-plugin",
  server: async (ctx, options) => ({
    config: async (cfg) => {
      cfg.mcp ??= {}
      // a user-defined entry in kilo.jsonc always wins
      if (cfg.mcp[NAME]) return
      const bin = typeof options?.command === "string" ? options.command : locate()
      if (!bin) {
        await ctx.client.app
          .log({
            body: {
              service: "kilo-cbm-plugin",
              level: "warn",
              message: `${NAME} not found on PATH or in ${DIR}; it must be installed separately`,
            },
          })
          .catch(() => {})
      }
      cfg.mcp[NAME] = {
        type: "local",
        // bare name when not found, so the failure shows up in the MCP list instead of being silent
        command: [bin ?? NAME],
        environment: options?.environment,
        enabled: true,
      }
    },
  }),
}
