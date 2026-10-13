const ID = "kilo-litellm-models-plugin"
const DEFAULT_URL = "https://litellm.gratex.ai"

// The same plugin can be loaded for several projects in one process, so fetch once per URL + key
const cache = new Map()

// LiteLLM reports prices per token, Kilo wants them per 1M tokens (rounded to absorb float noise)
function million(cost) {
  return Math.round(cost * 1e12) / 1e6
}

const num = (value) => (typeof value === "number" ? value : undefined)

async function fetchInfo(base, key) {
  const res = await fetch(`${base}/v1/model/info`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}/v1/model/info`)
  const json = await res.json()
  if (!Array.isArray(json?.data)) throw new Error("unexpected response shape (missing data[])")
  return json.data
}

// Builds the provider's models object from the /v1/model/info data[].
// Skips embedding, blocked and output-less models and merges entries that share a model_name
// (union of booleans, max of token limits and per-token costs, union of supported_openai_params).
function buildModels(entries) {
  const merged = {}

  for (const entry of entries) {
    const name = entry?.model_name
    if (!name) continue
    const info = entry.model_info ?? {}

    if (info.mode === "embedding") continue
    if (!info.max_output_tokens) continue
    if (info.blocked === true) continue

    if (!merged[name]) {
      merged[name] = {
        supports_reasoning: !!info.supports_reasoning,
        supports_vision: !!info.supports_vision,
        supports_pdf_input: !!info.supports_pdf_input,
        supports_none_reasoning_effort: !!info.supports_none_reasoning_effort,
        supports_minimal_reasoning_effort: !!info.supports_minimal_reasoning_effort,
        supports_xhigh_reasoning_effort: !!info.supports_xhigh_reasoning_effort,
        supports_max_reasoning_effort: !!info.supports_max_reasoning_effort,
        max_input_tokens: info.max_input_tokens,
        max_output_tokens: info.max_output_tokens,
        supported_openai_params: Array.isArray(info.supported_openai_params) ? info.supported_openai_params.slice() : [],
        input_cost_per_token: num(info.input_cost_per_token),
        output_cost_per_token: num(info.output_cost_per_token),
        cache_read_input_token_cost: num(info.cache_read_input_token_cost),
        cache_creation_input_token_cost: num(info.cache_creation_input_token_cost),
      }
      continue
    }

    const acc = merged[name]
    for (const field of [
      "supports_reasoning",
      "supports_vision",
      "supports_pdf_input",
      "supports_none_reasoning_effort",
      "supports_minimal_reasoning_effort",
      "supports_xhigh_reasoning_effort",
      "supports_max_reasoning_effort",
    ]) {
      if (info[field]) acc[field] = true
    }
    if ((info.max_input_tokens || 0) > (acc.max_input_tokens || 0)) acc.max_input_tokens = info.max_input_tokens
    if ((info.max_output_tokens || 0) > (acc.max_output_tokens || 0)) acc.max_output_tokens = info.max_output_tokens
    for (const field of [
      "input_cost_per_token",
      "output_cost_per_token",
      "cache_read_input_token_cost",
      "cache_creation_input_token_cost",
    ]) {
      if (typeof info[field] !== "number") continue
      if (typeof acc[field] !== "number" || info[field] > acc[field]) acc[field] = info[field]
    }
    if (Array.isArray(info.supported_openai_params)) {
      acc.supported_openai_params = [...new Set([...acc.supported_openai_params, ...info.supported_openai_params])]
    }
  }

  const models = {}
  for (const name of Object.keys(merged)) {
    const info = merged[name]
    const model = { name }

    if (info.supports_reasoning) {
      model.reasoning = true
      model.interleaved = { field: "reasoning_content" }
    }

    if (info.supports_vision || info.supports_pdf_input) {
      const input = ["text"]
      if (info.supports_vision) input.push("image")
      if (info.supports_pdf_input) input.push("pdf")
      model.attachment = true
      model.modalities = { input, output: ["text"] }
    }

    if (info.max_input_tokens && info.max_output_tokens) {
      model.limit = { context: info.max_input_tokens, output: info.max_output_tokens }
    }

    if (info.input_cost_per_token !== undefined || info.output_cost_per_token !== undefined) {
      model.cost = {
        input: info.input_cost_per_token !== undefined ? million(info.input_cost_per_token) : 0,
        output: info.output_cost_per_token !== undefined ? million(info.output_cost_per_token) : 0,
      }
      if (info.cache_read_input_token_cost !== undefined) {
        model.cost.cache_read = million(info.cache_read_input_token_cost)
      }
      if (info.cache_creation_input_token_cost !== undefined) {
        model.cost.cache_write = million(info.cache_creation_input_token_cost)
      }
    }

    if (info.supported_openai_params.includes("reasoning_effort")) {
      const variants = {}
      for (const level of ["low", "medium", "high"]) variants[level] = { reasoningEffort: level }
      if (info.supports_none_reasoning_effort) variants.none = { reasoningEffort: "none" }
      if (info.supports_minimal_reasoning_effort) variants.minimal = { reasoningEffort: "minimal" }
      if (info.supports_xhigh_reasoning_effort) variants.xhigh = { reasoningEffort: "xhigh" }
      if (info.supports_max_reasoning_effort) variants.max = { reasoningEffort: "max" }
      model.variants = variants
    }

    models[name] = model
  }

  return models
}

export default {
  id: ID,
  server: async (ctx, options) => {
    const log = (level, message) =>
      ctx.client.app.log({ body: { service: ID, level, message } }).catch(() => {})

    return {
      config: async (cfg) => {
        const id = typeof options?.id === "string" ? options.id : "litellm-mine"
        cfg.provider ??= {}
        // never touch a provider the user already defined (this also covers a second run of this hook)
        if (cfg.provider[id]) return

        const key = typeof options?.apiKey === "string" ? options.apiKey : process.env.LITELLM_API_KEY
        if (!key) {
          await log("warn", "LITELLM_API_KEY is not set (and no apiKey option given); no models registered")
          return
        }

        const base = (typeof options?.baseURL === "string" ? options.baseURL : process.env.LITELLM_BASE_URL || DEFAULT_URL).replace(/\/+$/, "")
        const cacheKey = `${base}\n${key}`
        if (!cache.has(cacheKey)) cache.set(cacheKey, fetchInfo(base, key))

        const data = await cache.get(cacheKey).catch(async (err) => {
          cache.delete(cacheKey) // allow a retry on the next config load
          await log("warn", `failed to fetch models from ${base} (${err.message}); no models registered`)
        })
        if (!data) return

        let models = buildModels(data)
        // local models have no "/" in their name; the rest are remote/cloud models
        if (options?.localOnly === true) {
          models = Object.fromEntries(Object.entries(models).filter(([name]) => !name.includes("/")))
        }
        if (Object.keys(models).length === 0) {
          await log("warn", "LiteLLM returned no usable models; nothing registered")
          return
        }

        cfg.provider[id] = {
          name: typeof options?.name === "string" ? options.name : "LiteLLM (my models)",
          npm: "@ai-sdk/openai-compatible",
          // an explicit key goes straight into the options; otherwise Kilo reads it from the environment
          ...(typeof options?.apiKey === "string" ? {} : { env: ["LITELLM_API_KEY"] }),
          options: {
            baseURL: `${base}/v1`,
            ...(typeof options?.apiKey === "string" ? { apiKey: options.apiKey } : {}),
          },
          models,
        }
      },
    }
  },
}
