-- =====================================================================
--  Suivi des prix VEJA — schéma Supabase / Postgres (schéma public)
--  Conventions : timestamptz partout, numeric(12,2) pour les prix,
--  zone_id sur chaque table métier, UUIDv7 pour les identifiants,
--  RLS activée partout sans politique (seul le Worker, en service_role, lit et écrit).
-- =====================================================================

create extension if not exists btree_gist;  -- EXCLUDE (zone_id =, période &&)
create extension if not exists citext;      -- e-mails insensibles à la casse

-- ---------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------

-- UUIDv7 (horodaté, trié par création : bonne localité d'index pour les tables append-only).
-- À remplacer par uuidv7() natif quand Supabase sera en PostgreSQL 18.
create or replace function uuid_generate_v7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;

-- Lundi ISO de la semaine d'une date.
create or replace function iso_week_start(d date) returns date
language sql immutable parallel safe as $$
  select (d - (extract(isodow from d)::int - 1))::date
$$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Tables append-only : toute modification ou suppression est refusée.
create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% est en ajout seul (% refusé)', tg_table_name, tg_op
    using errcode = 'integrity_constraint_violation';
end $$;

-- Évaluations : seule la clôture (is_current / superseded_at) est permise.
create or replace function evaluations_supersede_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'observation_evaluations est en ajout seul' using errcode = 'integrity_constraint_violation';
  end if;
  if (to_jsonb(new) - 'is_current' - 'superseded_at') is distinct from (to_jsonb(old) - 'is_current' - 'superseded_at') then
    raise exception 'observation_evaluations : seule la clôture est modifiable' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
create type record_status     as enum ('active', 'archived');
create type proof_kind        as enum ('confirmed', 'to-review');
create type match_kind        as enum ('alias', 'ean', 'retailer-ref', 'exact-title', 'fuzzy', 'none');
create type anomaly_reason    as enum ('non-discounted-model', 'over-max-discount');
create type evaluation_kind   as enum ('anomaly', 'ok', 'not-controlled', 'rrp-missing', 'unidentified');
create type evaluation_cause  as enum ('scan', 'decision', 'manual');
create type review_kind       as enum ('accepted', 'corrected', 'no-match');
create type price_kind        as enum ('rrp', 'wholesale');
create type scan_mode         as enum ('weekly', 'daily');
create type scan_trigger      as enum ('scheduled', 'manual');
create type scan_status       as enum ('queued', 'running', 'done', 'partial', 'failed', 'cancelled');
create type scan_site_status  as enum ('pending', 'running', 'ok', 'empty', 'failed', 'skipped');
create type listing_status    as enum ('active', 'gone', 'dismissed');
create type alias_kind        as enum ('url', 'title', 'retailer-ref', 'ean');
create type alias_verdict     as enum ('product', 'not-veja');
create type import_kind       as enum ('accounts', 'catalog');
create type import_status     as enum ('previewed', 'committed', 'failed', 'expired');
create type email_frequency   as enum ('off', 'each-scan', 'weekly', 'daily-in-sales');
create type zone_role         as enum ('reader', 'editor', 'admin');

-- ---------------------------------------------------------------------
-- Référentiel : zones, utilisateurs
-- ---------------------------------------------------------------------
create table zones (
  id               text primary key check (id ~ '^[A-Z]{2,8}$'),
  label            text not null,
  default_currency char(3) not null check (default_currency ~ '^[A-Z]{3}$'),
  timezone         text not null,                         -- fuseau du « lundi » et de l'heure de scan
  scan_time        time not null default '05:00',         -- heure locale du scan planifié
  current_season   text check (current_season ~ '^(SS|AW)[0-9]{2}$'),  -- saison de l'export (« AW26 »)
  credits_budget_month integer check (credits_budget_month >= 0),      -- plafond ScrapingBee indicatif
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table zones is 'Les quatre zones commerciales ; chaque zone a ses comptes, son catalogue, son calendrier.';

insert into zones (id, label, default_currency, timezone) values
  ('EMEA',  'Europe, Moyen-Orient, Afrique', 'EUR', 'Europe/Paris'),
  ('LATAM', 'Amérique latine',               'BRL', 'America/Sao_Paulo'),
  ('APAC',  'Asie-Pacifique',                'AUD', 'Australia/Sydney'),
  ('NOAM',  'Amérique du Nord',              'USD', 'America/New_York');

create table users (
  email        citext primary key check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
comment on table users is 'Identité fournie par le SSO (Cloudflare Access) : créée ou rafraîchie à chaque requête.';

create table user_zone_access (
  user_email citext not null references users(email) on delete cascade,
  zone_id    text   not null references zones(id) on delete cascade,
  role       zone_role not null default 'editor',
  granted_by citext references users(email) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_email, zone_id)
);

create table user_preferences (
  user_email      citext primary key references users(email) on delete cascade,
  tour_done_at    timestamptz,                                   -- « tutoriel vu »
  locale          text check (locale in ('fr', 'en', 'pt', 'es')),
  last_zone       text references zones(id) on delete set null,
  email_frequency email_frequency not null default 'off',
  ui              jsonb not null default '{}'::jsonb,            -- colonnes choisies, menu replié… (facultatif)
  updated_at      timestamptz not null default now()
);

create table user_email_zones (                                    -- zones choisies pour l'e-mail
  user_email citext not null references users(email) on delete cascade,
  zone_id    text   not null references zones(id) on delete cascade,
  primary key (user_email, zone_id)
);

-- ---------------------------------------------------------------------
-- Imports (déclaré tôt : référencé par les prix)
-- ---------------------------------------------------------------------
create table imports (
  id              uuid primary key default uuid_generate_v7(),     -- = ImportPreview.token
  zone_id         text not null references zones(id) on delete restrict,
  kind            import_kind not null,
  status          import_status not null default 'previewed',
  file_name       text not null,
  file_size_bytes integer check (file_size_bytes >= 0),
  storage_path    text,                                            -- copie du fichier (Supabase Storage), facultatif
  sheet           text,
  delimiter       text check (delimiter in (';', ',', E'\t')),
  season          text,
  no_discount     boolean,
  file_columns    text[],
  mapping         jsonb,                                           -- donnée attendue → index de colonne
  warnings        jsonb not null default '[]'::jsonb,
  rows_read       integer not null default 0,
  rows_skipped    integer not null default 0,
  rows_committed  integer,
  payload         jsonb,                                           -- lignes normalisées entre aperçu et application ; vidé après
  created_by      citext not null references users(email) on delete restrict,
  created_at      timestamptz not null default now(),
  committed_at    timestamptz,
  expires_at      timestamptz not null default now() + interval '2 hours',
  check ((status = 'committed') = (committed_at is not null))
);
create index imports_zone_ix on imports (zone_id, created_at desc);

-- ---------------------------------------------------------------------
-- Comptes, pages de site, commentaires
-- ---------------------------------------------------------------------
create table accounts (
  id           uuid primary key default uuid_generate_v7(),
  zone_id      text not null references zones(id) on delete restrict,
  name         text not null check (length(btrim(name)) between 1 and 200),
  segmentation text not null default '',
  sales_reps   text[] not null default '{}',
  tracked      boolean not null default true,     -- « scan activé »
  excluded     boolean not null default false,    -- exclu des règles (outlet, boutique officielle)
  status       record_status not null default 'active',
  archived_at  timestamptz,
  logo_url     text,
  created_by   citext references users(email) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   citext references users(email) on delete set null,
  updated_at   timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null)),
  unique (id, zone_id)                            -- cible des FK composites (cohérence de zone)
);
create unique index accounts_zone_name_active_ux on accounts (zone_id, lower(btrim(name))) where status = 'active';
create index accounts_zone_ix on accounts (zone_id, status, tracked);

create table account_sites (
  id            uuid primary key default uuid_generate_v7(),
  account_id    uuid not null,
  zone_id       text not null,
  currency      char(3) not null check (currency ~ '^[A-Z]{3}$'),   -- les prix de la page se comparent au RRP de cette devise
  url           text not null check (url ~* '^https?://[^[:space:]/]+\.[^[:space:]]+$'),
  label         text,
  position      smallint not null default 0,     -- 0 = page principale (STORE WEBSITE de l'export)
  enabled       boolean not null default true,
  platform      text,                             -- shopify, magento, salesforce-cc… (choix du parseur)
  fetch_options jsonb not null default '{}'::jsonb, -- ScrapingBee : render_js, premium_proxy, country_code, wait_for, pagination
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (account_id, zone_id) references accounts(id, zone_id) on delete cascade,
  unique (account_id, url),
  unique (id, account_id, zone_id)
);
create index account_sites_zone_currency_ix on account_sites (zone_id, currency) where enabled;

create table account_comments (
  id           uuid primary key default uuid_generate_v7(),
  account_id   uuid not null,
  zone_id      text not null,
  body         text not null check (length(btrim(body)) between 1 and 4000),
  author_email citext not null references users(email) on delete restrict,
  author_name  text not null,                     -- figé : le nom au moment du commentaire
  created_at   timestamptz not null default now(),
  foreign key (account_id, zone_id) references accounts(id, zone_id) on delete restrict
);
create index account_comments_account_ix on account_comments (account_id, created_at desc);
create index account_comments_zone_ix on account_comments (zone_id, created_at desc);
-- Suppression autorisée (par l'auteur, contrôle dans le Worker) ; pas de modification.
create trigger account_comments_no_update before update on account_comments
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------
-- Catalogue par zone
-- ---------------------------------------------------------------------
create table products (
  id               uuid primary key default uuid_generate_v7(),
  zone_id          text not null references zones(id) on delete restrict,
  sku              text not null check (sku ~ '^[A-Z0-9]{9}$'),   -- identité produit : 9 caractères
  variants         text[] not null default '{}'
                   check (variants <@ '{A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z}'::text[]),
  model            text not null default '',
  material         text not null default '',
  color            text not null default '',
  dept             text not null default '',
  season           text not null default '' check (season = '' or season ~ '^[A-Z0-9/]{2,8}$'),  -- AW26, SS27, C/O
  carry_over       boolean not null default false,
  max_discount_pct numeric(5,2) check (max_discount_pct between 0 and 100),  -- NULL = non contrôlé, 0 = non soldé
  segmentation     text,
  color_code       text,
  description      text,
  composition      text,
  origin           text,
  ean              text check (ean ~ '^[0-9]{8,14}$'),           -- premier EAN du fichier ; détail dans product_eans
  status           record_status not null default 'active',
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_by       citext references users(email) on delete set null,
  updated_at       timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null)),
  unique (zone_id, sku),
  unique (id, zone_id)
);
create index products_zone_model_ix on products (zone_id, model, color);
create index products_zone_season_ix on products (zone_id, season, carry_over);

create table product_prices (
  product_id uuid not null,
  zone_id    text not null,
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  kind       price_kind not null,
  amount     numeric(12,2) not null check (amount > 0),
  source     text not null default 'manual' check (source in ('import', 'manual')),
  import_id  uuid references imports(id) on delete set null,
  updated_by citext references users(email) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (product_id, currency, kind),
  foreign key (product_id, zone_id) references products(id, zone_id) on delete cascade
);
create index product_prices_zone_currency_ix on product_prices (zone_id, currency, kind);

create table product_eans (                        -- un EAN par taille/variante : clé de rapprochement la plus sûre
  ean        text primary key check (ean ~ '^[0-9]{8,14}$'),
  product_id uuid not null,
  zone_id    text not null,
  variant    text check (variant ~ '^[A-Z]$'),
  size_label text,
  import_id  uuid references imports(id) on delete set null,
  foreign key (product_id, zone_id) references products(id, zone_id) on delete cascade
);
create index product_eans_product_ix on product_eans (product_id);

-- ---------------------------------------------------------------------
-- Calendrier des soldes
-- ---------------------------------------------------------------------
create table sale_periods (
  id         uuid primary key default uuid_generate_v7(),
  zone_id    text not null references zones(id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 120),
  start_on   date not null,
  end_on     date not null,
  scan_mode  scan_mode not null default 'weekly',
  scan_days  smallint[] check (scan_days <@ '{1,2,3,4,5,6,7}'::smallint[]),  -- 1 = lundi … 7 = dimanche
  created_by citext references users(email) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_on >= start_on),
  check ((scan_mode = 'daily' and scan_days is null)
      or (scan_mode = 'weekly' and cardinality(scan_days) >= 1)),
  exclude using gist (zone_id with =, daterange(start_on, end_on, '[]') with &&)  -- pas de chevauchement dans une zone
);
create index sale_periods_zone_ix on sale_periods (zone_id, start_on);

-- ---------------------------------------------------------------------
-- Collecte : scans, scans par site, fiches produit vues
-- ---------------------------------------------------------------------
create table scans (
  id             uuid primary key default uuid_generate_v7(),
  zone_id        text not null references zones(id) on delete restrict,
  trigger_kind   scan_trigger not null,
  status         scan_status not null default 'queued',
  scheduled_for  date,                                   -- jour prévu (fuseau de la zone) ; NULL pour un scan manuel
  week_of        date not null check (extract(isodow from week_of) = 1),  -- lundi ISO, fuseau de la zone
  sale_period_id uuid references sale_periods(id) on delete set null,
  requested_by   citext references users(email) on delete set null,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  sites_total    integer not null default 0 check (sites_total >= 0),
  sites_done     integer not null default 0 check (sites_done >= 0),
  sites_failed   integer not null default 0 check (sites_failed >= 0),
  listings_seen  integer not null default 0,
  credits_used   integer not null default 0 check (credits_used >= 0),
  cost_estimate  numeric(12,4) check (cost_estimate >= 0),
  error          text,
  check (finished_at is null or started_at is not null),
  check (sites_done + sites_failed <= sites_total),
  unique (id, zone_id)
);
-- Idempotence du planificateur : un seul scan planifié par zone et par jour.
create unique index scans_scheduled_once_ux on scans (zone_id, scheduled_for) where trigger_kind = 'scheduled';
create index scans_zone_week_ix on scans (zone_id, week_of desc, status);

create table scan_sites (
  id                   uuid primary key default uuid_generate_v7(),
  scan_id              uuid not null,
  zone_id              text not null,
  site_id              uuid not null,
  account_id           uuid not null,
  status               scan_site_status not null default 'pending',
  started_at           timestamptz,
  finished_at          timestamptz,
  pages_fetched        integer not null default 0 check (pages_fetched >= 0),
  http_status          integer,
  credits_used         integer not null default 0 check (credits_used >= 0),   -- somme des en-têtes Spb-cost
  cost                 numeric(12,4) check (cost >= 0),
  listings_seen        integer not null default 0,
  listings_matched     integer not null default 0,
  listings_to_review   integer not null default 0,
  error                text,
  provider_request_ids text[],                                                  -- identifiants ScrapingBee
  raw_storage_path     text,                                                    -- HTML brut archivé (Storage), facultatif
  foreign key (scan_id, zone_id) references scans(id, zone_id) on delete cascade,
  foreign key (site_id, account_id, zone_id) references account_sites(id, account_id, zone_id) on delete restrict,
  unique (scan_id, site_id)
);
create index scan_sites_site_ix on scan_sites (site_id, started_at desc);
create index scan_sites_status_ix on scan_sites (scan_id, status);

create table listings (
  id                   uuid primary key default uuid_generate_v7(),
  zone_id              text not null,
  site_id              uuid not null,
  account_id           uuid not null,
  url_key              text not null,                  -- URL canonique (hôte + chemin, sans paramètres de suivi)
  url                  text not null,
  title                text not null default '',
  image_url            text,
  retailer_ref         text,                           -- référence affichée par le revendeur
  ean                  text,
  product_id           uuid,                           -- produit retenu (SKU confirmé)
  proof                proof_kind not null default 'to-review',
  candidate_product_id uuid,                           -- produit proposé quand le SKU n'est pas sûr
  candidate_confidence numeric(4,3) check (candidate_confidence between 0 and 1),
  match_kind           match_kind not null default 'none',
  status               listing_status not null default 'active',
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (site_id, account_id, zone_id) references account_sites(id, account_id, zone_id) on delete restrict,
  foreign key (product_id, zone_id) references products(id, zone_id) on delete set null,
  foreign key (candidate_product_id, zone_id) references products(id, zone_id) on delete set null,
  unique (site_id, url_key),
  unique (id, account_id, site_id, zone_id),
  check (proof = 'to-review' or product_id is not null),           -- confirmé ⇒ produit connu
  check (candidate_product_id is null or candidate_confidence is not null)
);
create index listings_product_ix on listings (zone_id, product_id) where status = 'active';
create index listings_account_ix on listings (account_id, status);
create index listings_review_ix on listings (zone_id, candidate_confidence desc) where proof = 'to-review' and status = 'active';

-- ---------------------------------------------------------------------
-- Historique append-only : relevés, évaluations, décisions, alias
-- ---------------------------------------------------------------------
create table observations (
  id             uuid primary key default uuid_generate_v7(),
  zone_id        text not null,
  listing_id     uuid not null,
  account_id     uuid not null,
  site_id        uuid not null,
  scan_id        uuid not null,
  scan_site_id   uuid not null references scan_sites(id) on delete restrict,
  observed_at    timestamptz not null default now(),
  week_of        date not null check (extract(isodow from week_of) = 1),   -- iso_week_start(observed_at dans le fuseau de la zone)
  currency       char(3) not null check (currency ~ '^[A-Z]{3}$'),       -- figée : devise de la page au moment du relevé
  price          numeric(12,2) not null check (price >= 0),              -- prix affiché (Site price)
  original_price numeric(12,2) check (original_price >= 0),              -- prix barré (Struck price), s'il y en a un
  title          text not null default '',
  url            text not null,
  image_url      text,
  in_stock       boolean,
  raw            jsonb,                                                  -- extrait brut du parseur, pour contestation
  foreign key (listing_id, account_id, site_id, zone_id) references listings(id, account_id, site_id, zone_id) on delete restrict,
  foreign key (scan_id, zone_id) references scans(id, zone_id) on delete restrict,
  unique (scan_site_id, listing_id)                                      -- un relevé par fiche et par passage
);
create index observations_listing_ix on observations (listing_id, observed_at desc);
create index observations_zone_week_ix on observations (zone_id, week_of desc, account_id);
create index observations_scan_ix on observations (scan_id);
create index observations_observed_brin on observations using brin (observed_at);
create trigger observations_append_only before update or delete on observations
  for each row execute function forbid_change();

create table review_decisions (
  id                  uuid primary key default uuid_generate_v7(),
  zone_id             text not null references zones(id) on delete restrict,
  listing_id          uuid not null references listings(id) on delete restrict,
  observation_id      uuid references observations(id) on delete set null,   -- relevé montré à l'utilisateur
  kind                review_kind not null,
  product_id          uuid,                 -- accepted : le candidat ; corrected : le SKU désigné ; no-match : NULL
  previous_product_id uuid,                 -- pour l'annulation
  decided_by          citext not null references users(email) on delete restrict,
  decided_at          timestamptz not null default now(),
  undone_at           timestamptz,          -- annulée par l'utilisateur, ou remplacée par une décision plus récente
  undone_by           citext references users(email) on delete restrict,
  foreign key (product_id, zone_id) references products(id, zone_id) on delete restrict,
  foreign key (previous_product_id, zone_id) references products(id, zone_id) on delete set null,
  check ((kind = 'no-match') = (product_id is null)),
  check ((undone_at is null) = (undone_by is null))
);
create index review_decisions_listing_ix on review_decisions (listing_id, decided_at desc);
create unique index review_decisions_active_ux on review_decisions (listing_id) where undone_at is null;
create index review_decisions_zone_ix on review_decisions (zone_id, decided_at desc);

create table observation_evaluations (
  id               uuid primary key default uuid_generate_v7(),
  observation_id   uuid not null references observations(id) on delete cascade,
  zone_id          text not null references zones(id) on delete restrict,
  evaluated_at     timestamptz not null default now(),
  cause            evaluation_cause not null,                 -- scan : au moment du relevé ; decision : après identification humaine
  decision_id      uuid references review_decisions(id) on delete set null,
  product_id       uuid,                                      -- produit utilisé pour l'évaluation (confirmé ou candidat)
  sku              text,                                      -- figé : SKU tel qu'évalué (survit à un renommage)
  proof            proof_kind not null,                       -- figé
  rrp              numeric(12,2) check (rrp > 0),             -- figé : RRP de la devise du relevé ; NULL = RRP manquant
  rule_pct         numeric(5,2) check (rule_pct between 0 and 100),  -- figé : remise autorisée du produit ; NULL = non contrôlé
  discount_pct     numeric(5,1) not null default 0 check (discount_pct between 0 and 100),
  reason           anomaly_reason,                            -- figé
  evaluation       evaluation_kind not null,
  account_excluded boolean not null default false,            -- figé : le compte était exclu des règles à ce moment
  is_current       boolean not null default true,
  superseded_at    timestamptz,
  foreign key (product_id, zone_id) references products(id, zone_id) on delete set null,
  check ((evaluation = 'anomaly') = (reason is not null)),
  check (reason is null or rule_pct is not null),
  check (evaluation <> 'rrp-missing' or rrp is null),
  check (evaluation <> 'unidentified' or product_id is null),
  check (is_current = (superseded_at is null))
);
create unique index observation_evaluations_current_ux on observation_evaluations (observation_id) where is_current;
create index observation_evaluations_product_ix on observation_evaluations (zone_id, product_id, evaluated_at desc) where is_current;
create trigger observation_evaluations_guard before update or delete on observation_evaluations
  for each row execute function evaluations_supersede_only();

create table product_aliases (                 -- ce que l'outil a appris des décisions humaines
  id          uuid primary key default uuid_generate_v7(),
  zone_id     text not null references zones(id) on delete restrict,
  site_id     uuid references account_sites(id) on delete cascade,   -- NULL : valable pour toute la zone (EAN, référence)
  kind        alias_kind not null,
  value       text not null check (length(value) between 1 and 2048),  -- valeur normalisée (URL canonique, titre en minuscules…)
  verdict     alias_verdict not null,
  product_id  uuid,
  decision_id uuid references review_decisions(id) on delete set null,
  created_by  citext references users(email) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (product_id, zone_id) references products(id, zone_id) on delete cascade,
  check ((verdict = 'product') = (product_id is not null))
);
create unique index product_aliases_ux on product_aliases
  (zone_id, kind, value, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index product_aliases_product_ix on product_aliases (product_id);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
create trigger zones_updated            before update on zones            for each row execute function set_updated_at();
create trigger user_preferences_updated before update on user_preferences for each row execute function set_updated_at();
create trigger accounts_updated         before update on accounts         for each row execute function set_updated_at();
create trigger account_sites_updated    before update on account_sites    for each row execute function set_updated_at();
create trigger products_updated         before update on products         for each row execute function set_updated_at();
create trigger product_prices_updated   before update on product_prices   for each row execute function set_updated_at();
create trigger sale_periods_updated     before update on sale_periods     for each row execute function set_updated_at();
create trigger listings_updated         before update on listings         for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Vues de lecture
-- ---------------------------------------------------------------------

-- Rules.excludedRetailerIds
create view zone_rules as
  select zone_id, array_agg(id order by name) filter (where excluded) as excluded_account_ids
  from accounts where status = 'active'
  group by zone_id;

-- ActivityItem : décisions actives ∪ commentaires
create view activity_feed as
  select d.id, d.zone_id, d.decided_at as at, d.kind::text as kind, l.title,
         a.name as retailer_name, u.display_name as by, null::text as note
  from review_decisions d
  join listings l on l.id = d.listing_id
  join accounts a on a.id = l.account_id
  join users u on u.email = d.decided_by
  where d.undone_at is null
  union all
  select c.id, c.zone_id, c.created_at, 'commented', '', a.name, c.author_name, c.body
  from account_comments c
  join accounts a on a.id = c.account_id;

-- État hebdomadaire : un relevé par fiche et par semaine (le dernier de la semaine), avec son évaluation courante.
-- Sert getWeek, listAnomalies, listProducts, listHistory, buildExport. À rafraîchir après chaque scan et chaque décision :
--   refresh materialized view concurrently weekly_listing_state;
create materialized view weekly_listing_state as
  select distinct on (o.listing_id, o.week_of)
         o.zone_id, o.week_of, o.listing_id, o.account_id, o.site_id,
         o.id as observation_id, o.observed_at, o.currency, o.price, o.original_price,
         e.product_id, e.sku, e.proof, e.rrp, e.rule_pct, e.discount_pct, e.reason, e.evaluation, e.account_excluded
  from observations o
  join observation_evaluations e on e.observation_id = o.id and e.is_current
  order by o.listing_id, o.week_of, o.observed_at desc;
create unique index weekly_listing_state_ux on weekly_listing_state (listing_id, week_of);
create index weekly_listing_state_zone_ix on weekly_listing_state (zone_id, week_of, account_id);
create index weekly_listing_state_product_ix on weekly_listing_state (zone_id, product_id, week_of);

-- ---------------------------------------------------------------------
-- Sécurité : RLS partout, aucune politique, aucun droit pour les clés publiques.
-- Le Worker Cloudflare utilise la clé service_role (BYPASSRLS) ; l'autorisation par zone est faite dans le Worker
-- à partir de user_zone_access.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
