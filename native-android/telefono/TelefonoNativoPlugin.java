package com.technoverse.admin;

import android.Manifest;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * El teléfono de Javier: alarmas, temporizadores, abrir apps, llamar, WhatsApp,
 * SMS, calendario, mapas, música, linterna, ajustes y enlaces. No es un paquete
 * npm: MainActivity lo registra a mano (como los demás de native-android/).
 *
 * Casi todo se hace con intents estándar de Android, sin permisos especiales:
 * llamar, escribir y agendar dejan la pantalla lista en la app correspondiente
 * y la persona solo toca «Llamar», «Enviar» o «Guardar». El único permiso en
 * tiempo de ejecución es el de contactos, para buscar a alguien por nombre; los
 * números se quedan en este aparato (la IA nunca los ve).
 *
 * Todas las llamadas responden { ok: true } o { ok: false, error } (nunca
 * rechazan), para que la web decida qué mostrar.
 */
@CapacitorPlugin(
    name = "TelefonoNativo",
    permissions = { @Permission(alias = "contactos", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class TelefonoNativoPlugin extends Plugin {

    // ------------------------------ ayudas ------------------------------
    private static JSObject ok() {
        JSObject r = new JSObject();
        r.put("ok", true);
        return r;
    }

    private static JSObject error(String mensaje) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("error", mensaje);
        return r;
    }

    /** Minúsculas, sin tildes ni símbolos: «Cámara» → «camara». */
    static String norm(String s) {
        if (s == null) return "";
        String t = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return t.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    private static String texto(PluginCall call, String clave) {
        String v = call.getString(clave);
        return v == null ? "" : v.trim();
    }

    /** Abre la pantalla de otra app. Sin ella, avisa en vez de romperse. */
    private JSObject iniciar(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return ok();
        } catch (ActivityNotFoundException e) {
            return error("No hay una app en el teléfono que pueda hacer eso.");
        } catch (SecurityException e) {
            return error("Android no dejó abrirlo.");
        } catch (Exception e) {
            return error(e.getMessage() != null ? e.getMessage() : "No se pudo.");
        }
    }

    // ------------------------------ reloj ------------------------------
    @PluginMethod
    public void alarma(PluginCall call) {
        Integer h = call.getInt("hora");
        Integer m = call.getInt("minutos");
        if (h == null || m == null || h < 0 || h > 23 || m < 0 || m > 59) {
            call.resolve(error("La hora de la alarma no es válida."));
            return;
        }
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, h.intValue())
            .putExtra(AlarmClock.EXTRA_MINUTES, m.intValue())
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        String etiqueta = texto(call, "etiqueta");
        if (!etiqueta.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, etiqueta);
        JSArray dias = call.getArray("dias");
        if (dias != null && dias.length() > 0) {
            ArrayList<Integer> lista = new ArrayList<>();
            for (int k = 0; k < dias.length(); k++) {
                int d = dias.optInt(k, 0);
                if (d >= 1 && d <= 7 && !lista.contains(d)) lista.add(d);
            }
            if (!lista.isEmpty()) i.putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, lista);
        }
        call.resolve(iniciar(i));
    }

    @PluginMethod
    public void temporizador(PluginCall call) {
        Integer s = call.getInt("segundos");
        if (s == null || s < 1 || s > 86400) {
            call.resolve(error("La duración del temporizador no es válida."));
            return;
        }
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, s.intValue())
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        String etiqueta = texto(call, "etiqueta");
        if (!etiqueta.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, etiqueta);
        call.resolve(iniciar(i));
    }

    // ------------------------------ apps ------------------------------
    private static final class App {
        final String nombre;
        final String paquete;
        final String clave;
        int puntos;

        App(String nombre, String paquete) {
            this.nombre = nombre;
            this.paquete = paquete;
            this.clave = norm(nombre);
        }
    }

    private List<App> appsInstaladas() {
        PackageManager pm = getContext().getPackageManager();
        Intent principal = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> lista = pm.queryIntentActivities(principal, 0);
        List<App> apps = new ArrayList<>();
        Map<String, Boolean> vistos = new LinkedHashMap<>();
        for (ResolveInfo ri : lista) {
            if (ri.activityInfo == null) continue;
            String paquete = ri.activityInfo.packageName;
            if (vistos.containsKey(paquete)) continue;
            vistos.put(paquete, true);
            CharSequence etiqueta = ri.loadLabel(pm);
            apps.add(new App(etiqueta != null ? etiqueta.toString() : paquete, paquete));
        }
        return apps;
    }

    /** Pantallas del sistema que la gente nombra como si fueran apps. */
    private Intent atajo(String q) {
        switch (q) {
            case "camara": case "camera": case "la camara":
                return new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
            case "reloj": case "alarmas": case "las alarmas":
                return new Intent(AlarmClock.ACTION_SHOW_ALARMS);
            case "ajustes": case "configuracion": case "los ajustes": case "la configuracion":
                return new Intent(Settings.ACTION_SETTINGS);
            case "telefono": case "marcador": case "teclado numerico":
                return new Intent(Intent.ACTION_DIAL);
            case "calendario": case "agenda": {
                Uri uri = CalendarContract.CONTENT_URI.buildUpon().appendPath("time").build();
                return new Intent(Intent.ACTION_VIEW).setData(uri);
            }
            default:
                return null;
        }
    }

    @PluginMethod
    public void abrirApp(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String paquete = texto(call, "paquete");
        if (!paquete.isEmpty()) {
            Intent li = pm.getLaunchIntentForPackage(paquete);
            call.resolve(li == null ? error("Esa app ya no está instalada.") : iniciar(li));
            return;
        }
        String q = norm(texto(call, "nombre"));
        if (q.length() < 2) {
            call.resolve(error("Decime qué app abrir."));
            return;
        }
        Intent a = atajo(q);
        if (a != null) {
            JSObject r = iniciar(a);
            if (r.optBoolean("ok")) r.put("app", texto(call, "nombre"));
            call.resolve(r);
            return;
        }
        List<App> apps = appsInstaladas();
        for (App app : apps) {
            if (app.clave.equals(q)) app.puntos = 100;
            else if (app.clave.startsWith(q)) app.puntos = 85;
            else if (app.clave.contains(" " + q) || app.clave.contains(q)) app.puntos = 70;
            else if (q.contains(app.clave) && app.clave.length() >= 3) app.puntos = 60;
            else if (norm(app.paquete).contains(q.replace(" ", ""))) app.puntos = 40;
        }
        Collections.sort(apps, new Comparator<App>() {
            @Override
            public int compare(App x, App y) {
                if (y.puntos != x.puntos) return y.puntos - x.puntos;
                return x.clave.length() - y.clave.length();
            }
        });
        if (apps.isEmpty() || apps.get(0).puntos < 40) {
            call.resolve(error("No encontré una app que se llame «" + texto(call, "nombre") + "»."));
            return;
        }
        App mejor = apps.get(0);
        // ¿Hay otra casi igual? (Chrome y Chrome Beta, WhatsApp y WhatsApp Business…): se pregunta.
        List<App> parecidas = new ArrayList<>();
        for (App app : apps) if (app.puntos >= 60 && app.puntos >= mejor.puntos - 15) parecidas.add(app);
        if (parecidas.size() > 1 && mejor.puntos < 100) {
            JSArray candidatos = new JSArray();
            for (int k = 0; k < parecidas.size() && k < 5; k++) {
                JSObject c = new JSObject();
                c.put("nombre", parecidas.get(k).nombre);
                c.put("paquete", parecidas.get(k).paquete);
                candidatos.put(c);
            }
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("candidatos", candidatos);
            call.resolve(r);
            return;
        }
        Intent li = pm.getLaunchIntentForPackage(mejor.paquete);
        if (li == null) {
            call.resolve(error("No pude abrir " + mejor.nombre + "."));
            return;
        }
        JSObject r = iniciar(li);
        if (r.optBoolean("ok")) r.put("app", mejor.nombre);
        call.resolve(r);
    }

    // ---------------------------- contactos ----------------------------
    @PluginMethod
    public void contactos(PluginCall call) {
        if (getPermissionState("contactos") != PermissionState.GRANTED) {
            requestPermissionForAlias("contactos", call, "alPermisoContactos");
            return;
        }
        call.resolve(buscarContactos(texto(call, "nombre")));
    }

    @PermissionCallback
    private void alPermisoContactos(PluginCall call) {
        if (getPermissionState("contactos") == PermissionState.GRANTED) {
            call.resolve(buscarContactos(texto(call, "nombre")));
        } else {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("permiso", "denegado");
            r.put("error", "Sin permiso para ver los contactos.");
            call.resolve(r);
        }
    }

    private static final class Contacto {
        final String nombre;
        final String clave;
        final List<String> numeros = new ArrayList<>();
        final List<String> finales = new ArrayList<>();
        int puntos;

        Contacto(String nombre) {
            this.nombre = nombre;
            this.clave = norm(nombre);
        }
    }

    private JSObject buscarContactos(String nombre) {
        String q = norm(nombre);
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("permiso", "concedido");
        JSArray salida = new JSArray();
        r.put("contactos", salida);
        if (q.isEmpty()) return r;
        String[] palabras = q.split(" ");
        ContentResolver cr = getContext().getContentResolver();
        Map<Long, Contacto> porId = new LinkedHashMap<>();
        Cursor c = null;
        try {
            c = cr.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] {
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                },
                null, null, null
            );
            int filas = 0;
            while (c != null && c.moveToNext() && filas++ < 12000) {
                String nom = c.getString(1);
                String num = c.getString(2);
                if (nom == null || num == null) continue;
                String clave = norm(nom);
                boolean todas = true;
                for (String p : palabras) if (!clave.contains(p)) { todas = false; break; }
                if (!todas) continue;
                long id = c.getLong(0);
                Contacto k = porId.get(id);
                if (k == null) {
                    k = new Contacto(nom);
                    k.puntos = clave.equals(q) ? 100 : clave.startsWith(q) ? 85 : 70;
                    porId.put(id, k);
                }
                String digitos = num.replaceAll("\\D", "");
                String fin = digitos.length() > 8 ? digitos.substring(digitos.length() - 8) : digitos;
                if (!digitos.isEmpty() && !k.finales.contains(fin)) { k.finales.add(fin); k.numeros.add(num.trim()); }
            }
        } catch (Exception e) {
            return error("No pude leer los contactos.");
        } finally {
            if (c != null) c.close();
        }
        List<Contacto> lista = new ArrayList<>(porId.values());
        Collections.sort(lista, new Comparator<Contacto>() {
            @Override
            public int compare(Contacto x, Contacto y) {
                if (y.puntos != x.puntos) return y.puntos - x.puntos;
                return x.clave.length() - y.clave.length();
            }
        });
        int mejor = lista.isEmpty() ? 0 : lista.get(0).puntos;
        for (int k = 0; k < lista.size() && k < 5; k++) {
            Contacto x = lista.get(k);
            if (x.puntos < mejor - 20) continue;
            JSObject o = new JSObject();
            o.put("nombre", x.nombre);
            JSArray nums = new JSArray();
            for (int n = 0; n < x.numeros.size() && n < 3; n++) nums.put(x.numeros.get(n));
            o.put("numeros", nums);
            salida.put(o);
        }
        return r;
    }

    // ------------------------ llamar y escribir ------------------------
    @PluginMethod
    public void marcar(PluginCall call) {
        String n = texto(call, "numero");
        if (n.replaceAll("\\D", "").length() < 7) { call.resolve(error("El número no es válido.")); return; }
        call.resolve(iniciar(new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", n, null))));
    }

    @PluginMethod
    public void whatsapp(PluginCall call) {
        String n = texto(call, "numero").replaceAll("\\D", "");
        if (n.length() < 7) { call.resolve(error("El número no es válido.")); return; }
        String mensaje = texto(call, "mensaje");
        String url = "https://wa.me/" + n + (mensaje.isEmpty() ? "" : "?text=" + Uri.encode(mensaje));
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        // «WhatsApp Business»: directo a esa app (si no está, el que haya).
        String paquete = Boolean.TRUE.equals(call.getBoolean("negocio", false)) ? "com.whatsapp.w4b" : "com.whatsapp";
        if (getContext().getPackageManager().getLaunchIntentForPackage(paquete) != null) i.setPackage(paquete);
        call.resolve(iniciar(i));
    }

    @PluginMethod
    public void sms(PluginCall call) {
        String n = texto(call, "numero");
        if (n.replaceAll("\\D", "").length() < 7) { call.resolve(error("El número no es válido.")); return; }
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(n)));
        String mensaje = texto(call, "mensaje");
        if (!mensaje.isEmpty()) i.putExtra("sms_body", mensaje);
        call.resolve(iniciar(i));
    }

    // ----------------------- calendario, mapa, música -----------------------
    @PluginMethod
    public void calendario(PluginCall call) {
        String titulo = texto(call, "titulo");
        long ini = call.getData().optLong("inicioMs", 0);
        long fin = call.getData().optLong("finMs", 0);
        if (titulo.isEmpty() || ini <= 0) { call.resolve(error("Faltan el nombre o la fecha del evento.")); return; }
        if (fin <= ini) fin = ini + 3600_000L;
        Intent i = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, titulo)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, ini)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, fin)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, Boolean.TRUE.equals(call.getBoolean("todoElDia", false)));
        String lugar = texto(call, "lugar");
        if (!lugar.isEmpty()) i.putExtra(CalendarContract.Events.EVENT_LOCATION, lugar);
        String descripcion = texto(call, "descripcion");
        if (!descripcion.isEmpty()) i.putExtra(CalendarContract.Events.DESCRIPTION, descripcion);
        call.resolve(iniciar(i));
    }

    @PluginMethod
    public void mapa(PluginCall call) {
        String q = texto(call, "consulta");
        if (q.isEmpty()) { call.resolve(error("Falta el lugar.")); return; }
        boolean navegar = Boolean.TRUE.equals(call.getBoolean("navegar", false));
        if (navegar) {
            Intent nav = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(q)));
            nav.setPackage("com.google.android.apps.maps");
            JSObject r = iniciar(nav);
            if (r.optBoolean("ok")) { call.resolve(r); return; }
        }
        call.resolve(iniciar(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q)))));
    }

    @PluginMethod
    public void musica(PluginCall call) {
        String q = texto(call, "consulta");
        if (q.isEmpty()) { call.resolve(error("Falta qué música poner.")); return; }
        Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        i.putExtra(SearchManager.QUERY, q);
        call.resolve(iniciar(i));
    }

    /** YouTube con la búsqueda hecha («entrá a YouTube y buscame…»). Sin la app, la web. */
    @PluginMethod
    public void youtube(PluginCall call) {
        String q = texto(call, "consulta");
        if (q.isEmpty()) { call.resolve(error("Falta qué buscar en YouTube.")); return; }
        Intent i = new Intent(Intent.ACTION_SEARCH).setPackage("com.google.android.youtube").putExtra(SearchManager.QUERY, q);
        JSObject r = iniciar(i);
        if (!r.optBoolean("ok")) r = iniciar(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))));
        call.resolve(r);
    }

    // ----------------------- linterna, ajustes, enlaces -----------------------
    @PluginMethod
    public void linterna(PluginCall call) {
        boolean encender = !Boolean.FALSE.equals(call.getBoolean("encender", true));
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            if (cm == null) { call.resolve(error("Este teléfono no tiene linterna.")); return; }
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics cc = cm.getCameraCharacteristics(id);
                Boolean flash = cc.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer lado = cc.get(CameraCharacteristics.LENS_FACING);
                if (flash != null && flash && lado != null && lado == CameraCharacteristics.LENS_FACING_BACK) {
                    cm.setTorchMode(id, encender);
                    call.resolve(ok());
                    return;
                }
            }
            call.resolve(error("Este teléfono no tiene linterna."));
        } catch (Exception e) {
            call.resolve(error("No pude " + (encender ? "prender" : "apagar") + " la linterna ahora."));
        }
    }

    @PluginMethod
    public void ajustes(PluginCall call) {
        String p = norm(texto(call, "pantalla"));
        String accion;
        switch (p) {
            case "wifi": accion = Settings.ACTION_WIFI_SETTINGS; break;
            case "bluetooth": accion = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "sonido": accion = Settings.ACTION_SOUND_SETTINGS; break;
            case "pantalla": accion = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "bateria": accion = Settings.ACTION_BATTERY_SAVER_SETTINGS; break;
            case "aplicaciones": accion = Settings.ACTION_APPLICATION_SETTINGS; break;
            case "ubicacion": accion = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            default: accion = Settings.ACTION_SETTINGS; break;
        }
        call.resolve(iniciar(new Intent(accion)));
    }

    @PluginMethod
    public void enlace(PluginCall call) {
        String url = texto(call, "url");
        String esquema = url.length() > 8 ? url.substring(0, 8).toLowerCase(Locale.ROOT) : url.toLowerCase(Locale.ROOT);
        if (!(esquema.startsWith("http://") || esquema.startsWith("https://"))) {
            call.resolve(error("Solo abro enlaces http o https."));
            return;
        }
        call.resolve(iniciar(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
    }
}
