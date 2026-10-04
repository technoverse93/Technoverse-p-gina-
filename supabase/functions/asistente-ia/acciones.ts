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
// registros, cobrar, cambiar roles, ni para vigilar o seguir a personas.
// =====================================================================

// deno-lint-ignore no-explicit-any
type Db = any;

export type Riesgo = 'reversible' | 'acceso';
export type Opcion =
  | { id: string; tipo: 'elegir'; etiqueta: string; valores: { valor: string; texto: string; ayuda?: string }[]; defecto: string }
  | { id: 'minutos'; tipo: 'duracion'; etiqueta: string; defecto: number | null }
  | { id: 'motivo'; tipo: 'texto'; etiqueta: string; defecto: string };
export type Tarjeta = {
  accion: string;
  modulo: string;
  icono: 'ban' | 'unlock' | 'log-out';
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
      out[o.id] = texto(c[o.id] ?? o.defecto, 120);
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
  descripcion: 'Deja un botón para que el superadmin abra un módulo del panel en una pestaña. Usalo cuando pida «abrí», «llevame a» o cuando el detalle esté mejor en su pantalla.',
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
];
