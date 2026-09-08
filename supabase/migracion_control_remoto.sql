-- =====================================================================
-- CONTROL REMOTO ASISTIDO — canal de entrada (admin → objetivo)
-- =====================================================================
-- Hermano del espejo (migracion_hotfix_supervision.sql y
-- migracion_supervision_clientes.sql), pero al REVÉS. El espejo lleva el
-- DOM del objetivo HACIA el superadmin para que lo VEA; el control lleva
-- los clics/scroll/texto del superadmin HACIA el objetivo para que él los
-- APLIQUE en su propia sesión. La pantalla del superadmin nunca viaja: lo
-- único que sale de su lado es el comando de entrada.
--
-- Canales, con la misma llave que el espejo:
--   control:<uid>    → sesión de un empleado (dispositivo empresarial).
--   control:v:<id>   → sesión de un cliente anónimo de la tienda.
--
-- LA REGLA DE ORO DE ESTE CANAL: ENVIAR es SOLO del superadmin.
-- ---------------------------------------------------------------------
-- A diferencia del espejo —donde el propio objetivo ENVÍA su DOM—, aquí
-- un comando es una acción autoritativa sobre el aparato de otra persona.
-- Si cualquiera pudiera insertar, cualquiera podría manejar la sesión
-- ajena. Por eso el INSERT queda amarrado a `is_superadmin()`, incluso en
-- el canal del visitante (que para RECIBIR sí es abierto por id aleatorio,
-- igual que el espejo del visitante).
--
-- Empleados: NO hay consentimiento por sesión. La autorización nace del
-- vínculo laboral sobre equipo empresarial (ver src/supervision/grabador.ts
-- y controlRemoto.ts) — al iniciar sesión el receptor queda armado. El
-- objetivo SIEMPRE ve un indicador de "soporte activo" mientras dura.
-- Clientes: sí autorizan explícitamente desde el pie de página antes de
-- que el receptor se arme (ver components/store/SoporteRemoto.tsx).
-- =====================================================================

-- RECIBIR (select): el empleado dueño del canal, o el superadmin, en
-- cualquier canal de control del personal.
drop policy if exists control_recibir_personal on realtime.messages;
create policy control_recibir_personal on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'control:%'
    and (
      public.is_superadmin()
      or realtime.topic() = 'control:' || auth.uid()::text
    )
  );

-- RECIBIR (select) en el canal del visitante: abierto por id aleatorio,
-- mismo compromiso asumido que el espejo del visitante. Lo que se recibe
-- son comandos de entrada, no datos personales.
drop policy if exists control_recibir_visitante on realtime.messages;
create policy control_recibir_visitante on realtime.messages
  for select to anon, authenticated
  using (realtime.topic() like 'control:v:%');

-- ENVIAR (insert): ÚNICAMENTE el superadmin, a cualquier canal de control.
drop policy if exists control_enviar on realtime.messages;
create policy control_enviar on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'control:%'
    and public.is_superadmin()
  );
