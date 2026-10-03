// =====================================================================
// ASISTENTE IA — chat de consulta del personal, con IA gratuita
// =====================================================================
// Recibe un mensaje de una persona del personal, lo manda a Gemini (Google)
// y, si Google responde que se agotó el cupo, a Groq como respaldo. Guarda
// la conversación, lleva la cuenta del uso diario y devuelve la respuesta
// con sus tokens y el cupo que queda.
//
// LAS CLAVES viven solo aquí, como secretos de la función:
//   GEMINI_API_KEY   (aistudio.google.com)          — obligatoria
//   GROQ_API_KEY     (console.groq.com)             — opcional (respaldo)
//   GEMINI_MODEL     por defecto «gemini-flash-latest»: el alias que Google
//                    mueve solo al Flash más nuevo.
//   GROQ_MODEL       por defecto «llama-3.3-70b-versatile».
//
// CONSULTAS AL SISTEMA (fase 2): la IA puede pedir datos de inventario,
// facturación, taller y errores mediante «herramientas» (ver
// herramientas.ts). Se ejecutan con la sesión de quien pregunta y nunca
// devuelven datos de clientes.
//
// SEGURIDAD: la identidad sale del JWT de quien llama (no del cuerpo), el
// acceso y el límite diario se comprueban aquí, y la base solo deja que cada
// quien lea sus propias conversaciones.
// =====================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { disponibles, ejecutar, NOMBRE_MODULO, type Consulta, type Contexto } from './herramientas.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile';
// Si el Flash está saturado o sin cupo, se prueba el Flash-Lite (cupo aparte)
// antes de pasar a Groq.
const GEMINI_RESPALDO = Deno.env.get('GEMINI_MODEL_RESPALDO') || 'gemini-flash-lite-latest';
// Cupo del equipo según el plan gratis de cada servicio. Solo se usa para
// dibujar la barra; el límite real lo pone cada servicio.
const CUPO_GEMINI = Number(Deno.env.get('CUPO_GEMINI_DIA') || 1000);
const CUPO_GROQ = Number(Deno.env.get('CUPO_GROQ_DIA') || 1000);
const MAX_HISTORIAL = 20;          // mensajes previos que se mandan como contexto
const MAX_TEXTO = 8000;            // caracteres por mensaje
const TOPE_RED_MS = 45000;

const MAX_RONDAS = 4;               // consultas encadenadas por mensaje

const sistema = (hoy: string, conHerramientas: boolean) => `Eres el asistente del panel de Technoverse Costa Rica, una tienda y taller de celulares y accesorios.
Hoy es ${hoy} (hora de Costa Rica). Responde en español de Costa Rica, claro y al grano. Usa listas cortas o tablas en markdown cuando ayuden.
${conHerramientas ? `Tienes consultas de SOLO LECTURA al sistema de la tienda. Úsalas siempre que la pregunta sea sobre el inventario, las ventas o facturas, el taller o los errores del sistema; nunca inventes cifras del negocio. Si una consulta dice que no hay acceso, explícalo sin inventar. No puedes crear, editar ni borrar nada: si te piden un cambio, indica en qué módulo del panel se hace.
` : ''}Si buscaste en internet, apóyate en las fuentes. Si no sabes algo, dilo.
No pidas ni repitas datos personales de clientes (cédulas, teléfonos, direcciones).`;

type Turno = { rol: 'user' | 'assistant'; texto: string };
type Resultado = { texto: string; fuentes: { titulo: string; url: string }[]; tokensIn: number; tokensOut: number; proveedor: 'gemini' | 'groq'; modelo: string; busco: boolean; consultas: Consulta[]; sinBusqueda?: boolean };
/** Lo que necesita la IA para consultar el sistema en este mensaje. */
type Sistema = { ctx: Contexto; herramientas: ReturnType<typeof disponibles>; consultas: Consulta[]; usados: Record<string, number> };

async function correrHerramienta(nombre: string, args: Record<string, unknown>, sis: Sistema): Promise<unknown> {
  const salida = await ejecutar(nombre, args, sis.ctx, sis.herramientas);
  sis.consultas.push(salida.consulta);
  const h = sis.herramientas.find(x => x.nombre === nombre);
  if (h && !salida.consulta.sinPermiso) sis.usados[h.modulo] = (sis.usados[h.modulo] || 0) + 1;
  return salida.datos;
}

class CupoAgotado extends Error {}

function diaCR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
}

async function conTope(url: string, init: RequestInit): Promise<Response> {
  const corte = new AbortController();
  const t = setTimeout(() => corte.abort(), TOPE_RED_MS);
  try { return await fetch(url, { ...init, signal: corte.signal }); } finally { clearTimeout(t); }
}

// La búsqueda en Google (grounding) no viene en todos los planes gratis:
// cuando Google la rechaza, se recuerda un rato para no gastar una
// llamada en cada mensaje y se responde sin buscar.
let busquedaBloqueadaHasta = 0;

async function preguntarGemini(historial: Turno[], buscar: boolean, modelo: string, sis: Sistema): Promise<Resultado> {
  const clave = Deno.env.get('GEMINI_API_KEY');
  if (!clave) throw new CupoAgotado('Falta GEMINI_API_KEY en los secretos');
  const conHerramientas = sis.herramientas.length > 0;
  // La búsqueda en Google y las consultas al sistema no se combinan en la
  // misma llamada: si hay consultas, mandan ellas.
  const conBusqueda = buscar && !conHerramientas && Date.now() > busquedaBloqueadaHasta;
  const contents: any[] = historial.map(t => ({ role: t.rol === 'assistant' ? 'model' : 'user', parts: [{ text: t.texto }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  let tokensIn = 0, tokensOut = 0;

  for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
    const cuerpo: Record<string, unknown> = { systemInstruction: { parts: [{ text: sistema(sis.ctx.hoy, conHerramientas) }] }, contents };
    // En la última ronda ya no se ofrecen consultas: tiene que responder.
    if (conHerramientas && ronda < MAX_RONDAS) {
      cuerpo.tools = [{ functionDeclarations: sis.herramientas.map(h => ({ name: h.nombre, description: h.descripcion, parameters: h.parametros })) }];
    } else if (conBusqueda) {
      cuerpo.tools = [{ google_search: {} }];
    }
    const r = await conTope(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify(cuerpo) });
    if (!r.ok) {
      const det = await r.text().catch(() => '');
      console.log(`gemini ${modelo} busqueda=${conBusqueda} ronda=${ronda} -> ${r.status}: ${det.slice(0, 300)}`);
      if (conBusqueda && (r.status === 400 || r.status === 429)) {
        busquedaBloqueadaHasta = Date.now() + 30 * 60_000;
        const sin = await preguntarGemini(historial, false, modelo, sis);
        return { ...sin, sinBusqueda: true };
      }
      if (r.status === 429 || r.status >= 500) throw new CupoAgotado(`Gemini ${modelo} ${r.status}`);
      throw new Error(`Gemini respondió ${r.status}: ${det.slice(0, 200)}`);
    }
    const d = await r.json();
    tokensIn += Number(d?.usageMetadata?.promptTokenCount || 0);
    tokensOut += Number(d?.usageMetadata?.candidatesTokenCount || 0) + Number(d?.usageMetadata?.thoughtsTokenCount || 0);
    const cand = d?.candidates?.[0];
    const partes: any[] = cand?.content?.parts || [];
    const llamadas = partes.filter(p => p?.functionCall);
    if (llamadas.length && ronda < MAX_RONDAS) {
      // Se devuelve el turno del modelo tal cual (con sus firmas de
      // razonamiento) y, después, el resultado de cada consulta.
      contents.push(cand.content);
      const respuestas = [];
      for (const p of llamadas) {
        const datos = await correrHerramienta(p.functionCall.name, p.functionCall.args || {}, sis);
        respuestas.push({ functionResponse: { ...(p.functionCall.id ? { id: p.functionCall.id } : {}), name: p.functionCall.name, response: { resultado: datos } } });
      }
      contents.push({ role: 'user', parts: respuestas });
      continue;
    }
    const texto = partes.map(p => p?.text || '').join('').trim();
    if (!texto) throw new CupoAgotado('Gemini no devolvió texto');
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const fuentes = chunks
      .map((c: any) => ({ titulo: String(c?.web?.title || '').slice(0, 80), url: String(c?.web?.uri || '') }))
      .filter((f: any) => f.url)
      .slice(0, 6);
    return {
      texto, fuentes, tokensIn, tokensOut,
      proveedor: 'gemini', modelo: String(d?.modelVersion || modelo), busco: conBusqueda && fuentes.length > 0,
      consultas: sis.consultas, sinBusqueda: buscar && !conBusqueda && !conHerramientas,
    };
  }
  throw new Error('La IA no terminó de responder.');
}

async function preguntarGroq(historial: Turno[], sis: Sistema): Promise<Resultado> {
  const clave = Deno.env.get('GROQ_API_KEY');
  if (!clave) { console.log('groq: falta GROQ_API_KEY en los secretos'); throw new CupoAgotado('Sin respaldo configurado'); }
  const conHerramientas = sis.herramientas.length > 0;
  const mensajes: any[] = [{ role: 'system', content: sistema(sis.ctx.hoy, conHerramientas) }, ...historial.map(t => ({ role: t.rol, content: t.texto }))];
  let tokensIn = 0, tokensOut = 0;
  for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
    const cuerpo: Record<string, unknown> = { model: GROQ_MODEL, messages: mensajes, temperature: 0.4 };
    if (conHerramientas && ronda < MAX_RONDAS) {
      cuerpo.tools = sis.herramientas.map(h => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } }));
    }
    const r = await conTope('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) {
      const det = await r.text().catch(() => '');
      console.log(`groq ${GROQ_MODEL} ronda=${ronda} -> ${r.status}: ${det.slice(0, 300)}`);
      if (r.status === 429 || r.status >= 500) throw new CupoAgotado('Groq sin cupo');
      throw new Error(`Groq respondió ${r.status}: ${det.slice(0, 200)}`);
    }
    const d = await r.json();
    tokensIn += Number(d?.usage?.prompt_tokens || 0); tokensOut += Number(d?.usage?.completion_tokens || 0);
    const msg = d?.choices?.[0]?.message || {};
    const llamadas: any[] = msg.tool_calls || [];
    if (llamadas.length && ronda < MAX_RONDAS) {
      mensajes.push({ role: 'assistant', content: msg.content || null, tool_calls: llamadas });
      for (const c of llamadas) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c?.function?.arguments || '{}'); } catch { /* argumentos inválidos: sin filtros */ }
        const datos = await correrHerramienta(c?.function?.name, args, sis);
        mensajes.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(datos) });
      }
      continue;
    }
    const texto = String(msg.content || '').trim();
    if (!texto) throw new Error('Groq no devolvió respuesta.');
    return {
      texto, fuentes: [], tokensIn, tokensOut,
      proveedor: 'groq', modelo: String(d?.model || GROQ_MODEL), busco: false, consultas: sis.consultas,
    };
  }
  throw new Error('La IA no terminó de responder.');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: quien } = await admin.auth.getUser(jwt);
    const uid = quien?.user?.id;
    if (!uid) return responder({ ok: false, error: 'Sesión no válida.' }, 401);

    const [{ data: perfil }, { data: ajustes }] = await Promise.all([
      admin.from('profiles').select('role').eq('id', uid).maybeSingle(),
      admin.from('ia_ajustes').select('*').eq('id', 1).maybeSingle(),
    ]);
    const rol = perfil?.role as string | undefined;
    const esSuper = rol === 'superadmin';
    const acceso = ajustes?.acceso || 'personal';
    const permitido = esSuper
      || (acceso === 'personal' && (rol === 'admin' || rol === 'empleado'))
      || (acceso === 'gestion' && rol === 'admin');
    if (!permitido) return responder({ ok: false, error: 'No tienes acceso al asistente.' }, 403);

    const cuerpo = await req.json().catch(() => ({}));
    const accion = String(cuerpo?.accion || 'enviar');
    const dia = diaCR();
    const limite = Number(ajustes?.limite_diario || 60);

    const usoHoy = async () => {
      const [{ data: mio }, { data: equipo }] = await Promise.all([
        admin.from('ia_uso_diario').select('mensajes,tokens,consultas').eq('user_id', uid).eq('dia', dia).maybeSingle(),
        admin.from('ia_uso_diario').select('gemini,groq').eq('dia', dia),
      ]);
      const gem = (equipo || []).reduce((a: number, f: any) => a + (f.gemini || 0), 0);
      const grq = (equipo || []).reduce((a: number, f: any) => a + (f.groq || 0), 0);
      return {
        usados: mio?.mensajes || 0, limite: esSuper ? null : limite,
        disponibles: esSuper ? null : Math.max(0, limite - (mio?.mensajes || 0)),
        tokensHoy: mio?.tokens || 0,
        equipo: { gemini: gem, groq: grq, cupoGemini: CUPO_GEMINI, cupoGroq: CUPO_GROQ },
        busqueda: !!ajustes?.busqueda, respaldo: !!ajustes?.respaldo, groqConfigurado: !!Deno.env.get('GROQ_API_KEY'),
        // Módulos que este usuario puede consultar (errores: solo superadmin).
        modulos: disponibles(ajustes?.modulos).map(h => h.modulo).filter((m, i, xs) => xs.indexOf(m) === i && (m !== 'errores' || esSuper)),
        consultasHoy: Object.values((mio as any)?.consultas || {}).reduce((a: number, n: any) => a + Number(n || 0), 0),
      };
    };

    if (accion === 'cupo') return responder({ ok: true, cupo: await usoHoy() });
    if (accion !== 'enviar') return responder({ ok: false, error: 'Acción desconocida.' }, 400);

    const texto = String(cuerpo?.texto || '').trim().slice(0, MAX_TEXTO);
    if (!texto) return responder({ ok: false, error: 'El mensaje está vacío.' }, 400);

    const antes = await usoHoy();
    if (!esSuper && antes.usados >= limite) {
      return responder({ ok: false, codigo: 'limite', error: 'Usaste todo tu cupo de hoy. Se renueva a la medianoche.', cupo: antes }, 429);
    }

    // Conversación: se usa la indicada solo si es de quien llama.
    let convId: string | null = cuerpo?.conversacionId ? String(cuerpo.conversacionId) : null;
    if (convId) {
      const { data: conv } = await admin.from('ia_conversaciones').select('id').eq('id', convId).eq('user_id', uid).maybeSingle();
      if (!conv) convId = null;
    }
    let nueva = false;
    if (!convId) {
      const titulo = texto.replace(/\s+/g, ' ').slice(0, 60);
      const { data: conv, error } = await admin.from('ia_conversaciones').insert({ user_id: uid, titulo }).select('id').single();
      if (error) throw error;
      convId = conv.id; nueva = true;
    }

    const { data: previos } = nueva ? { data: [] as any[] } : await admin
      .from('ia_mensajes').select('rol,texto').eq('conversacion_id', convId).order('creado_en', { ascending: false }).limit(MAX_HISTORIAL);
    const historial: Turno[] = [...(previos || []).reverse(), { rol: 'user', texto }] as Turno[];

    const buscar = !!ajustes?.busqueda && cuerpo?.buscar !== false;

    // Las consultas al sistema se hacen con la SESIÓN DE QUIEN PREGUNTA (no
    // con service_role): la base aplica las mismas reglas que en el panel.
    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const herramientas = disponibles(ajustes?.modulos);
    // Cada intento (Gemini, Flash-Lite, Groq) empieza con la lista de
    // consultas vacía, para no duplicar tarjetas si uno falla a medias.
    const nuevoSistema = (): Sistema => ({ ctx: { db: comoUsuario, esSuper, hoy: dia }, herramientas, consultas: [], usados: {} });
    let sis = nuevoSistema();

    // Gemini primero; si Google no tiene cupo, Groq (si está permitido).
    // `null` = ninguno de los dos tiene cupo ahora.
    const preguntar = async (): Promise<{ res: Resultado; respaldo: boolean } | null> => {
      for (const modelo of [GEMINI_MODEL, GEMINI_RESPALDO]) {
        try {
          sis = nuevoSistema();
          return { res: await preguntarGemini(historial, buscar, modelo, sis), respaldo: false };
        } catch (e) {
          if (!(e instanceof CupoAgotado)) throw e;
        }
      }
      if (!ajustes?.respaldo) return null;
      try {
        sis = nuevoSistema();
        return { res: await preguntarGroq(historial, sis), respaldo: true };
      } catch (e) {
        if (e instanceof CupoAgotado) return null;
        throw e;
      }
    };
    let salida: Awaited<ReturnType<typeof preguntar>>;
    try {
      salida = await preguntar();
    } catch (e) {
      // Si ninguna IA respondió, la conversación recién creada no se queda
      // vacía en la lista.
      if (nueva) await admin.from('ia_conversaciones').delete().eq('id', convId);
      throw e;
    }
    if (!salida) {
      if (nueva) await admin.from('ia_conversaciones').delete().eq('id', convId);
      const error = ajustes?.respaldo
        ? 'Los dos servicios gratuitos llegaron a su límite por ahora. Intenta en unos minutos.'
        : 'Google llegó a su límite por ahora. Intenta en unos minutos.';
      console.log('sin servicio: ni Gemini ni Groq respondieron');
      return responder({ ok: false, codigo: 'sin_servicio', error, cupo: antes }, 503);
    }
    const { res, respaldo: usoRespaldo } = salida;

    // Los dos mensajes llevan TODAS las columnas: en una inserción de varias
    // filas, la que no trae un campo lo manda como null (no usa el valor por
    // defecto), y `fuentes` no admite null.
    const ahora = new Date().toISOString();
    const despues = new Date(Date.now() + 1).toISOString();
    const fila = (m: Record<string, unknown>) => ({
      conversacion_id: convId, user_id: uid, fuentes: [], tokens_in: 0, tokens_out: 0, proveedor: null, modelo: null, busco: false, consultas: [], ...m,
    });
    const { error: errMsg } = await admin.from('ia_mensajes').insert([
      fila({ rol: 'user', texto, creado_en: ahora }),
      fila({ rol: 'assistant', texto: res.texto, fuentes: res.fuentes, tokens_in: res.tokensIn, tokens_out: res.tokensOut, proveedor: res.proveedor, modelo: res.modelo, busco: res.busco, consultas: res.consultas, creado_en: despues }),
    ]);
    if (errMsg) console.log(`no se guardaron los mensajes: ${errMsg.message}`);
    await admin.from('ia_conversaciones').update({ actualizado_en: new Date().toISOString() }).eq('id', convId);

    const { data: uso } = await admin.from('ia_uso_diario').select('mensajes,tokens,gemini,groq,consultas').eq('user_id', uid).eq('dia', dia).maybeSingle();
    const f = uso || { mensajes: 0, tokens: 0, gemini: 0, groq: 0, consultas: {} };
    const consultasHoy: Record<string, number> = { ...(f.consultas || {}) };
    for (const [m, n] of Object.entries(sis.usados)) consultasHoy[m] = (consultasHoy[m] || 0) + n;
    const { error: errUso } = await admin.from('ia_uso_diario').upsert({
      user_id: uid, dia,
      mensajes: f.mensajes + 1,
      tokens: f.tokens + res.tokensIn + res.tokensOut,
      gemini: f.gemini + (res.proveedor === 'gemini' ? 1 : 0),
      groq: f.groq + (res.proveedor === 'groq' ? 1 : 0),
      consultas: consultasHoy,
    });
    if (errUso) console.log(`no se guardó el uso: ${errUso.message}`);

    // Bitácora: qué módulo consultó el asistente (no qué se preguntó).
    const modulosUsados = Object.keys(sis.usados);
    if (modulosUsados.length) {
      await admin.from('audit_logs').insert({
        id: `LOG-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
        user_email: quien?.user?.email || null,
        module: 'Asistente IA',
        action: 'Consulta al sistema',
        detail: 'Consultó: ' + modulosUsados.map(m => `${NOMBRE_MODULO[m] || m} (${sis.usados[m]})`).join(', '),
      });
    }

    return responder({
      ok: true, conversacionId: convId, nueva, respaldo: usoRespaldo, sinBusqueda: !!res.sinBusqueda,
      mensaje: { rol: 'assistant', texto: res.texto, fuentes: res.fuentes, tokens_in: res.tokensIn, tokens_out: res.tokensOut, proveedor: res.proveedor, modelo: res.modelo, busco: res.busco, consultas: res.consultas },
      cupo: await usoHoy(),
    });
  } catch (e) {
    return responder({ ok: false, error: e instanceof Error ? e.message : 'No se pudo responder.' }, 500);
  }
});
