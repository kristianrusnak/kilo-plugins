# kilo-cbm-plugin

Registers an already installed [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) MCP server in Kilo.
It never downloads or installs anything, and the client needs no `package.json` in its `.kilo` folder.

```jsonc
// kilo.jsonc
{ "plugin": ["git+https://github.com/<org>/kilo-cbm-plugin.git"] }
```

Binary lookup order (read-only):

1. The `command` option, if set.
2. `PATH`.
3. The upstream default install directory: `~/.local/bin/codebase-memory-mcp` on macOS/Linux,
   `%LOCALAPPDATA%\Programs\codebase-memory-mcp\codebase-memory-mcp.exe` on Windows.

If nothing is found, a warning is logged and the server is registered under its bare name, so it shows up as failed in the MCP list.

Optional options: `{ "command": "/path/to/bin", "environment": { "CBM_CACHE_DIR": "..." } }`.
An `mcp["codebase-memory-mcp"]` entry in `kilo.jsonc` always takes precedence.
