// =====================================================================
// ASISTENTE IA — ACCIONES DE JARVIS (solo superadmin, con confirmación)
// =====================================================================
// Jarvis no ejecuta nada por su cuenta. El protocolo es siempre:
//
//   1. PREPARAR  (sin efectos) — la IA pide una acción del catálogo; el
//      servidor busca el objetivo con la sesión del superadmin, revisa las
//      reglas y guarda una propuesta en `ia_acciones` (vence en 5 min).
//   2. CONFIRMAR — el superadmin revisa la tarjeta y toca el botón. El
//      servidor ejecuta EXACTAMENTE lo guardado, una sola vez.
//   3. DESHACER  — si la acción lo permite, durante 24 horas.
//
// Dos carriles, igual que las consultas: la IA recibe solo conteos y una
// referencia («A1»); correos, IPs y equipos van a la tarjeta en pantalla.
//
// No hay acciones para tocar código, desplegar, escribir SQL libre, borrar
// registros, cambiar roles, ni para vigilar o seguir a personas.
//
// COBRAR y RESPONDER UN CHAT no los ejecuta el servidor: emitir la factura
// (PDF, consecutivo, Hacienda, correo) ya está resuelto y probado en el
// panel (`cobrarServicio`). Jarvis prepara los datos y calcula los montos;
// al confirmar, el servidor entrega esos datos validados y el panel los
// cobra por el MISMO camino que el módulo de Cobros, nunca por uno aparte.
// =====================================================================

// deno-lint-ignore no-explicit-any
type Db = any;

export type Riesgo = 'reversible' | 'acceso' | 'fiscal';
export type Opcion =
  | { id: string; tipo: 'elegir'; etiqueta: string; valores: { valor: string; texto: string; ayuda?: string }[]; defecto: string }
  | { id: 'minutos'; tipo: 'duracion'; etiqueta: string; defecto: number | null }
  | { id: string; tipo: 'texto'; etiqueta: string; defecto: string; teclado?: 'email' | 'numeric' | 'tel'; max?: number };
export type Tarjeta = {
  accion: string;
  modulo: string;
  icono: 'ban' | 'unlock' | 'log-out' | 'receipt' | 'message' | 'wrench' | 'package';
  /** Texto del chip de riesgo (si no, se deduce de `riesgo`). */
  chip?: string;
  /** La acción la termina el panel con su propio proceso. */
  enCliente?: 'cobro' | 'chat' | 'taller' | 'inventario';
  /** Se ejecuta sola al aparecer (solo si no hay ninguna duda de a quién). */
  auto?: boolean;
  /** Minutos para deshacer cuando el deshacer lo hace el panel. */
  deshacerMin?: number;
  titulo: string;
  riesgo: Riesgo;
  efecto: string;
  filas: { etiqueta: string; valor: string }[];
  opciones: Opcion[];
  boton: string;
  botonSiempre?: string;
  /** Cuándo pide el token de seguridad (también lo exige el servidor). */
  token: 'nunca' | 'para_siempre';
  deshacible: boolean;
  nota?: string;
};
export type CtxAccion = {
  db: Db;                 // cliente con la sesión del superadmin (RLS)
  uid: string;
  email: string;
  ip: string | null;      // desde donde se conecta el superadmin
  yo: { device?: string | null; modelo?: string | null };
  /** Datos personales que escribió el superadmin (cédula, correo, teléfono).
   *  El panel los saca del texto ANTES de que llegue a la IA y los manda
   *  aparte; la IA solo ve marcas como [CÉDULA·1]. */
  privados: Record<string, string>;
  /** Ajustes del asistente (p. ej. `chat_directo`). */
  ajustes: Record<string, boolean>;
};
export type Preparada = { tarjeta: Tarjeta; objetivo: Record<string, any>; paraIA: Record<string, unknown> };
/** `texto` va a la IA (sin datos personales); `detalle` solo a la pantalla. */
export type Resultado = { texto: string; detalle: string; efectos?: string[]; datos?: Record<string, any> };
export type Accion = {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
  bitacora: string;
  preparar(args: Record<string, unknown>, ctx: CtxAccion): Promise<Preparada>;
  ejecutar(objetivo: Record<string, any>, opc: Record<string, any>, ctx: CtxAccion): Promise<Resultado>;
  deshacer?(objetivo: Record<string, any>, opc: Record<string, any>, resultado: Resultado, ctx: CtxAccion): Promise<Resultado>;
  /** Solo acciones `enCliente`: valida lo elegido y arma lo que el panel ejecuta. */
  paraCliente?(objetivo: Record<string, any>, opc: Record<string, any>, ctx: CtxAccion): Record<string, any>;
};

const DURACIONES = [30, 120, 1440, null] as const;
const DUR_TXT: Record<string, string> = { 30: 'por 30 minutos', 120: 'por 2 horas', 1440: 'por 24 horas', null: 'para siempre' };
const TIPO_TXT: Record<string, string> = { email: 'Cuenta', ip: 'IP', modelo: 'Modelo', device: 'Equipo' };
const ROL_TXT: Record<string, string> = { superadmin: 'Superadmin', admin: 'Administrador', empleado: 'Empleado', Cliente: 'Cliente' };

const texto = (v: unknown, max = 80) => String(v ?? '').trim().slice(0, max);
/** Para `ilike`: sin comodines ni caracteres que rompan el filtro. */
const patron = (v: unknown) => texto(v, 60).replace(/[,()%*_\\]/g, ' ').trim();
const fechaCorta = (v: unknown) => {
  if (!v) return '—';
  try { return new Date(String(v)).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(v).slice(0, 16); }
};
function exigir(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const ES_IP = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;
const ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «Mozilla/5.0 (Linux; Android 10; SM-A125M) … wv» → «SM-A125M · APK». */
export function equipoDe(ua: string | null | undefined): string {
  const u = String(ua || '');
  if (!u) return 'Equipo';
  const app = / wv\)|; wv;/.test(u) ? ' · APK' : '';
  const and = u.match(/Android [\d.]+; ([^;)]+)/);
  if (and && and[1] && and[1] !== 'K') return and[1].trim() + app;
  if (/iPhone/.test(u)) return 'iPhone';
  if (/iPad/.test(u)) return 'iPad';
  if (/Android/.test(u)) return 'Android' + app;
  const nav = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Navegador';
  const so = /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  return so ? `${nav} · ${so}` : nav;
}

/** Valida lo que llega de la tarjeta contra lo que ella misma ofrecía. */
export function validarOpciones(t: Tarjeta, crudas: unknown): Record<string, any> {
  const c = (crudas && typeof crudas === 'object' ? crudas : {}) as Record<string, unknown>;
  const out: Record<string, any> = {};
  for (const o of t.opciones || []) {
    if (o.tipo === 'elegir') {
      const v = c[o.id] == null ? o.defecto : String(c[o.id]);
      exigir(o.valores.some(x => x.valor === v), 'Esa opción no estaba en la tarjeta.');
      out[o.id] = v;
    } else if (o.tipo === 'duracion') {
      const v = c.minutos === undefined ? o.defecto : (c.minutos === null ? null : Number(c.minutos));
      exigir((DURACIONES as readonly (number | null)[]).includes(v as number | null), 'Duración no válida.');
      out.minutos = v;
    } else {
      out[o.id] = texto(c[o.id] ?? o.defecto, o.max || 120);
    }
  }
  return out;
}
export const pideToken = (t: Tarjeta, o: Record<string, any>) => t.token === 'para_siempre' && o.minutos === null;

/** Módulos del panel que Jarvis puede abrir (los mismos ids de las pestañas). */
export const MODULOS_PANEL: Record<string, string> = {
  dashboard: 'Panel general', inventario_productos: 'Inventario', chat: 'Chat y CRM', taller: 'Taller', clientes: 'Clientes',
  cobros: 'Cobros', facturacion: 'Contabilidad', marketing: 'Marketing', ciberseguridad: 'Ciberseguridad',
  configuracion: 'Configuración', supervision: 'Supervisión', ubicaciones: 'Ubicaciones', ingresos: 'Ingresos',
  bloqueos: 'Bloqueos', gestion_usuarios: 'Gestión de usuarios',
};
export const NAVEGAR = {
  nombre: 'abrir_modulo',
  descripcion: 'Deja un botón para abrir un módulo del panel. SOLO cuando el superadmin pida explícitamente ir o abrir algo («abrí», «llevame a», «mostrame el módulo»). Nunca para cumplir una orden ni para «revisar»: para eso consultá o usá la acción.',
  parametros: {
    type: 'object',
    properties: { modulo: { type: 'string', enum: Object.keys(MODULOS_PANEL), description: 'Módulo a abrir.' } },
    required: ['modulo'],
  },
};

type Alcance = { tipo: 'email' | 'ip' | 'modelo' | 'device'; valor: string; texto: string; ayuda: string };

export const ACCIONES: Accion[] = [
  // -------------------------------------------------------------------
  {
    nombre: 'bloquear_acceso',
    bitacora: 'Bloqueo (Kill Switch)',
    descripcion: 'PREPARA un bloqueo de acceso con el Kill Switch (cuenta, IP, modelo de equipo o equipo del personal). No bloquea: el superadmin elige el alcance y la duración en una tarjeta y confirma. Usala solo cuando el superadmin pida bloquear a alguien.',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Lo que identifica a quién bloquear, tal como lo dijo: correo, IP, modelo del equipo (p. ej. GFY-LX3) o correo/nombre del empleado.' },
        motivo: { type: 'string', description: 'Motivo breve si el superadmin lo dio (opcional).' },
      },
      required: ['buscar'],
    },
    async preparar(args, ctx) {
      const q = texto(args.buscar, 60);
      exigir(q.length >= 3, 'Decime a quién bloquear: correo, IP o modelo del equipo.');
      const p = patron(q);
      const alc: Alcance[] = [];
      const agregar = (a: Alcance) => { if (!alc.some(x => x.tipo === a.tipo && x.valor.toLowerCase() === a.valor.toLowerCase())) alc.push(a); };
      const esIp = ES_IP.test(q), esCorreo = ES_CORREO.test(q);

      const [{ data: blanca }, { data: personal }] = await Promise.all([
        ctx.db.from('ip_whitelist').select('ip'),
        esIp ? Promise.resolve({ data: [] }) : ctx.db.from('supervision_state').select('email,device,modelo,last_seen').ilike('email', `%${p}%`).limit(3),
      ]);
      const blancas = new Set((blanca || []).map((r: any) => String(r.ip)));

      for (const s of personal || []) {
        if (s.device) agregar({ tipo: 'device', valor: s.device, texto: `Su equipo (${s.modelo || 'aparato'})`, ayuda: `Solo el aparato de ${s.email}, visto por última vez el ${fechaCorta(s.last_seen)}.` });
        if (s.email) agregar({ tipo: 'email', valor: String(s.email).toLowerCase(), texto: `Su cuenta (${s.email})`, ayuda: 'Bloquea esa cuenta en cualquier equipo.' });
      }
      if (esCorreo) {
        const { data: pr } = await ctx.db.from('profiles').select('email,name,role').ilike('email', p).maybeSingle();
        exigir(pr?.role !== 'superadmin', 'No se puede bloquear la cuenta de un superadmin.');
        agregar({ tipo: 'email', valor: q.toLowerCase(), texto: `Su cuenta (${q.toLowerCase()})`,
          ayuda: pr ? `Cuenta de ${pr.name || pr.email} · ${ROL_TXT[pr.role] || pr.role}. Bloquea esa cuenta en cualquier equipo.` : 'No hay una cuenta con ese correo todavía: queda bloqueada si se registra.' });
      }
      if (esIp) agregar({ tipo: 'ip', valor: q, texto: `La IP ${q}`, ayuda: 'Bloquea todo lo que entre desde esa IP. Ojo: puede ser compartida (un edificio o una red de datos).' });
      if (!esIp && !esCorreo) {
        const [{ data: vis }, { data: huellas }] = await Promise.all([
          ctx.db.from('supervision_visitantes').select('modelo,last_seen').ilike('modelo', `%${p}%`).order('last_seen', { ascending: false }).limit(60),
          ctx.db.from('visitor_fingerprints').select('dispositivo,ip,visitas,ultima_visita').ilike('dispositivo', `%${p}%`).order('ultima_visita', { ascending: false }).limit(30),
        ]);
        const modelos = new Map<string, { n: number; ultima: string }>();
        for (const v of [...(vis || []).map((x: any) => ({ m: x.modelo, t: x.last_seen })), ...(huellas || []).map((x: any) => ({ m: x.dispositivo, t: x.ultima_visita }))]) {
          if (!v.m) continue;
          const e = modelos.get(v.m) || { n: 0, ultima: v.t };
          e.n++; if (String(v.t) > String(e.ultima)) e.ultima = v.t;
          modelos.set(v.m, e);
        }
        [...modelos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3).forEach(([m, i]) => agregar({
          tipo: 'modelo', valor: m, texto: `Todos los ${m}`,
          ayuda: `Bloquea cualquier equipo ${m} que entre a la tienda o al panel. Visto ${i.n} ${i.n === 1 ? 'vez' : 'veces'}, la última el ${fechaCorta(i.ultima)}.`,
        }));
        const conIp = (huellas || []).find((h: any) => h.ip);
        if (conIp) agregar({ tipo: 'ip', valor: String(conIp.ip), texto: `Su última IP (${conIp.ip})`, ayuda: `La IP desde la que entró ese equipo por última vez (${fechaCorta(conIp.ultima_visita)}). Puede ser compartida.` });
        if (!alc.length && /\d/.test(q) && /[a-z]/i.test(q) && !/\s{2,}/.test(q)) {
          agregar({ tipo: 'modelo', valor: q, texto: `Todos los ${q}`, ayuda: 'No lo vi entrar todavía. Se bloquea cuando entre un equipo con ese modelo exacto.' });
        }
      }

      exigir(alc.length, `No encontré a quién bloquear con «${q}». Probá con el correo, la IP o el modelo exacto del equipo.`);
      const miModelo = String(ctx.yo.modelo || '').toLowerCase();
      const libres = alc.filter(a => !(
        (a.tipo === 'email' && a.valor === ctx.email.toLowerCase()) ||
        (a.tipo === 'device' && !!ctx.yo.device && a.valor === ctx.yo.device) ||
        (a.tipo === 'modelo' && !!miModelo && a.valor.toLowerCase() === miModelo) ||
        (a.tipo === 'ip' && (a.valor === ctx.ip || blancas.has(a.valor)))
      ));
      exigir(libres.length, 'Eso te bloquearía a vos mismo (tu cuenta, tu equipo, tu modelo o una IP de la lista blanca). No lo preparé.');
      const orden = { device: 0, email: 1, modelo: 2, ip: 3 };
      libres.sort((a, b) => orden[a.tipo] - orden[b.tipo]);
      // Lo que coincide EXACTO con lo pedido («el modelo GFY-LX3») va primero.
      const exacto = libres.findIndex(a => a.valor.toLowerCase() === q.toLowerCase());
      if (exacto > 0) libres.unshift(...libres.splice(exacto, 1));
      const elegibles = libres.slice(0, 5);
      return {
        tarjeta: {
          accion: 'bloquear_acceso', modulo: 'Ciberseguridad', icono: 'ban', titulo: 'Bloquear acceso', riesgo: 'acceso',
          efecto: 'Le aparece la pantalla de bloqueo al instante, en la tienda y en el panel (Kill Switch).',
          filas: [{ etiqueta: 'Buscaste', valor: q }],
          opciones: [
            { id: 'alcance', tipo: 'elegir', etiqueta: 'A quién', valores: elegibles.map((a, i) => ({ valor: `a${i}`, texto: a.texto, ayuda: a.ayuda })), defecto: 'a0' },
            { id: 'minutos', tipo: 'duracion', etiqueta: 'Duración', defecto: 1440 },
            { id: 'motivo', tipo: 'texto', etiqueta: 'Motivo', defecto: texto(args.motivo, 120) || 'Pedido desde Jarvis' },
          ],
          boton: 'Bloquear ahora', botonSiempre: 'Bloquear para siempre', token: 'para_siempre', deshacible: true,
        },
        objetivo: { alcances: elegibles },
        paraIA: { opciones_de_alcance: elegibles.length, tipos: [...new Set(elegibles.map(a => TIPO_TXT[a.tipo]))] },
      };
    },
    async ejecutar(objetivo, opc, ctx) {
      const a: Alcance | undefined = objetivo.alcances?.[Number(String(opc.alcance).slice(1))];
      exigir(a, 'Alcance no válido.');
      const hasta = opc.minutos == null ? null : new Date(Date.now() + opc.minutos * 60000).toISOString();
      const { data: activos, error: e1 } = await ctx.db.from('system_bans').select('id,valor,hasta,motivo').eq('activo', true).eq('tipo', a.tipo);
      if (e1) throw e1;
      const previo = (activos || []).find((b: any) => String(b.valor).toLowerCase() === a.valor.toLowerCase());
      let id: string, nuevo: boolean;
      if (previo) {
        const { error } = await ctx.db.from('system_bans').update({ hasta, motivo: opc.motivo || null }).eq('id', previo.id);
        if (error) throw error;
        id = previo.id; nuevo = false;
      } else {
        const { data, error } = await ctx.db.from('system_bans').insert({ tipo: a.tipo, valor: a.valor, motivo: opc.motivo || null, hasta, created_by: ctx.uid }).select('id').single();
        if (error) throw error;
        id = data.id; nuevo = true;
      }
      const dur = DUR_TXT[String(opc.minutos)];
      return {
        texto: `Bloqueo aplicado (${TIPO_TXT[a.tipo].toLowerCase()}) ${dur}${nuevo ? '' : '; ya estaba bloqueado y se actualizó'}.`,
        detalle: `${a.texto}: bloqueado ${dur}${hasta ? `, hasta el ${fechaCorta(hasta)}` : ''}.${nuevo ? '' : ' Ya estaba bloqueado: se actualizó la duración.'}`,
        efectos: ['avisar_bloqueos'],
        datos: { id, nuevo, previo: previo ? { hasta: previo.hasta, motivo: previo.motivo } : null },
      };
    },
    async deshacer(_objetivo, _opc, resultado, ctx) {
      const d = resultado.datos || {};
      const { error } = d.nuevo
        ? await ctx.db.from('system_bans').update({ activo: false }).eq('id', d.id)
        : await ctx.db.from('system_bans').update({ hasta: d.previo?.hasta ?? null, motivo: d.previo?.motivo ?? null }).eq('id', d.id);
      if (error) throw error;
      return { texto: 'Bloqueo revertido.', detalle: d.nuevo ? 'Bloqueo levantado: puede volver a entrar.' : 'Se restauró la duración que tenía antes.', efectos: ['avisar_bloqueos'] };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'levantar_bloqueo',
    bitacora: 'Desbloqueo (Kill Switch)',
    descripcion: 'PREPARA levantar un bloqueo activo del Kill Switch (devuelve el acceso). El superadmin elige cuál y confirma en una tarjeta. Usala cuando pida desbloquear a alguien.',
    parametros: {
      type: 'object',
      properties: { buscar: { type: 'string', description: 'Correo, IP, modelo o motivo del bloqueo a levantar.' } },
      required: ['buscar'],
    },
    async preparar(args, ctx) {
      const q = texto(args.buscar, 60).toLowerCase();
      exigir(q.length >= 2, 'Decime qué bloqueo levantar.');
      const { data, error } = await ctx.db.from('system_bans').select('id,tipo,valor,motivo,hasta,created_at').eq('activo', true).order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      const ahora = new Date().toISOString();
      const hits = (data || []).filter((b: any) => (!b.hasta || b.hasta > ahora) && (String(b.valor).toLowerCase().includes(q) || String(b.motivo || '').toLowerCase().includes(q))).slice(0, 6);
      exigir(hits.length, `No hay bloqueos activos que coincidan con «${texto(args.buscar, 60)}».`);
      return {
        tarjeta: {
          accion: 'levantar_bloqueo', modulo: 'Ciberseguridad', icono: 'unlock', titulo: 'Levantar bloqueo', riesgo: 'acceso',
          efecto: 'Vuelve a tener acceso al instante: se le quita la pantalla de bloqueo.',
          filas: [],
          opciones: [{ id: 'cual', tipo: 'elegir', etiqueta: 'Cuál', defecto: 'b0',
            valores: hits.map((b: any, i: number) => ({ valor: `b${i}`, texto: `${TIPO_TXT[b.tipo] || b.tipo}: ${b.valor}`,
              ayuda: `${b.hasta ? `Hasta el ${fechaCorta(b.hasta)}` : 'Sin fecha de término'}${b.motivo ? ` · ${b.motivo}` : ''}` })) }],
          boton: 'Levantar bloqueo', token: 'nunca', deshacible: true,
        },
        objetivo: { bloqueos: hits.map((b: any) => ({ id: b.id, tipo: b.tipo, valor: b.valor })) },
        paraIA: { coincidencias: hits.length },
      };
    },
    async ejecutar(objetivo, opc, ctx) {
      const b = objetivo.bloqueos?.[Number(String(opc.cual).slice(1))];
      exigir(b, 'Bloqueo no válido.');
      const { data, error } = await ctx.db.from('system_bans').update({ activo: false }).eq('id', b.id).eq('activo', true).select('id');
      if (error) throw error;
      exigir(data?.length, 'Ese bloqueo ya no estaba activo.');
      return { texto: `Bloqueo levantado (${String(TIPO_TXT[b.tipo] || b.tipo).toLowerCase()}).`, detalle: `${TIPO_TXT[b.tipo] || b.tipo} ${b.valor}: ya puede entrar.`, efectos: ['avisar_bloqueos'], datos: { id: b.id } };
    },
    async deshacer(_objetivo, _opc, resultado, ctx) {
      const { error } = await ctx.db.from('system_bans').update({ activo: true }).eq('id', resultado.datos?.id);
      if (error) throw new Error('No se pudo volver a bloquear: quizá ya hay otro bloqueo activo igual.');
      return { texto: 'Bloqueo restaurado.', detalle: 'El bloqueo vuelve a estar activo.', efectos: ['avisar_bloqueos'] };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'cerrar_sesiones',
    bitacora: 'Cierre de sesiones',
    descripcion: 'PREPARA cerrar la sesión de una persona en todos sus equipos. El superadmin confirma en una tarjeta. Usala cuando pida cerrar, sacar o desloguear a alguien.',
    parametros: {
      type: 'object',
      properties: { buscar: { type: 'string', description: 'Correo o nombre de la persona.' } },
      required: ['buscar'],
    },
    async preparar(args, ctx) {
      const q = patron(args.buscar);
      exigir(q.length >= 3, 'Decime de quién: correo o nombre.');
      const { data, error } = await ctx.db.rpc('sesiones_de', { p_buscar: q });
      if (error) throw error;
      const personas = new Map<string, { email: string; nombre: string; rol: string; sesiones: any[] }>();
      for (const s of data || []) {
        if (s.persona === ctx.uid || s.rol === 'superadmin') continue;
        const e = personas.get(s.persona) || { email: s.correo, nombre: s.nombre, rol: s.rol, sesiones: [] as any[] };
        e.sesiones.push(s); personas.set(s.persona, e);
      }
      if (!personas.size) {
        const { data: pr } = await ctx.db.from('profiles').select('id,role').or(`email.ilike.%${q}%,name.ilike.%${q}%`).limit(1);
        exigir(!pr?.length, 'Esa persona no tiene sesiones abiertas en este momento.');
        throw new Error(`No encontré a nadie con «${q}».`);
      }
      const lista = [...personas.entries()].slice(0, 5);
      const total = lista.reduce((t, [, p]) => t + p.sesiones.length, 0);
      return {
        tarjeta: {
          accion: 'cerrar_sesiones', modulo: 'Sesiones', icono: 'log-out', titulo: 'Cerrar sesiones', riesgo: 'acceso',
          efecto: 'Sale del panel en todos sus equipos: al instante si está conectado, y como mucho en una hora si no. Vuelve a entrar con su clave (la huella también se la pide).',
          filas: [],
          opciones: [
            { id: 'persona', tipo: 'elegir', etiqueta: 'Persona', defecto: 'p0',
              valores: lista.map(([, p], i) => ({ valor: `p${i}`, texto: p.email,
                ayuda: `${ROL_TXT[p.rol] || p.rol} · ${p.sesiones.length} ${p.sesiones.length === 1 ? 'sesión abierta' : 'sesiones abiertas'}: ` +
                  p.sesiones.slice(0, 4).map(s => `${equipoDe(s.agente)} (${fechaCorta(s.actividad)})`).join(', ') })) },
            { id: 'motivo', tipo: 'texto', etiqueta: 'Motivo', defecto: 'Pedido desde Jarvis' },
          ],
          boton: 'Cerrar sesiones', token: 'nunca', deshacible: false,
          nota: 'No se puede deshacer: vuelve a entrar con su clave.',
        },
        objetivo: { personas: lista.map(([id, p]) => ({ id, email: p.email })) },
        paraIA: { personas: lista.length, sesiones_abiertas: total },
      };
    },
    async ejecutar(objetivo, opc, ctx) {
      const p = objetivo.personas?.[Number(String(opc.persona).slice(1))];
      exigir(p, 'Persona no válida.');
      const { data, error } = await ctx.db.rpc('revocar_sesiones', { p_user: p.id });
      if (error) throw error;
      const n = Number(data || 0);
      return { texto: `Sesiones cerradas (${n}).`, detalle: `${p.email}: ${n} ${n === 1 ? 'sesión cerrada' : 'sesiones cerradas'}.`, efectos: ['avisar_sesion'] };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'preparar_cobro',
    bitacora: 'Cobro preparado por Jarvis',
    descripcion: 'PREPARA un cobro con factura electrónica (servicio con repuestos del inventario). Calcula el precio en el servidor a partir del costo real y el margen, o usa el monto que se indique, o el precio de venta del inventario. El superadmin revisa los datos del cliente y los montos en una tarjeta y confirma; el panel emite la factura por el mismo camino del módulo de Cobros. Usala solo cuando pida cobrar o facturar. Los datos del cliente llegan como marcas [CÉDULA·1], [CORREO·1], [TEL·1]: pasalas tal cual en `cliente`, nunca inventes cédulas ni correos.',
    parametros: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente y las marcas que haya en el mensaje, p. ej. «Laura Mora [CÉDULA·1] [CORREO·1]».' },
        repuestos: {
          type: 'array', description: 'Repuestos o productos del inventario usados (nombre o SKU y cantidad).',
          items: { type: 'object', properties: { producto: { type: 'string' }, cantidad: { type: 'integer' } }, required: ['producto'] },
        },
        servicio: { type: 'string', description: 'Descripción corta del servicio para la factura (p. ej. «Cambio de pantalla Galaxy A12»).' },
        margen_pct: { type: 'number', description: 'Margen de ganancia en % sobre el precio sin IVA (p. ej. 35). Opcional.' },
        mano_obra: { type: 'number', description: 'Mano de obra en colones, sin IVA, que se suma al precio. Opcional.' },
        monto_total: { type: 'number', description: 'Total exacto a cobrar en colones con IVA, si lo dijeron. Tiene prioridad sobre el margen.' },
        medio: { type: 'string', enum: ['SINPE', 'Efectivo'], description: 'Medio de pago.' },
        garantia_meses: { type: 'integer', description: 'Meses de garantía: 1, 3 o 12 (por defecto 3).' },
      },
      required: ['cliente'],
    },
    async preparar(args, ctx) {
      // ---- Cliente: marcas privadas + facturas anteriores ----
      const crudo = texto(args.cliente, 200);
      const marcas = [...crudo.matchAll(/\[([A-ZÉ]+·\d+)\]/g)].map(m => m[1]);
      const valorDe = (pref: string) => marcas.filter(m => m.startsWith(pref)).map(m => ctx.privados[m]).find(Boolean) || '';
      let cedula = valorDe('CÉDULA').replace(/\D/g, '');
      let correo = valorDe('CORREO').toLowerCase();
      let telefono = valorDe('TEL').replace(/\D/g, '');
      // Si igual llegaron crudos (nombre, cédula y correo en una sola tira),
      // se separan aquí: cada dato a su casilla y el nombre queda limpio.
      let resto = crudo.replace(/\[[^\]]*\]/g, ' ');
      resto = resto.replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, m => { if (!correo) correo = m.replace(/[.,;:]+$/, '').toLowerCase(); return ' '; });
      resto = resto.replace(/\b\d-?\d{4}-?\d{4}\b|\b\d{9,12}\b/g, m => { if (!cedula) cedula = m.replace(/\D/g, ''); return ' '; });
      resto = resto.replace(/(?:\+?506[\s-]?)?\b[2-8]\d{3}[\s-]?\d{4}\b/g, m => { if (!telefono) telefono = m.replace(/\D/g, '').slice(-8); return ' '; });
      let nombre = resto.replace(/\b(c[eé]dula|correo|tel[eé]fono|cel(ular)?|email|n[uú]mero)\b:?/gi, ' ').replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
      let idTipo = cedula.length === 10 ? '02' : cedula.length >= 11 ? '03' : '01';
      let previo = false;
      const cols = 'customer_name,customer_identification,customer_identification_type,customer_email';
      const { data: ant } = cedula
        ? await ctx.db.from('invoices').select(cols).eq('customer_identification', cedula).order('created_at', { ascending: false }).limit(1)
        : nombre.length >= 3
          ? await ctx.db.from('invoices').select(cols).ilike('customer_name', `%${patron(nombre)}%`).order('created_at', { ascending: false }).limit(3)
          : { data: [] };
      const nombres = new Set((ant || []).map((f: any) => String(f.customer_name || '').toLowerCase()));
      if (ant?.length && (cedula || nombres.size === 1)) {
        const f = ant[0];
        previo = true;
        nombre = nombre || f.customer_name || '';
        if (!cedula) cedula = String(f.customer_identification || '').replace(/\D/g, '');
        if (!correo) correo = String(f.customer_email || '');
        if (f.customer_identification_type) idTipo = String(f.customer_identification_type);
      }

      // ---- Repuestos: inventario real (costo, precio, existencias) ----
      const pedidos = (Array.isArray(args.repuestos) ? args.repuestos : []).slice(0, 8) as any[];
      const lineas: { id: string; nombre: string; cantidad: number; costo: number; precio: number }[] = [];
      for (const r of pedidos) {
        const q = patron(r?.producto);
        exigir(q.length >= 2, 'Falta el nombre o SKU de un repuesto.');
        const cant = Math.max(1, Math.min(50, Math.round(Number(r?.cantidad) || 1)));
        const { data: prods, error } = await ctx.db.from('products').select('id,name,sku,cost,price,stock,active')
          .or(`sku.ilike.${q},name.ilike.%${q}%`).limit(6);
        if (error) throw error;
        const activos = (prods || []).filter((p: any) => p.active !== false);
        const exacto = activos.find((p: any) => String(p.sku || '').toLowerCase() === q.toLowerCase()) || (activos.length === 1 ? activos[0] : null);
        if (!exacto) {
          exigir(activos.length, `No encontré «${q}» en el inventario.`);
          throw new Error(`Hay varios productos que coinciden con «${q}»: ${activos.map((p: any) => `${p.name} (SKU ${p.sku || '—'})`).join('; ')}. Preguntale cuál es.`);
        }
        exigir(Number(exacto.stock) >= cant, `«${exacto.name}» tiene ${Number(exacto.stock) || 0} en existencia y se piden ${cant}.`);
        lineas.push({ id: exacto.id, nombre: exacto.name, cantidad: cant, costo: Number(exacto.cost) || 0, precio: Number(exacto.price) || 0 });
      }

      // ---- Montos: los calcula el servidor, nunca la IA ----
      const costo = lineas.reduce((t, l) => t + l.costo * l.cantidad, 0);
      const manoObra = Math.max(0, Number(args.mano_obra) || 0);
      const margen = args.margen_pct == null ? null : Number(args.margen_pct);
      let total: number, como: string;
      if (Number(args.monto_total) > 0) {
        total = Math.round(Number(args.monto_total)); como = 'monto indicado';
      } else if (margen != null) {
        exigir(margen >= 0 && margen < 95, 'El margen tiene que estar entre 0 % y 95 %.');
        exigir(costo > 0 || manoObra > 0, 'Sin repuestos con costo ni mano de obra no puedo calcular el margen.');
        const base = costo / (1 - margen / 100) + manoObra;
        total = Math.round(base * 1.13); como = `margen ${margen} % sobre el costo${manoObra ? ' + mano de obra' : ''}, más IVA 13 %`;
      } else {
        const lista = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
        exigir(lista > 0 || manoObra > 0, 'Decime el margen o el monto a cobrar.');
        total = Math.round(lista + manoObra * 1.13); como = 'precio de venta del inventario (IVA incluido)';
      }
      exigir(total > 0 && total < 50_000_000, 'El total no es válido.');
      const sinIva = total / 1.13;
      const ganancia = sinIva - costo;
      const colon = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
      const servicio = texto(args.servicio, 120) || (lineas[0] ? `Servicio técnico — ${lineas.map(l => l.nombre).join(', ')}` : 'Servicio técnico');

      return {
        tarjeta: {
          accion: 'preparar_cobro', modulo: 'Cobros', icono: 'receipt', titulo: `Cobrar ${colon(total)}${nombre ? ` a ${nombre}` : ''}`,
          riesgo: 'fiscal', chip: 'Emite factura', enCliente: 'cobro',
          efecto: 'Descuenta el inventario, emite la factura electrónica con número fiscal y se la envía al cliente por correo. Es el mismo proceso del módulo de Cobros.',
          filas: [
            ...lineas.map(l => ({ etiqueta: 'Repuesto', valor: `${l.cantidad} × ${l.nombre} · costo ${colon(l.costo * l.cantidad)}` })),
            ...(manoObra ? [{ etiqueta: 'Mano de obra', valor: `${colon(manoObra)} + IVA` }] : []),
            { etiqueta: 'Total', valor: `${colon(total)} (IVA ${colon(total - sinIva)} incluido) · ${como}` },
            { etiqueta: 'Ganancia', valor: `${colon(ganancia)} · ${sinIva > 0 ? Math.round(ganancia / sinIva * 100) : 0} % sobre el precio sin IVA` },
            ...(previo ? [{ etiqueta: 'Cliente', valor: 'Datos tomados de su última factura. Revisalos.' }] : []),
          ],
          opciones: [
            { id: 'nombre', tipo: 'texto', etiqueta: 'Cliente', defecto: nombre, max: 100 },
            { id: 'id_tipo', tipo: 'elegir', etiqueta: 'Identificación', defecto: ['01', '02', '03', '04'].includes(idTipo) ? idTipo : '01',
              valores: [{ valor: '01', texto: 'Física' }, { valor: '02', texto: 'Jurídica' }, { valor: '03', texto: 'DIMEX' }, { valor: '04', texto: 'NITE' }] },
            { id: 'cedula', tipo: 'texto', etiqueta: 'Número', defecto: cedula, teclado: 'numeric', max: 12 },
            { id: 'correo', tipo: 'texto', etiqueta: 'Correo', defecto: correo, teclado: 'email', max: 120 },
            { id: 'medio', tipo: 'elegir', etiqueta: 'Pago', defecto: args.medio === 'Efectivo' ? 'Efectivo' : 'SINPE',
              valores: [{ valor: 'SINPE', texto: 'SINPE Móvil' }, { valor: 'Efectivo', texto: 'Efectivo' }] },
            { id: 'telefono', tipo: 'texto', etiqueta: 'Teléfono SINPE', defecto: telefono, teclado: 'tel', max: 12 },
            { id: 'garantia', tipo: 'elegir', etiqueta: 'Garantía', defecto: String([1, 3, 12].includes(Number(args.garantia_meses)) ? Number(args.garantia_meses) : 3),
              valores: [{ valor: '1', texto: '1 mes' }, { valor: '3', texto: '3 meses' }, { valor: '12', texto: '12 meses' }] },
            { id: 'servicio', tipo: 'texto', etiqueta: 'Detalle en la factura', defecto: servicio, max: 120 },
          ],
          boton: `Cobrar ${colon(total)}`, token: 'nunca', deshacible: false,
          nota: 'No se deshace: para anular, nota de crédito desde Contabilidad.',
        },
        objetivo: { lineas, total, servicio },
        paraIA: {
          total_colones: total, como_se_calculo: como, repuestos: lineas.map(l => `${l.cantidad} × ${l.nombre}`),
          ganancia_colones: Math.round(ganancia),
          cliente: previo ? 'encontrado en facturas anteriores' : (cedula || correo ? 'con datos del mensaje' : 'faltan sus datos: los completa en la tarjeta'),
        },
      };
    },
    ejecutar() { throw new Error('El cobro lo termina el panel.'); },
    paraCliente(objetivo, opc, ctx) {
      const cedula = String(opc.cedula || '').replace(/\D/g, '');
      exigir(String(opc.nombre || '').trim().length >= 3, 'Falta el nombre del cliente.');
      exigir(cedula.length >= 9 && cedula.length <= 12, 'La identificación tiene que tener entre 9 y 12 dígitos.');
      exigir(ES_CORREO.test(String(opc.correo || '')), 'El correo del cliente no es válido.');
      if (opc.medio === 'SINPE') exigir(String(opc.telefono || '').replace(/\D/g, '').length === 8, 'Para SINPE falta el teléfono de 8 dígitos.');
      return {
        clienteNombre: String(opc.nombre).trim(), clienteIdTipo: opc.id_tipo, clienteId: cedula,
        clienteEmail: String(opc.correo).trim().toLowerCase(), clienteTelefono: String(opc.telefono || '').replace(/\D/g, ''),
        descripcionServicio: String(opc.servicio || objetivo.servicio), montoTotal: Number(objetivo.total),
        garantiaMeses: Number(opc.garantia), medioCobro: opc.medio,
        repuestos: (objetivo.lineas || []).map((l: any) => ({ productId: l.id, productName: l.nombre, quantity: l.cantidad, costoUnitario: l.costo, precioUnitario: l.precio, esRegalia: false })),
        insumos: [], adminEmail: ctx.email,
      };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'responder_chat',
    bitacora: 'Respuesta de chat por Jarvis',
    descripcion: 'ENVÍA un mensaje a un cliente en el Chat de la tienda, como respuesta del personal. Usala SIEMPRE que el dueño pida responder, contestar, escribirle, mandarle o decirle algo a un cliente por el chat (no abras el módulo Chat en su lugar). `texto` es lo que el dueño pidió decir, tal cual (si dijo «respondele yo más», el texto es «Yo más»); solo corregí mayúscula inicial y puntuación, no agregues saludos ni contenido. `cliente` es el nombre como lo dijo, o «último» si habla del chat más reciente.',
    parametros: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente como lo dijo el dueño, o «último».' },
        texto: { type: 'string', description: 'El mensaje exacto a enviar.' },
      },
      required: ['cliente', 'texto'],
    },
    async preparar(args, ctx) {
      const mensaje = String(args.texto ?? '').trim().slice(0, 1000);
      exigir(mensaje.length >= 1, 'Falta el texto del mensaje.');
      const q = patron(args.cliente);
      const ultimo = !q || /^(el |la )?(ú|u)ltim|reciente|ese chat|este chat/i.test(q);
      // Los nombres se comparan «planos»: sin tildes, sin mayúsculas y sin
      // letras decoradas (hay clientes que escriben su nombre en 𝐧𝐞𝐠𝐫𝐢𝐭𝐚, y
      // la búsqueda de la base de datos no los encontraba).
      const plano = (t: unknown) => String(t || '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const { data: convs, error } = await ctx.db.from('chat_conversations').select('id,customer_name,status,updated_at,unread_count')
        .order('updated_at', { ascending: false }).limit(ultimo ? 3 : 120);
      if (error) throw error;
      const palabras = plano(q).split(' ').filter(w => w.length >= 2);
      const coinciden = ultimo ? (convs || []) : (convs || []).filter((c: any) => { const n = plano(c.customer_name); return palabras.length > 0 && palabras.every(w => n.includes(w)); });
      // Las abiertas primero; una resuelta solo si no hay otra.
      const lista = [...coinciden].sort((a: any, b: any) => Number(a.status === 'resuelto') - Number(b.status === 'resuelto')).slice(0, 5);
      exigir(lista.length, ultimo ? 'No hay chats todavía.' : `No encontré un chat de «${q}».`);
      const ids = lista.map((c: any) => c.id);
      const { data: msgs } = await ctx.db.from('chat_messages').select('conversation_id,sender,text,created_at').in('conversation_id', ids).eq('sender', 'customer').order('created_at', { ascending: false }).limit(40);
      const ultimoDe = (id: string) => (msgs || []).find((m: any) => m.conversation_id === id);
      const abiertas = lista.filter((c: any) => c.status !== 'resuelto');
      // Es «seguro» enviarlo solo si no hay dudas de a quién: el último chat,
      // un solo chat abierto que coincide, o varios pero todos de la MISMA
      // persona (se usa el más reciente).
      const personas = new Set(lista.map((c: any) => plano(c.customer_name)));
      const seguro = ultimo ? true : (abiertas.length === 1 || lista.length === 1 || personas.size === 1);
      const auto = seguro && ctx.ajustes.chat_directo !== false;
      const elegido = lista[0];
      const corto = (t: unknown) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 70 ? `${x.slice(0, 67)}…` : x || '(foto, audio o video)'; };
      return {
        tarjeta: {
          accion: 'responder_chat', modulo: 'Chat', icono: 'message', titulo: lista.length === 1 || auto ? `Responder a ${elegido.customer_name || 'cliente'}` : 'Responder un chat',
          riesgo: 'reversible', chip: 'Mensaje al cliente', enCliente: 'chat', auto, deshacerMin: 10,
          efecto: 'Se envía en el chat como respuesta de la tienda; el cliente lo ve al instante.',
          filas: lista.length === 1 || auto ? [{ etiqueta: 'Último del cliente', valor: ultimoDe(elegido.id) ? `«${corto(ultimoDe(elegido.id).text)}» · ${fechaCorta(ultimoDe(elegido.id).created_at)}` : '—' }] : [],
          opciones: [
            ...(lista.length > 1 && !auto ? [{ id: 'chat', tipo: 'elegir' as const, etiqueta: 'Chat', defecto: 'c0',
              valores: lista.map((c: any, i: number) => ({ valor: `c${i}`, texto: c.customer_name || 'Cliente',
                ayuda: `${c.status === 'resuelto' ? 'Resuelto' : c.unread_count ? `${c.unread_count} sin leer` : 'Abierto'} · último: «${corto(ultimoDe(c.id)?.text)}»` })) }] : []),
            { id: 'texto', tipo: 'texto' as const, etiqueta: 'Mensaje', defecto: mensaje, max: 1000 },
          ],
          boton: 'Enviar', token: 'nunca', deshacible: true,
          nota: auto ? 'Enviado sin preguntar: había un solo chat que coincidía. Se puede borrar por 10 minutos.' : 'Se puede borrar para todos durante 10 minutos.',
        },
        objetivo: { chats: lista.map((c: any) => ({ id: c.id, nombre: c.customer_name || 'Cliente' })) },
        paraIA: auto
          ? { hecho: true, se_envia_solo: true, instruccion: 'YA SE ENVIÓ, no pidas confirmar. Respondé en pasado y corto, p. ej. «Listo, ya le escribí.»' }
          : { hecho: false, chats_que_coinciden: lista.length, instruccion: 'Hay varios chats posibles: decí que elija el chat en la tarjeta y toque Enviar.' },
      };
    },
    ejecutar() { throw new Error('El mensaje lo envía el panel.'); },
    async deshacer(_o, _opc, resultado) {
      // El panel ya lo borró para todos; aquí solo queda el registro.
      return { texto: 'Mensaje borrado.', detalle: `Se borró el mensaje${resultado?.datos?.cliente ? ` a ${resultado.datos.cliente}` : ''}.` };
    },
    paraCliente(objetivo, opc) {
      const i = opc.chat ? Number(String(opc.chat).slice(1)) : 0;
      const c = objetivo.chats?.[i];
      exigir(c, 'Chat no válido.');
      const texto = String(opc.texto || '').trim();
      exigir(texto.length >= 1, 'El mensaje está vacío.');
      return { convId: c.id, cliente: c.nombre, texto };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'cambiar_estado_orden',
    bitacora: 'Estado de orden por Jarvis',
    descripcion: 'CAMBIA el estado de una orden del Taller (mueve la tarjeta en el tablero). Usala cuando el dueño pida pasar, mover, marcar o poner una orden en un estado («la de Laura ya está lista», «marcá el TKT-104 como entregado»). Estados: Pendiente, Diagnosticada, Cotizada, Aprobada, Esperando repuestos, En Reparación, Lista, Entregada, Cancelada.',
    parametros: {
      type: 'object',
      properties: {
        orden: { type: 'string', description: 'Ticket (TKT-…), nombre del cliente o equipo, como lo dijo el dueño.' },
        estado: { type: 'string', enum: ['Pendiente', 'Diagnosticada', 'Cotizada', 'Aprobada', 'Esperando repuestos', 'En Reparación', 'Lista', 'Entregada', 'Cancelada'] },
      },
      required: ['orden', 'estado'],
    },
    async preparar(args, ctx) {
      const ESTADOS = ['Pendiente', 'Diagnosticada', 'Cotizada', 'Aprobada', 'Esperando repuestos', 'En Reparación', 'Lista', 'Entregada', 'Cancelada'];
      const estado = String(args.estado || '');
      exigir(ESTADOS.includes(estado), 'Ese estado no existe en el taller.');
      const q = patron(args.orden);
      exigir(q.length >= 2, 'Decime cuál orden: ticket, cliente o equipo.');
      const { data, error } = await ctx.db.from('repair_orders').select('id,ticket,customer_name,device,device_model,status,created_at')
        .or(`ticket.ilike.%${q}%,customer_name.ilike.%${q}%,device.ilike.%${q}%,device_model.ilike.%${q}%`).order('created_at', { ascending: false }).limit(8);
      if (error) throw error;
      const abiertas = (data || []).filter((o: any) => !['Entregada', 'Cancelada'].includes(o.status));
      const lista = (abiertas.length ? abiertas : data || []).slice(0, 5);
      exigir(lista.length, `No encontré una orden con «${q}».`);
      const ya = lista.length === 1 && lista[0].status === estado;
      exigir(!ya, `Esa orden ya está en «${estado}».`);
      // Entregar o cancelar cierra la orden (entregar sella la garantía): esos se confirman.
      const final = estado === 'Entregada' || estado === 'Cancelada';
      const auto = lista.length === 1 && !final && ctx.ajustes.taller_directo !== false;
      const o = lista[0];
      const nombre = (x: any) => `${x.ticket} · ${x.customer_name || 'Cliente'} · ${x.device_model || x.device || 'equipo'}`;
      return {
        tarjeta: {
          accion: 'cambiar_estado_orden', modulo: 'Taller', icono: 'wrench', titulo: lista.length === 1 ? `${o.ticket} → ${estado}` : `Mover una orden a «${estado}»`,
          riesgo: 'reversible', chip: final ? 'Cierra la orden' : 'Taller', enCliente: 'taller', auto, deshacerMin: 10,
          efecto: estado === 'Entregada' ? 'La orden pasa a Entregada y se sella la garantía.' : `La orden pasa a «${estado}» en el tablero, con su nota en la bitácora.`,
          filas: lista.length === 1 ? [{ etiqueta: 'Orden', valor: nombre(o) }, { etiqueta: 'Estado actual', valor: o.status }] : [],
          opciones: lista.length > 1 ? [{ id: 'orden', tipo: 'elegir' as const, etiqueta: 'Orden', defecto: 'o0',
            valores: lista.map((x: any, i: number) => ({ valor: `o${i}`, texto: `${x.ticket} · ${x.customer_name || 'Cliente'}`, ayuda: `${x.device_model || x.device || 'equipo'} · ahora: ${x.status}` })) }] : [],
          boton: `Pasar a ${estado}`, token: 'nunca', deshacible: true,
          nota: auto ? 'Hecho sin preguntar: había una sola orden. Se puede deshacer por 10 minutos.' : 'Se puede deshacer por 10 minutos.',
        },
        objetivo: { ordenes: lista.map((x: any) => ({ id: x.id, ticket: x.ticket, estado: x.status })), estado },
        paraIA: auto
          ? { hecho: true, se_hace_solo: true, ticket: o.ticket, instruccion: 'YA SE HIZO, no pidas confirmar. Respondé en pasado y corto.' }
          : { hecho: false, ordenes_posibles: lista.length, instruccion: final ? 'Entregar o cancelar se confirma en la tarjeta.' : 'Hay varias órdenes posibles: que elija en la tarjeta.' },
      };
    },
    ejecutar() { throw new Error('El cambio lo hace el panel.'); },
    async deshacer(_o, _opc, resultado) {
      return { texto: 'Estado revertido.', detalle: `La orden volvió a «${resultado?.datos?.anterior || 'su estado anterior'}».` };
    },
    paraCliente(objetivo, opc) {
      const i = opc.orden ? Number(String(opc.orden).slice(1)) : 0;
      const o = objetivo.ordenes?.[i];
      exigir(o, 'Orden no válida.');
      return { repairId: o.id, ticket: o.ticket, estado: objetivo.estado };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'editar_producto',
    bitacora: 'Inventario por Jarvis',
    descripcion: 'CAMBIA las existencias o el precio de venta de un producto del inventario. Usala cuando el dueño pida subir, bajar, poner o corregir el stock («entraron 5 cargadores USB-C», «quedan 2 fundas A12») o el precio («poné la funda A12 a ₡4 500»). `sumar` para sumar o restar unidades; `stock` para dejar un número exacto; `precio` en colones con IVA.',
    parametros: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre o SKU como lo dijo el dueño.' },
        sumar: { type: 'integer', description: 'Unidades a sumar (negativo para restar).' },
        stock: { type: 'integer', description: 'Existencia exacta que debe quedar.' },
        precio: { type: 'number', description: 'Nuevo precio de venta en colones, IVA incluido.' },
      },
      required: ['producto'],
    },
    async preparar(args, ctx) {
      const q = patron(args.producto);
      exigir(q.length >= 2, 'Decime cuál producto: nombre o SKU.');
      const sumar = args.sumar == null ? null : Math.round(Number(args.sumar));
      const fijar = args.stock == null ? null : Math.round(Number(args.stock));
      const precio = args.precio == null ? null : Math.round(Number(args.precio));
      exigir(sumar !== null || fijar !== null || precio !== null, 'Decime qué cambiar: unidades, existencia exacta o precio.');
      exigir(fijar === null || (fijar >= 0 && fijar <= 100000), 'Esa existencia no es válida.');
      exigir(sumar === null || Math.abs(sumar) <= 100000, 'Esa cantidad no es válida.');
      exigir(precio === null || (precio >= 0 && precio <= 50_000_000), 'Ese precio no es válido.');
      const { data, error } = await ctx.db.from('products').select('id,name,sku,stock,price').or(`sku.ilike.${q},name.ilike.%${q}%`).limit(6);
      if (error) throw error;
      const lista = data || [];
      const exacto = lista.find((x: any) => String(x.sku || '').toLowerCase() === q.toLowerCase()) || (lista.length === 1 ? lista[0] : null);
      if (!exacto) {
        exigir(lista.length, `No encontré «${q}» en el inventario.`);
        throw new Error(`Hay varios productos que coinciden con «${q}»: ${lista.map((x: any) => `${x.name} (SKU ${x.sku || '—'})`).join('; ')}. Preguntale cuál es.`);
      }
      const p: any = exacto;
      const nuevoStock = fijar !== null ? fijar : sumar !== null ? Math.max(0, Number(p.stock) + sumar) : Number(p.stock);
      const colon = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
      const cambios = [
        ...(nuevoStock !== Number(p.stock) ? [{ etiqueta: 'Existencias', valor: `${p.stock} → ${nuevoStock}` }] : []),
        ...(precio !== null && precio !== Number(p.price) ? [{ etiqueta: 'Precio', valor: `${colon(p.price)} → ${colon(precio)}` }] : []),
      ];
      exigir(cambios.length, `«${p.name}» ya está así: no hay nada que cambiar.`);
      // Bajar el precio a menos de la mitad o dejar en 0 se confirma: es el error de dedo típico.
      const raro = (precio !== null && Number(p.price) > 0 && precio < Number(p.price) / 2) || nuevoStock === 0;
      const auto = !raro && ctx.ajustes.inventario_directo !== false;
      return {
        tarjeta: {
          accion: 'editar_producto', modulo: 'Inventario', icono: 'package', titulo: p.name, riesgo: 'reversible',
          chip: 'Inventario', enCliente: 'inventario', auto, deshacerMin: 10,
          efecto: 'Se actualiza la ficha del producto y queda el movimiento en el historial de inventario.',
          filas: [{ etiqueta: 'SKU', valor: p.sku || '—' }, ...cambios],
          opciones: [],
          boton: 'Aplicar', token: 'nunca', deshacible: true,
          nota: auto ? 'Hecho sin preguntar. Se puede deshacer por 10 minutos.' : nuevoStock === 0 ? 'En 0 el producto sale de la tienda: confirmalo.' : 'El precio baja a menos de la mitad: confirmalo.',
        },
        objetivo: { id: p.id, nombre: p.name, modo: fijar !== null ? 'fijar' : 'sumar', stock: fijar !== null ? fijar : sumar, precio },
        paraIA: auto
          ? { hecho: true, se_hace_solo: true, producto: p.name, cambios: cambios.map(c => `${c.etiqueta}: ${c.valor}`), instruccion: 'YA SE HIZO. Decilo en pasado y corto.' }
          : { hecho: false, producto: p.name, cambios: cambios.map(c => `${c.etiqueta}: ${c.valor}`), instruccion: 'Pedile que confirme en la tarjeta.' },
      };
    },
    ejecutar() { throw new Error('El cambio lo hace el panel.'); },
    async deshacer() { return { texto: 'Producto restaurado.', detalle: 'El producto volvió a como estaba.' }; },
    paraCliente(objetivo) {
      return { productId: objetivo.id, nombre: objetivo.nombre, modo: objetivo.modo, stock: objetivo.stock, precio: objetivo.precio };
    },
  },
  // -------------------------------------------------------------------
  {
    nombre: 'crear_producto',
    bitacora: 'Producto creado por Jarvis',
    descripcion: 'CREA productos nuevos en el inventario (uno o varios de una vez, hasta 10). Usala cuando el dueño pida crear, agregar, registrar o dar de alta productos, también «de prueba». Precios en colones con IVA. `categoria`: Dispositivos, Estuches, Cargadores, Audio o Accesorios. Si el dueño dice que son de prueba o que no se vean, `en_tienda` = false. Si falta el precio o la cantidad, poné lo razonable y decí qué supusiste.',
    parametros: {
      type: 'object',
      properties: {
        productos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              precio: { type: 'number', description: 'Precio de venta en colones, IVA incluido.' },
              costo: { type: 'number', description: 'Costo en colones (opcional).' },
              stock: { type: 'integer', description: 'Unidades iniciales.' },
              categoria: { type: 'string', enum: ['Dispositivos', 'Estuches', 'Cargadores', 'Audio', 'Accesorios'] },
              descripcion: { type: 'string' },
            },
            required: ['nombre', 'precio'],
          },
        },
        en_tienda: { type: 'boolean', description: 'false = quedan ocultos de la tienda pública (productos de prueba).' },
      },
      required: ['productos'],
    },
    async preparar(args, ctx) {
      const CATS = ['Dispositivos', 'Estuches', 'Cargadores', 'Audio', 'Accesorios'];
      const entrada = Array.isArray(args.productos) ? args.productos.slice(0, 10) : [];
      exigir(entrada.length, 'Decime qué productos crear: nombre y precio.');
      const lista = entrada.map((x: any) => {
        const nombre = texto(x?.nombre, 80);
        const precio = Math.round(Number(x?.precio));
        const costo = x?.costo == null ? 0 : Math.round(Number(x.costo));
        const stock = x?.stock == null ? 1 : Math.round(Number(x.stock));
        exigir(nombre.length >= 2, 'A un producto le falta el nombre.');
        exigir(Number.isFinite(precio) && precio >= 0 && precio <= 50_000_000, `El precio de «${nombre}» no es válido.`);
        exigir(Number.isFinite(costo) && costo >= 0 && costo <= 50_000_000, `El costo de «${nombre}» no es válido.`);
        exigir(Number.isFinite(stock) && stock >= 0 && stock <= 100000, `La cantidad de «${nombre}» no es válida.`);
        return { nombre, precio, costo, stock, categoria: CATS.includes(String(x?.categoria)) ? String(x.categoria) : 'Accesorios', descripcion: texto(x?.descripcion, 300) };
      });
      // Que no se dupliquen productos que ya existen con el mismo nombre.
      const { data: existentes, error } = await ctx.db.from('products').select('name').in('name', lista.map(l => l.nombre)).limit(20);
      if (error) throw error;
      const ya = new Set((existentes || []).map((e: any) => String(e.name).toLowerCase()));
      const nuevos = lista.filter(l => !ya.has(l.nombre.toLowerCase()));
      exigir(nuevos.length, `Ya existe${lista.length > 1 ? 'n' : ''} en el inventario: ${lista.map(l => l.nombre).join(', ')}.`);
      const enTienda = args.en_tienda !== false;
      const colon = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
      const auto = ctx.ajustes.inventario_directo !== false;
      const titulo = nuevos.length === 1 ? `Nuevo: ${nuevos[0].nombre}` : `${nuevos.length} productos nuevos`;
      return {
        tarjeta: {
          accion: 'crear_producto', modulo: 'Inventario', icono: 'package', titulo, riesgo: 'reversible',
          chip: 'Inventario', enCliente: 'inventario', auto, deshacerMin: 10,
          efecto: enTienda ? 'Se crean en el inventario y aparecen en la tienda.' : 'Se crean en el inventario, ocultos de la tienda.',
          filas: nuevos.map(n => ({ etiqueta: n.nombre, valor: `${colon(n.precio)} · ${n.stock} u. · ${n.categoria}` })),
          opciones: [],
          boton: 'Crear', token: 'nunca', deshacible: true,
          nota: auto ? 'Hecho sin preguntar. Se puede deshacer por 10 minutos.' : 'Se puede deshacer por 10 minutos.',
        },
        objetivo: { crear: nuevos, enTienda },
        paraIA: {
          ...(auto ? { hecho: true, se_hace_solo: true, instruccion: 'YA SE HIZO. Decilo en pasado y en una frase.' } : { hecho: false, instruccion: 'Pedile que confirme en la tarjeta.' }),
          creados: nuevos.map(n => `${n.nombre} (${colon(n.precio)}, ${n.stock} u.)`),
          ...(nuevos.length < lista.length ? { ya_existian: lista.filter(l => ya.has(l.nombre.toLowerCase())).map(l => l.nombre) } : {}),
          en_tienda: enTienda,
        },
      };
    },
    ejecutar() { throw new Error('Los crea el panel.'); },
    async deshacer() { return { texto: 'Productos retirados.', detalle: 'Los productos creados se retiraron del inventario y de la tienda.' }; },
    paraCliente(objetivo) {
      exigir(Array.isArray(objetivo.crear) && objetivo.crear.length, 'No hay productos para crear.');
      return { crear: objetivo.crear, enTienda: objetivo.enTienda !== false };
    },
  },
];
