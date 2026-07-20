-- Technoverse: purga de esquema (Empleados, Nóminas, Membresías)
-- Ejecutar en el Editor SQL de Supabase

begin;

drop table if exists public.payroll;
drop table if exists public.employees;
drop table if exists public.membership_tiers;

drop function if exists public.is_accountant();

alter table public.profiles drop column if exists employee_role;
alter table public.profiles drop column if exists membership_tier;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['Dueño'::text, 'Cliente'::text]));

alter table public.client_profiles drop column if exists membership_tier;

alter table public.products drop column if exists applicable_memberships;

alter table public.chat_conversations drop column if exists membership_level;

commit;
