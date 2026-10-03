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
// SEGURIDAD: la identidad sale del JWT de quien llama (no del cuerpo), el
// acceso y el límite diario se comprueban aquí, y la base solo deja que cada
// quien lea sus propias conversaciones.
// =====================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

const SISTEMA = `Eres el asistente del panel de Technoverse Costa Rica, una tienda y taller de celulares y accesorios.
Responde en español de Costa Rica, claro y al grano. Usa listas cortas cuando ayuden.
Si buscaste en internet, apóyate en las fuentes y no inventes datos. Si no sabes algo, dilo.
No pidas ni repitas datos personales de clientes (cédulas, teléfonos, direcciones).`;

type Turno = { rol: 'user' | 'assistant'; texto: string };
type Resultado = { texto: string; fuentes: { titulo: string; url: string }[]; tokensIn: number; tokensOut: number; proveedor: 'gemini' | 'groq'; modelo: string; busco: boolean };

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

async function preguntarGemini(historial: Turno[], buscar: boolean, modelo: string): Promise<Resultado & { sinBusqueda?: boolean }> {
  const clave = Deno.env.get('GEMINI_API_KEY');
  if (!clave) throw new CupoAgotado('Falta GEMINI_API_KEY en los secretos');
  const conBusqueda = buscar && Date.now() > busquedaBloqueadaHasta;
  const cuerpo: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SISTEMA }] },
    contents: historial.map(t => ({ role: t.rol === 'assistant' ? 'model' : 'user', parts: [{ text: t.texto }] })),
  };
  if (conBusqueda) cuerpo.tools = [{ google_search: {} }];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  const r = await conTope(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify(cuerpo) });
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    console.log(`gemini ${modelo} busqueda=${conBusqueda} -> ${r.status}: ${det.slice(0, 300)}`);
    // Con búsqueda, un 400 o 429 suele ser la búsqueda (no el modelo): se
    // reintenta sin buscar antes de dar el modelo por agotado.
    if (conBusqueda && (r.status === 400 || r.status === 429)) {
      busquedaBloqueadaHasta = Date.now() + 30 * 60_000;
      const sin = await preguntarGemini(historial, false, modelo);
      return { ...sin, sinBusqueda: true };
    }
    if (r.status === 429 || r.status >= 500) throw new CupoAgotado(`Gemini ${modelo} ${r.status}`);
    throw new Error(`Gemini respondió ${r.status}: ${det.slice(0, 200)}`);
  }
  const d = await r.json();
  const cand = d?.candidates?.[0];
  const texto = (cand?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
  if (!texto) throw new CupoAgotado('Gemini no devolvió texto');
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const fuentes = chunks
    .map((c: any) => ({ titulo: String(c?.web?.title || '').slice(0, 80), url: String(c?.web?.uri || '') }))
    .filter((f: any) => f.url)
    .slice(0, 6);
  return {
    texto, fuentes,
    tokensIn: Number(d?.usageMetadata?.promptTokenCount || 0),
    tokensOut: Number(d?.usageMetadata?.candidatesTokenCount || 0) + Number(d?.usageMetadata?.thoughtsTokenCount || 0),
    proveedor: 'gemini', modelo: String(d?.modelVersion || modelo), busco: conBusqueda && fuentes.length > 0,
    sinBusqueda: buscar && !conBusqueda,
  };
}

async function preguntarGroq(historial: Turno[]): Promise<Resultado> {
  const clave = Deno.env.get('GROQ_API_KEY');
  if (!clave) { console.log('groq: falta GROQ_API_KEY en los secretos'); throw new CupoAgotado('Sin respaldo configurado'); }
  const r = await conTope('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: SISTEMA }, ...historial.map(t => ({ role: t.rol, content: t.texto }))],
      temperature: 0.6,
    }),
  });
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    console.log(`groq ${GROQ_MODEL} -> ${r.status}: ${det.slice(0, 300)}`);
    if (r.status === 429 || r.status >= 500) throw new CupoAgotado('Groq sin cupo');
    throw new Error(`Groq respondió ${r.status}: ${det.slice(0, 200)}`);
  }
  const d = await r.json();
  const texto = String(d?.choices?.[0]?.message?.content || '').trim();
  if (!texto) throw new Error('Groq no devolvió respuesta.');
  return {
    texto, fuentes: [],
    tokensIn: Number(d?.usage?.prompt_tokens || 0), tokensOut: Number(d?.usage?.completion_tokens || 0),
    proveedor: 'groq', modelo: String(d?.model || GROQ_MODEL), busco: false,
  };
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
        admin.from('ia_uso_diario').select('mensajes,tokens').eq('user_id', uid).eq('dia', dia).maybeSingle(),
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
    // Gemini primero; si Google no tiene cupo, Groq (si está permitido).
    // `null` = ninguno de los dos tiene cupo ahora.
    const preguntar = async (): Promise<{ res: Resultado & { sinBusqueda?: boolean }; respaldo: boolean } | null> => {
      for (const modelo of [GEMINI_MODEL, GEMINI_RESPALDO]) {
        try {
          return { res: await preguntarGemini(historial, buscar, modelo), respaldo: false };
        } catch (e) {
          if (!(e instanceof CupoAgotado)) throw e;
        }
      }
      if (!ajustes?.respaldo) return null;
      try {
        return { res: await preguntarGroq(historial), respaldo: true };
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

    const ahora = new Date().toISOString();
    const despues = new Date(Date.now() + 1).toISOString();
    await admin.from('ia_mensajes').insert([
      { conversacion_id: convId, user_id: uid, rol: 'user', texto, creado_en: ahora },
      { conversacion_id: convId, user_id: uid, rol: 'assistant', texto: res.texto, fuentes: res.fuentes, tokens_in: res.tokensIn, tokens_out: res.tokensOut, proveedor: res.proveedor, modelo: res.modelo, busco: res.busco, creado_en: despues },
    ]);
    await admin.from('ia_conversaciones').update({ actualizado_en: new Date().toISOString() }).eq('id', convId);

    const fila = await admin.from('ia_uso_diario').select('mensajes,tokens,gemini,groq').eq('user_id', uid).eq('dia', dia).maybeSingle();
    const f = fila.data || { mensajes: 0, tokens: 0, gemini: 0, groq: 0 };
    await admin.from('ia_uso_diario').upsert({
      user_id: uid, dia,
      mensajes: f.mensajes + 1,
      tokens: f.tokens + res.tokensIn + res.tokensOut,
      gemini: f.gemini + (res.proveedor === 'gemini' ? 1 : 0),
      groq: f.groq + (res.proveedor === 'groq' ? 1 : 0),
    });

    return responder({
      ok: true, conversacionId: convId, nueva, respaldo: usoRespaldo, sinBusqueda: !!res.sinBusqueda,
      mensaje: { rol: 'assistant', texto: res.texto, fuentes: res.fuentes, tokens_in: res.tokensIn, tokens_out: res.tokensOut, proveedor: res.proveedor, modelo: res.modelo, busco: res.busco },
      cupo: await usoHoy(),
    });
  } catch (e) {
    return responder({ ok: false, error: e instanceof Error ? e.message : 'No se pudo responder.' }, 500);
  }
});
