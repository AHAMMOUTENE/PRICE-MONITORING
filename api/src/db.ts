/**
 * Accès à Postgres, derrière une interface minimale : le même code tourne avec postgres.js (Supabase)
 * et avec PGlite (tests). Règle : les paramètres sont des valeurs simples (texte, nombre, booléen, null) ;
 * les listes passent en JSON (`$1::jsonb`) pour ne dépendre d'aucun pilote.
 */
import postgres from 'postgres'

export interface Sql {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<T[]>
}
export interface Db extends Sql {
  /** Exécute `fn` dans une transaction ; tout est annulé si elle lève. */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function postgresDb(url: string, max = 8): Db {
  // prepare:false : obligatoire avec le « Transaction pooler » de Supabase.
  const sql = postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 15 })
  return {
    query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
    tx: (fn) => sql.begin(async (t) => fn({ query: async (text, params = []) => (await t.unsafe(text, params as never[])) as never })) as never,
    close: () => sql.end(),
  }
}

/** Structure minimale de PGlite utilisée ici (évite de dépendre du paquet hors tests). */
interface PgliteLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
  transaction<T>(fn: (t: { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export function pgliteDb(pg: PgliteLike): Db {
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    tx: (fn) => pg.transaction((t) => fn({ query: async (text, params = []) => (await t.query(text, params)).rows })),
    close: () => pg.close(),
  }
}

/** « 2026-11-18T10:15:00Z » depuis une colonne timestamptz (même format quel que soit le pilote). */
export const ts = (col: string) => `to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
