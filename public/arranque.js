/*
 * RED DE SEGURIDAD DEL ARRANQUE
 * -----------------------------
 * Se carga ANTES que la app y no depende de ella (por eso es un archivo suelto y no
 * parte del paquete). Si la app no llega a armar su primera pantalla —un archivo que no
 * cargó, un error al arrancar— en vez de dejar la pantalla oscura enseña qué hacer.
 *
 * La app avisa que arrancó poniendo `window.__tvListo = true` (src/App.tsx). Si la app sí
 * armó pantalla pero se rompió después, quien responde es el borde de errores de React
 * (src/components/ErrorBoundaryRaiz.tsx), no este archivo.
 */
(function () {
  'use strict';
  var LIMITE_MS = 15000;
  var inicio = Date.now();

  function esperando() {
    // Mientras exista el indicador de carga estático, React todavía no armó nada.
    return !window.__tvListo && !!document.getElementById('tv-arranque');
  }

  function boton(texto, principal, alTocar) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.style.cssText = 'appearance:none;border:' + (principal ? 'none' : '1px solid rgba(255,255,255,.18)') +
      ';background:' + (principal ? '#FB923C' : 'rgba(255,255,255,.06)') + ';color:' + (principal ? '#1a1206' : '#E9ECF1') +
      ';border-radius:12px;padding:12px 14px;font:600 14px system-ui,-apple-system,sans-serif;width:100%;cursor:pointer';
    b.addEventListener('click', alTocar);
    return b;
  }

  function mostrar() {
    var cont = document.getElementById('tv-arranque');
    if (!cont || window.__tvListo) return;
    cont.textContent = '';
    cont.style.cssText = 'min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#0F1217;color:#E9ECF1;font-family:system-ui,-apple-system,sans-serif';

    var tarjeta = document.createElement('div');
    tarjeta.setAttribute('role', 'alert');
    tarjeta.style.cssText = 'max-width:420px;width:100%;background:#171B22;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px';

    var marca = document.createElement('div');
    marca.textContent = 'Technoverse Costa Rica';
    marca.style.cssText = 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#FB923C;margin-bottom:10px';
    var titulo = document.createElement('h1');
    titulo.textContent = 'La app no terminó de abrir';
    titulo.style.cssText = 'font-size:19px;font-weight:700;margin:0 0 8px;color:#E9ECF1;font-family:inherit;line-height:1.25';
    var texto = document.createElement('p');
    texto.textContent = 'Está tardando más de lo normal o se detuvo al arrancar. No se perdió nada: sus datos están a salvo en el servidor.';
    texto.style.cssText = 'font-size:14px;line-height:1.5;color:#A7AFBD;margin:0 0 16px';
    var aviso = document.createElement('p');
    aviso.setAttribute('role', 'status');
    aviso.style.cssText = 'font-size:13px;color:#A7AFBD;margin:14px 0 0';

    var botones = document.createElement('div');
    botones.style.cssText = 'display:grid;gap:10px';
    botones.appendChild(boton('Recargar la app', true, function () { window.location.reload(); }));

    // Solo dentro de la app del teléfono: volver a la versión con la que vino la app instalada.
    var cap = window.Capacitor;
    // `nativePromise` solo existe en el puente que inyecta la app instalada (en la web no está).
    var nativo = !!(cap && typeof cap.nativePromise === 'function');
    if (nativo) {
      botones.appendChild(boton('Volver a la versión de fábrica', false, function () {
        aviso.textContent = 'Volviendo a la versión de fábrica…';
        try {
          cap.nativePromise('CapacitorUpdater', 'reset', { toLastSuccessful: false }).catch(function () {
            aviso.textContent = 'No se pudo. Pruebe «Recargar la app».';
          });
        } catch (e) {
          aviso.textContent = 'No se pudo. Pruebe «Recargar la app».';
        }
      }));
    }

    tarjeta.appendChild(marca);
    tarjeta.appendChild(titulo);
    tarjeta.appendChild(texto);
    tarjeta.appendChild(botones);
    tarjeta.appendChild(aviso);
    cont.appendChild(tarjeta);
  }

  var reloj = setInterval(function () {
    if (!esperando()) { clearInterval(reloj); return; }
    if (Date.now() - inicio >= LIMITE_MS) { clearInterval(reloj); mostrar(); }
  }, 1000);

  // Si falla la carga del archivo principal de la app, no hace falta esperar los 15 s completos.
  window.addEventListener('error', function (ev) {
    var t = ev && ev.target;
    if (t && t.tagName === 'SCRIPT' && esperando()) {
      setTimeout(function () { if (esperando()) { clearInterval(reloj); mostrar(); } }, 3000);
    }
  }, true);
})();
