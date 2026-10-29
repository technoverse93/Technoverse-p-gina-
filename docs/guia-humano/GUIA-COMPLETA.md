# GUÍA COMPLETA DE TECHNOVERSE — para el dueño, desde cero

> Escrita el 29 de octubre de 2026. Todo lo que dice acá está comprobado en el sistema real.
> Si algo cambió después, la IA que trabaje con vos tiene que actualizar esta guía (está en el repositorio en
> `docs/guia-humano/GUIA-COMPLETA.md` y en el escritorio del Linux, carpeta `Guia-para-IA`).
>
> **Regla de oro**: nunca escribas tu contraseña en ningún archivo ni se la pegues a una IA en un chat público.
> Si alguna vez la compartiste, cambiala (Parte 11).

---

## ÍNDICE

1. Qué es cada pieza (explicado simple)
2. Tus direcciones y cuentas
3. La tablet de trabajo: el Linux paso a paso
4. OpenCode: tu programador de IA, paso a paso
5. Claude Code (si lo volvés a tener)
6. Cómo se publica un cambio en la página
7. El panel, módulo por módulo
8. Tareas del día a día, paso a paso
9. La app del teléfono (APK)
10. Problemas comunes y cómo resolverlos
11. Seguridad
12. Lo que está pendiente y te toca decidir
13. Glosario

---

## PARTE 1 — QUÉ ES CADA PIEZA (explicado simple)

Imaginá tu negocio como una tienda física:

| Pieza | Qué es en la tienda física | Qué es de verdad |
|---|---|---|
| **La tienda web** | La vitrina y el mostrador donde el cliente mira y compra | La página https://technoverse-cr.technoversecr.workers.dev |
| **El panel** | La oficina de atrás | La misma página, en la dirección que termina en `/admin`. Solo entra el personal. |
| **La base de datos (Supabase)** | El archivador donde guardás todo | Un servicio en internet que guarda productos, clientes, ventas, facturas, chats, banners… |
| **El código (GitHub)** | Los planos de la tienda | Los archivos con que está hecha la página. Viven en GitHub, en el repositorio `technoverse93/Technoverse-p-gina-`. |
| **Cloudflare** | El edificio donde está la tienda | El servicio que pone la página en internet. Cada vez que se aprueba un cambio en GitHub, Cloudflare publica la página nueva solo. |
| **La APK** | Una sucursal de bolsillo | La app de Android «Technoverse Admin». Es la misma página, empaquetada como app, con extras del teléfono (huella, avisos, Phill). |
| **Javier / Phill** | Un asistente que trabaja en la oficina | La inteligencia artificial que vive dentro del panel (te ayuda a escribir pautas, responde preguntas del negocio). |
| **La tablet con Linux** | Tu taller de herramientas | Tu tablet Xiaomi tiene adentro una computadora Linux (Ubuntu) donde viven las IA que programan la página: Claude Code y OpenCode. |
| **OpenCode / Claude Code** | Los programadores que contratás | Inteligencias artificiales que cambian el código de la página por vos, lo prueban y lo publican. |

**Cómo viaja un cambio** (por ejemplo, «cambiá el color de un botón»):
vos se lo pedís a OpenCode → OpenCode cambia el código en la tablet → lo sube a GitHub → GitHub revisa que no se
rompa nada → se aprueba → Cloudflare publica la página nueva (1 a 3 minutos) → la app del teléfono se actualiza sola
(la próxima vez que la abrís).

---

## PARTE 2 — TUS DIRECCIONES Y CUENTAS

| Para qué | Dirección | Cuenta |
|---|---|---|
| Ver la tienda | https://technoverse-cr.technoversecr.workers.dev | (cualquier persona) |
| Entrar al panel | La misma dirección → icono de persona arriba a la derecha → tu correo y contraseña | `technoverse.admin@gmail.com` (administrador supremo) |
| El código | https://github.com/technoverse93/Technoverse-p-gina- | cuenta de GitHub `technoverse93` |
| La base de datos | https://supabase.com/dashboard/project/hzatdfrjcqiimgqxcwwh | tu cuenta de Supabase |
| Cloudflare | https://dash.cloudflare.com (cuenta de `technoverse.admin@gmail.com`) | **Ojo**: si entrás «con GitHub» te puede abrir una cuenta vieja vacía (Genarolopez). Entrá con **Google** y el correo `technoverse.admin@gmail.com`. |
| WhatsApp / SINPE de la tienda | +506 6421 4795 | — |

Quién puede qué en el panel:
- **Administrador supremo** (`technoverse.admin@gmail.com`): todo. Es el único que ve Supervisión, Ingresos,
  Bloqueos y Gestión de usuarios.
- **Admin**: administra (ajustes, editar la tienda, cuentas).
- **Empleado**: trabaja el día a día, sin ajustes ni cuentas.
- **Cliente**: solo la tienda.

---

## PARTE 3 — LA TABLET DE TRABAJO: EL LINUX PASO A PASO

### 3.1 Encender el Linux
1. En la pantalla de inicio de Android buscá el **widget de Termux** (un recuadro blanco que dice «Termux» con dos
   opciones).
2. Tocá **`tasks/Escritorio`**. Aparece un aviso «Abriendo escritorio…» y a los segundos se abre la app
   **Termux:X11** con el escritorio de Linux.
   - Si ya estaba abierto, solo lo trae al frente y avisa «El escritorio ya estaba abierto».
   - Si algo falla, el aviso te dice qué pasó. Lo que pasó queda anotado en el archivo `escritorio.log` de la
     memoria del teléfono.
3. Para cerrarlo y liberar memoria: widget → **`tasks/Salir de Linux`**, o el icono **«Salir a Android»** del
   escritorio. Las IA que estén trabajando **no se cierran** (viven aparte).

### 3.2 Los iconos del escritorio

| Icono | Para qué |
|---|---|
| **OpenCode** | Abre OpenCode, tu programador de IA (Parte 4). |
| **Claude Code** | Abre Claude Code (Parte 5). |
| **Activar conexion adb** | Vuelve a conectar la IA con la tablet (para que pueda tocar la pantalla, abrir Chrome y probar). Usalo cuando la IA te diga «ADB se cayó». |
| **Navegador** | Abre el navegador de Linux. |
| **Archivos** | Las carpetas del Linux. |
| **Tarjeta SD** | La memoria del teléfono (fotos, descargas). |
| **Terminal** | La pantalla negra de comandos (solo si sabés lo que hacés o una IA te lo indica). |
| **VS Code** | Editor de código. |
| **LibreOffice** | Documentos, hojas de cálculo. |
| **VLC** | Videos y música. |
| **Instalar programas** | Tienda de programas de Linux (Synaptic). |
| **Guía: instalar programas** / **Guía Kali** | Guías escritas antes. |
| **Herramientas de seguridad** | Menú de herramientas de seguridad (Kali). |
| **Liberar memoria** | Cierra apps de Android en segundo plano para que todo vaya más fluido. |
| **Vigilar recursos** | Refuerza cada 10 min los permisos para que Android no frene el escritorio. |
| **Guia-para-IA** (carpeta) | Esta guía y la de las IA. |

### 3.3 Cosas que conviene saber de la tablet
- Tiene poca memoria: si se pone lenta, usá **Liberar memoria**.
- Cargala mientras las IA trabajan (si la batería se acaba, todo se corta).
- Si la IA dice que «ADB se cayó» o «Connection refused»: tocá **Activar conexion adb** y decile «listo».
- Si la pantalla gira, a la IA le cambian las coordenadas para tocar: avisale si giraste la tablet.

---

## PARTE 4 — OPENCODE: TU PROGRAMADOR DE IA, PASO A PASO

OpenCode es una IA que programa. En esta tablet ya está instalado y **configurado para este proyecto**: cada vez
que lo abrís, lee solo las reglas del negocio, la guía técnica, el estado actual y la bitácora. Así sabe qué se hizo
antes, qué falta y qué no puede tocar sin tu permiso.

### 4.1 Abrirlo
1. Encendé el Linux (3.1).
2. Tocá el icono **OpenCode**. Se abre una ventana de terminal con OpenCode, ya parado en la carpeta del proyecto,
   y retoma la última conversación.
3. Si cerrás la ventana, OpenCode **sigue vivo** por detrás (vive en una «sesión» llamada `oc`). Al volver a tocar
   el icono, aparece donde lo dejaste.

### 4.2 Primer mensaje de cada día: `/inicio`
Escribí **`/inicio`** y Enter. OpenCode va a:
1. Bajar los últimos cambios del código.
2. Leer la bitácora y el estado actual.
3. Contarte en pocas líneas dónde quedó el trabajo y qué sigue.

### 4.3 Pedirle cambios (ejemplos de cómo pedir)
Hablale normal, en español, y sé concreto:
- «Cambiá el texto del botón *Comprar* por *Lo quiero* en la tienda y publicalo.»
- «El banner del iPhone ya no lo quiero: quitalo de la tienda.» (borrar datos de la base: te va a pedir permiso)
- «En el carrito, el total sale cortado en el teléfono. Revisalo en la tablet y arreglalo.»
- «Agregá el producto X con este precio…» (cargar productos lo podés hacer vos desde el panel, Parte 8.1)

Lo que OpenCode hace solo (tenés autorización permanente dada): cambiar el código, revisarlo, subirlo a GitHub,
aprobarlo y publicarlo.
Lo que **siempre te va a preguntar antes**: tocar datos de la base en producción, dar o quitar accesos, emitir
facturas reales, mandar mensajes reales a clientes.

### 4.4 Último mensaje de cada día: `/cierre`
Escribí **`/cierre`**. OpenCode anota en la bitácora lo que hizo, lo que quedó a medias y qué sigue, y lo sube al
repositorio. **Hacelo siempre**: es lo que permite que mañana (o Claude, si vuelve) siga sin perderse.

### 4.5 Otros comandos útiles
- **`/estado`**: te resume los pendientes y las decisiones que te tocan.
- **`/help`**: muestra los comandos de OpenCode.
- **`/models`**: cambiar de modelo de IA. Hoy solo hay **modelos gratis** (por ejemplo DeepSeek). Si un día pagás
  un modelo mejor, se elige acá.
- **`/new`**: empezar una conversación nueva (la bitácora mantiene la memoria entre conversaciones).

### 4.6 Si OpenCode se traba
- Esperá: con la tablet sin memoria algunas cosas tardan minutos.
- Si de verdad está trabado: **Ctrl+C** cancela lo que estaba haciendo.
- Si la ventana se rompe: cerrala y tocá de nuevo el icono OpenCode.
- Los modelos gratis a veces se equivocan más: si algo no te convence, pedile que lo **pruebe en la tablet** y te
  muestre el resultado.

---

## PARTE 5 — CLAUDE CODE (si lo volvés a tener)

- Icono **Claude Code** en el escritorio (o, en Termux, escribí `tv`).
- Al volver, Claude **lee la misma bitácora** que OpenCode y sigue desde donde quedó. Decile:
  «Leé la bitácora y seguí».
- Claude tiene una ventaja: puede leer y cambiar la base de datos directamente (con tu permiso) y publicar
  documentos para que los mires.

---

## PARTE 6 — CÓMO SE PUBLICA UN CAMBIO EN LA PÁGINA

1. La IA hace el cambio en una «rama» (una copia aparte del código, para no romper la página mientras trabaja).
2. Lo revisa: comprueba que el código no tenga errores (`tsc`) y que se pueda armar la página (`build`).
3. Abre un **Pull Request** (PR): una propuesta de cambio con un número (#300, #301…).
4. GitHub corre revisiones automáticas: código, base de datos (pruebas de seguridad), API pública.
5. Si todo pasa, la IA **fusiona** el PR (lo aprueba) a la rama principal `main`.
6. Al fusionar, automáticamente:
   - **Cloudflare publica** la página nueva (1 a 3 minutos).
   - Se publica la **actualización de la app** (OTA): la app del teléfono la baja sola y la aplica la próxima vez
     que la mandás a segundo plano y la volvés a abrir.
   - Se compila una **APK nueva** (por si hay que reinstalar).
7. La IA lo **prueba en la tablet** y te cuenta.

Todo queda registrado en GitHub: podés ver cada cambio en https://github.com/technoverse93/Technoverse-p-gina-/pulls

---

## PARTE 7 — EL PANEL, MÓDULO POR MÓDULO

Entrás a la tienda → icono de persona → correo y contraseña → **Panel de Control**. Arriba hay pestañas (como un
navegador): **«+»** abre «Nueva pestaña» con todos los módulos. Arriba a la derecha: luna/sol (tema claro u oscuro),
tienda (volver a la tienda) y tus iniciales (menú: Cambiar contraseña, Cambiar PIN, Ver la tienda, Seguridad y
acceso, Cerrar sesión).

En el navegador, **si pasás 5 minutos sin tocar nada, se cierra la sesión** y hay que volver a poner correo y
contraseña (es por seguridad, lo pediste así). En la app del teléfono se entra con huella o cara.

| Módulo | Para qué sirve |
|---|---|
| **Panel general** | Resumen del día: ventas, taller, inventario, lo que necesita atención. |
| **Inventario** | Carpetas: **Productos** (lo que vendés), **Repuestos** (piezas del taller), **Insumos**, **Movimientos** (entradas y salidas de stock), **Reportes**. Botones: «Nuevo Producto», «Importar lista de precios», «Iniciar Conteo». |
| **Chat** | Conversaciones en vivo con los clientes de la tienda. |
| **CRM** | Tus contactos y ventas. Carpetas: **Embudo** (cada contacto según la etapa: nuevo, en conversación, cotización, pendiente de pago, venta cerrada, postventa), **Seguimiento** (a quién hay que llamar hoy, quién está «sin atender»), **Segmentos** (filtrar para promociones), **Respuestas** (textos rápidos: /hola, /garantia…), **Métricas** (cuánto convierte cada canal). |
| **Taller** | Tablero de reparaciones, desde que entra el equipo hasta que se entrega. |
| **Clientes** | Fichas de clientes e historial de compras. |
| **Cobros** | Cobrar: **Venta de inventario** o **Reparación**. Pide cédula (la busca sola en Hacienda), correo, producto o servicio, método de pago. Emite el comprobante y lo manda por correo. Casilla «Factura de prueba (Sandbox)» para probar sin gastar un número real. |
| **Contabilidad** | Ventas y comprobantes emitidos, IVA. Botón **«Nota de crédito»** en una venta: la marca como devuelta y devuelve los productos al stock (ojo: todavía no genera un comprobante fiscal de anulación; ver Parte 12). |
| **Marketing** | **Estudio de pauta con Javier** (piezas para redes y banners con IA) y **Banners y promociones** (lo que se ve en la tienda). También cupones de descuento. |
| **Ciberseguridad** | 10 apartados: Resumen, Accesos, Dispositivos, Bloqueos, Lista blanca, Biometría, Bitácora, Visitantes, Penalizados, Aparatos bloqueados. |
| **Configuración** | Datos fiscales, logo, paleta de colores de la marca, crear administradores. |
| **Supervisión** (solo supremo) | Ver en vivo la pantalla (la página) del personal y clientes conectados. |
| **Ubicaciones** | Mapa con las ubicaciones que clientes y personal compartieron a propósito. |
| **Ingresos** (solo supremo) | Cada entrada exitosa al sistema, en vivo. |
| **Bloqueos** (solo supremo) | Expulsar al instante una cuenta, un aparato, una IP o un modelo (30 min, 2 h, 24 h o para siempre). |
| **Gestión de usuarios** (solo supremo) | Restablecer contraseña o PIN de otra cuenta administradora. |

---

## PARTE 8 — TAREAS DEL DÍA A DÍA, PASO A PASO

### 8.1 Agregar un producto
1. Panel → **Inventario** → carpeta **Productos** → **Nuevo Producto**.
2. Llená: **Nombre**, **Categoría** (Dispositivos, Estuches, Cargadores, Audio, Accesorios), **Garantía**
   (1, 3 o 12 meses), **Descripción** (podés usar «Auto-completar datos»), **Precio Venta**,
   **Costo Adquisición** (obligatorio), **Stock Inicial**.
3. **Imagen del Producto**: elegí la foto. **El sistema le quita el fondo solo**, recorta los bordes y la achica.
   Si querés, el botón «Quitar fondo y hacerlo transparente» lo vuelve a intentar.
4. Dejá sin marcar «¿Generar banner automático…?» y «¿Crear imagen y publicación…?» si no los querés.
5. **Guardar Producto**. Aparece en la tienda enseguida (si tiene stock).

### 8.2 Crear un banner con Javier (el que se ve arriba en la tienda)
1. Panel → **Marketing** → **Estudio de pauta con Javier**.
2. **Producto**: elegilo. **Objetivo**: Vender, Oferta, Llegó nuevo o Informar. **Formato**: «Banner» (para la
   tienda; los otros son para redes).
3. Opcional: «Algo que Javier deba tener en cuenta» (ej.: «mencioná la garantía de 12 meses»).
4. **Armar con Javier**: escribe titular, subtítulo, sello, botón y texto (unos 20 s).
5. **Estilo** (Premium, Claro, Vibrante, Oferta) y **Fondo** (Degradado de marca, Foto difuminada o **Con IA ✨** →
   «Crear fondo con IA»).
6. **Usar de banner** → «Publicar en la tienda». Queda arriba en la tienda y, al tocarlo, abre WhatsApp con un
   mensaje sobre ese producto.

### 8.3 Ver, pausar o quitar banners
Panel → **Marketing** → **Banners y promociones**. Cada banner tiene: Editar, Pausar, Duplicar, Subir/Bajar (orden)
y Quitar (pide confirmación). Ahí ves también sus **vistas y clics**.

### 8.4 Vender por WhatsApp con el CRM
1. Un cliente te escribe por WhatsApp (desde el botón de un producto, el carrito o un banner): el mensaje trae
   «Ref: …» (el código del producto).
2. Panel → **CRM** → **Nuevo contacto** → «Llegó por: **WhatsApp**» → pegá la «Ref.» (aparece «Le interesa: …») →
   nombre y teléfono → **Crear contacto**.
3. En su ficha:
   - **WhatsApp**: elegí una respuesta rápida (por ejemplo /garantia) → «Abrir WhatsApp» → revisás y enviás vos.
   - **Armar venta**: agregá los productos, elegí retiro o envío → **Enviar resumen** (abre WhatsApp con el pedido,
     el total y los datos del SINPE; el contacto pasa a «Pendiente de pago»).
4. Cuando veas el SINPE en tu banco: **SINPE recibido** → se abre **Cobros** con todo cargado → poné cédula y correo
   → cobrá. Recién ahí se descuenta el stock y sale la factura.

### 8.5 Cobrar en el mostrador
Panel → **Cobros** → «Venta de inventario» o «Reparación» → cédula (Buscar) → correo → producto/servicio →
método de pago → confirmar. Si es solo para probar, marcá «Factura de prueba (Sandbox)».

### 8.6 Revisar la seguridad
Panel → **Ciberseguridad** → **Resumen** (intentos de las últimas 24 h). Si ves un aparato que no reconocés en
**Dispositivos** o intentos raros en **Accesos**, usá **Bloqueos** para expulsarlo.

### 8.7 Cambiar los textos o colores de la tienda
- Colores de la marca: Panel → **Configuración** → paleta (Esmeralda, Océano, Atardecer, Orquídea).
- Textos de la tienda: en la tienda, con tu sesión abierta, el **lápiz** abajo a la derecha («Editar la página»)
  activa la edición de textos.

---

## PARTE 9 — LA APP DEL TELÉFONO (APK)

- Nombre: **Technoverse Admin**. Se entra con huella o cara.
- **Se actualiza sola** (OTA): cuando se publica un cambio, la app lo baja; se aplica la próxima vez que la mandás
  a segundo plano (botón de inicio) y la volvés a abrir.
- **Instalar o reinstalar** (si hace falta una APK nueva): pedíselo a la IA («bajá la última APK e instalala en la
  tablet»). Si lo hacés vos: GitHub → pestaña **Actions** → «Build Android APK» → la última en verde →
  **Artifacts** → `technoverse-admin-debug-apk` → descargarla → abrir el archivo desde **Archivos → Descargas** →
  «Actualizar» o «Instalar». MIUI y Play Protect muestran advertencias porque no viene de Play Store: es tu app.

---

## PARTE 10 — PROBLEMAS COMUNES Y CÓMO RESOLVERLOS

| Pasa esto | Hacé esto |
|---|---|
| El widget «Escritorio» no abre | Esperá el aviso que aparece abajo y leelo. Si dice «Ya se está abriendo», esperá un momento. Si nada: abrí la app Termux y escribí `escritorio`. |
| La IA dice «ADB se cayó» / «Connection refused» | Icono **Activar conexion adb** y avisale «listo». |
| El panel me sacó y pide contraseña | Normal: pasaron 5 minutos sin actividad (en el navegador). |
| La tablet está lentísima | **Liberar memoria**; cargarla; cerrar apps que no uses. |
| Un cambio no se ve en la página | Esperá 3 minutos y recargá. En la app: mandala a segundo plano y volvé. |
| OpenCode no responde | Ctrl+C; si no, cerrar la ventana y tocar el icono de nuevo. |
| Las ventanas en Termux:X11 no se pueden achicar/agrandar | Problema reportado el 29-oct, **pendiente de revisar** (está en la bitácora). |

---

## PARTE 11 — SEGURIDAD

1. **Cambiá tu contraseña del panel** si alguna vez la escribiste en un chat (menú de tus iniciales → «Cambiar
   contraseña»).
2. Activá la **verificación en dos pasos** en Cloudflare, GitHub y Google.
3. Nunca le des a una IA tus llaves de Supabase, Gmail o Cloudflare escritas en un mensaje: si una función las
   necesita, se guardan como «secretos» en el servicio correspondiente.
4. Revisá **Ciberseguridad → Accesos y Dispositivos** de vez en cuando.
5. La base **no tiene copias automáticas** todavía (pendiente 2 de la Parte 12).

---

## PARTE 12 — LO QUE ESTÁ PENDIENTE Y TE TOCA DECIDIR

(La lista viva y actualizada está en `docs/guia-ia/05-ESTADO-Y-PENDIENTES.md`.)

1. **Copias de seguridad automáticas de la base** (hoy no hay; ya se perdieron las facturas 1 a 5).
2. **Que la tienda no facture antes de ver el SINPE** (hoy la compra en línea factura al confirmar, sin verificar).
3. **Factura electrónica real ante Hacienda** (necesita tu usuario del ATV y la llave `.p12`).
4. **Nota de crédito fiscal**: hoy «Nota de crédito» devuelve el stock y marca la venta como devuelta, pero no genera un comprobante fiscal que anule la factura.
5. **Corregir datos** de los audífonos nuevos (stock y costo los puso la IA como estimado) y categorías mal puestas
   (iPhone en «Accesorios», teclado en «Audio»).
6. **Banners de prueba del iPhone**: ¿se quedan?
7. **Traer al código 6 funciones del servidor** que hoy solo están en Supabase (lo puede hacer la IA).
8. Dominio propio, doble factor, cédula automática en la compra de la tienda.
9. Revisar el problema de las ventanas en Termux:X11.

---

## PARTE 13 — GLOSARIO

| Palabra | Qué significa |
|---|---|
| **Repositorio (repo)** | La carpeta con todo el código, guardada en GitHub. |
| **Rama** | Una copia aparte del código para trabajar sin romper la página. `main` es la principal (la publicada). |
| **Commit** | Un «guardado» del código con una descripción. |
| **PR (Pull Request)** | Propuesta de cambio con número; se revisa y se aprueba (fusiona). |
| **Fusionar (merge)** | Aprobar el PR: el cambio entra a `main` y se publica. |
| **Build** | Armar la página a partir del código. Si falla, no se publica. |
| **Migración** | Un cambio en la estructura de la base de datos. Siempre pide tu permiso. |
| **OTA** | Actualización de la app por internet, sin reinstalar. |
| **APK** | El archivo instalador de una app de Android. |
| **ADB** | El «cable invisible» con que la IA controla la tablet para probar. |
| **Edge Function** | Un programita que corre en el servidor de Supabase (ej.: mandar el correo de la factura). |
| **SINPE Móvil** | Transferencia por número de teléfono (Costa Rica). |
| **Bitácora** | El cuaderno donde cada IA anota qué hizo; así ninguna empieza de cero. |
| **Modelo (de IA)** | El «cerebro» que usa OpenCode. Hay gratis y de pago. |
| **tmux** | Lo que mantiene vivas las IA aunque cierres la ventana. |
