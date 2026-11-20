/**
 * Serveur Node : API + planificateur des scans.
 *   cp .env.example .env   (renseigner DATABASE_URL, SCRAPINGBEE_API_KEY…)   puis   npm run dev
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { createApp } from './app.ts'
import { postgresDb } from './db.ts'
import { mailerFromEnv } from './mail.ts'
import { extractorFromEnv } from './scrape/extract.ts'
import { fetcherFromEnv } from './scrape/fetcher.ts'
import { recoverScans, tickScheduler, type ScanDeps } from './scrape/scan.ts'

try {
  process.loadEnvFile('.env')
} catch {
  /* pas de fichier .env : variables d'environnement du système */
}
const env = process.env as Record<string, string | undefined>
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL manquant : copiez .env.example en .env et renseignez la connexion Postgres de Supabase.')
  process.exit(1)
}
const log = (event: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }))

const db = postgresDb(env.DATABASE_URL)
const deps: ScanDeps = { db, fetcher: fetcherFromEnv(env), llm: extractorFromEnv(env), mailer: mailerFromEnv(env), env, log }
if (!deps.fetcher) log('warning', { message: 'SCRAPINGBEE_API_KEY absent : les scans sont désactivés' })
if (!deps.llm) log('info', { message: 'ANTHROPIC_API_KEY absent : pas de lecture par Claude des pages sans données structurées' })

const app = createApp({ ...deps, env: { ...env, NODE_ENV: env.NODE_ENV ?? 'development' } })
// Un seul hébergement : si le site est construit (app/dist), le même serveur le sert en plus de /api.
const dist = env.STATIC_DIR || '../app/dist'
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: dist }))
  app.get('*', serveStatic({ root: dist, path: 'index.html' }))
  log('static', { dir: dist })
}
const port = Number(env.PORT) || 8787
serve({ fetch: app.fetch, port, hostname: env.HOST || '127.0.0.1' }, () => log('listening', { port }))

await recoverScans(deps)
// Le planificateur passe chaque minute ; l'index unique en base garantit un seul scan planifié par zone et par jour.
const tick = () => tickScheduler(deps).catch((e) => log('scheduler-error', { error: String(e) }))
setInterval(tick, 60_000)
void tick()

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    void db.close().finally(() => process.exit(0))
  })
