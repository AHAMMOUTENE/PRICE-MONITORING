/**
 * Entrée Cloudflare Workers : même API que le serveur Node.
 *  - fetch     : /api/* (le site statique est servi par Cloudflare, voir wrangler.toml) ;
 *  - scheduled : chaque minute, lance les scans du jour puis les scans en attente (manuels compris).
 * La base est jointe par Hyperdrive (binding HYPERDRIVE) ; les secrets sont des « secrets » Wrangler.
 */
import { createApp } from './app.ts'
import { postgresDb, type Db } from './db.ts'
import { extractorFromEnv } from './scrape/extract.ts'
import { fetcherFromEnv } from './scrape/fetcher.ts'
import { recoverStale, runQueued, tickScheduler, type ScanDeps } from './scrape/scan.ts'

interface Bindings {
  HYPERDRIVE?: { connectionString: string }
  DATABASE_URL?: string
  [key: string]: unknown
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

const log = (event: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

function strings(env: Bindings): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')) as Record<string, string>
}
function open(env: Bindings, connections = 1): { db: Db; deps: ScanDeps } {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
  if (!url) throw new Error('Base de données non configurée (binding HYPERDRIVE ou DATABASE_URL)')
  const vars = strings(env)
  // Une connexion par invocation : Hyperdrive les mutualise côté Cloudflare.
  const db = postgresDb(url, connections)
  return { db, deps: { db, fetcher: fetcherFromEnv(vars), llm: extractorFromEnv(vars), env: vars, log } }
}

export default {
  async fetch(req: Request, env: Bindings, ctx: Ctx): Promise<Response> {
    const { db, deps } = open(env)
    try {
      const app = createApp({ ...deps, env: { ...deps.env, NODE_ENV: 'production' }, deferScans: true, background: (p) => ctx.waitUntil(p) })
      return await app.fetch(req)
    } finally {
      ctx.waitUntil(db.close())
    }
  },

  async scheduled(_event: unknown, env: Bindings, ctx: Ctx): Promise<void> {
    const { db, deps } = open(env, 4)
    const work = (async () => {
      await recoverStale(deps)
      const started: Promise<void>[] = []
      await tickScheduler(deps, (p) => started.push(p))
      await Promise.all(started)
      await runQueued(deps)
    })()
    ctx.waitUntil(work.catch((e) => log('cron-error', { error: String(e) })).finally(() => db.close()))
  },
}
