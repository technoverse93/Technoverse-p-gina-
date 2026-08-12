-- ===========================================================================
-- IDENTIFICACIÓN DEL EMISOR — Technoverse Costa Rica
-- ===========================================================================
-- Fija 119090965 como identificación del vendedor en toda la facturación.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HACE FALTA CORRER ESTO Y NO BASTA CON CAMBIAR EL CÓDIGO
-- ---------------------------------------------------------------------------
-- La identificación que sale impresa en cada comprobante NO la pone el
-- frontend: la devuelve la función `issue_invoice()` leyéndola de
-- `app_settings`, y desde ahí viaja al PDF y al QR de verificación. Es lo
-- correcto —el dato fiscal debe salir de un único sitio, no de una constante
-- repartida por las pantallas—, pero significa que cambiarlo es un UPDATE en
-- la base, no una edición de código.
--
-- Mientras esta consulta no se ejecute, los comprobantes seguirán llevando la
-- identificación anterior por mucho que la interfaz muestre otra cosa.
--
-- ---------------------------------------------------------------------------
-- SOBRE EL NOMBRE DE LA COLUMNA
-- ---------------------------------------------------------------------------
-- La columna se llama `cedula_juridica` por razones históricas. NO se le
-- cambia el nombre a propósito: renombrarla obligaría a tocar `issue_invoice`,
-- `app_settings`, storage.ts y las políticas RLS a la vez, y cualquier pieza
-- que se quedara atrás rompería la emisión de facturas el mismo día del
-- lanzamiento. El nombre de una columna no sale impreso en ningún lado; su
-- CONTENIDO sí, y es lo que se corrige aquí.
--
-- ---------------------------------------------------------------------------
-- CÓMO EJECUTARLO
-- ---------------------------------------------------------------------------
--   Panel de Supabase → SQL Editor → pegar TODO → Run.
-- ===========================================================================

begin;

-- app_settings guarda una sola fila de configuración. El `where true` es para
-- que el editor no advierta de un UPDATE sin filtro: es deliberado.
update app_settings
   set cedula_juridica = '119090965'
 where true;

commit;

-- ===========================================================================
-- VERIFICACIÓN — debe devolver exactamente 119090965
-- ===========================================================================
select cedula_juridica as identificacion_emisor from app_settings;

-- Y este es el valor que llevará la próxima factura emitida. Si aquí sale
-- algo distinto, la emisión está leyendo de otro sitio y hay que revisar
-- `issue_invoice()` antes de facturar en real.
