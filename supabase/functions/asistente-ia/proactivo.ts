// =====================================================================
// JARVIS PROACTIVO — te habla primero
// =====================================================================
// Lo corre la base sola (pg_cron → esta función, ver
// supabase/migracion_jarvis_proactivo.sql), sin que nadie le pregunte:
//   · vigilar (cada 15 min): chats sin responder, existencias en el mínimo,
//     equipos listos que nadie retira, ingresos fallidos o desde un aparato
//     nuevo, y un día de ventas muy por debajo de lo normal.
//   · resumen (7:00 a. m.): el resumen de la mañana, con la voz de Jarvis.
//   · repaso (2:30 a. m.): ordena el cerebro solo y le pone vector a todo.
// Cada aviso queda en `jarvis_avisos` (una sola vez: clave única) y la app
// lo muestra al instante y lo notifica en el teléfono.
// La llamada se valida con la llave de `jarvis_cron`, que solo puede leer
// la base (service_role): nadie de afuera puede disparar estas tareas.
// =====================================================================

import { crearCerebro } from './cerebro.ts';

type Db = any;
type Aviso = { tipo: string; clave: string; titulo: string; cuerpo: string; nivel?: 'info' | 'atencion' | 'urgente'; destino?: string };
type Redactar = (prompt: string, datos: string) => Promise<string | null>;

const colon = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR');
const diaCR = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d);
const horaCR = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', hour: 'numeric', hour12: false }).format(new Date()));
const minutos = (desde: string) => Math.round((Date.now() - new Date(desde).getTime()) / 60_000);
/** Inicio del día de Costa Rica (UTC-6, sin horario de verano). */
const inicioDia = (dia: string) => new Date(`${dia}T00:00:00-06:00`).toISOString();

/** ¿La llamada viene de la base (pg_cron) con la llave correcta? */
export async function esCron(admin: Db, req: Request): Promise<boolean> {
  const llave = req.headers.get('x-jarvis-cron') || '';
  if (llave.length < 20) return false;
  const { data } = await admin.from('jarvis_cron').select('clave').eq('id', 1).maybeSingle();
  return !!data?.clave && data.clave === llave;
}

async function guardar(admin: Db, uid: string, avisos: Aviso[]): Promise<number> {
  let nuevos = 0;
  for (const a of avisos) {
    const { error } = await admin.from('jarvis_avisos').insert({ user_id: uid, tipo: a.tipo, clave: a.clave.slice(0, 200), titulo: a.titulo.slice(0, 120), cuerpo: a.cuerpo.slice(0, 2000), nivel: a.nivel || 'info', destino: a.destino || null });
    if (!error) nuevos++; // la clave repetida (ya avisado) choca y no se duplica
  }
  return nuevos;
}

// ------------------------------- VIGILAR -------------------------------
async function vigilar(admin: Db): Promise<Aviso[]> {
  const dia = diaCR();
  const avisos: Aviso[] = [];
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const [chats, prods, taller, fallidos, nuevos] = await Promise.all([
    admin.from('chat_conversations').select('id,customer_name,unread_count,updated_at,status').gt('unread_count', 0).neq('status', 'resuelto').lt('updated_at', hace(15)).gt('updated_at', hace(24 * 60)).limit(20),
    admin.from('products').select('id,name,stock,min_stock').eq('active', true).gt('min_stock', 0).limit(3000),
    admin.from('repair_orders').select('id,ticket,device,status,created_at').in('status', ['Lista', 'Listo', 'Lista para entregar']).lt('created_at', hace(3 * 24 * 60)).limit(50),
    admin.from('login_audit_logs').select('id,ip,email,exito,ocurrido_en').eq('exito', false).gt('ocurrido_en', hace(15)).limit(50),
    admin.from('login_audit_logs').select('id,email,ciudad,pais,dispositivo_conocido,ocurrido_en').eq('exito', true).eq('dispositivo_conocido', false).gt('ocurrido_en', hace(16)).limit(10),
  ]);
  // 1) Un cliente esperando.
  for (const c of (chats.data || []) as any[]) {
    const m = minutos(c.updated_at);
    avisos.push({ tipo: 'chat', clave: `chat:${c.id}:${c.updated_at}`, titulo: 'Un cliente está esperando', cuerpo: `${c.customer_name || 'Un cliente'} lleva ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`} sin respuesta en el chat (${c.unread_count} mensaje${c.unread_count === 1 ? '' : 's'}).`, nivel: m > 60 ? 'urgente' : 'atencion', destino: 'chat' });
  }
  // 2) Existencias en el mínimo (un aviso por día y por grupo de productos).
  const bajos = ((prods.data || []) as any[]).filter(p => Number(p.stock) <= Number(p.min_stock));
  if (bajos.length) {
    const firma = bajos.map(p => p.id).sort().join(',');
    let h = 0; for (let i = 0; i < firma.length; i++) h = (h * 31 + firma.charCodeAt(i)) | 0;
    const agotados = bajos.filter(p => Number(p.stock) <= 0).length;
    avisos.push({ tipo: 'stock', clave: `stock:${dia}:${h}`, titulo: `${bajos.length} producto${bajos.length === 1 ? '' : 's'} en el mínimo`, cuerpo: `${agotados ? `${agotados} agotado${agotados === 1 ? '' : 's'}. ` : ''}Por ejemplo: ${bajos.slice(0, 5).map(p => `${String(p.name).slice(0, 40)} (${p.stock})`).join(', ')}.`, nivel: agotados ? 'atencion' : 'info', destino: 'inventario_productos' });
  }
  // 3) Equipos listos que nadie retira.
  const listos = (taller.data || []) as any[];
  if (listos.length) avisos.push({ tipo: 'taller', clave: `taller:${dia}:${listos.length}`, titulo: `${listos.length} equipo${listos.length === 1 ? '' : 's'} listo${listos.length === 1 ? '' : 's'} sin retirar`, cuerpo: `Llevan más de 3 días listos: ${listos.slice(0, 4).map(o => `${o.ticket || ''} ${String(o.device || '').slice(0, 30)}`.trim()).join(', ')}. ¿Les escribo para avisarles?`, nivel: 'info', destino: 'taller' });
  // 4) Seguridad: intentos fallidos seguidos o un ingreso desde un aparato nuevo.
  const f = (fallidos.data || []) as any[];
  if (f.length >= 3) {
    const ips = [...new Set(f.map(x => x.ip).filter(Boolean))];
    avisos.push({ tipo: 'seguridad', clave: `seguridad:fallidos:${Math.floor(Date.now() / (15 * 60_000))}`, titulo: `${f.length} intentos de ingreso fallidos`, cuerpo: `En los últimos 15 minutos, desde ${ips.length} IP${ips.length === 1 ? '' : 's'}${ips.length ? ` (${ips.slice(0, 3).join(', ')})` : ''}. Revisá si hay que bloquear.`, nivel: 'urgente', destino: 'ciberseguridad' });
  }
  for (const n of (nuevos.data || []) as any[]) {
    avisos.push({ tipo: 'seguridad', clave: `seguridad:nuevo:${n.id}`, titulo: 'Ingreso desde un aparato nuevo', cuerpo: `${n.email || 'Una cuenta'} entró desde un aparato que no se conocía${n.ciudad ? ` (${n.ciudad}${n.pais ? `, ${n.pais}` : ''})` : ''}.`, nivel: 'atencion', destino: 'ciberseguridad' });
  }
  // 5) Ventas muy por debajo de lo normal (una vez por día, en la tarde).
  const hora = horaCR();
  if (hora >= 15 && hora <= 19) {
    const desde = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { data: fac } = await admin.from('invoices').select('total,created_at').gte('created_at', desde).limit(5000);
    const hoy = inicioDia(dia);
    let ventasHoy = 0; const otros: Record<string, number> = {};
    for (const x of (fac || []) as any[]) {
      const t = new Date(x.created_at);
      if (x.created_at >= hoy) { ventasHoy += Number(x.total || 0); continue; }
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', hour: 'numeric', hour12: false }).format(t));
      if (h <= hora) { const d = diaCR(t); otros[d] = (otros[d] || 0) + Number(x.total || 0); }
    }
    const dias = Object.values(otros);
    const promedio = dias.length ? dias.reduce((a, b) => a + b, 0) / 7 : 0;
    if (promedio > 0 && ventasHoy < promedio * 0.5) {
      avisos.push({ tipo: 'ventas', clave: `ventas:${dia}`, titulo: 'Ventas bajas hoy', cuerpo: `A esta hora llevamos ${colon(ventasHoy)}; lo normal a esta hora es unos ${colon(promedio)}. ¿Movemos alguna promoción?`, nivel: 'atencion', destino: 'facturacion' });
    }
  }
  return avisos;
}

// ------------------------------- RESUMEN -------------------------------
async function resumen(admin: Db, uid: string, nombre: string, redactar: Redactar): Promise<Aviso> {
  const dia = diaCR();
  const ayer = diaCR(new Date(Date.now() - 86_400_000));
  const [fac, agenda, prods, taller, chats, intentos, pendientes] = await Promise.all([
    admin.from('invoices').select('total,created_at').gte('created_at', inicioDia(ayer)).lt('created_at', inicioDia(dia)).limit(5000),
    admin.from('jarvis_agenda').select('texto,cuando').eq('user_id', uid).eq('estado', 'pendiente').lt('cuando', new Date(new Date(inicioDia(dia)).getTime() + 86_400_000).toISOString()).order('cuando').limit(10),
    admin.from('products').select('name,stock,min_stock').eq('active', true).gt('min_stock', 0).limit(3000),
    admin.from('repair_orders').select('status').limit(2000),
    admin.from('chat_conversations').select('id').gt('unread_count', 0).neq('status', 'resuelto').limit(50),
    admin.from('login_audit_logs').select('id').eq('exito', false).gt('ocurrido_en', new Date(Date.now() - 86_400_000).toISOString()).limit(500),
    admin.from('jarvis_avisos').select('titulo').eq('user_id', uid).is('leido_en', null).neq('tipo', 'resumen').limit(20),
  ]);
  const ventas = (fac.data || []) as any[];
  const total = ventas.reduce((a, x) => a + Number(x.total || 0), 0);
  const bajos = ((prods.data || []) as any[]).filter(p => Number(p.stock) <= Number(p.min_stock));
  const estados: Record<string, number> = {};
  for (const o of (taller.data || []) as any[]) estados[o.status] = (estados[o.status] || 0) + 1;
  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { timeZone: 'America/Costa_Rica', hour: 'numeric', minute: '2-digit' });
  const datos = [
    `Ventas de ayer: ${colon(total)} en ${ventas.length} comprobante(s).`,
    `Agenda de hoy: ${(agenda.data || []).length ? (agenda.data as any[]).map(a => `${a.cuando ? hora(a.cuando) : 'sin hora'} ${a.texto}`).join('; ') : 'nada agendado'}.`,
    `Taller: ${Object.entries(estados).map(([e, n]) => `${n} ${e}`).join(', ') || 'sin órdenes'}.`,
    `Productos en el mínimo: ${bajos.length}${bajos.length ? ` (${bajos.slice(0, 4).map(p => p.name).join(', ')})` : ''}.`,
    `Chats con mensajes sin responder: ${(chats.data || []).length}.`,
    `Intentos de ingreso fallidos en 24 h: ${(intentos.data || []).length}.`,
    `Avisos sin leer: ${(pendientes.data || []).length ? (pendientes.data as any[]).map(a => a.titulo).join('; ') : 'ninguno'}.`,
  ].join('\n');
  const fecha = new Date().toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'long', day: 'numeric', month: 'long' });
  const texto = await redactar(
    `Sos Jarvis, el asistente personal del dueño de Technoverse Costa Rica (tienda y taller de celulares). Escribí su RESUMEN DE LA MAÑANA para escucharlo en voz alta: saludo corto con su nombre, lo más importante primero, cifras exactas de los datos, y cerrá con UNA recomendación concreta para hoy. 4 a 7 frases, voseo costarricense cálido, sin listas ni títulos, sin inventar nada que no esté en los datos. Devolvé SOLO JSON: {"texto":"…"}`,
    `Nombre del dueño: ${nombre}\nHoy es ${fecha}.\n\nDATOS:\n${datos}`,
  ).catch(() => null);
  const plano = `Buenos días${nombre ? `, ${nombre}` : ''}. Ayer cerramos en ${colon(total)} con ${ventas.length} venta${ventas.length === 1 ? '' : 's'}. ${(agenda.data || []).length ? `Hoy tenés ${(agenda.data || []).length} pendiente${(agenda.data || []).length === 1 ? '' : 's'} en la agenda. ` : ''}${bajos.length ? `${bajos.length} producto${bajos.length === 1 ? ' está' : 's están'} en el mínimo. ` : ''}${(chats.data || []).length ? `Hay ${(chats.data || []).length} chat${(chats.data || []).length === 1 ? '' : 's'} esperando respuesta. ` : ''}Que tengás un buen día.`;
  return { tipo: 'resumen', clave: `resumen:${dia}`, titulo: `Buenos días · ${fecha}`, cuerpo: texto || plano, nivel: 'info' };
}

// ----------------------------- LA PUERTA -----------------------------
export async function tareaCron(admin: Db, tarea: string, redactar: Redactar, soloUid?: string): Promise<Record<string, unknown>> {
  let q = admin.from('profiles').select('id,name,email').eq('role', 'superadmin').limit(5);
  if (soloUid) q = q.eq('id', soloUid);
  const { data: duenos } = await q;
  const lista = (duenos || []) as any[];
  if (!lista.length) return { ok: true, nada: 'sin superadmin' };
  if (tarea === 'vigilar') {
    const avisos = await vigilar(admin);
    let nuevos = 0;
    for (const d of lista) nuevos += await guardar(admin, d.id, avisos);
    return { ok: true, avisos: avisos.length, nuevos };
  }
  if (tarea === 'resumen') {
    let nuevos = 0;
    for (const d of lista) {
      const r = await resumen(admin, d.id, String(d.name || '').split(' ')[0], redactar);
      // Pedido a mano (botón «Resumen ahora»): uno nuevo cada vez.
      if (soloUid) r.clave = `${r.clave}:${Date.now()}`;
      nuevos += await guardar(admin, d.id, [r]);
    }
    return { ok: true, nuevos };
  }
  if (tarea === 'repaso') {
    const r: Record<string, unknown> = {};
    for (const d of lista) {
      const c = crearCerebro(admin, d.id);
      const orden = await c.editar('depurar', { aplicar: true }).catch(e => ({ ok: false, error: String(e) }));
      const vectores = await c.vectorizar(300).catch(() => 0);
      await c.esperar();
      r[d.id] = { orden: (orden as any)?.nodo?.plan || orden, vectores };
    }
    // Los avisos leídos de más de 30 días ya no hacen falta.
    await admin.from('jarvis_avisos').delete().lt('creado_en', new Date(Date.now() - 30 * 86_400_000).toISOString()).not('leido_en', 'is', null);
    return { ok: true, repaso: r };
  }
  return { ok: false, error: `Tarea desconocida: ${tarea}` };
}
