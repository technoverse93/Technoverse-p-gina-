-- ===========================================================================
-- VISITANTES OCULTOS AL PERSONAL (oct 2026)
-- ===========================================================================
-- YA EJECUTADO en la base (lo corrió el dueño en el SQL Editor; verificado).
--
-- El superadmin puede marcar un aparato de Visitantes como "oculto al
-- personal": la política de lectura se lo esconde al resto de las cuentas
-- del personal, y solo el superadmin puede poner o quitar la marca
-- (`visitante_ocultar`). Se deja marcado el GFY-LX3, que lo pidió el dueño.
--
-- Alcance honesto: la marca va por identidad de aparato (`huella`). Si ese
-- teléfono borra los datos del navegador, aparece como identidad nueva y
-- habrá que volver a ocultarla desde Visitantes.
-- ===========================================================================

alter table public.visitor_fingerprints
  add column if not exists oculto_personal boolean not null default false;

drop policy if exists "dueño lee huellas" on public.visitor_fingerprints;
drop policy if exists "personal lee huellas visibles" on public.visitor_fingerprints;
create policy "personal lee huellas visibles" on public.visitor_fingerprints
  for select using ((select public.is_superadmin()) or ((select public.is_staff()) and not oculto_personal));

create or replace function public.visitante_ocultar(p_huellas text[], p_ocultar boolean)
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_n integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo el superadmin puede ocultar visitantes al personal.';
  end if;
  update public.visitor_fingerprints set oculto_personal = coalesce(p_ocultar, false)
   where huella = any(p_huellas);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.visitante_ocultar(text[], boolean) from public, anon;
grant execute on function public.visitante_ocultar(text[], boolean) to authenticated;

update public.visitor_fingerprints set oculto_personal = true where dispositivo = 'GFY-LX3';
