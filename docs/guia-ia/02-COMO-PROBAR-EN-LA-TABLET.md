# CÓMO PROBAR EN LA TABLET «COMO UN HUMANO»

Todo se corre desde la terminal del Linux (Ubuntu en PRoot). Los guiones están en `herramientas/`.
(En el repo están en `docs/guia-ia/herramientas/`; en el escritorio, en `Guia-para-IA/herramientas/`.) Copialos a una carpeta de trabajo antes de usarlos (por ejemplo `/tmp/tv`) y corré `node` desde ahí.

## 0. Preparar

```bash
export ANDROID_SERIAL=127.0.0.1:5555
timeout 10 adb devices                     # tiene que decir: 127.0.0.1:5555  device
# Si dice «offline», nada, o «Connection refused»: pedile al dueño que toque «Activar conexion adb» en el escritorio.
timeout 10 adb shell monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1   # Chrome al frente
timeout 8  adb forward tcp:9333 localabstract:chrome_devtools_remote
curl -s --max-time 5 localhost:9333/json/list | grep -E '"(id|url)"'                      # pestañas: anotá el id
```

- Una pestaña en **segundo plano se congela** en Android: si un guion se queda colgado, traé Chrome al frente y
  activá la pestaña: `curl -s localhost:9333/json/activate/<id>`.
- `json/new` no funciona en este Chrome: **reutilizá una pestaña** (el dueño no quiere muchas).
- El sistema pasa a otras apps (YouTube, escritorio X11): mirá qué está al frente con
  `adb shell dumpsys window | grep -m1 mCurrentFocus`.

## 1. Entrar al panel

```bash
cd /tmp/tv
TV_CORREO='correo-del-dueño' TV_CLAVE='(se la pedís al dueño; NUNCA la guardes en un archivo)' \
  PESTANA=<id> node asegurar.mjs /admin/marketing
```

El navegador cierra la sesión a los **5 minutos sin actividad real**. Los guiones mandan un movimiento de cursor cada
20 s, pero si vos tardás programando, la sesión se cierra: volvé a correr `asegurar.mjs`.

## 2. Leer y tocar la página

- `node ev.mjs '<expresión JS>' <id>` → evalúa algo en la página y muestra el resultado.
- `node pos.mjs "<expresión que devuelve un elemento>" ` → devuelve `X Y` en PANTALLA para tocarlo.
  Fórmula: `X = cssX × devicePixelRatio`, `Y = 216 + cssY × devicePixelRatio` en Chrome horizontal (216 px = barra de
  Chrome). En la APK el WebView empieza en y=46 (medilo con `uiautomator dump`, clase `android.webkit.WebView`).
- Tocar de verdad: `adb shell input tap X Y`. Escribir: `adb shell input text '...'` (o llenar por JS).
- **Ojo**: `pos.mjs` hace `scrollIntoView`, y eso cierra menús desplegables (por ejemplo el del carrito). Para algo
  dentro de un desplegable, abrilo con un toque y medí sin desplazar (ver ejemplo en `ev.mjs`).

## 3. Fotos de la pantalla

```bash
timeout 20 adb exec-out screencap -p > foto.png        # la pantalla real
convert foto.png -resize 1000x foto.jpg               # más chica para mirarla
```

- La **APK** tiene FLAG_SECURE (anti-captura): `screencap` sale vacío. Usá CDP sobre su WebView (sección 5) o
  `uiautomator dump` para leer textos.
- Diálogos del sistema (instalar apps, huella) tampoco se fotografían a veces: usá `uiautomator dump`.

## 4. Abrir WhatsApp y limpiar

Al tocar un botón de WhatsApp, comprobá que abrió con
`adb shell dumpsys window | grep -m1 mCurrentFocus` (tiene que decir `com.whatsapp` o `com.whatsapp.w4b`).
La tablet tiene **WhatsApp Business de la propia tienda**, así que el chat que abre es «Tú» (el mismo número).
**Nunca toques Enviar.** Para borrar el borrador: tocar el campo de texto (sacá sus coordenadas con
`uiautomator dump`, id que termina en `entry`), `adb shell input keycombination 113 29` (Ctrl+A), `KEYCODE_DEL`, y
dos veces `KEYCODE_BACK`.

## 5. Probar la APK (Technoverse Admin)

1. Bajar el último build: `gh run list --workflow build-android.yml --status success -L 1`, después
   `gh run download <id>` → `technoverse-admin-debug-apk/app-debug.apk`.
2. `adb install` falla en MIUI («INSTALL_FAILED_USER_RESTRICTED») si no está «Instalar vía USB». Camino que sí
   funciona: `adb push app-debug.apk /sdcard/Download/Technoverse-Admin.apk`, abrir **Archivos → Descargas**
   (`adb shell am start -a android.intent.action.VIEW_DOWNLOADS`), tocar la APK, «Actualizar». (Ya está habilitado
   «instalar apps desconocidas» para la app Archivos.)
3. Versión instalada: `adb shell dumpsys package com.technoverse.admin | grep -E "versionName|lastUpdateTime"`.
4. Actualización OTA: después de fusionar a `main`, el workflow «Publicar actualización OTA» la sube. En la app:
   abrirla, esperar ~40 s a que la baje, **mandarla a segundo plano (HOME) y volver**: ahí se aplica.
5. Conectarse a su WebView:
   ```bash
   sock=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | sort -u | tail -1)
   adb forward tcp:9444 localabstract:$sock
   curl -s localhost:9444/json/list            # anotar el id
   PUERTO=9444 node ev.mjs "window.Capacitor.Plugins.CapacitorUpdater.current().then(r=>r.bundle.version)" <id>
   ```

## 6. Base de datos (solo LECTURA sin permiso)

Con el conector de Supabase (o `psql` si lo hay) se pueden hacer `select` para verificar: por ejemplo
`select formato, title, link from banners;` o `select nombre, etapa from crm_leads where nombre like 'PRUEBA%';`.
Cualquier escritura en producción: **pedir permiso** (ver `01-REGLAS…`).

## 7. Errores conocidos del entorno

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `ws sin respuesta` en los guiones | Pestaña congelada / Chrome en segundo plano / pestaña descartada | Chrome al frente, `json/activate`, o usar otra pestaña viva. |
| `adb: device offline` / `Connection refused` | El ADB local se cae | Pedir al dueño «Activar conexion adb». |
| Toques que «no hacen nada» | La pantalla giró, o un diálogo del sistema bloquea | Capturar pantalla y recalcular coordenadas. |
| Comando que tarda una eternidad | Poca memoria | `timeout` en todo; paciencia. |
| La carpeta temporal desapareció | Se reinició el escritorio y `/tmp` se limpió | Volver a copiar `herramientas/`. |
