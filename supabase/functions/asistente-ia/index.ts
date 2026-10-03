// =====================================================================
// ASISTENTE IA — chat de consulta del personal, con IA gratuita
// =====================================================================
// Recibe un mensaje de una persona del personal, lo manda a Gemini (Google)
// y, si Google no tiene cupo, a Groq como respaldo. Guarda la conversación,
// lleva la cuenta del uso diario y devuelve la respuesta con sus tokens y
// el cupo que queda.
//
// LAS CLAVES viven solo aquí, como secretos de la función:
//   GEMINI_API_KEY   (aistudio.google.com)          — obligatoria
//   GROQ_API_KEY     (console.groq.com)             — opcional (respaldo)
//   GEMINI_MODEL     por defecto «gemini-flash-latest» (el Flash más nuevo)
//   GEMINI_MODEL_RESPALDO  por defecto «gemini-flash-lite-latest»
//   GROQ_MODEL       por defecto «llama-3.3-70b-versatile».
//
// CONSULTAS AL SISTEMA: la IA pide datos de inventario, facturación, taller,
// errores y —solo el superadmin— ciberseguridad, ingresos, ubicaciones y
// finanzas mediante «herramientas» (herramientas.ts). Se ejecutan con la
// sesión de quien pregunta. Las del superadmin van en DOS CARRILES: la IA
// recibe solo resúmenes y el detalle con datos personales va directo a la
// pantalla (nunca a Google).
//
// RAPIDEZ:
//   · Respuesta EN VIVO (SSE): el texto aparece mientras se escribe y las
//     tarjetas de consulta apenas se resuelven.
//   · Cortacircuito: si el Flash dice «sin cupo» (429) se salta una hora;
//     si dice «saturado» (503) o no contesta a tiempo, cinco minutos. Se va
//     directo al Flash-Lite.
//   · Tiempo máximo por intento y por mensaje; las consultas ya hechas se
//     reutilizan si hay que cambiar de modelo a mitad (no se repiten).
//   · Razonamiento «low»: en preguntas de datos, pensar de más solo tarda.
//   · Las lecturas iniciales van en paralelo y los guardados, después de
//     responder (EdgeRuntime.waitUntil).
//
// SEGURIDAD: la identidad sale del JWT de quien llama (no del cuerpo), el
// acceso y el límite diario se comprueban aquí, y la base solo deja que cada
// quien lea sus propias conversaciones.
// =====================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { disponibles, ejecutar, NOMBRE_MODULO, type Consulta, type Contexto } from './herramientas.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
const GEMINI_RESPALDO = Deno.env.get('GEMINI_MODEL_RESPALDO') || 'gemini-flash-lite-latest';
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile';
// Cupo del equipo según el plan gratis de cada servicio. Solo se usa para
// dibujar la barra; el límite real lo pone cada servicio.
const CUPO_GEMINI = Number(Deno.env.get('CUPO_GEMINI_DIA') || 1000);
const CUPO_GROQ = Number(Deno.env.get('CUPO_GROQ_DIA') || 1000);
const MAX_HISTORIAL = 20;          // mensajes previos que se mandan como contexto
const MAX_TEXTO = 8000;            // caracteres por mensaje
const MAX_RONDAS = 4;              // consultas encadenadas por mensaje
const TOPE_INTENTO_MS = 20000;     // por llamada a un modelo
const TOPE_TOTAL_MS = 40000;       // por mensaje completo

const sistema = (hoy: string, conHerramientas: boolean, esSuper: boolean) => `Eres el asistente del panel de Technoverse Costa Rica, una tienda y taller de celulares y accesorios.
Hoy es ${hoy} (hora de Costa Rica). Responde en español de Costa Rica, claro y al grano. Usa listas cortas o tablas en markdown cuando ayuden.
${conHerramientas ? `Tienes consultas de SOLO LECTURA al sistema. Úsalas siempre que la pregunta sea sobre datos del negocio; nunca inventes cifras. Elige la consulta que corresponde al tema (no busques un equipo o una persona en el taller si la pregunta es de ingresos o visitas). No puedes crear, editar ni borrar nada: si te piden un cambio, indica en qué módulo del panel se hace.
` : ''}${esSuper ? `Quien pregunta es el SUPERADMIN, dueño del sistema, con acceso total. Responde directo y completo sobre ciberseguridad, ingresos, visitantes, ubicaciones y finanzas: no evadas ni recortes. Esas consultas te dan conteos y resúmenes; el detalle completo (correos, IPs, coordenadas, mapa) ya le aparece al superadmin en pantalla junto a tu respuesta, así que no digas que no tienes acceso: resume, interpreta y menciona que el detalle está en la tabla.
` : `Ciberseguridad, ingresos, ubicaciones y finanzas son solo del superadmin: si te preguntan por eso, dilo en una frase.
`}Si no sabes algo, dilo. No pidas ni repitas datos personales de clientes (cédulas, teléfonos, direcciones).`;

type Turno = { rol: 'user' | 'assistant'; texto: string };
type Resultado = { texto: string; fuentes: { titulo: string; url: string }[]; tokensIn: number; tokensOut: number; proveedor: 'gemini' | 'groq'; modelo: string; busco: boolean; consultas: Consulta[] };
type Emisor = (evento: string, datos: unknown) => void;
/** Lo que necesita la IA para consultar el sistema en este mensaje. */
type Sistema = {
  ctx: Contexto; herramientas: ReturnType<typeof disponibles>; consultas: Consulta[]; usados: Record<string, number>;
  /** Resultados ya obtenidos en ESTE mensaje: si hay que cambiar de modelo, no se repiten. */
  hechas: Map<string, { datos: unknown; consulta: Consulta }>;
  emitir: Emisor; esSuper: boolean; limite: number;
};

class CupoAgotado extends Error {}

// Cortacircuito por modelo: hasta cuándo no se intenta (memoria de la instancia).
const pausado = new Map<string, number>();
const disponibleModelo = (m: string) => (pausado.get(m) || 0) < Date.now();
function pausar(m: string, status: number) {
  pausado.set(m, Date.now() + (status === 429 ? 60 : 5) * 60_000);
}

async function correrHerramienta(nombre: string, args: Record<string, unknown>, sis: Sistema): Promise<unknown> {
  const clave = `${nombre}:${JSON.stringify(args || {})}`;
  let salida = sis.hechas.get(clave);
  if (!salida) {
    const modulo = sis.herramientas.find(h => h.nombre === nombre)?.modulo || '';
    sis.emitir('estado', { texto: `Consultando ${NOMBRE_MODULO[modulo] || 'el sistema'}…` });
    salida = await ejecutar(nombre, args, sis.ctx, sis.herramientas);
    sis.hechas.set(clave, salida);
  }
  if (!sis.consultas.includes(salida.consulta)) {
    sis.consultas.push(salida.consulta);
    sis.emitir('consulta', salida.consulta);
    const h = sis.herramientas.find(x => x.nombre === nombre);
    if (h && !salida.consulta.sinPermiso) sis.usados[h.modulo] = (sis.usados[h.modulo] || 0) + 1;
  }
  return salida.datos;
}

function diaCR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
}

async function conTope(url: string, init: RequestInit, ms: number): Promise<Response> {
  const corte = new AbortController();
  const t = setTimeout(() => corte.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: corte.signal });
  } catch (e) {
    // Un modelo que no contesta a tiempo se trata como saturado.
    if (corte.signal.aborted) throw new CupoAgotado('tiempo agotado');
    throw e;
  } finally { clearTimeout(t); }
}

/** Lee un cuerpo SSE («data: {...}») y entrega cada objeto JSON. */
async function* leerSSE(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const lector = cuerpo.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += value;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linea = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (linea.startsWith('data:')) {
        const json = linea.slice(5).trim();
        if (json && json !== '[DONE]') { try { yield JSON.parse(json); } catch { /* fragmento inválido */ } }
      }
    }
  }
}

async function preguntarGemini(historial: Turno[], modelo: string, sis: Sistema): Promise<Resultado> {
  const clave = Deno.env.get('GEMINI_API_KEY');
  if (!clave) throw new CupoAgotado('Falta GEMINI_API_KEY en los secretos');
  const conHerramientas = sis.herramientas.length > 0;
  const contents: any[] = historial.map(t => ({ role: t.rol === 'assistant' ? 'model' : 'user', parts: [{ text: t.texto }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`;
  let tokensIn = 0, tokensOut = 0, version = modelo, empezo = false;

  for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
    const cuerpo: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: sistema(sis.ctx.hoy, conHerramientas, sis.esSuper) }] },
      contents,
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    };
    // En la última ronda ya no se ofrecen consultas: tiene que responder.
    if (conHerramientas && ronda < MAX_RONDAS) {
      cuerpo.tools = [{ functionDeclarations: sis.herramientas.map(h => ({ name: h.nombre, description: h.descripcion, parameters: h.parametros })) }];
    }
    const restante = sis.limite - Date.now();
    if (restante < 3000) throw new CupoAgotado('sin tiempo');
    const r = await conTope(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify(cuerpo) }, Math.min(TOPE_INTENTO_MS, restante))
      .catch(e => { if (e instanceof CupoAgotado) pausar(modelo, 503); throw e; });
    if (!r.ok || !r.body) {
      const det = await r.text().catch(() => '');
      console.log(`gemini ${modelo} ronda=${ronda} -> ${r.status}: ${det.slice(0, 300)}`);
      if (r.status === 429 || r.status >= 500) { pausar(modelo, r.status); throw new CupoAgotado(`Gemini ${modelo} ${r.status}`); }
      throw new Error(`Gemini respondió ${r.status}: ${det.slice(0, 200)}`);
    }

    // Se juntan las partes de la ronda (el turno del modelo se devuelve tal
    // cual, con sus firmas de razonamiento) y el texto sale en vivo.
    const partes: any[] = [];
    let texto = '';
    let uso: any = null;
    for await (const trozo of leerSSE(r.body)) {
      if (trozo?.usageMetadata) uso = trozo.usageMetadata; // el último trae el total
      if (trozo?.modelVersion) version = trozo.modelVersion;
      for (const p of trozo?.candidates?.[0]?.content?.parts || []) {
        partes.push(p);
        if (p?.text && !p?.thought) {
          if (!empezo) { empezo = true; sis.emitir('modelo', { modelo: version }); }
          texto += p.text;
          sis.emitir('texto', { delta: p.text });
        }
      }
    }
    tokensIn += Number(uso?.promptTokenCount || 0);
    tokensOut += Number(uso?.candidatesTokenCount || 0) + Number(uso?.thoughtsTokenCount || 0);

    const llamadas = partes.filter(p => p?.functionCall);
    if (llamadas.length && ronda < MAX_RONDAS) {
      contents.push({ role: 'model', parts: partes });
      const respuestas = await Promise.all(llamadas.map(async p => ({
        functionResponse: {
          ...(p.functionCall.id ? { id: p.functionCall.id } : {}),
          name: p.functionCall.name,
          response: { resultado: await correrHerramienta(p.functionCall.name, p.functionCall.args || {}, sis) },
        },
      })));
      contents.push({ role: 'user', parts: respuestas });
      continue;
    }
    texto = texto.trim();
    if (!texto) throw new CupoAgotado('Gemini no devolvió texto');
    return { texto, fuentes: [], tokensIn, tokensOut, proveedor: 'gemini', modelo: String(version), busco: false, consultas: sis.consultas };
  }
  throw new Error('La IA no terminó de responder.');
}

async function preguntarGroq(historial: Turno[], sis: Sistema): Promise<Resultado> {
  const clave = Deno.env.get('GROQ_API_KEY');
  if (!clave) { console.log('groq: falta GROQ_API_KEY en los secretos'); throw new CupoAgotado('Sin respaldo configurado'); }
  const conHerramientas = sis.herramientas.length > 0;
  const mensajes: any[] = [{ role: 'system', content: sistema(sis.ctx.hoy, conHerramientas, sis.esSuper) }, ...historial.map(t => ({ role: t.rol, content: t.texto }))];
  let tokensIn = 0, tokensOut = 0;
  for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
    const cuerpo: Record<string, unknown> = { model: GROQ_MODEL, messages: mensajes, temperature: 0.4 };
    if (conHerramientas && ronda < MAX_RONDAS) {
      cuerpo.tools = sis.herramientas.map(h => ({ type: 'function', function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } }));
    }
    const restante = sis.limite - Date.now();
    if (restante < 2000) throw new CupoAgotado('sin tiempo');
    const r = await conTope('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify(cuerpo),
    }, Math.min(TOPE_INTENTO_MS, restante));
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
    sis.emitir('modelo', { modelo: d?.model || GROQ_MODEL });
    sis.emitir('texto', { delta: texto });
    return { texto, fuentes: [], tokensIn, tokensOut, proveedor: 'groq', modelo: String(d?.model || GROQ_MODEL), busco: false, consultas: sis.consultas };
  }
  throw new Error('La IA no terminó de responder.');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const cuerpo = await req.json().catch(() => ({}));
    const accion = String(cuerpo?.accion || 'enviar');
    const dia = diaCR();
    let convId: string | null = cuerpo?.conversacionId ? String(cuerpo.conversacionId) : null;

    const { data: quien } = await admin.auth.getUser(jwt);
    const uid = quien?.user?.id;
    if (!uid) return responder({ ok: false, error: 'Sesión no válida.' }, 401);

    // Todo lo que no depende entre sí, en paralelo.
    const conConv = !!convId && accion === 'enviar';
    const [{ data: perfil }, { data: ajustes }, { data: mio }, { data: equipo }, conv, previos] = await Promise.all([
      admin.from('profiles').select('role').eq('id', uid).maybeSingle(),
      admin.from('ia_ajustes').select('*').eq('id', 1).maybeSingle(),
      admin.from('ia_uso_diario').select('mensajes,tokens,gemini,groq,consultas').eq('user_id', uid).eq('dia', dia).maybeSingle(),
      admin.from('ia_uso_diario').select('gemini,groq').eq('dia', dia),
      conConv
        ? admin.from('ia_conversaciones').select('id').eq('id', convId).eq('user_id', uid).maybeSingle()
        : Promise.resolve({ data: null }),
      conConv
        ? admin.from('ia_mensajes').select('rol,texto').eq('conversacion_id', convId).eq('user_id', uid).order('creado_en', { ascending: false }).limit(MAX_HISTORIAL)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const rol = perfil?.role as string | undefined;
    const esSuper = rol === 'superadmin';
    const acceso = ajustes?.acceso || 'personal';
    const permitido = esSuper
      || (acceso === 'personal' && (rol === 'admin' || rol === 'empleado'))
      || (acceso === 'gestion' && rol === 'admin');
    if (!permitido) return responder({ ok: false, error: 'No tienes acceso al asistente.' }, 403);
    const limite = Number(ajustes?.limite_diario || 60);

    const armarCupo = (u: any, eq: any[]) => ({
      usados: u?.mensajes || 0, limite: esSuper ? null : limite,
      disponibles: esSuper ? null : Math.max(0, limite - (u?.mensajes || 0)),
      tokensHoy: u?.tokens || 0,
      equipo: {
        gemini: (eq || []).reduce((a: number, f: any) => a + (f.gemini || 0), 0),
        groq: (eq || []).reduce((a: number, f: any) => a + (f.groq || 0), 0),
        cupoGemini: CUPO_GEMINI, cupoGroq: CUPO_GROQ,
      },
      // La búsqueda en Google no está en el plan gratis y no se combina con
      // las consultas al sistema: queda apagada.
      busqueda: false, respaldo: !!ajustes?.respaldo, groqConfigurado: !!Deno.env.get('GROQ_API_KEY'),
      modulos: [...new Set(disponibles(ajustes?.modulos, esSuper).map(h => h.modulo))],
      consultasHoy: Object.values(u?.consultas || {}).reduce((a: number, n: any) => a + Number(n || 0), 0),
    });
    const antes = armarCupo(mio, equipo || []);

    if (accion === 'cupo') return responder({ ok: true, cupo: antes });
    if (accion !== 'enviar') return responder({ ok: false, error: 'Acción desconocida.' }, 400);

    const texto = String(cuerpo?.texto || '').trim().slice(0, MAX_TEXTO);
    if (!texto) return responder({ ok: false, error: 'El mensaje está vacío.' }, 400);
    if (!esSuper && antes.usados >= limite) {
      return responder({ ok: false, codigo: 'limite', error: 'Usaste todo tu cupo de hoy. Se renueva a la medianoche.', cupo: antes }, 429);
    }

    // Conversación: se usa la indicada solo si es de quien llama.
    if (convId && !conv?.data) convId = null;
    let nueva = false;
    if (!convId) {
      const titulo = texto.replace(/\s+/g, ' ').slice(0, 60);
      const { data: c, error } = await admin.from('ia_conversaciones').insert({ user_id: uid, titulo }).select('id').single();
      if (error) throw error;
      convId = c.id; nueva = true;
    }
    const historial: Turno[] = [...((nueva ? [] : previos.data) || []).reverse(), { rol: 'user', texto }] as Turno[];

    // Las consultas al sistema se hacen con la SESIÓN DE QUIEN PREGUNTA (no
    // con service_role): la base aplica las mismas reglas que en el panel.
    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const herramientas = disponibles(ajustes?.modulos, esSuper);

    // ---------------------------------------------------------------
    // Conversación con la IA. `emitir` manda eventos en vivo si el panel
    // los pidió; si no, no hace nada y al final se responde con JSON.
    // ---------------------------------------------------------------
    const correr = async (emitir: Emisor) => {
      const hechas = new Map<string, { datos: unknown; consulta: Consulta }>();
      const limiteT = Date.now() + TOPE_TOTAL_MS;
      const nuevo = (): Sistema => ({ ctx: { db: comoUsuario, esSuper, hoy: dia }, herramientas, consultas: [], usados: {}, hechas, emitir, esSuper, limite: limiteT });
      for (const modelo of [GEMINI_MODEL, GEMINI_RESPALDO]) {
        if (!disponibleModelo(modelo)) continue;
        const sis = nuevo();
        try {
          return { res: await preguntarGemini(historial, modelo, sis), respaldo: false, sis };
        } catch (e) {
          if (!(e instanceof CupoAgotado)) throw e;
          emitir('reinicio', {}); // el panel borra el texto parcial, si lo hubo
        }
      }
      if (ajustes?.respaldo) {
        const sis = nuevo();
        try {
          return { res: await preguntarGroq(historial, sis), respaldo: true, sis };
        } catch (e) { if (!(e instanceof CupoAgotado)) throw e; }
      }
      return null;
    };

    // Guardar (se hace DESPUÉS de responder).
    const guardar = async (res: Resultado, sis: Sistema) => {
      const ahora = new Date().toISOString();
      const despues = new Date(Date.now() + 1).toISOString();
      // Todas las columnas en las dos filas: en una inserción múltiple, un
      // campo ausente va como null (no usa el valor por defecto).
      const fila = (m: Record<string, unknown>) => ({
        conversacion_id: convId, user_id: uid, fuentes: [], tokens_in: 0, tokens_out: 0, proveedor: null, modelo: null, busco: false, consultas: [], ...m,
      });
      const { error: errMsg } = await admin.from('ia_mensajes').insert([
        fila({ rol: 'user', texto, creado_en: ahora }),
        fila({ rol: 'assistant', texto: res.texto, fuentes: res.fuentes, tokens_in: res.tokensIn, tokens_out: res.tokensOut, proveedor: res.proveedor, modelo: res.modelo, busco: res.busco, consultas: res.consultas, creado_en: despues }),
      ]);
      if (errMsg) console.log(`no se guardaron los mensajes: ${errMsg.message}`);
      const consultasHoy: Record<string, number> = { ...(mio?.consultas || {}) };
      for (const [m, n] of Object.entries(sis.usados)) consultasHoy[m] = (consultasHoy[m] || 0) + n;
      const [, uso] = await Promise.all([
        admin.from('ia_conversaciones').update({ actualizado_en: new Date().toISOString() }).eq('id', convId),
        admin.from('ia_uso_diario').upsert({
          user_id: uid, dia,
          mensajes: (mio?.mensajes || 0) + 1,
          tokens: (mio?.tokens || 0) + res.tokensIn + res.tokensOut,
          gemini: (mio?.gemini || 0) + (res.proveedor === 'gemini' ? 1 : 0),
          groq: (mio?.groq || 0) + (res.proveedor === 'groq' ? 1 : 0),
          consultas: consultasHoy,
        }),
      ]);
      if (uso.error) console.log(`no se guardó el uso: ${uso.error.message}`);
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
    };
    const enSegundoPlano = async (p: Promise<unknown>) => {
      const seguro = p.catch(e => console.log(`guardado falló: ${e instanceof Error ? e.message : e}`));
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(seguro);
      else await seguro;
    };
    const cupoDespues = (res: Resultado) => armarCupo(
      { mensajes: (mio?.mensajes || 0) + 1, tokens: (mio?.tokens || 0) + res.tokensIn + res.tokensOut, consultas: mio?.consultas },
      [...(equipo || []), { gemini: res.proveedor === 'gemini' ? 1 : 0, groq: res.proveedor === 'groq' ? 1 : 0 }],
    );
    const sinServicio = () => ajustes?.respaldo
      ? 'Los servicios gratuitos están saturados en este momento. Intenta en unos minutos.'
      : 'Google llegó a su límite por ahora. Intenta en unos minutos.';
    const final = (r: { res: Resultado; respaldo: boolean }) => ({
      ok: true, conversacionId: convId, nueva, respaldo: r.respaldo, sinBusqueda: false,
      mensaje: { rol: 'assistant', texto: r.res.texto, fuentes: r.res.fuentes, tokens_in: r.res.tokensIn, tokens_out: r.res.tokensOut, proveedor: r.res.proveedor, modelo: r.res.modelo, busco: false, consultas: r.res.consultas },
      cupo: cupoDespues(r.res),
    });
    const descartarNueva = async () => { if (nueva) await admin.from('ia_conversaciones').delete().eq('id', convId); };

    if (cuerpo?.envivo !== true) {
      let salida: Awaited<ReturnType<typeof correr>>;
      try { salida = await correr(() => {}); } catch (e) { await descartarNueva(); throw e; }
      if (!salida) {
        await descartarNueva();
        console.log('sin servicio: ningún modelo respondió');
        return responder({ ok: false, codigo: 'sin_servicio', error: sinServicio(), cupo: antes }, 503);
      }
      await enSegundoPlano(guardar(salida.res, salida.sis));
      return responder(final(salida));
    }

    // ---------------------------- EN VIVO ----------------------------
    const codificador = new TextEncoder();
    const flujo = new ReadableStream<Uint8Array>({
      async start(control) {
        const emitir: Emisor = (evento, datos) => {
          try { control.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)); } catch { /* el panel se fue */ }
        };
        emitir('inicio', { conversacionId: convId, nueva });
        try {
          const salida = await correr(emitir);
          if (!salida) {
            await descartarNueva();
            console.log('sin servicio: ningún modelo respondió');
            emitir('error', { ok: false, codigo: 'sin_servicio', error: sinServicio(), cupo: antes });
          } else {
            emitir('fin', final(salida));
            await enSegundoPlano(guardar(salida.res, salida.sis));
          }
        } catch (e) {
          await descartarNueva();
          emitir('error', { ok: false, error: e instanceof Error ? e.message : 'No se pudo responder.' });
        } finally {
          try { control.close(); } catch { /* ya cerrado */ }
        }
      },
    });
    return new Response(flujo, { headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return responder({ ok: false, error: e instanceof Error ? e.message : 'No se pudo responder.' }, 500);
  }
});
