# kilo-litellm-models-plugin

Asks your [LiteLLM](https://docs.litellm.ai) server which models your API key may use and registers all of them in Kilo
as **one new provider**. Existing providers (including a hand-written `gti-litellm`) are never modified or removed.
It installs nothing and the client needs no `package.json` in its `.kilo` folder.

```jsonc
// kilo.jsonc
{ "plugin": ["git+https://github.com/<org>/kilo-litellm-models-plugin.git"] }
```

Set `LITELLM_API_KEY` in your environment (and `LITELLM_BASE_URL` if not using `https://litellm.gratex.ai`).
Models then show up as `litellm-mine/<model name>`.

Optional options, passed as `["<plugin>", { ... }]`:

| Option | Default | Meaning |
|---|---|---|
| `id` | `litellm-mine` | Provider id. If a provider with this id already exists in your config, the plugin does nothing. |
| `name` | `LiteLLM (my models)` | Display name. |
| `baseURL` | `$LITELLM_BASE_URL` or `https://litellm.gratex.ai` | LiteLLM server; `/v1` is appended for chat requests. |
| `apiKey` | `$LITELLM_API_KEY` | Explicit key. Prefer the environment variable. |
| `localOnly` | `false` | Skip models whose name contains `/` (remote/cloud models). |

If the key is missing or the fetch fails, a warning is logged and nothing is registered.
Model data comes from `GET /v1/model/info`: embedding, blocked and output-less models are skipped, duplicate names are merged,
and per-token prices are converted to per-1M-token prices.
