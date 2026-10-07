// =====================================================================
// CEREBRO DE JARVIS — lo que aprende, guardado como una red
// =====================================================================
// Cada cosa que Jarvis aprende es un NODO con un resumen de lo que sabe y
// su fuente; los ENLACES dicen cómo se relacionan y engordan con el uso.
// Ramas reales, por ejemplo:
//
//   Technoverse → Dispositivos electrónicos → iPhone → iPhone 15 Pro
//                                              ├─ Inventario · iPhone (modelos, stock, precios)
//                                              ├─ Taller · iPhone (daños frecuentes)
//                                              └─ Internet · iPhone (resumen con enlace)
//
// Cómo crece (todo es aprendizaje):
//   · aprender_tema: Jarvis investiga un tema a fondo (inventario, taller e
//     internet) y arma la rama completa.
//   · Cada búsqueda en internet queda como nodo bajo «Internet».
//   · Cada «recordá…» queda bajo «Sobre vos».
//   · De cada conversación con el dueño se sacan solos los hechos
//     duraderos (precios de proveedor, políticas, datos técnicos…) y caen
//     como puntos en la rama y el tema que ya existan (aprenderHechos).
//   · Cada módulo que consulta o en el que actúa se refuerza.
// Cómo lo usa: si el mensaje nombra algo que está en el cerebro, se le
// pasa a la IA su resumen y el de sus vecinos («LO QUE APRENDISTE»).
//
// Seguridad: nunca datos personales de clientes (todo viaja a Google). Lo
// que vino de internet se marca como tal y NO se usa en mensajes que son
// órdenes: lo que se leyó afuera nunca empuja una acción.
// Si las tablas todavía no existen, todo falla en silencio.
// =====================================================================

type Db = any;
/** Una idea del cerebro lista para mostrarse a la persona (nombre humano, resumen limpio). */
export type Nota = { nombre: string; resumen: string; url: string | null; fuente: string | null; peso: number; cubre: number };
/** De lo guardado de una búsqueda («Título: extracto · Título: extracto…»),
 *  solo lo del primer resultado y sin el «Planet:» del título al inicio. */
const primerResultado = (r: string) => r.split(' · ')[0].replace(/^[^.:]{1,40}:\s+/, '');
export type Nodo = { id: string; clave: string; etiqueta: string; tipo: string; resumen: string | null; fuente: string | null; url: string | null; usos: number };
export type Aprendido = { etiqueta: string; clave: string; nuevo: boolean };

// ---------------------------------------------------------------------
// RAMAS FIJAS: el cerebro tiene SIEMPRE las mismas ramas (antes cada IA
// inventaba la suya y salían «Herramientas de taller» y «Herramientas y
// Taller» por separado, o «Política Nacional»). Todo lo que aprende cae en
// una de estas, dentro de un tema, como un dato concreto.
// ---------------------------------------------------------------------
export const RAMAS: { clave: string; nombre: string; guarda: string; pistas: RegExp }[] = [
  { clave: 'productos', nombre: 'Productos y accesorios', guarda: 'Modelos, precios, SKU, especificaciones y compatibilidad de lo que se vende.', pistas: /producto|accesori|celular|tel[eé]fono|cargador|cable|funda|aud[ií]fono|laptop|computadora|tablet|reloj|electrodom|cocina|modelo|sku|precio|marca|samsung|iphone|xiaomi|motorola|dispositivo|inventario/i },
  { clave: 'reparaciones', nombre: 'Reparaciones y técnica', guarda: 'Fallas, repuestos, procedimientos, herramientas y trucos del taller.', pistas: /repar|taller|falla|pantalla|bater[ií]a|placa|tarjeta|microsold|soldad|herramient|repuesto|desbloque|unlock|chimera|octoplus|\\bbox\\b|\\btool\\b|frp|imei|flasheo|firmware|diagn[oó]stic|t[eé]cnic/i },
  { clave: 'proveedores', nombre: 'Proveedores y compras', guarda: 'Quién vende qué, costos de compra, tiempos de entrega y contactos de negocio.', pistas: /proveedor|mayorista|distribuid|compra|importa|pedido|costo|cotiza/i },
  { clave: 'ventas', nombre: 'Ventas y finanzas', guarda: 'Márgenes, metas, cómo se cobra y se factura, impuestos y números del negocio.', pistas: /venta|finanz|margen|ganancia|factur|cobr|iva|impuesto|hacienda|meta|ingreso|gasto|pago|sinpe|precio de venta/i },
  { clave: 'trabajo', nombre: 'Cómo trabajamos', guarda: 'Políticas, garantías, horarios y reglas de cómo funciona Technoverse.', pistas: /pol[ií]tica|garant[ií]a|horario|regla|procedimiento|cliente|atenci[oó]n|devoluci|negocio|tienda|empleado|personal|turno/i },
  { clave: 'tecnologia', nombre: 'Tecnología y mercado', guarda: 'Tendencias, lanzamientos, inteligencia artificial y lo que pasa en el mercado.', pistas: /tecnolog|\bia\b|inteligencia artificial|lanzamiento|tendencia|mercado|software|\bapp|sistema operativo|android|\bios\b|internet|5g|api\b|open source|acceso|groq|openrouter|siliconflow|gemini|kimi|llm|modelo de lenguaje|\\bnube\\b|cloud/i },
  { clave: 'mundo', nombre: 'Mundo y actualidad', guarda: 'Noticias, política, economía y lo que pasa en Costa Rica y el mundo.', pistas: /pol[ií]tica (de )?(costa rica|nacional|del pa[ií]s)|noticia|gobierno|elecci|econom[ií]a|\bpa[ií]s\b|costa rica|\bley\b|narco|seguridad (ciudadana|nacional)|clima|deporte|institucional|tipo de cambio|d[oó]lar/i },
];
/** La rama fija que corresponde. `propuesta` es la rama que dijo la IA (o
 *  la rama vieja); el TEMA pesa más que todo lo demás, porque dice de qué
 *  se trata («Mensajes al cliente» no es de reparaciones aunque viniera de
 *  «Herramientas y taller»). */
export function ramaCanonica(propuesta: string, tema = '', resto = ''): (typeof RAMAS)[number] {
  const exacta = RAMAS.find(r => normalizar(propuesta) === normalizar(r.nombre) || normalizar(propuesta) === r.clave);
  if (exacta) return exacta;
  const contar = (t: string, re: RegExp) => (t.match(new RegExp(re.source, 'gi')) || []).length;
  let mejor = RAMAS[0], pts = 0;
  for (const r of RAMAS) {
    const n = contar(tema, r.pistas) * 3 + contar(resto, r.pistas) + contar(propuesta, r.pistas);
    if (n > pts) { pts = n; mejor = r; }
  }
  return pts ? mejor : RAMAS.find(r => r.clave === 'trabajo')!;
}
/** Lo que NO es conocimiento: lo que alguien pidió, lo que no se sabe,
 *  reglas obvias o frases sobre Jarvis mismo. Antes se guardaba y era basura. */
export const BASURA = /^(el|la|un|una)?\s*(due[ñn]o|usuario|cliente|jefe|superadmin)\s+(solicit|pidi|pregunt|quiere|quer[ií]a|consult|busc[oó]|necesit)|^(jarvis|el asistente|la ia|el sistema)\b|se debe (evitar|verificar|confirmar|consultar)|no se (dispone|tiene|encontr|cuenta)|no (est[aá]n?|se encuentran?|fue|fueron) (registrad|disponible|encontrad|especificad)|no hay (datos|informaci|registros)|sin (datos|informaci[oó]n) (disponible|registrad)|^(se )?(recomienda|sugiere) (verificar|consultar|revisar)|^(es importante|hay que tener en cuenta)|(pregunt[oó]|consult[oó]) por\b|no (est[aá] |se encuentra |aparece |figura )?disponible|no aparece|no se (pudo|logr[oó])|al momento de la consulta|^precio:? no/i;
/** Sitios cuyos resultados no aportan conocimiento (perfiles, redes). */
export const SITIO_BASURA = /rocketreach|instagram|facebook|linkedin|pinterest|tiktok|zoominfo|scribd|quora/i;

const PRIVADO = /\b\d{8,12}\b|\d{4}[-\s]\d{4}|[^\s@]+@[^\s@]+\.[^\s@]+|\[[A-ZÉ]+·\d+\]/;

/** «Teléfonos iPhone 15» → «telefonos iphone 15». */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim().replace(/\s+/g, ' ');
}
const recortar = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const limpio = (t: unknown, n: number) => recortar(String(t ?? '').replace(/\s+/g, ' ').trim(), n);

/** Los módulos del negocio como nodos fijos bajo «Negocio». */
const MODULOS: Record<string, string> = {
  inventario: 'Inventario', facturacion: 'Ventas', taller: 'Taller', chat: 'Chat', seguridad: 'Seguridad',
  finanzas: 'Finanzas', sesiones: 'Sesiones', tienda: 'Tienda en línea', internet: 'Internet', clientes: 'Clientes',
  ubicaciones: 'Ubicaciones', errores: 'Errores del sistema', vivo: 'En vivo',
};

/** Jarvis consulta SU cerebro cuando lo necesita (no solo lo que se le pasó al inicio). */
export const CONSULTAR_CEREBRO = {
  nombre: 'consultar_cerebro',
  descripcion: 'Busca en TU cerebro (todo lo que aprendiste: productos, reparaciones, proveedores, políticas, lo que te dijo el dueño, lo que leíste en internet) por palabras y por significado. Usala antes de buscar en internet cuando la pregunta pueda estar en lo que ya sabés, o cuando el dueño pregunte «qué sabés de…». Con buscar vacío devuelve el mapa: ramas y temas.',
  parametros: { type: 'object', properties: { buscar: { type: 'string', description: 'Qué buscás, en pocas palabras. Vacío = el mapa del cerebro.' } } },
};

export const APRENDER = {
  nombre: 'aprender_tema',
  descripcion: 'Investiga un tema A FONDO y lo guarda en tu cerebro como una rama (por ejemplo Dispositivos electrónicos → iPhone → iPhone 15). Cruza lo que hay en inventario y taller con una búsqueda en internet. Usala cuando el dueño diga «aprendé», «investigá», «averiguá todo sobre…», o cuando te pregunte por un producto, marca, servicio o tema del negocio que todavía no esté en «LO QUE APRENDISTE». No la uses para cosas de un solo uso (el clima de hoy). Nunca con datos de clientes.',
  parametros: {
    type: 'object',
    properties: {
      tema: { type: 'string', description: 'El tema, corto: «iPhone», «Baterías de litio», «Samsung A12».' },
      rama: { type: 'string', description: 'La categoría madre, corta: «Dispositivos electrónicos», «Accesorios», «Reparaciones», «Proveedores», «Finanzas»…' },
      resumen: { type: 'string', description: 'Lo que vos ya sabés del tema y te sirve para el negocio, 2 a 5 frases.' },
      subtemas: {
        type: 'array', description: 'Hasta 6 subtemas concretos (modelos, variantes, partes), cada uno con una frase.',
        items: { type: 'object', properties: { nombre: { type: 'string' }, resumen: { type: 'string' } }, required: ['nombre'] },
      },
      buscar: { type: 'string', description: 'Qué buscar en internet para completar (vacío si no hace falta).' },
    },
    required: ['tema', 'rama', 'resumen'],
  },
};

import { limpiarBusqueda, limpiarExtracto, nombreHumano, sitioHumano } from './nombres.ts';

export function crearCerebro(admin: Db, uid: string) {
  const cache = new Map<string, string>();
  const pendientes: Promise<unknown>[] = [];
  let vivo = true; // se apaga si las tablas no existen

  async function asegurarNodo(clave: string, etiqueta: string, tipo: string, extra: { resumen?: string; fuente?: string; url?: string; usar?: boolean } = {}): Promise<{ id: string; nuevo: boolean } | null> {
    if (!vivo) return null;
    const ahora = new Date().toISOString();
    const { data: ya, error } = await admin.from('jarvis_nodos').select('id,usos').eq('user_id', uid).eq('clave', clave).maybeSingle();
    if (error) { vivo = false; console.log(`cerebro: ${error.message}`); return null; }
    if (ya) {
      const cambios: Record<string, unknown> = { actualizado_en: ahora };
      if (extra.resumen) cambios.resumen = recortar(extra.resumen, 1500);
      if (extra.fuente) cambios.fuente = extra.fuente;
      if (extra.url) cambios.url = extra.url;
      if (extra.usar) { cambios.usos = (ya.usos || 0) + 1; cambios.ultimo_uso = ahora; }
      await admin.from('jarvis_nodos').update(cambios).eq('id', ya.id);
      cache.set(clave, ya.id);
      return { id: ya.id, nuevo: false };
    }
    const { data, error: e2 } = await admin.from('jarvis_nodos').insert({
      user_id: uid, clave, etiqueta: recortar(etiqueta, 80) || clave, tipo,
      resumen: extra.resumen ? recortar(extra.resumen, 1500) : null, fuente: extra.fuente || null, url: extra.url || null,
      usos: extra.usar ? 1 : 0, ultimo_uso: extra.usar ? ahora : null,
    }).select('id').single();
    if (e2) {
      // Otra petición lo creó al mismo tiempo: se lee.
      const { data: otra } = await admin.from('jarvis_nodos').select('id').eq('user_id', uid).eq('clave', clave).maybeSingle();
      if (otra) { cache.set(clave, otra.id); return { id: otra.id, nuevo: false }; }
      console.log(`cerebro: ${e2.message}`);
      return null;
    }
    cache.set(clave, data.id);
    return { id: data.id, nuevo: true };
  }

  async function enlazar(origen: string | undefined, destino: string | undefined, relacion: string) {
    if (!vivo || !origen || !destino || origen === destino) return;
    const { data: ya } = await admin.from('jarvis_enlaces').select('id,peso').eq('origen', origen).eq('destino', destino).maybeSingle();
    if (ya) await admin.from('jarvis_enlaces').update({ peso: Math.min(999, (ya.peso || 1) + 1) }).eq('id', ya.id);
    else await admin.from('jarvis_enlaces').insert({ user_id: uid, origen, destino, relacion });
  }

  // Raíz y ramas fijas.
  const raiz = () => asegurarNodo('raiz', 'Technoverse', 'raiz', { resumen: 'Todo lo que Jarvis sabe del negocio.' });
  async function dominio(clave: string, etiqueta: string) {
    const r = await raiz();
    const d = await asegurarNodo(`dom:${clave}`, etiqueta, 'dominio');
    await enlazar(r?.id, d?.id, 'contiene');
    return d;
  }
  /** Una de las ramas fijas (con su nombre y lo que guarda). */
  async function ramaFija(r: (typeof RAMAS)[number]) {
    const n = await asegurarNodo(`dom:rama:${r.clave}`, r.nombre, 'dominio', { resumen: r.guarda });
    const raizN = await raiz();
    await enlazar(raizN?.id, n?.id, 'contiene');
    return n;
  }
  async function modulo(id: string, usar = true) {
    const negocio = await dominio('negocio', 'Negocio');
    const m = await asegurarNodo(`mod:${id}`, MODULOS[id] || id, 'modulo', { usar });
    await enlazar(negocio?.id, m?.id, 'contiene');
    return m;
  }

  // ------------------------------------------------------------------
  // MEMORIA SEMÁNTICA: cada idea tiene un vector de significado
  // (embedding, Gemini gratis), y se recuerda por IDEA, no solo por
  // palabras: «cargador rápido» encuentra «adaptador 20W PD». También evita
  // aprender dos veces lo mismo dicho distinto. Si la columna `embedding`
  // todavía no existe (falta el SQL), todo sigue por palabras como antes.
  // ------------------------------------------------------------------
  let conVectores: boolean | null = null;
  async function hayVectores(): Promise<boolean> {
    if (conVectores !== null) return conVectores;
    const { error } = await admin.from('jarvis_nodos').select('id').not('embedding', 'is', null).limit(1);
    conVectores = !error;
    return conVectores;
  }
  async function vectores(textos: string[]): Promise<number[][] | null> {
    const clave = (globalThis as any).Deno?.env?.get('GEMINI_API_KEY');
    if (!clave || !textos.length) return null;
    const modelo = (globalThis as any).Deno?.env?.get('GEMINI_EMBED_MODEL') || 'gemini-embedding-001';
    const corte = new AbortController(); const t = setTimeout(() => corte.abort(), 6000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:batchEmbedContents`, {
        method: 'POST', signal: corte.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
        body: JSON.stringify({ requests: textos.map(tx => ({ model: `models/${modelo}`, content: { parts: [{ text: tx.slice(0, 2000) }] }, outputDimensionality: 768 })) }),
      });
      if (!r.ok) { console.log(`vectores ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`); return null; }
      const d = await r.json();
      const vs = (d?.embeddings || []).map((e: any) => e?.values as number[]);
      return vs.length === textos.length && vs.every((v: number[]) => Array.isArray(v) && v.length === 768) ? vs : null;
    } catch { return null; } finally { clearTimeout(t); }
  }
  const textoDe = (n: { etiqueta: string; resumen?: string | null }) => `${n.etiqueta}. ${n.resumen || ''}`.slice(0, 1500);
  /** Les pone vector a las ideas que todavía no tienen (de a poco). */
  async function vectorizarPendientes(max: number) {
    if (!(await hayVectores())) return 0;
    const { data } = await admin.from('jarvis_nodos').select('id,etiqueta,resumen').eq('user_id', uid).is('embedding', null)
      .in('tipo', ['tema', 'dato', 'fuente', 'recuerdo']).order('usos', { ascending: false }).limit(max);
    if (!data?.length) return 0;
    const vs = await vectores(data.map(textoDe));
    if (!vs) return 0;
    await Promise.all(data.map((n: any, i: number) => admin.from('jarvis_nodos').update({ embedding: JSON.stringify(vs[i]) }).eq('id', n.id)));
    return data.length;
  }
  /** Las ideas más parecidas por significado. */
  async function semejantes(vec: number[], k: number): Promise<(Nodo & { similitud: number })[]> {
    const { data, error } = await admin.rpc('jarvis_semejantes', { p_user: uid, p_vec: JSON.stringify(vec), p_k: k });
    if (error) { console.log(`semejantes: ${error.message}`); return []; }
    return (data || []) as (Nodo & { similitud: number })[];
  }

  /** Corre en segundo plano; el guardado de la respuesta lo espera. */
  const enFondo = (p: Promise<unknown>) => { pendientes.push(p.catch(e => console.log(`cerebro: ${e instanceof Error ? e.message : e}`))); };

  async function buscarInternet(consulta: string): Promise<{ resumen: string; url: string; titulo: string } | null> {
    const clave = (globalThis as any).Deno?.env?.get('TAVILY_API_KEY');
    if (!clave || !consulta) return null;
    const corte = new AbortController();
    const t = setTimeout(() => corte.abort(), 12000);
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST', signal: corte.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
        body: JSON.stringify({ query: consulta, max_results: 5, search_depth: 'advanced', include_answer: true }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      const primero = (d?.results || [])[0];
      const resumen = limpio(d?.answer || (d?.results || []).slice(0, 2).map((x: any) => x.content).join(' '), 1200);
      return resumen ? { resumen, url: String(primero?.url || ''), titulo: limpio(primero?.title, 120) } : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  // ------------------ Internet centralizado por tema ------------------
  /** «Cargador tipo C · Planet Group» → tema «Cargador tipo C», sitio «Planet Group». */
  function partirWeb(crudo: string, url?: string | null) {
    // Desde lo CRUDO (no el nombre humano, que borra la tienda del tema y
    // dejaba «License price pro» en vez de «ChimeraTool license price pro»).
    const [a, b] = crudo.replace(/^Internet · /, '').split(' · ');
    const lb = limpiarBusqueda(a);
    const t = (lb.tema || a).replace(/[\s·…]+$/, '');
    return { tema: limpio(t, 60) || 'Búsqueda', sitio: limpio(b || lb.sitio || (url ? sitioHumano(url) : ''), 40) };
  }
  // Palabras que dicen DE QUÉ se trata (sin relleno, en singular).
  // Las tiendas (Planet, Group, CR…) son el SITIO, no el tema: no cuentan para agrupar.
  const RELLENO_WEB = new Set('para como con sin del los las una uno que por precio precios comprar venta vende donde mejor mejores nuevo nueva oficial sitio pagina web tienda costa rica hoy 2024 2025 2026 2027 planet planetgroupcr planetcellcr group grupo plana planas mayorista mayoreo producto productos encontralo amazon'.split(' '));
  const claves = (t: string) => new Set(normalizar(t).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !RELLENO_WEB.has(w)).map(w => (w.length > 5 ? w.replace(/(es|s)$/, '') : w.replace(/s$/, ''))));
  /** Nombre del tema: solo las palabras que dicen de QUÉ trata (sin tiendas ni relleno). */
  const nombreTema = (t: string) => {
    const ws = t.split(/\s+/).filter(w => { const n = normalizar(w).replace(/[^a-z0-9ñ]/g, ''); return n && !RELLENO_WEB.has(n) && !RELLENO_WEB.has(n.replace(/(es|s)$/, '')); });
    const r = ws.join(' ').replace(/^[,\s]+|[,\s]+$/g, '');
    return r ? r.charAt(0).toUpperCase() + r.slice(1) : t;
  };
  let temasWeb: { id: string; clave: string; etiqueta: string; palabras: Set<string> }[] | null = null;
  async function cargarTemasWeb() {
    if (temasWeb) return temasWeb;
    const { data } = await admin.from('jarvis_nodos').select('id,clave,etiqueta').eq('user_id', uid).like('clave', 'web:tema:%').limit(500);
    temasWeb = (data || []).map((n: any) => ({ ...n, palabras: claves(n.etiqueta) }));
    return temasWeb;
  }
  /** El tema donde cae una búsqueda: uno que ya trate de lo mismo o uno nuevo. */
  async function temaWeb(tema: string, resumen?: string, url?: string) {
    const ps = claves(tema);
    const lista = await cargarTemasWeb();
    let mejor: (typeof lista)[number] | null = null, puntaje = 0;
    for (const t of lista) {
      const comun = [...ps].filter(w => t.palabras.has(w)).length;
      const menor = Math.min(ps.size, t.palabras.size) || 1;
      const p = comun / menor;
      // Lo mismo dicho distinto («cargador tipo c» ≈ «cargadores usb tipo c»).
      if (comun >= 1 && p >= 0.75 && p > puntaje) { mejor = t; puntaje = p; }
    }
    if (mejor) {
      // Si lo nuevo es más general («Cargadores» frente a «Cargador USB tipo C
      // Planet»), el tema toma el nombre más general: así se centraliza.
      if (ps.size && ps.size < mejor.palabras.size && [...ps].every(w => mejor!.palabras.has(w))) {
        const nuevo = nombreTema(tema);
        await admin.from('jarvis_nodos').update({ etiqueta: nuevo, actualizado_en: new Date().toISOString() }).eq('id', mejor.id);
        // Sus puntos («tema · sitio») toman el nombre nuevo.
        const { data: hijos } = await admin.from('jarvis_nodos').select('id,etiqueta').eq('user_id', uid).like('clave', `web:p:${mejor.id.slice(0, 8)}:%`);
        for (const h of (hijos || []) as any[]) { const sitio = String(h.etiqueta).split(' · ')[1]; await admin.from('jarvis_nodos').update({ etiqueta: sitio ? `${nuevo} · ${sitio}` : `${nuevo} (internet)` }).eq('id', h.id); }
        mejor.etiqueta = nuevo; mejor.palabras = ps;
      }
      return { id: mejor.id, clave: mejor.clave, etiqueta: mejor.etiqueta };
    }
    const inter = await dominio('internet', 'Internet');
    const clave = `web:tema:${normalizar(tema).slice(0, 80)}`;
    const nombre = nombreTema(tema);
    const n = await asegurarNodo(clave, nombre, 'fuente', { resumen: resumen ? limpiarExtracto(resumen.split(' · ')[0].replace(/^[^.:]{1,40}:\s+/, ''), 400) : undefined, fuente: 'internet', url });
    if (!n) return null;
    await enlazar(inter?.id, n.id, 'buscó');
    lista.push({ id: n.id, clave, etiqueta: nombre, palabras: ps });
    return { id: n.id, clave, etiqueta: nombre };
  }
  /** El punto de un sitio dentro de su tema (se actualiza, no se repite). */
  async function puntoWeb(padre: { id: string }, tema: string, sitio: string, extra: { resumen?: string; url?: string; usar?: boolean }) {
    const clave = `web:p:${padre.id.slice(0, 8)}:${normalizar(sitio || 'web')}`;
    const etiqueta = sitio ? `${tema} · ${sitio}` : `${tema} (internet)`;
    const n = await asegurarNodo(clave, etiqueta, 'fuente', { ...extra, fuente: 'internet' });
    if (!n) return null;
    await enlazar(padre.id, n.id, 'en');
    return { ...n, clave, etiqueta };
  }
  /** Pasa de a poco las búsquedas sueltas viejas a su tema; las repetidas
   *  (mismo tema y mismo sitio) se funden en una sola sumando sus usos. */
  async function consolidar(max: number): Promise<number> {
    if (!vivo) return 0;
    const { data } = await admin.from('jarvis_nodos').select('id,clave,etiqueta,resumen,url,usos,ultimo_uso')
      .eq('user_id', uid).eq('tipo', 'fuente').like('clave', 'web:%').not('clave', 'like', 'web:tema:%').not('clave', 'like', 'web:p:%')
      .order('actualizado_en', { ascending: true }).limit(max);
    const filas = (data || []) as any[];
    for (const v of filas) {
      // «Internet · X» cuelga de un tema aprendido a propósito: se queda donde está.
      if (/^Internet · /.test(v.etiqueta)) { await admin.from('jarvis_nodos').update({ clave: `web:p:apr:${v.id.slice(0, 8)}` }).eq('id', v.id); continue; }
      const { tema, sitio } = partirWeb(v.etiqueta, v.url);
      const padre = await temaWeb(tema, v.resumen || undefined, v.url || undefined);
      if (!padre) continue;
      const clave = `web:p:${padre.id.slice(0, 8)}:${normalizar(sitio || 'web')}`;
      const { data: ya } = await admin.from('jarvis_nodos').select('id,usos,resumen,url').eq('user_id', uid).eq('clave', clave).maybeSingle();
      if (ya && ya.id !== v.id) {
        await admin.from('jarvis_nodos').update({ usos: (ya.usos || 0) + (v.usos || 0), url: ya.url || v.url, resumen: ya.resumen || v.resumen }).eq('id', ya.id);
        await admin.from('jarvis_nodos').delete().eq('id', v.id);
      } else {
        await admin.from('jarvis_nodos').update({ clave, etiqueta: sitio ? `${padre.etiqueta} · ${sitio}` : `${padre.etiqueta} (internet)` }).eq('id', v.id);
        await admin.from('jarvis_enlaces').delete().eq('user_id', uid).eq('destino', v.id).eq('relacion', 'buscó');
        await enlazar(padre.id, v.id, 'en');
      }
    }
    return filas.length;
  }

  return {
    pendientes,
    /** Espera lo que quedó escribiéndose. */
    esperar: () => Promise.all(pendientes),

    /** aprender_tema: la rama completa con datos reales. */
    async aprenderTema(a: Record<string, unknown>, desdeAfuera: boolean): Promise<{ datos: unknown; aprendidos: Aprendido[]; fuentes: { titulo: string; url: string }[] }> {
      const tema = limpio(a.tema, 60), rama = limpio(a.rama || 'Temas', 60) || 'Temas';
      if (tema.length < 2) return { datos: { error: 'Falta el tema.' }, aprendidos: [], fuentes: [] };
      if (PRIVADO.test(tema) || PRIVADO.test(String(a.resumen || ''))) return { datos: { error: 'Eso parece un dato personal: no lo guardo en el cerebro.' }, aprendidos: [], fuentes: [] };
      const aprendidos: Aprendido[] = [];
      const fuentes: { titulo: string; url: string }[] = [];
      const ramaN = await ramaFija(ramaCanonica(rama, tema, String(a.resumen || '')));
      if (!ramaN) return { datos: { error: 'El cerebro todavía no está instalado (falta la migración).' }, aprendidos: [], fuentes: [] };

      // Lo que hay en el negocio sobre el tema (sin datos de clientes).
      const q = tema.replace(/[,()%*_\\]/g, ' ').trim();
      const [prods, ords] = await Promise.all([
        admin.from('products').select('name,brand,category,price,stock').eq('active', true)
          .or(`name.ilike.%${q}%,brand.ilike.%${q}%,category.ilike.%${q}%`).limit(200),
        admin.from('repair_orders').select('device,device_model,damage_category,status')
          .or(`device.ilike.%${q}%,device_model.ilike.%${q}%,device_brand.ilike.%${q}%`).limit(300),
      ]);
      const ps = (prods.data || []) as any[], os = (ords.data || []) as any[];
      const colon = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
      let datoInv = '', datoTaller = '';
      if (ps.length) {
        const precios = ps.map(p => Number(p.price) || 0).filter(n => n > 0);
        const stock = ps.reduce((t, p) => t + (Number(p.stock) || 0), 0);
        const agotados = ps.filter(p => Number(p.stock) <= 0).length;
        datoInv = `${ps.length} producto(s) activos; ${stock} unidades en total${agotados ? `, ${agotados} agotado(s)` : ''}.`
          + (precios.length ? ` Precios de ${colon(Math.min(...precios))} a ${colon(Math.max(...precios))}.` : '')
          + ` Ejemplos: ${ps.slice(0, 8).map(p => `${limpio(p.name, 50)} (${Number(p.stock) || 0} u.)`).join('; ')}.`;
      }
      if (os.length) {
        const danos: Record<string, number> = {};
        for (const o of os) if (o.damage_category) danos[o.damage_category] = (danos[o.damage_category] || 0) + 1;
        const top = Object.entries(danos).sort((x, y) => y[1] - x[1]).slice(0, 4);
        const abiertas = os.filter(o => !['Entregada', 'Cancelada'].includes(o.status)).length;
        datoTaller = `${os.length} orden(es) de taller con este equipo (${abiertas} abiertas).` + (top.length ? ` Daños más comunes: ${top.map(([d, n]) => `${d} (${n})`).join(', ')}.` : '');
      }
      // Internet: gasta tokens, pero es justo lo que el dueño quiere que aprenda.
      const busqueda = limpio(a.buscar || `${tema} ${rama} especificaciones precios Costa Rica`, 200);
      const web = await buscarInternet(busqueda);
      const deAfuera = desdeAfuera || !!web;

      const temaN = await asegurarNodo(normalizar(tema), tema, 'tema', {
        resumen: limpio([a.resumen, datoInv && `Inventario: ${datoInv}`, datoTaller && `Taller: ${datoTaller}`].filter(Boolean).join(' '), 1500),
        fuente: deAfuera ? 'internet' : 'jarvis', usar: true,
      });
      if (!temaN) return { datos: { error: 'No se pudo guardar en el cerebro.' }, aprendidos: [], fuentes: [] };
      await enlazar(ramaN.id, temaN.id, 'incluye');
      aprendidos.push({ etiqueta: tema, clave: normalizar(tema), nuevo: temaN.nuevo });

      if (datoInv) {
        const n = await asegurarNodo(`dato:inventario:${normalizar(tema)}`, `Inventario · ${tema}`, 'dato', { resumen: datoInv, fuente: 'inventario' });
        await enlazar(temaN.id, n?.id, 'en inventario');
        await enlazar((await modulo('inventario', true))?.id, n?.id, 'registra');
      }
      if (datoTaller) {
        const n = await asegurarNodo(`dato:taller:${normalizar(tema)}`, `Taller · ${tema}`, 'dato', { resumen: datoTaller, fuente: 'taller' });
        await enlazar(temaN.id, n?.id, 'en taller');
        await enlazar((await modulo('taller', true))?.id, n?.id, 'registra');
      }
      if (web) {
        const inter = await dominio('internet', 'Internet');
        const n = await asegurarNodo(`web:${normalizar(tema)}`, `Internet · ${tema}`, 'fuente', { resumen: web.resumen, fuente: 'internet', url: web.url || undefined });
        await enlazar(temaN.id, n?.id, 'según internet');
        await enlazar(inter?.id, n?.id, 'encontró');
        if (web.url) fuentes.push({ titulo: web.titulo || `Sobre ${tema}`, url: web.url });
      }
      const subs = (Array.isArray(a.subtemas) ? a.subtemas : []).slice(0, 6) as any[];
      for (const s of subs) {
        const nombre = limpio(s?.nombre, 60);
        if (nombre.length < 2 || PRIVADO.test(nombre) || normalizar(nombre) === normalizar(tema)) continue;
        const n = await asegurarNodo(normalizar(nombre), nombre, 'tema', { resumen: limpio(s?.resumen, 600) || undefined, fuente: deAfuera ? 'internet' : 'jarvis' });
        await enlazar(temaN.id, n?.id, 'incluye');
        if (n) aprendidos.push({ etiqueta: nombre, clave: normalizar(nombre), nuevo: n.nuevo });
      }
      return {
        datos: {
          ok: true, guardado_en: `Technoverse → ${rama} → ${tema}`, subtemas: aprendidos.length - 1,
          inventario: datoInv || 'sin productos con ese nombre', taller: datoTaller || 'sin órdenes con ese equipo',
          internet: web ? web.resumen : 'sin búsqueda',
          nota: 'Contale al dueño en 2-4 frases lo más útil que aprendiste para el negocio y que quedó en su cerebro.',
        },
        aprendidos, fuentes,
      };
    },

    /** Cada búsqueda en internet queda como nodo bajo «Internet».
     *  FALLO CORREGIDO: antes se avisaba «Aprendí» antes de escribir, y si el
     *  guardado fallaba (p. ej. tablas sin instalar) el chip mentía. Ahora
     *  solo devuelve algo si de verdad quedó guardado. */
    async registrarWeb(consulta: string, resultados: { titulo: string; url: string; extracto: string }[]): Promise<Aprendido | null> {
      const c = limpio(consulta, 120);
      if (c.length < 3 || !resultados?.length || PRIVADO.test(c)) return null;
      // CENTRALIZADO: lo que se busca sobre lo mismo cae en UN tema
      // («Cargador USB tipo C») y cada sitio es un punto debajo («… · Planet
      // Group»). Buscar otra vez actualiza ese punto en vez de crear otra
      // estrella: antes salían 70 ideas casi iguales de la misma búsqueda.
      const { tema, sitio } = partirWeb(c, resultados[0]?.url);
      try {
        const resumen = limpio(resultados.slice(0, 3).map(r => { const e = limpiarExtracto(r.extracto, 400); return e ? `${r.titulo}: ${e}` : r.titulo; }).join(' · '), 1400);
        const padre = await temaWeb(tema, resumen, resultados[0]?.url);
        if (!padre) return null;
        const n = await puntoWeb(padre, padre.etiqueta, sitio, { resumen, url: resultados[0]?.url, usar: true });
        enFondo(consolidar(10));
        return n ? { etiqueta: n.etiqueta, clave: n.clave, nuevo: n.nuevo } : null;
      } catch (e) { console.log(`cerebro: ${e instanceof Error ? e.message : e}`); return null; }
    },

    /** Ordena de a poco lo viejo de internet (búsquedas sueltas repetidas). */
    consolidar: (max = 10) => consolidar(max),

    /** Le pone vector a todo lo que falta (de a 50, el tope por pedido de Gemini). */
    async vectorizar(max = 300): Promise<number> {
      let total = 0;
      for (let i = 0; i < max; i += 50) { const n = await vectorizarPendientes(50); total += n; if (n < 50) break; }
      return total;
    },

    /** FICHA VIVA DEL DUEÑO: quién es, cómo trabaja y qué le gusta. Vive en
     *  el resumen de «Sobre vos» (se ve y se corrige en el cerebro). */
    async ficha(): Promise<string> {
      const { data } = await admin.from('jarvis_nodos').select('resumen').eq('user_id', uid).eq('clave', 'dom:dueno').maybeSingle();
      const t = String(data?.resumen || '').trim();
      return /^Lo que le pediste recordar/.test(t) ? '' : t;
    },
    /** La rehace (repaso nocturno) con su memoria, lo que dijo en las
     *  conversaciones y la ficha actual (respetando lo que él corrigió). */
    async actualizarFicha(redactar: (prompt: string, datos: string) => Promise<string | null>): Promise<boolean> {
      const [mem, vos, msgs, actual] = await Promise.all([
        admin.from('jarvis_memoria').select('texto,tipo').eq('user_id', uid).limit(80),
        admin.from('jarvis_nodos').select('etiqueta,resumen,tipo').eq('user_id', uid).in('tipo', ['recuerdo', 'dato']).eq('fuente', 'vos').limit(60),
        admin.from('ia_mensajes').select('texto,creado_en').eq('user_id', uid).eq('rol', 'user').order('creado_en', { ascending: false }).limit(80),
        this.ficha(),
      ]);
      const datos = [
        actual ? `FICHA ACTUAL (lo que el dueño haya corregido aquí manda):\n${actual}` : '',
        (mem.data || []).length ? `MEMORIA (lo que pidió recordar):\n${(mem.data as any[]).map(m => `- ${m.texto}`).join('\n')}` : '',
        (vos.data || []).length ? `LO QUE DIJO DE SÍ MISMO:\n${(vos.data as any[]).map(n => `- ${n.resumen || n.etiqueta}`).join('\n')}` : '',
        (msgs.data || []).length ? `SUS ÚLTIMOS MENSAJES (para ver cómo habla, qué le importa y qué tiene pendiente):\n${(msgs.data as any[]).map(m => `- ${String(m.texto).slice(0, 200)}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n').slice(0, 14000);
      if (!datos.trim()) return false;
      const t = await redactar(
        `Sos el cerebro de Jarvis. Escribí la FICHA del dueño de Technoverse Costa Rica para que Jarvis lo conozca de verdad: cómo se llama y cómo prefiere que le hablen, cómo trabaja (horarios, rutinas, cómo decide), qué le importa del negocio ahora (metas, preocupaciones, proyectos), sus preferencias concretas y lo que tiene pendiente. Solo lo que surja de los datos; nada inventado, nada de clientes. Máximo 900 caracteres, frases cortas separadas por « · ». Devolvé SOLO JSON: {"texto":"…"}`,
        datos,
      ).catch(() => null);
      if (!t || t.length < 40 || PRIVADO.test(t)) return false;
      const vosN = await dominio('dueno', 'Sobre vos');
      if (!vosN) return false;
      await admin.from('jarvis_nodos').update({ resumen: recortar(t, 1200), actualizado_en: new Date().toISOString() }).eq('id', vosN.id);
      return true;
    },

    /** Respuesta de la herramienta consultar_cerebro. */
    async consultar(buscar: string): Promise<unknown> {
      const q = limpio(buscar, 200);
      if (q.length < 2) {
        const { data: temas } = await admin.from('jarvis_nodos').select('id,etiqueta').eq('user_id', uid).eq('tipo', 'tema').order('usos', { ascending: false }).limit(80);
        const { data: enl } = await admin.from('jarvis_enlaces').select('origen,destino').eq('user_id', uid).in('destino', (temas || []).map((t: any) => t.id)).limit(400);
        const { data: ramas } = await admin.from('jarvis_nodos').select('id,etiqueta').eq('user_id', uid).eq('tipo', 'dominio').limit(40);
        const nombreRama = new Map((ramas || []).map((r: any) => [r.id, r.etiqueta]));
        const mapa: Record<string, string[]> = {};
        for (const t of (temas || []) as any[]) { const r = (enl || []).find((e: any) => e.destino === t.id && nombreRama.has(e.origen)); const k = r ? String(nombreRama.get(r.origen)) : 'Sin rama'; (mapa[k] ||= []).push(t.etiqueta); }
        return { mapa, nota: 'Estas son tus ramas y temas. Pedí uno con «buscar» para ver lo que sabés de él.' };
      }
      const r = await this.recordarPara(q, false);
      return r.bloque ? { encontrado: r.bloque, temas: r.usados } : { encontrado: null, nota: 'No tenés nada guardado sobre eso. Si hace falta, buscalo en internet (lo que encontrés queda guardado).' };
    },

    /** Ramas y temas que ya existen, para que lo nuevo caiga en ellos y no
     *  se dupliquen («Proveedores» y «proveedor» son la misma rama). */
    async mapa(): Promise<{ ramas: string[]; temas: string[] }> {
      if (!vivo) return { ramas: [], temas: [] };
      const [r, t] = await Promise.all([
        admin.from('jarvis_nodos').select('etiqueta').eq('user_id', uid).like('clave', 'dom:rama:%').limit(40),
        admin.from('jarvis_nodos').select('etiqueta').eq('user_id', uid).eq('tipo', 'tema').not('clave', 'like', 'web:%').order('usos', { ascending: false }).limit(60),
      ]);
      return { ramas: (r.data || []).map((x: any) => x.etiqueta), temas: (t.data || []).map((x: any) => x.etiqueta) };
    },

    /** Hechos sacados de una conversación: cada uno es un PUNTO bajo su
     *  tema, y el tema cuelga de su rama. Si el tema o el punto ya existen,
     *  se refuerzan en vez de duplicarse. Nunca datos personales. */
    async aprenderHechos(hechos: { rama?: unknown; tema?: unknown; dato?: unknown; url?: unknown }[], origen: { fuente: string; url?: string } = { fuente: 'conversación' }): Promise<Aprendido[]> {
      const aprendidos: Aprendido[] = [];
      for (const h of (Array.isArray(hechos) ? hechos : []).slice(0, 5)) {
        const tema = limpio(h?.tema, 60), dato = limpio(h?.dato, 400);
        if (tema.length < 2 || dato.length < 12 || [tema, dato].some(x => PRIVADO.test(x)) || BASURA.test(dato) || BASURA.test(tema)) continue;
        // Un dato tiene que decir algo concreto: un número, un nombre propio o una regla clara.
        // Una preferencia del dueño («prefiere…», «no le gusta…») va a «Sobre vos».
        const preferencia = /\b(prefiere|le gusta|no le gusta|quiere que|odia|le molesta|le parece)\b/i.test(dato);
        if (!preferencia && !/\d|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-Z0-9]|\b(siempre|nunca|cuesta|vale|incluye|dura|funciona|sirve|es compatible|se cobra|se usa|abre|cierra|atiende)\b/.test(dato)) continue;
        const r = ramaCanonica(limpio(h?.rama, 60), tema, dato);
        const url = typeof h?.url === 'string' && /^https?:\/\//.test(h.url) ? h.url : origen.url;
        try {
          const ramaN = preferencia ? await dominio('dueno', 'Sobre vos') : await ramaFija(r);
          if (!ramaN) break;
          const temaN = await asegurarNodo(normalizar(tema), tema, 'tema', { fuente: 'conversación', usar: true });
          if (!temaN) continue;
          await enlazar(ramaN.id, temaN.id, 'incluye');
          // ¿Ya sabe esto mismo dicho de otra forma? Se refuerza en vez de duplicar.
          if (await hayVectores()) {
            const v = await vectores([dato]);
            const igual = v ? (await semejantes(v[0], 3)).find(x => x.tipo === 'dato' && x.similitud >= 0.92) : null;
            if (igual) {
              await admin.from('jarvis_nodos').update({ usos: (igual.usos || 0) + 1, ultimo_uso: new Date().toISOString() }).eq('id', igual.id);
              await enlazar(temaN.id, igual.id, 'detalle');
              continue;
            }
          }
          const clave = `nota:${temaN.id.slice(0, 8)}:${normalizar(dato).slice(0, 60)}`;
          const n = await asegurarNodo(clave, dato, 'dato', { resumen: dato, fuente: origen.fuente, url, usar: true });
          if (n?.nuevo) enFondo(vectorizarPendientes(4));
          await enlazar(temaN.id, n?.id, 'detalle');
          if (n) aprendidos.push({ etiqueta: dato, clave, nuevo: n.nuevo });
        } catch (e) { console.log(`cerebro: ${e instanceof Error ? e.message : e}`); }
      }
      return aprendidos;
    },

    /** Un «recordá…» queda bajo «Sobre vos». */
    registrarRecuerdo(texto: string, tipo: string) {
      enFondo((async () => {
        const vos = await dominio('dueno', 'Sobre vos');
        const n = await asegurarNodo(`rec:${normalizar(texto).slice(0, 120)}`, recortar(texto, 80), 'recuerdo', { resumen: texto, fuente: 'vos' });
        await enlazar(vos?.id, n?.id, tipo === 'negocio' ? 'del negocio' : tipo === 'forma_de_hablar' ? 'cómo habla' : 'prefiere');
      })());
    },

    /** Cambios que el dueño hace a mano desde el cerebro 3D (la app no puede
     *  insertar en estas tablas: lo hace la función, validando que todo sea suyo).
     *  · punto: agrega un dato que cuelga de una idea.
     *  · tema:  agrega una idea a una rama.
     *  · mover: pasa una idea de una rama (o idea madre) a otra rama. */
    async editar(op: string, d: Record<string, unknown>): Promise<{ ok: true; nodo?: unknown; enlace?: unknown } | { ok: false; error: string }> {
      const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
      const mios = async (ids: (string | null)[]) => {
        const xs = ids.filter(Boolean) as string[];
        if (xs.length !== ids.length) return false;
        const { data } = await admin.from('jarvis_nodos').select('id').eq('user_id', uid).in('id', xs);
        return (data || []).length === new Set(xs).size;
      };
      const COLS = 'id,clave,etiqueta,tipo,resumen,fuente,url,usos,ultimo_uso,creado_en,actualizado_en';
      const nuevoEnlace = async (origen: string, destino: string, relacion: string) => {
        const { data: ya } = await admin.from('jarvis_enlaces').select('id,origen,destino,relacion,peso').eq('origen', origen).eq('destino', destino).maybeSingle();
        if (ya) return ya;
        const { data } = await admin.from('jarvis_enlaces').insert({ user_id: uid, origen, destino, relacion }).select('id,origen,destino,relacion,peso').single();
        return data;
      };
      if (op === 'punto' || op === 'tema') {
        const madre = id(op === 'punto' ? d.tema : d.rama);
        const texto = limpio(d.texto, op === 'punto' ? 300 : 80);
        if (!madre || texto.length < 2) return { ok: false, error: 'Falta el texto.' };
        if (PRIVADO.test(texto)) return { ok: false, error: 'Eso parece un dato personal: no lo guardo en el cerebro.' };
        if (!(await mios([madre]))) return { ok: false, error: 'No encontré dónde agregarlo.' };
        const clave = op === 'punto' ? `nota:${madre.slice(0, 8)}:${normalizar(texto).slice(0, 60)}` : normalizar(texto);
        const resumen = limpio(d.resumen, 1500) || (op === 'punto' ? texto : '');
        const n = await asegurarNodo(clave, texto, op === 'punto' ? 'dato' : 'tema', { resumen: resumen || undefined, fuente: 'vos' });
        if (!n) return { ok: false, error: 'No se pudo guardar.' };
        const enlace = await nuevoEnlace(madre, n.id, op === 'punto' ? 'detalle' : 'incluye');
        const { data: nodo } = await admin.from('jarvis_nodos').select(COLS).eq('id', n.id).single();
        return { ok: true, nodo, enlace };
      }
      if (op === 'mover') {
        const nodo = id(d.nodo), desde = id(d.desde), hacia = id(d.hacia);
        if (!nodo || !hacia || nodo === hacia || !(await mios([nodo, hacia, ...(desde ? [desde] : [])]))) return { ok: false, error: 'No se pudo mover.' };
        if (desde) await admin.from('jarvis_enlaces').delete().eq('user_id', uid).or(`and(origen.eq.${desde},destino.eq.${nodo}),and(origen.eq.${nodo},destino.eq.${desde})`);
        const enlace = await nuevoEnlace(hacia, nodo, 'incluye');
        return { ok: true, enlace };
      }
      if (op === 'depurar') {
        // ORDENAR Y LIMPIAR TODO EL CEREBRO. Sin «aplicar» solo devuelve el
        // plan (qué se borra, qué se mueve) para que el dueño lo vea primero.
        const leerTodo = async (tabla: string, cols: string) => {
          const filas: any[] = [];
          for (let desde = 0; desde < 8000; desde += 1000) {
            const { data } = await admin.from(tabla).select(cols).eq('user_id', uid).range(desde, desde + 999);
            filas.push(...(data || []));
            if ((data || []).length < 1000) break;
          }
          return filas;
        };
        const nodos = await leerTodo('jarvis_nodos', 'id,clave,etiqueta,tipo,resumen,fuente,url,usos,ultimo_uso,creado_en');
        const enlaces = await leerTodo('jarvis_enlaces', 'id,origen,destino');
        const porId = new Map(nodos.map(n => [n.id, n]));
        const salen = new Map<string, string[]>(), entran = new Map<string, string[]>();
        for (const e of enlaces) { (salen.get(e.origen) || salen.set(e.origen, []).get(e.origen)!).push(e.destino); (entran.get(e.destino) || entran.set(e.destino, []).get(e.destino)!).push(e.origen); }
        const borrar = new Map<string, string>(); // id → motivo
        const mover: { tema: string; desde: string | null; hacia: (typeof RAMAS)[number] }[] = [];
        const CANON = new Set(RAMAS.map(r => `dom:rama:${r.clave}`));
        // 1) Datos que no son conocimiento.
        for (const n of nodos) if (n.tipo === 'dato' && (BASURA.test(n.etiqueta) || BASURA.test(n.resumen || ''))) borrar.set(n.id, 'no es un dato útil');
        // 2) Datos repetidos (mismo texto): queda el más usado.
        const vistos = new Map<string, any>();
        for (const n of nodos.filter(x => x.tipo === 'dato' && !borrar.has(x.id)).sort((x, y) => (y.usos || 0) - (x.usos || 0))) {
          const k = normalizar(n.resumen || n.etiqueta);
          if (vistos.has(k)) borrar.set(n.id, 'repetido'); else vistos.set(k, n);
        }
        // 3) Restos de búsquedas: quedan los 25 más usados/recientes; fuera los de sitios que no aportan.
        const web = nodos.filter(n => n.tipo === 'fuente').sort((x, y) => (y.usos || 0) - (x.usos || 0) || String(y.ultimo_uso || y.creado_en).localeCompare(String(x.ultimo_uso || x.creado_en)));
        web.forEach((n, i) => { if (SITIO_BASURA.test(`${n.etiqueta} ${n.url || ''}`)) borrar.set(n.id, 'sitio que no aporta'); else if (i >= 25 && (n.usos || 0) <= 2) borrar.set(n.id, 'búsqueda vieja'); });
        // 4) Ramas inventadas → sus temas pasan a la rama fija que corresponde.
        for (const r of nodos.filter(n => n.tipo === 'dominio' && String(n.clave).startsWith('dom:rama:') && !CANON.has(n.clave))) {
          for (const t of salen.get(r.id) || []) { const tn = porId.get(t); if (tn && tn.tipo === 'tema') mover.push({ tema: t, desde: r.id, hacia: ramaCanonica(r.etiqueta, tn.etiqueta, tn.resumen || '') }); }
          borrar.set(r.id, 'rama repetida o inventada');
        }
        // 5) Temas sueltos (sin rama) → a su rama fija; temas vacíos (sin nada adentro ni resumen) → fuera.
        const enRama = (id: string) => (entran.get(id) || []).some(o => { const p = porId.get(o); return p && (p.tipo === 'dominio' || p.tipo === 'raiz') && !borrar.has(o); });
        for (const t of nodos.filter(n => n.tipo === 'tema' && !borrar.has(n.id))) {
          const hijos = (salen.get(t.id) || []).filter(h => !borrar.has(h) && porId.get(h));
          if (!hijos.length && !(t.resumen || '').trim()) { borrar.set(t.id, 'tema vacío'); continue; }
          if (!enRama(t.id) && !mover.some(m => m.tema === t.id)) mover.push({ tema: t.id, desde: null, hacia: ramaCanonica('', t.etiqueta, t.resumen || '') });
        }
        const plan = {
          borrar: borrar.size, mover: mover.length,
          motivos: [...borrar.values()].reduce((a: Record<string, number>, m) => { a[m] = (a[m] || 0) + 1; return a; }, {}),
          ejemplos_borrar: [...borrar.keys()].slice(0, 8).map(id => porId.get(id)?.etiqueta),
          ejemplos_mover: mover.slice(0, 30).map(m => `${porId.get(m.tema)?.etiqueta} → ${m.hacia.nombre}`),
          total: nodos.length,
        };
        if (d.aplicar !== true) return { ok: true, nodo: { plan } };
        // Aplicar: primero las ramas fijas y los movimientos, después el borrado.
        for (const m of mover) {
          const r = await ramaFija(m.hacia);
          if (!r) continue;
          if (m.desde) await admin.from('jarvis_enlaces').delete().eq('user_id', uid).eq('origen', m.desde).eq('destino', m.tema);
          await nuevoEnlace(r.id, m.tema, 'incluye');
        }
        const ids = [...borrar.keys()];
        for (let i = 0; i < ids.length; i += 80) {
          const lote = ids.slice(i, i + 80);
          await admin.from('jarvis_enlaces').delete().eq('user_id', uid).in('origen', lote);
          await admin.from('jarvis_enlaces').delete().eq('user_id', uid).in('destino', lote);
          await admin.from('jarvis_nodos').delete().eq('user_id', uid).in('id', lote);
        }
        temasWeb = null;
        return { ok: true, nodo: { plan, aplicado: true } };
      }
      if (op === 'ordenar') {
        // Ordena TODO lo viejo de internet de una vez (al abrir el cerebro).
        let total = 0;
        for (let i = 0; i < 15; i++) { const n = await consolidar(25); total += n; if (n < 25) break; }
        return { ok: true, nodo: { ordenadas: total } };
      }
      return { ok: false, error: 'Cambio desconocido.' };
    },

    /** Un módulo consultado o en el que se actuó se refuerza. */
    reforzarModulo(id: string) { if (MODULOS[id]) enFondo(modulo(id, true)); },

    /** Lo que ya sabe y viene al caso en este mensaje. */
    async recordarPara(texto: string, esOrden: boolean): Promise<{ bloque: string; usados: string[]; notas: Nota[] }> {
      // Cada mensaje ordena un poco lo viejo y vectoriza un poco más (no frena la respuesta).
      enFondo(consolidar(8));
      enFondo(vectorizarPendientes(24));
      // En paralelo: las ideas por palabras y las parecidas por significado.
      const porSignificado = (async () => {
        if (!(await hayVectores())) return [] as (Nodo & { similitud: number })[];
        const v = await vectores([texto]);
        return v ? await semejantes(v[0], 10) : [];
      })().catch(() => [] as (Nodo & { similitud: number })[]);
      const { data: nodos, error } = await admin.from('jarvis_nodos').select('id,clave,etiqueta,tipo,resumen,fuente,url,usos')
        .eq('user_id', uid).in('tipo', ['tema', 'dato', 'fuente', 'recuerdo']).order('usos', { ascending: false }).limit(1000);
      if (error) { vivo = false; return { bloque: '', usados: [], notas: [] }; }
      const msg = ` ${normalizar(texto)} `;
      const nombre = (n: Nodo) => normalizar(n.etiqueta.replace(/^(Inventario|Taller|Internet) · /, ''));
      // Lo que es basura (aunque todavía no se haya ordenado el cerebro) no se
      // recuerda: antes «Precio no disponible…» volvía en cada respuesta y
      // Jarvis repetía su propio error.
      const sirve = (n: Nodo) => !(BASURA.test(n.etiqueta) || BASURA.test(n.resumen || '') || SITIO_BASURA.test(`${n.etiqueta} ${n.url || ''}`));
      const directos = ((nodos || []) as Nodo[]).filter(sirve)
        .filter(n => n.tipo !== 'recuerdo' && n.resumen && nombre(n).length >= 3 && msg.includes(` ${nombre(n)} `))
        .filter(n => !(esOrden && n.fuente === 'internet'))
        .sort((x, y) => nombre(y).length - nombre(x).length || y.usos - x.usos).slice(0, 5);
      // Además, por PALABRAS: lo que comparte palabras importantes con el
      // mensaje (en el nombre pesa más que en el resumen). Así Jarvis revisa
      // primero lo que ya sabe aunque no se nombre el tema tal cual.
      // «Costa Rica» y las palabras de pedir («enlaces», «buscame»…) no dicen de
      // QUÉ se habla: con ellas salía política al pedir enlaces de cargadores.
      const VACIAS = new Set('para como cual cuál cuales donde cuando cuanto cuánto cuantos sobre tiene tienen tengo hacer hace esta este esto estos estas eso esos esas porque pero algo alguna alguno todo toda todos todas muy mas más menos desde hasta entre ahora hoy ayer mañana quiero queres querés podes podés puede pueden decime dime sabes sabés saber jarvis favor también tambien cosa cosas costa rica enlace enlaces link links pagina paginas sitio sitios busca buscame buscar dame pasame pasar necesito ocupo informacion info mandame envia enviame'.split(' '));
      // Raíz simple para que «cargadores» encuentre «cargador».
      const raiz = (w: string) => (w.length > 5 ? w.replace(/(es|s)$/, '') : w);
      const palabras = [...new Set(normalizar(texto).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4 && !VACIAS.has(w)).map(raiz))];
      if (palabras.length) {
        const ya = new Set(directos.map(n => n.id));
        const puntuados = ((nodos || []) as Nodo[]).filter(sirve)
          .filter(n => !ya.has(n.id) && n.tipo !== 'recuerdo' && n.resumen && !(esOrden && n.fuente === 'internet'))
          .map(n => {
            const et = normalizar(n.etiqueta), res = normalizar(n.resumen || '');
            let p = 0;
            for (const w of palabras) { if (et.includes(w)) p += 3; else if (res.includes(w)) p += 1; }
            return { n, p };
          })
          .filter(x => x.p >= 3 || (x.p >= 2 && palabras.length <= 3))
          .sort((x, y) => y.p - x.p || y.n.usos - x.n.usos).slice(0, Math.max(0, 8 - directos.length));
        directos.push(...puntuados.map(x => x.n));
      }
      // Lo que se parece por SIGNIFICADO aunque no comparta palabras.
      {
        const ya = new Set(directos.map(n => n.id));
        const sem = (await porSignificado).filter(x => sirve(x) && x.similitud >= 0.62 && !ya.has(x.id) && x.tipo !== 'recuerdo' && x.resumen && !(esOrden && x.fuente === 'internet'));
        directos.push(...sem.slice(0, Math.max(0, 10 - directos.length)));
      }
      if (!directos.length) return { bloque: '', usados: [], notas: [] };
      // Qué tan relacionada está cada idea con el mensaje (para responder sin IA).
      const peso = (n: Nodo) => { if (msg.includes(` ${nombre(n)} `)) return 100; const et = normalizar(n.etiqueta), res = normalizar(n.resumen || ''); let p = 0; for (const w of palabras) { if (et.includes(w)) p += 3; else if (res.includes(w)) p += 1; } return p; };
      const notas: Nota[] = directos.map(n => ({ nombre: nombreHumano(n.etiqueta, n.tipo, n.url), resumen: n.fuente === 'internet' ? limpiarExtracto(primerResultado(n.resumen || ''), 260) : recortar(n.resumen || '', 260), url: n.url, fuente: n.fuente, peso: peso(n), cubre: palabras.length ? palabras.filter(w => normalizar(n.etiqueta + ' ' + (n.resumen || '')).includes(w)).length / palabras.length : 1 }));
      const ids = directos.map(n => n.id);
      const { data: enl } = await admin.from('jarvis_enlaces').select('origen,destino,relacion')
        .eq('user_id', uid).or(`origen.in.(${ids.join(',')}),destino.in.(${ids.join(',')})`).limit(120);
      const porId = new Map(((nodos || []) as Nodo[]).map(n => [n.id, n]));
      const vecinos: Nodo[] = [];
      for (const e of (enl || []) as any[]) {
        const otro = porId.get(ids.includes(e.origen) ? e.destino : e.origen);
        if (otro && otro.resumen && !ids.includes(otro.id) && !vecinos.includes(otro) && !(esOrden && otro.fuente === 'internet')) vecinos.push(otro);
      }
      const linea = (n: Nodo) => `- ${nombreHumano(n.etiqueta, n.tipo, n.url)}${n.fuente ? ` [${n.fuente}]` : ''}: ${n.fuente === 'internet' ? limpiarExtracto(n.resumen || '', 500) : recortar(n.resumen || '', 500)}${n.url ? ` (enlace: ${n.url})` : ''}`;
      // Primero los puntos que cuelgan de lo encontrado (lo aprendido en
      // conversaciones y lo que agregó el dueño), después el resto.
      vecinos.sort((x, y) => Number(y.tipo === 'dato') - Number(x.tipo === 'dato') || y.usos - x.usos);
      const bloque = [...directos.map(linea), ...vecinos.slice(0, 12).map(linea)].join('\n').slice(0, 6000);
      enFondo((async () => {
        const ahora = new Date().toISOString();
        for (const n of directos) await admin.from('jarvis_nodos').update({ usos: (n.usos || 0) + 1, ultimo_uso: ahora }).eq('id', n.id);
      })());
      return { bloque, usados: directos.map(n => n.etiqueta), notas };
    },
  };
}
export type Cerebro = ReturnType<typeof crearCerebro>;

/**
 * Cuando ninguna IA contesta, Jarvis responde con su cerebro. Antes tiraba
 * TODO lo que encontraba, con nombres técnicos y texto de menús. Ahora:
 *  - solo lo que de verdad trata de lo que se preguntó (lo demás se calla);
 *  - con nombres humanos y resúmenes limpios;
 *  - si se pidieron enlaces, da los enlaces;
 *  - si no tiene nada que sirva, lo dice en vez de rellenar.
 */
export function respuestaSinIA(pregunta: string, notas: Nota[]): string {
  const q = normalizar(pregunta);
  const pideEnlaces = /\b(enlaces?|links?|url|paginas?|sitios? web|donde (lo )?(venden|compro|comprar|consigo))\b/.test(q);
  const mejor = Math.max(0, ...notas.map(n => n.peso));
  let utiles = notas.filter(n => n.peso >= 100 || (n.peso >= 3 && n.peso >= mejor * 0.6 && n.cubre >= 0.5));
  if (pideEnlaces) utiles = utiles.filter(n => n.url).concat(utiles.filter(n => !n.url)).slice(0, 5);
  // Lo mismo dicho dos veces (misma página o mismo nombre) se muestra una vez.
  const vistos = new Set<string>();
  utiles = utiles.filter(n => { const k = n.url || normalizar(n.nombre); if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, pideEnlaces ? 5 : 3);
  const aviso = 'Las IAs están saturadas ahora mismo';
  if (!utiles.length) return `${aviso} y en mi cerebro no tengo nada guardado sobre eso. Preguntame de nuevo en unos minutos y lo busco.`;
  const lineas = utiles.map(n => {
    if (pideEnlaces && n.url) return `- **${n.nombre}**: ${n.url}${n.resumen && n.resumen.length > 20 ? `\n  ${n.resumen}` : ''}`;
    return `- **${n.nombre}**: ${n.resumen || 'lo tengo anotado, sin más detalle.'}${n.url ? ` ([fuente](${n.url}))` : ''}`;
  });
  const desdeInternet = utiles.some(n => n.fuente === 'internet');
  const intro = pideEnlaces
    ? (utiles.some(n => n.url) ? `${aviso}. Estos son los enlaces que tengo guardados:` : `${aviso} y no tengo enlaces guardados de eso; esto es lo que sé:`)
    : `${aviso}. Esto es lo que tengo guardado sobre eso:`;
  return `${intro}\n\n${lineas.join('\n')}\n\n${desdeInternet ? 'Lo de internet puede estar desactualizado. ' : ''}Si necesitás algo más actual, preguntame de nuevo en unos minutos.`;
}
