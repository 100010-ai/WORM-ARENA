-- Historical compatibility marker.
-- The exact live migration converted an early auth.users-backed schema to guest sessions.
-- The repository baseline (20260824151855) already creates the effective guest-session
-- schema directly for fresh installs, so no DDL is required here.
select 1;
