/**
 * models.dev list prices and the DeepSeek billing periods.
 *
 * The harness prices only request images, so a text price has to be resolved
 * here. The book is fetched once and cached; every function that turns a price
 * into money is pure, so the accounting is testable without a network.
 * @module @yirc99/dsh-jev-context/pricing
 */

/** One model's list prices, in USD per million tokens. */
export interface TokenPrice {
  /** Uncached input tokens. */
  readonly input: number
  /** Input tokens served from the provider's prompt cache. */
  readonly cacheRead: number
}

/** List prices by provider id, then model id. */
export type PriceBook = ReadonlyMap<string, ReadonlyMap<string, TokenPrice>>

/** Where the price book comes from, and how money is displayed. */
export interface PricingFacts {
  /** Registry base URL; `/api.json` is appended. */
  readonly baseUrl: string
  /** USD per one CNY, as the deployment states the conversion. */
  readonly usdPerCny: number
}

/** A number read from an untrusted registry payload, or 0 when absent. */
function amountOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Read the registry payload into a price book. The payload is external data
 * that changes without notice, so every level is checked and anything
 * unreadable is simply absent from the book rather than failing the fetch.
 * @param payload - decoded `/api.json` response.
 * @returns list prices by provider id, then model id.
 */
export function parsePriceBook(payload: unknown): PriceBook {
  const book = new Map<string, ReadonlyMap<string, TokenPrice>>()
  if (typeof payload !== 'object' || payload === null) return book
  for (const [providerId, provider] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof provider !== 'object' || provider === null) continue
    const models = (provider as { models?: unknown }).models
    if (typeof models !== 'object' || models === null) continue
    const priced = new Map<string, TokenPrice>()
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (typeof model !== 'object' || model === null) continue
      const cost = (model as { cost?: unknown }).cost
      if (typeof cost !== 'object' || cost === null) continue
      const input = amountOf((cost as { input?: unknown }).input)
      if (input === 0) continue
      priced.set(modelId, { input, cacheRead: amountOf((cost as { cache_read?: unknown }).cache_read) })
    }
    if (priced.size > 0) book.set(providerId, priced)
  }
  return book
}

/**
 * Fetch the registry once. A rejected fetch is the caller's to contain: a
 * missing price must never cost a turn.
 * @param baseUrl - registry base URL.
 * @param signal - request cancellation.
 * @returns the parsed book.
 * @throws when the registry is unreachable or answers with a non-JSON body.
 */
export async function fetchPriceBook(baseUrl: string, signal?: AbortSignal): Promise<PriceBook> {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}/api.json`, {
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`price registry answered ${String(response.status)}`)
  return parsePriceBook(await response.json())
}

/**
 * Whether an instant bills at DeepSeek's peak rate.
 *
 * DeepSeek's published list is UTC 01:00-04:00 and 06:00-10:00, Monday through
 * Friday (Beijing Time 09:00-12:00 and 14:00-18:00). Every other hour, and the
 * whole weekend, bills at the half-price off-peak rate.
 * @param at - the instant the request was made.
 * @returns true inside a peak window.
 */
export function isPeak(at: Date): boolean {
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** dsh provider ids that price under a different models.dev id; others pass through. */
const MODELS_DEV_PROVIDER_IDS: Readonly<Record<string, string>> = {
  'deepseek-official': 'deepseek',
  'kimi-coding': 'moonshotai',
  'minimax-cn': 'minimax',
  'zai-coding-cn': 'zhipuai',
}

/**
 * The models.dev registry id that prices a routed provider.
 * @param provider - the routed dsh provider id.
 * @returns the registry id, or the input when the table does not rename it.
 */
export function registryProviderOf(provider: string): string {
  return MODELS_DEV_PROVIDER_IDS[provider] ?? provider
}

/**
 * The input price one provider's model bills at, for one instant.
 *
 * Only DeepSeek bills through periods; every other provider books everything
 * at its list price.
 * @param book - list prices from the registry.
 * @param provider - the routed provider id.
 * @param model - the routed model id.
 * @param at - the instant the tokens would have been sent.
 * @returns USD per million input tokens, or undefined when the model is unpriced.
 */
export function inputPriceOf(
  book: PriceBook,
  provider: string,
  model: string,
  at: Date,
): number | undefined {
  const id = registryProviderOf(provider)
  const price = book.get(id)?.get(model)
  if (price === undefined) return undefined
  return id === 'deepseek' && !isPeak(at) ? price.input / 2 : price.input
}

/**
 * Value a token count at a price, in CNY.
 * @param tokens - tokens removed from the model-visible surface.
 * @param priceUsdPerMillion - USD per million input tokens.
 * @param usdPerCny - USD per one CNY.
 * @returns the value in CNY.
 */
export function cnyOf(tokens: number, priceUsdPerMillion: number, usdPerCny: number): number {
  return tokens / 1_000_000 * priceUsdPerMillion / usdPerCny
}
