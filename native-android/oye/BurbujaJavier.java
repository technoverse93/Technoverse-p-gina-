package com.technoverse.admin;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * LA BURBUJA DE JAVIER (como las de Messenger). La pidió el dueño (2026-10-12):
 * Javier fuera de la app es una burbujita que flota sobre lo que estés usando y NO
 * bloquea nada (YouTube, WhatsApp o el escritorio se siguen usando igual):
 *  · tocarla → el chat escrito, a su lado;
 *  · mantenerla apretada (o decir «Oye Javier») → te escucha y contesta a su lado;
 *  · arrastrarla → se mueve; soltarla sobre la ✕ de abajo → se esconde.
 *
 * Es una ventana del sistema del tamaño de la burbuja (TYPE_APPLICATION_OVERLAY,
 * permiso «Mostrar sobre otras apps»): fuera de ese círculo los toques van a la
 * app de atrás. La maneja OyePhillService (el oído), así que existe mientras
 * «Oye Javier» esté prendido y la burbuja activada.
 */
final class BurbujaJavier {
    private static final int TAM_DP = 56;
    private static final long TOQUE_LARGO_MS = 450;

    private final Context ctx;
    private final WindowManager wm;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private FrameLayout vista;
    private WindowManager.LayoutParams lp;
    private TextView basurero;
    private GradientDrawable fondo;

    BurbujaJavier(Context c) {
        ctx = c.getApplicationContext();
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    static boolean puede(Context c) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c);
    }

    private int dp(float v) {
        return Math.round(v * ctx.getResources().getDisplayMetrics().density);
    }

    private static int tipoVentana() {
        return Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    boolean visible() {
        return vista != null;
    }

    /** Centro vertical de la burbuja en la pantalla (px), para abrir el chat a su lado. */
    int centroY() {
        return lp == null ? -1 : lp.y + dp(TAM_DP) / 2;
    }

    /** Centro horizontal (px): el panel se abre del lado de la pantalla donde está la burbuja. */
    int centroX() {
        return lp == null ? -1 : lp.x + dp(TAM_DP) / 2;
    }

    void mostrar() {
        if (vista != null || wm == null || !puede(ctx)) return;
        try {
            int tam = dp(TAM_DP);
            FrameLayout f = new FrameLayout(ctx);
            fondo = new GradientDrawable();
            fondo.setShape(GradientDrawable.OVAL);
            fondo.setColor(Color.argb(235, 12, 108, 120));
            fondo.setStroke(dp(2), Color.argb(220, 255, 255, 255));
            f.setBackground(fondo);
            f.setElevation(dp(6));
            ImageView icono = new ImageView(ctx);
            int idIcono = ctx.getResources().getIdentifier("jarvis_ic_chispa", "drawable", ctx.getPackageName());
            if (idIcono != 0) icono.setImageResource(idIcono);
            icono.setColorFilter(Color.WHITE);
            FrameLayout.LayoutParams il = new FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER);
            f.addView(icono, il);
            f.setContentDescription("Javier");

            lp = new WindowManager.LayoutParams(tam, tam, tipoVentana(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            int ancho = ctx.getResources().getDisplayMetrics().widthPixels;
            int alto = ctx.getResources().getDisplayMetrics().heightPixels;
            lp.x = OyePrefs.burbujaX(ctx, ancho - tam - dp(8));
            lp.y = OyePrefs.burbujaY(ctx, Math.round(alto * 0.42f));
            f.setOnTouchListener(new Arrastre());
            wm.addView(f, lp);
            vista = f;
        } catch (Throwable t) {
            vista = null;
        }
    }

    void quitar() {
        quitarBasurero();
        View v = vista;
        vista = null;
        if (v == null) return;
        try {
            wm.removeView(v);
        } catch (Throwable t) {
            /* ya no estaba */
        }
    }

    /**
     * Javier está abierto (escuchando o con el chat): la burbuja se ESCONDE. Antes quedaba dibujada
     * encima del panel y tapaba su botón de cerrar (es una ventana del sistema, siempre va por
     * encima de la ventanita). Al cerrar el panel vuelve en el mismo lugar.
     */
    void activo(boolean si) {
        principal.post(() -> {
            if (vista != null) vista.setVisibility(si ? View.INVISIBLE : View.VISIBLE);
        });
    }

    /** Abre a Javier junto a la burbuja: «escribir» (el chat) u «oye» (te escucha). */
    void abrir(String modo) {
        try {
            Intent i = new Intent(ctx, JarvisRapido.class)
                .putExtra(JarvisRapido.EXTRA_MODO, modo)
                .putExtra(JarvisRapido.EXTRA_BURBUJA, true)
                .putExtra(JarvisRapido.EXTRA_ANCLA_Y, centroY())
                .putExtra(JarvisRapido.EXTRA_ANCLA_X, centroX())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(i);
        } catch (Throwable t) {
            /* sin ventanita: no pasa nada */
        }
    }

    // ------------------------------ el basurero (la ✕ de abajo) ------------------------------
    private void mostrarBasurero() {
        if (basurero != null) return;
        try {
            TextView x = new TextView(ctx);
            x.setText("✕");
            x.setTextSize(22);
            x.setTextColor(Color.WHITE);
            x.setGravity(Gravity.CENTER);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(Color.argb(170, 30, 30, 30));
            x.setBackground(g);
            WindowManager.LayoutParams l = new WindowManager.LayoutParams(dp(60), dp(60), tipoVentana(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
            l.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            l.y = dp(48);
            wm.addView(x, l);
            basurero = x;
        } catch (Throwable t) {
            basurero = null;
        }
    }

    private void quitarBasurero() {
        TextView x = basurero;
        basurero = null;
        if (x == null) return;
        try {
            wm.removeView(x);
        } catch (Throwable t) {
            /* ya no estaba */
        }
    }

    private boolean sobreElBasurero(float rawX, float rawY) {
        int ancho = ctx.getResources().getDisplayMetrics().widthPixels;
        int alto = ctx.getResources().getDisplayMetrics().heightPixels;
        float cx = ancho / 2f, cy = alto - dp(48) - dp(30);
        float dx = rawX - cx, dy = rawY - cy;
        return dx * dx + dy * dy < dp(70) * dp(70);
    }

    /** Tocar, mantener o arrastrar. */
    private final class Arrastre implements View.OnTouchListener {
        private float x0, y0;
        private int lx0, ly0;
        private boolean movio, largo;
        private final Runnable alMantener = () -> {
            if (!movio) {
                largo = true;
                if (vista != null) vista.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                abrir("oye");
            }
        };

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    x0 = e.getRawX();
                    y0 = e.getRawY();
                    lx0 = lp.x;
                    ly0 = lp.y;
                    movio = false;
                    largo = false;
                    principal.postDelayed(alMantener, TOQUE_LARGO_MS);
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - x0, dy = e.getRawY() - y0;
                    if (!movio && dx * dx + dy * dy > dp(10) * dp(10)) {
                        movio = true;
                        principal.removeCallbacks(alMantener);
                        mostrarBasurero();
                    }
                    if (movio && vista != null) {
                        lp.x = lx0 + Math.round(dx);
                        lp.y = ly0 + Math.round(dy);
                        try {
                            wm.updateViewLayout(vista, lp);
                        } catch (Throwable t) {
                            /* se movió mientras se quitaba */
                        }
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    principal.removeCallbacks(alMantener);
                    if (movio) {
                        boolean tirar = sobreElBasurero(e.getRawX(), e.getRawY());
                        quitarBasurero();
                        if (tirar) {
                            // Escondida hasta que se vuelva a prender en Ajustes (o se reinicie el oído).
                            OyePrefs.fijarBurbuja(ctx, false);
                            quitar();
                            return true;
                        }
                        pegarAlBorde();
                    } else if (!largo && e.getActionMasked() == MotionEvent.ACTION_UP) {
                        abrir("escribir");
                    }
                    return true;
                default:
                    return false;
            }
        }
    }

    /** Al soltarla, se pega al borde más cercano (como Messenger) y se recuerda dónde quedó. */
    private void pegarAlBorde() {
        if (vista == null) return;
        int ancho = ctx.getResources().getDisplayMetrics().widthPixels;
        int alto = ctx.getResources().getDisplayMetrics().heightPixels;
        int tam = dp(TAM_DP);
        lp.x = lp.x + tam / 2 < ancho / 2 ? dp(8) : ancho - tam - dp(8);
        lp.y = Math.max(dp(40), Math.min(lp.y, alto - tam - dp(80)));
        try {
            wm.updateViewLayout(vista, lp);
        } catch (Throwable t) {
            /* ya no estaba */
        }
        OyePrefs.guardarBurbuja(ctx, lp.x, lp.y);
    }
}
