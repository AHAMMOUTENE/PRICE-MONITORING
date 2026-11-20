-- Rythme habituel des scans d'une zone (hors périodes de soldes) : jours de la semaine, 1 = lundi … 7 = dimanche. Par défaut : le lundi.
-- L'heure du scan est déjà dans zones.scan_time. Ajout sans effet sur les données existantes ; peut être relancé.
alter table zones add column if not exists default_scan_days smallint[] not null default '{1}'
  check (default_scan_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(default_scan_days) >= 1);
