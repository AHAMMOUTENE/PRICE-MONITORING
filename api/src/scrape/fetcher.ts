/**
 * Collecte des pages derrière une interface : ScrapingBee en production, un faux en test.
 * Coût : 1 crédit par page simple, 5 avec rendu JavaScript, 10 à 25 avec proxy premium (en-tête Spb-cost).
 */
export interface FetchOptions {
  renderJs?: boolean
  premiumProxy?: boolean
  countryCode?: string
  /** Attente en ms après le rendu (pages qui chargent leurs produits en différé). */
  wait?: number
}
export interface FetchResult {
  status: number
  body: string
  credits: number
  requestId?: string
}
export interface Fetcher {
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult>
}

export class ScrapingBeeFetcher implements Fetcher {
  constructor(
    private apiKey: string,
    private timeoutMs = 90_000,
  ) {}

  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const q = new URLSearchParams({ api_key: this.apiKey, url, render_js: String(Boolean(opts.renderJs)) })
    if (opts.premiumProxy) q.set('premium_proxy', 'true')
    if (opts.countryCode) q.set('country_code', opts.countryCode)
    if (opts.wait) q.set('wait', String(opts.wait))
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${q}`, { signal: AbortSignal.timeout(this.timeoutMs) })
    const body = await res.text()
    // ScrapingBee ne facture pas les échecs ; sinon l'en-tête donne le coût réel.
    const credits = Number(res.headers.get('spb-cost')) || (res.ok ? (opts.renderJs ? 5 : 1) : 0)
    return { status: res.status, body, credits, requestId: res.headers.get('spb-request-id') ?? undefined }
  }
}

export function fetcherFromEnv(env: Record<string, string | undefined>): Fetcher | null {
  return env.SCRAPINGBEE_API_KEY ? new ScrapingBeeFetcher(env.SCRAPINGBEE_API_KEY) : null
}
