// =====================================================================
// QUITAR FONDO — el recorte de la foto de producto («Quitar fondo y hacerlo transparente»)
// =====================================================================
// Trabaja sobre los píxeles ya leídos (ImageData) y los deja con el fondo transparente. Lo usa
// `removeFlatBackground()` (utils/storage.ts), que se encarga de leer la imagen, reescalar y codificar.
//
// POR QUÉ SE REHIZO (2026-10-28, el dueño: «deja parchones blancos»): el recorte anterior solo borraba el fondo
// CONECTADO AL BORDE de la foto, así que todo blanco que el producto encierra —el lazo del cable de unos audífonos,
// el hueco de una diadema, el espacio entre dos piezas— quedaba como un parche blanco. Y el contorno se «suavizaba»
// bajando la opacidad de píxeles que seguían siendo blancuzcos: un halo claro, muy visible sobre la vitrina tintada
// y en modo oscuro.
//
// CÓMO TRABAJA AHORA
//   1. Color de fondo: los tonos que dominan el contorno de la foto (blanco liso, o los dos grises de un damero).
//   2. Fondo exterior: relleno desde el borde, estricto (solo lo muy parecido al fondo). Igual que antes: es lo
//      único que nunca se comió un producto.
//   3. Huecos encerrados: cada zona interior que NO llegó el relleno se mide. Si es grande y casi del color EXACTO
//      del fondo (fondo liso de estudio), es un hueco y se borra. El cuerpo de un producto blanco no califica: tiene
//      sombreado y se aleja del blanco puro (medido: ~50 de distancia, el umbral es 12).
//   4. Contorno sin halo: cada píxel del producto pegado al fondo recibe una opacidad según cuánto se parece al
//      fondo, y se le «resta» ese fondo a su color (descontaminación). El borde queda del color del producto, no
//      blancuzco.
// =====================================================================

type Color = [number, number, number];

/** Colores de fondo: los que ocupan más del 5 % del contorno (hasta cuatro, por los dameros). */
function coloresDeFondo(d: Uint8ClampedArray, w: number, h: number): Color[] {
  const conteo = new Map<string, number>();
  const anotar = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const clave = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
  };
  for (let x = 0; x < w; x++) { anotar(x, 0); anotar(x, h - 1); }
  for (let y = 0; y < h; y++) { anotar(0, y); anotar(w - 1, y); }
  const total = 2 * (w + h);
  return [...conteo.entries()]
    .filter(([, n]) => n / total > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k.split(',').map(v => (parseInt(v, 10) << 3) + 4) as Color);
}

/**
 * Deja transparente el fondo de `d` (RGBA, w×h). Devuelve false si no reconoce un fondo plano (la foto queda igual).
 * `tolerancia`: cuánto puede alejarse del fondo un píxel del relleno exterior.
 */
export function quitarFondoEnPixeles(d: Uint8ClampedArray, w: number, h: number, tolerancia = 26): boolean {
  const fondo = coloresDeFondo(d, w, h);
  if (fondo.length === 0) return false;

  // Diferencia con el fondo, contando el COLOR aparte del brillo. Un brillo rosado claro (250, 228, 234) está casi
  // tan cerca del blanco como el fondo mismo, pero tiene tinte; el fondo de estudio no. Antes se medía solo el canal
  // que más difería y esos brillos se borraban: el borde del producto salía «mordisqueado». Ahora el tinte que el
  // fondo no tiene pesa el triple.
  const tinte = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);
  const tintesFondo = fondo.map(([r, g, b]) => tinte(r, g, b));
  const dif = new Uint8Array(w * h);
  const cercano = new Uint8Array(w * h); // índice del color de fondo más parecido
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    let mejor = 255, cual = 0;
    const t = tinte(d[i], d[i + 1], d[i + 2]);
    for (let k = 0; k < fondo.length; k++) {
      const [r, g, b] = fondo[k];
      const brillo = Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));
      const m = Math.max(brillo, Math.max(0, t - tintesFondo[k]) * 3);
      if (m < mejor) { mejor = m; cual = k; }
    }
    dif[p] = Math.min(255, mejor); cercano[p] = cual;
  }

  // 0 = producto · 1 = fondo
  const esFondo = new Uint8Array(w * h);

  // ---- 2. Fondo exterior: relleno desde el borde ----
  const pila: number[] = [];
  const sembrar = (p: number) => { if (!esFondo[p] && dif[p] <= tolerancia) { esFondo[p] = 1; pila.push(p); } };
  for (let x = 0; x < w; x++) { sembrar(x); sembrar((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sembrar(y * w); sembrar(y * w + w - 1); }
  while (pila.length) {
    const p = pila.pop()!; const x = p % w, y = (p - x) / w;
    if (x > 0) sembrar(p - 1); if (x < w - 1) sembrar(p + 1);
    if (y > 0) sembrar(p - w); if (y < h - 1) sembrar(p + w);
  }

  // ---- 3. Huecos encerrados: zonas interiores grandes y casi del color exacto del fondo ----
  const HUECO_DIF = 12;
  const minimo = Math.max(60, Math.round(w * h * 0.0006));
  const visto = new Uint8Array(w * h);
  const zona: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (esFondo[s] || visto[s] || dif[s] > HUECO_DIF) continue;
    zona.length = 0; pila.length = 0; pila.push(s); visto[s] = 1;
    while (pila.length) {
      const p = pila.pop()!; zona.push(p); const x = p % w, y = (p - x) / w;
      const probar = (q: number) => { if (!visto[q] && !esFondo[q] && dif[q] <= HUECO_DIF) { visto[q] = 1; pila.push(q); } };
      if (x > 0) probar(p - 1); if (x < w - 1) probar(p + 1);
      if (y > 0) probar(p - w); if (y < h - 1) probar(p + w);
    }
    if (zona.length >= minimo) {
      // Liso de verdad: el promedio de la zona tiene que estar pegado al fondo (un blanco del producto con brillo
      // o sombra se aleja).
      let suma = 0; for (const p of zona) suma += dif[p];
      if (suma / zona.length <= 6) for (const p of zona) esFondo[p] = 1;
    }
  }
  // Lo que rodea a un hueco borrado y todavía es casi fondo (su antialias) entra al fondo.
  for (let pasada = 0; pasada < 2; pasada++) {
    const sumar: number[] = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (esFondo[p] || dif[p] > tolerancia) continue;
      if (esFondo[p - 1] || esFondo[p + 1] || esFondo[p - w] || esFondo[p + w]) sumar.push(p);
    }
    if (!sumar.length) break;
    for (const p of sumar) esFondo[p] = 1;
  }

  // ---- Pedacitos sueltos: lo que no es fondo pero tampoco está pegado al producto (ruido de compresión de la foto,
  // puntos, rayitas) y es chico, pasa a ser fondo. Lo que queda es el producto: las piezas grandes.
  {
    const marca = new Uint8Array(w * h);
    const pieza: number[] = [];
    const chico = Math.max(30, Math.round(w * h * 0.0004));
    for (let s0 = 0; s0 < w * h; s0++) {
      if (esFondo[s0] || marca[s0]) continue;
      pieza.length = 0; pila.length = 0; pila.push(s0); marca[s0] = 1;
      while (pila.length) {
        const p = pila.pop()!; pieza.push(p); const x = p % w, y = (p - x) / w;
        const probar = (q: number) => { if (!marca[q] && !esFondo[q]) { marca[q] = 1; pila.push(q); } };
        if (x > 0) probar(p - 1); if (x < w - 1) probar(p + 1);
        if (y > 0) probar(p - w); if (y < h - 1) probar(p + w);
      }
      if (pieza.length < chico) for (const p of pieza) esFondo[p] = 1;
    }
  }

  // ---- 4. Fondo transparente y contorno sin halo ----
  // Distancia (en píxeles, hasta 6) de cada píxel del producto al fondo.
  const cerca = new Uint8Array(w * h);
  let frente: number[] = [];
  for (let p = 0; p < w * h; p++) if (esFondo[p]) { cerca[p] = 0; frente.push(p); } else cerca[p] = 255;
  for (let paso = 1; paso <= 6 && frente.length; paso++) {
    const sig: number[] = [];
    for (const p of frente) {
      const x = p % w, y = (p - x) / w;
      const vec = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of vec) if (q >= 0 && cerca[q] > paso) { cerca[q] = paso; sig.push(q); }
    }
    frente = sig;
  }

  // Contorno: cada píxel a 1-2 px del fondo es una MEZCLA del color del producto (F, el de su interior cercano) y
  // del fondo (B). Su opacidad es cuánto avanzó de B hacia F —proyección de (C−B) sobre (F−B)—, y su color real se
  // recupera quitándole la parte de fondo. Así el borde queda liso (sin escalones) y del color del producto (sin
  // halo blanco), también en un producto claro sobre blanco.
  const orig = new Uint8ClampedArray(d);
  for (let p = 0; p < w * h; p++) if (esFondo[p]) d[p * 4 + 3] = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (cerca[p] > 2) continue;
    // Del fondo, solo la primera fila pegada al producto (puede guardar un poco de producto: el antialias).
    if (esFondo[p] && !((x > 0 && !esFondo[p - 1]) || (x < w - 1 && !esFondo[p + 1]) || (y > 0 && !esFondo[p - w]) || (y < h - 1 && !esFondo[p + w]))) continue;
    // F: promedio del interior cercano (píxeles a 3-6 px del fondo, en una ventana de 7×7).
    let fr = 0, fg = 0, fb = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (esFondo[q] || cerca[q] < 3) continue;
      const k = q * 4; fr += orig[k]; fg += orig[k + 1]; fb += orig[k + 2]; n++;
    }
    const i = p * 4;
    const [br, bg, bb] = fondo[cercano[p]];
    if (!n) { fr = orig[i]; fg = orig[i + 1]; fb = orig[i + 2]; } else { fr /= n; fg /= n; fb /= n; }
    const vr = fr - br, vg = fg - bg, vb = fb - bb;
    const largo2 = vr * vr + vg * vg + vb * vb;
    let alfa = 1;
    if (largo2 > 64) {
      alfa = ((orig[i] - br) * vr + (orig[i + 1] - bg) * vg + (orig[i + 2] - bb) * vb) / largo2;
      alfa = Math.min(1, Math.max(0, alfa));
    }
    if (esFondo[p]) alfa = Math.min(alfa, 0.5); // del lado del fondo nunca pasa de medio opaco
    if (alfa <= 0.03) { d[i + 3] = 0; continue; }
    if (alfa >= 0.97) { d[i + 3] = orig[i + 3]; continue; }
    d[i] = Math.max(0, Math.min(255, Math.round(br + (orig[i] - br) / alfa)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(bg + (orig[i + 1] - bg) / alfa)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(bb + (orig[i + 2] - bb) / alfa)));
    d[i + 3] = Math.round(orig[i + 3] * alfa);
  }
  return true;
}
