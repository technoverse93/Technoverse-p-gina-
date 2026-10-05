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
export type Nodo = { id: string; clave: string; etiqueta: string; tipo: string; resumen: string | null; fuente: string | null; url: string | null; usos: number };
export type Aprendido = { etiqueta: string; clave: string; nuevo: boolean };

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
  async function modulo(id: string, usar = true) {
    const negocio = await dominio('negocio', 'Negocio');
    const m = await asegurarNodo(`mod:${id}`, MODULOS[id] || id, 'modulo', { usar });
    await enlazar(negocio?.id, m?.id, 'contiene');
    return m;
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
      const ramaN = await dominio(`rama:${normalizar(rama)}`, rama);
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

    /** Cada búsqueda en internet queda como nodo bajo «Internet». */
    registrarWeb(consulta: string, resultados: { titulo: string; url: string; extracto: string }[]): Aprendido | null {
      const c = limpio(consulta, 80);
      if (c.length < 3 || !resultados?.length || PRIVADO.test(c)) return null;
      const clave = `web:${normalizar(c)}`;
      enFondo((async () => {
        const inter = await dominio('internet', 'Internet');
        const resumen = limpio(resultados.slice(0, 3).map(r => `${r.titulo}: ${r.extracto}`).join(' · '), 1400);
        const n = await asegurarNodo(clave, c, 'fuente', { resumen, fuente: 'internet', url: resultados[0]?.url, usar: true });
        await enlazar(inter?.id, n?.id, 'buscó');
      })());
      return { etiqueta: c, clave, nuevo: true };
    },

    /** Un «recordá…» queda bajo «Sobre vos». */
    registrarRecuerdo(texto: string, tipo: string) {
      enFondo((async () => {
        const vos = await dominio('dueno', 'Sobre vos');
        const n = await asegurarNodo(`rec:${normalizar(texto).slice(0, 120)}`, recortar(texto, 80), 'recuerdo', { resumen: texto, fuente: 'vos' });
        await enlazar(vos?.id, n?.id, tipo === 'negocio' ? 'del negocio' : tipo === 'forma_de_hablar' ? 'cómo habla' : 'prefiere');
      })());
    },

    /** Un módulo consultado o en el que se actuó se refuerza. */
    reforzarModulo(id: string) { if (MODULOS[id]) enFondo(modulo(id, true)); },

    /** Lo que ya sabe y viene al caso en este mensaje. */
    async recordarPara(texto: string, esOrden: boolean): Promise<{ bloque: string; usados: string[] }> {
      const { data: nodos, error } = await admin.from('jarvis_nodos').select('id,clave,etiqueta,tipo,resumen,fuente,usos')
        .eq('user_id', uid).in('tipo', ['tema', 'dato', 'fuente', 'recuerdo']).order('usos', { ascending: false }).limit(600);
      if (error) { vivo = false; return { bloque: '', usados: [] }; }
      const msg = ` ${normalizar(texto)} `;
      const nombre = (n: Nodo) => normalizar(n.etiqueta.replace(/^(Inventario|Taller|Internet) · /, ''));
      const directos = ((nodos || []) as Nodo[])
        .filter(n => n.tipo !== 'recuerdo' && n.resumen && nombre(n).length >= 3 && msg.includes(` ${nombre(n)} `))
        .filter(n => !(esOrden && n.fuente === 'internet'))
        .sort((x, y) => nombre(y).length - nombre(x).length || y.usos - x.usos).slice(0, 4);
      if (!directos.length) return { bloque: '', usados: [] };
      const ids = directos.map(n => n.id);
      const { data: enl } = await admin.from('jarvis_enlaces').select('origen,destino,relacion')
        .eq('user_id', uid).or(`origen.in.(${ids.join(',')}),destino.in.(${ids.join(',')})`).limit(40);
      const porId = new Map(((nodos || []) as Nodo[]).map(n => [n.id, n]));
      const vecinos: Nodo[] = [];
      for (const e of (enl || []) as any[]) {
        const otro = porId.get(ids.includes(e.origen) ? e.destino : e.origen);
        if (otro && otro.resumen && !ids.includes(otro.id) && !vecinos.includes(otro) && !(esOrden && otro.fuente === 'internet')) vecinos.push(otro);
      }
      const linea = (n: Nodo) => `- ${n.etiqueta}${n.fuente ? ` [${n.fuente}]` : ''}: ${recortar(n.resumen || '', 500)}`;
      const bloque = [...directos.map(linea), ...vecinos.slice(0, 6).map(linea)].join('\n').slice(0, 4000);
      enFondo((async () => {
        const ahora = new Date().toISOString();
        for (const n of directos) await admin.from('jarvis_nodos').update({ usos: (n.usos || 0) + 1, ultimo_uso: ahora }).eq('id', n.id);
      })());
      return { bloque, usados: directos.map(n => n.etiqueta) };
    },
  };
}
export type Cerebro = ReturnType<typeof crearCerebro>;
