# MAPA DEL SISTEMA (técnico, verificado contra el código y la base el 29-oct-2026)

> Todo lo de este archivo se sacó del código del repo y de consultas de solo lectura a la base de producción.
> Si algo cambió después, **el código manda**: verificá con `grep`/`ls` antes de confiar en un nombre.
> Mapa automático archivo por archivo (más fino que este): `supabase/functions/asistente-ia/mapa-codigo.ts`
> (se regenera con `npm run mapa`).

## 1. Arquitectura en una imagen

```
 Cliente (Chrome / APK)                       Personal (mismo sitio, ruta /admin)
        │                                              │
        ▼                                              ▼
 Cloudflare Worker «technoverse-cr»  ── sirve dist/ (Vite) y, ANTES de entregar el HTML,
 src/worker/index.ts + previo.ts         inyecta <script id="tv-previo"> con textos, ajustes,
        │                                banners y paleta (para que la tienda no parpadee)
        ▼
 React 19 (src/main.tsx → App.tsx) ── PublicStore.tsx (tienda) | AdminPanel.tsx (panel)
        │
        ▼
 Supabase «hzatdfrjcqiimgqxcwwh»:  Postgres (+RLS)  ·  Auth  ·  Storage  ·  Realtime  ·  Edge Functions
```

La **APK** (`com.technoverse.admin`) es la MISMA app web empaquetada con Capacitor 8 (`webDir: dist`), con
complementos nativos propios en `native-android/` (teléfono, Phill/Jarvis, captura) y actualización OTA
(`@capgo/capacitor-updater`, bucket `ota-updates`).

## 2. Carpetas del repo

| Ruta | Qué hay |
|---|---|
| `src/main.tsx`, `src/App.tsx` | Arranque, sesión, candados, decide tienda o panel. |
| `src/components/PublicStore.tsx` | La tienda entera (catálogo, carrito, checkout SINPE, cuenta del cliente). |
| `src/components/store/` | `BannerPrincipal`, `BannersTienda` (cintillo, campaña, divisor, cuadrícula, emergente), `PieDePagina`, `AvisoCookies`, `AyudaUbicacion`. |
| `src/components/ProductCard.tsx` | Tarjeta de producto (vitrina `.tv-prod-foto`). |
| `src/components/AdminPanel.tsx` | El panel: monta cada módulo según `activeTab`. |
| `src/components/admin/` | Piezas del panel: `adminNav.ts` (menú), `AdminKit.tsx` (botones, tarjetas, campos), `GestorBanners`, `EstudioPauta` (Javier + IA), `crm/`, `cerebro/`, consolas de seguridad, Phill/Jarvis. |
| `src/components/chat/` | Chat del personal (bandeja, hilos, adjuntos, audio, respuestas rápidas). |
| `src/components/LiveChat.tsx` | Chat flotante del cliente en la tienda. |
| `src/components/InventarioControl.tsx` | Inventario (productos, repuestos, insumos, movimientos, reportes). |
| `src/components/FacturacionPanel.tsx` | Cobros (venta de inventario / reparación, factura, correo). |
| `src/components/TallerKanban.tsx` | Taller (tablero de reparaciones). |
| `src/components/CyberSecurityPanel.tsx` | Ciberseguridad (10 apartados). |
| `src/components/security/` | Contraseña, PIN, patrón, reautenticación. |
| `src/cms/` | Edición en vivo de textos/colores/íconos de la tienda (`ModoEdicion`, `TextoEditable`…). |
| `src/mobile/` | Todo lo de la APK: `otaUpdater`, `appLock`, `telefonoNativo`, `pushNativo`, widget de Phill… |
| `src/seguridad/` | Anti-captura, FLAG_SECURE, kill switch. |
| `src/utils/` | Lógica: `storage.ts` (datos), `crm*.ts`, `whatsapp.ts`, `quitarFondo.ts`, `dinero.ts`, `invoicePdf.ts`, `facturacion.ts`, `roles.ts`, `bannerEstado.ts`… |
| `src/styles/` | CSS por área (`admin.css`, `crm.css`, `paletas.css`…); tokens de color en `src/index.css`. |
| `src/worker/` | El Worker de Cloudflare (`index.ts`, `previo.ts`). |
| `supabase/*.sql` | Migraciones (66 archivos). **Ojo**: `reset_produccion.sql` y `reset_datos_prueba.sql` NO se corren en producción. |
| `supabase/pruebas/*.sql` | Pruebas de las migraciones de seguridad (las corre el CI en una réplica local). |
| `supabase/functions/` | Código de 4 funciones del servidor (ver §7). |
| `native-android/` | Código Java/Kotlin que el CI copia a la APK. |
| `scripts/` | `mapa-codigo.mjs`, `validar-paletas.mjs`, `buscar-secretos.mjs`, `probar-api-publica.mjs`, `probar-crm.mjs`, `renombrar-facturas-publicas.mjs`, `verificar-hooks.sh`. |
| `docs/` | `seguridad.md` (estado de la auditoría) y esta guía. |

## 3. Comandos (`package.json`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | Vite en el puerto 3000 (desarrollo local). |
| `npm run build` | Compila a `dist/`. **Obligatorio que pase antes de fusionar.** |
| `npm run lint` | = `tsc --noEmit`. **Obligatorio que pase.** |
| `npm run mapa` | Regenera el mapa del código para Javier. |
| `npm run paletas` | Contraste WCAG AA de todas las paletas (si tocaste colores). |
| `npm run secretos` | Falla si encuentra una llave secreta en el repo. |
| `npm run probar-api` | Prueba que un visitante sin sesión no vea datos privados (usa la llave pública). |
| `npm run probar-crm` | Pruebas de la lógica del CRM. |

## 4. Módulos del panel (`src/components/admin/adminNav.ts`)

La ruta es `/admin/<id>`. `id` = `activeTab`.

| Módulo | id (ruta) | Carpetas | Archivo principal |
|---|---|---|---|
| Panel general | `dashboard` | — | `admin/AdminDashboard.tsx` |
| Inventario | `inventario_productos` | `inventario_productos`, `_repuestos`, `_insumos`, `_movimientos`, `_reportes` | `InventarioControl.tsx` |
| Chat | `chat` | — | `components/chat/*` |
| CRM | `crm_embudo` | `crm_embudo`, `crm_seguimiento`, `crm_segmentos`, `crm_respuestas`, `crm_metricas` | `admin/crm/CrmModulo.tsx` |
| Taller | `taller` | — | `TallerKanban.tsx` |
| Clientes | `clientes` | — | dentro de `AdminPanel.tsx` (la ficha de cada uno: `ClienteFicha.tsx`) |
| Cobros | `cobros` | — | `FacturacionPanel.tsx` |
| Contabilidad | **`facturacion`** (no «contabilidad») | — | dentro de `AdminPanel.tsx` |
| Marketing | `marketing` | — | `EstudioPauta.tsx`, `GestorBanners.tsx` |
| Ciberseguridad | `ciberseguridad` | 10 apartados internos (riel `.sg-riel`) | `CyberSecurityPanel.tsx` |
| Configuración | `configuracion` | — | dentro de `AdminPanel.tsx` |
| Supervisión | `supervision` | — | `admin/ConsolaSupervision.tsx` (solo supremo) |
| Ubicaciones | `ubicaciones` | — | `admin/PanelUbicaciones.tsx` (mapa Leaflet) |
| Ingresos | `ingresos` | — | `admin/ConsolaIngresos.tsx` (solo supremo) |
| Bloqueos | `bloqueos` | — | `admin/ConsolaBloqueos.tsx` (solo supremo) |
| Gestión de usuarios | `gestion_usuarios` | — | `admin/GestionUsuariosPanel.tsx` (solo supremo) |

## 5. Roles (`src/utils/roles.ts`; la barrera real es RLS en la base)

| Rol | Quién | Puede |
|---|---|---|
| `superadmin` | Solo `technoverse.admin@gmail.com` («administrador supremo», `esAdminSupremo` en `utils/securityPin.ts`) | Todo, incluidos Supervisión, Ingresos, Bloqueos y Gestión de usuarios. |
| `admin` | Administración | Gestión (`esGestion`): ajustes, editar la tienda, cuentas. |
| `empleado` | Personal | Opera el panel sin gestión. |
| `Cliente` | Comprador | Solo la tienda; nunca el panel. |

En la base: `is_staff()`, `is_owner()` (= gestión), `es_visitante()`, `limitar_uso()`.

## 6. Base de datos (Postgres, esquema `public`, 64 tablas)

| Grupo | Tablas |
|---|---|
| Tienda e inventario | `products`, `product_components`, `historical_skus`, `inventory_movements`, `device_catalog`, `contenido_sitio`, `app_settings`, `app_settings_privado` |
| Ventas y facturación | `orders`, `payments`, `invoices`, `invoice_counters`, `comprobantes_emisor`, `logistics_deliveries` |
| Banners y marketing | `banners`, `banner_metricas`, `marketing_campaigns`, `marketing_requests`, `pautas` |
| CRM | `crm_leads`, `crm_eventos`, `crm_recordatorios`, `crm_respuestas_rapidas`, `crm_segmentos` |
| Clientes y chat | `client_profiles`, `chat_conversations`, `chat_messages`, `ubicaciones_compartidas`, `legal_privacy_settings` |
| Taller | `repair_orders` |
| Cuentas | `profiles` (rol), `user_credentials`, `webauthn_challenges` |
| Seguridad | `security_login_events`, `login_audit_logs`, `audit_logs`, `registro_seguridad`, `known_devices`, `banned_ips`, `banned_devices`, `blocked_users_list`, `system_bans`, `ip_whitelist`, `dlp_whitelist`, `limites_uso` |
| Supervisión y visitas | `supervision_events`, `supervision_state`, `supervision_visitantes`, `visitor_fingerprints`, `visitor_visit_log` |
| Javier / IA | `ia_acciones`, `ia_ajustes`, `ia_conversaciones`, `ia_mensajes`, `ia_descartes`, `ia_uso_diario`, `ia_widget_llaves`, `jarvis_agenda`, `jarvis_avisos`, `jarvis_cron`, `jarvis_enlaces`, `jarvis_eventos`, `jarvis_memoria`, `jarvis_nodos` |

Reglas de datos que conviene saber:
- `crm_leads.canal` ∈ `chat_web, tienda_form, registro, pedido, taller, manual, whatsapp` (check `crm_leads_canal_check`).
- `crm_eventos`: el personal solo puede insertar `tipo` `nota` o `contacto` (política `crm_eventos_crear`).
- `orders.status` ∈ `Completado, Devuelto, Cancelado`; `payment_method` ∈ `SINPE, Tarjeta, Efectivo`.
- `invoices`: inmutables (sin update/delete para nadie desde la API). El consecutivo lo da `issue_invoice` con
  `invoice_counters` (atómico). Las facturas 1-5 de la serie 01 se borraron antes del blindaje (hueco permanente).
- `products.visible_en_tienda` solo importa para **insumos**; los productos normales se muestran si tienen stock > 0
  y no son repuestos.

**Buckets de Storage** (todos públicos para leer por URL; escribir según políticas):

| Bucket | Límite | Tipos | Uso |
|---|---|---|---|
| `productos` | 3 MB | webp, png, jpeg, svg | Fotos del catálogo (`catalogo/PROD-…`). |
| `marketing` | 8 MB | png, jpeg, webp, mp4 | Piezas de pauta y banners (`pautas/…`). No se puede listar: subir con nombre nuevo y `upsert: false`. |
| `invoices` | 2 MB | pdf | Comprobantes (`FE-<consecutivo>-<16 hex>.pdf`). |
| `chat-images` | 25 MB | imagen, video, audio | Adjuntos del chat. |
| `ota-updates` | — | — | Paquetes OTA de la APK. |

**Funciones RPC que llama el código** (grep de `rpc('…')`): `issue_invoice`, `set_invoice_pdf`, `adjust_stock`,
`redeem_coupon`, `crm_registrar_contacto`, `banner_evento`, `registrar_ubicacion`, `registrar_ingreso`,
`registrar_huella`, `visitante_latido`/`_mirar`/`_ocultar`, `banear_dispositivo`, `banear_cliente_total`,
`levantar_baneo_cliente`, `levantar_dispositivo`, `estoy_bloqueado`, `mi_estado_de_acceso`, `mi_sesion_vigente`,
`has_security_pin`, `set_security_pin`, `verify_security_pin`, `change_security_pin`, `admin_reset_security_pin`,
`admin_list_duenos`, chat (`get_customer_chat`, `chat_visitante_presente`, `chat_marcar_exclusivo`,
`borrar_mensaje_chat`, `purgar_conversacion`, `purgar_chats`), purgas (`purgar_bitacora`, `purgar_login_audit_logs`),
avisos (`registrar_dispositivo_push`, `quitar_dispositivo_push`, `registrar_avisos_web`, `quitar_avisos_web`),
Instagram (`guardar_webhook_instagram`, `leer_webhook_instagram`, `webhook_instagram_configurado`), IA
(`ia_uso_de_hoy`, `ia_consultas_de_hoy`), `conteo_historial`.

## 7. Funciones del servidor (Edge Functions de Supabase) — ¡ATENCIÓN!

| Función | ¿Código en el repo? | Para qué (según el código que la llama) |
|---|---|---|
| `asistente-ia` | Sí | Javier: chat, pauta (textos), imágenes con IA. |
| `autocompletar-producto` | Sí | «Auto-completar datos» en el formulario de producto. |
| `consultar-cedula` | Sí | Consulta a Hacienda por cédula (Cobros). |
| `send-invoice-email` | Sí | Manda el comprobante por Gmail SMTP; modo prueba solo para personal. |
| `admin-login` | **NO** | Portero del acceso: bloquea la IP tras 3 fallos en 15 min, registra cada intento con ubicación (`registrar_intento_login`), acciones `mi-ip` y `estado`. `verify_jwt=false`. |
| `admin-clientes` | **NO** | Gestión de clientes desde el panel. |
| `admin-force-password-reset` | **NO** | Restablecer contraseña de otra cuenta (Gestión de usuarios). |
| `create-admin-user` | **NO** | Crear administradores (Configuración). |
| `webauthn` | **NO** | Huella/llave de acceso (biometría). `verify_jwt=false`. |
| `jarvis-widget` | **NO** | La ventanita/widget de Phill. `verify_jwt=false`. |

**Riesgo**: 6 funciones solo existen desplegadas en Supabase. Para traer su código al repo (recomendado):
con el conector de Supabase de Claude (`get_edge_function`), o con la Supabase CLI:
`npx supabase login` (token de Dashboard → Account → Access Tokens) y
`npx supabase functions download <nombre> --project-ref hzatdfrjcqiimgqxcwwh`. Revisar con `npm run secretos`
antes de subir. Desplegar una función: `npx supabase functions deploy <nombre> --project-ref hzatdfrjcqiimgqxcwwh`.

Secretos del servidor (solo nombres, nunca valores): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, más las llaves de IA. En GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
y los del build de Android/OTA.

## 8. Publicación (`.github/workflows/`)

| Workflow | Se dispara | Hace |
|---|---|---|
| `seguridad.yml` | Cada PR, cada push a `main`, lunes 9:17 UTC | Job `codigo`: `npm run lint` (tsc), `paletas`, `secretos`, `probar-crm`, `probar-api` (**no compila**: el `npm run build` lo tenés que correr vos). Job `base-de-datos`: réplica Postgres + todas las `supabase/pruebas/*.sql`. Job `api-publica`. |
| `deploy-cloudflare.yml` | Push a `main` | `npm run build` + `wrangler deploy` (cloudflare/wrangler-action). Además Cloudflare tiene **Workers Builds** conectado al repo (aparece como check «Workers Builds: technoverse-cr»). |
| `ota-publish.yml` | Push a `main` que toque `src/`, `public/`, html, config | Sube el paquete web al bucket `ota-updates` para la APK. |
| `build-android.yml` | Push a `main` | Compila la APK de depuración; artefacto `technoverse-admin-debug-apk`. |
| `build-ios.yml` | Push a `main` | Build de iOS sin firmar. |

## 9. Piezas clave para cambios frecuentes

| Querés cambiar… | Mirá |
|---|---|
| Textos/colores editables de la tienda | `src/cms/*`, tabla `contenido_sitio`, `src/worker/previo.ts` |
| Paletas de color | `src/index.css`, `src/styles/paletas.css`, `src/utils/paleta.ts` → `npm run paletas` |
| Banners | `components/store/BannerPrincipal.tsx`, `BannersTienda.tsx`, `admin/GestorBanners.tsx`, `utils/bannerEstado.ts` (`esPiezaDisenada`) |
| WhatsApp | `src/utils/whatsapp.ts` (`abrirWhatsApp`, `enlaceWhatsApp`), `mobile/telefonoNativo.ts` |
| Fotos de producto | `src/utils/quitarFondo.ts`, `storage.ts` (`prepararFotoProducto`, `recortarMargenes`, `compressImage`) |
| Precios | `src/utils/dinero.ts` (`colones`, `miles`) — usar SIEMPRE esto |
| Factura / PDF | `utils/invoicePdf.ts`, `utils/facturacion.ts`, función SQL `issue_invoice`, Edge `send-invoice-email` |
| CRM | `utils/crm.ts` (API), `utils/crmLogica.ts` (lógica pura), `components/admin/crm/*` (`CrmWhatsApp.tsx` = vender por chat) |
| Entrar / sesión / candados | `App.tsx`, `mobile/appLock.ts` (5 min web), `utils/biometriaNativa.ts`, `components/security/*` |
| Ajuste de textos largos | `utils/ajustarTexto.ts` (`instalarAjusteGlobal`), clase `tv-1l`, `data-ajustar` |
