// =====================================================================
// PRUEBAS DE LA LÓGICA DEL CRM (embudo, seguimiento, segmentos y métricas)
// =====================================================================
// `npm run probar-crm` — compila src/utils/crmLogica.ts en memoria (esbuild, que ya viene con Vite) y comprueba
// con datos fijos lo que el panel decide: qué contactos están vencidos o estancados, qué entra en un segmento,
// cómo se calculan la conversión y las ventas, y que el CSV no se pueda usar para colar fórmulas en Excel.
// No necesita red ni base de datos. Sale con código 1 si algo falla.
// =====================================================================

process.env.TZ = 'America/Costa_Rica';

import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const salida = await build({
  entryPoints: [join(RAIZ, 'src/utils/crmLogica.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const L = await import('data:text/javascript;base64,' + Buffer.from(salida.outputFiles[0].text).toString('base64'));

let pasan = 0;
const fallos = [];
function prueba(nombre, cond, detalle = '') {
  if (cond) pasan++;
  else fallos.push(`${nombre}${detalle ? ' — ' + detalle : ''}`);
}
const igual = (nombre, real, esperado) => prueba(nombre, JSON.stringify(real) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}`);

// «Ahora»: jueves 15 de octubre de 2026, 15:00 en Costa Rica (UTC-6).
const AHORA = Date.parse('2026-10-15T15:00:00-06:00');
const hace = (dias, horas = 0) => new Date(AHORA - dias * 86_400_000 - horas * 3_600_000).toISOString();
const en = (dias, horas = 0) => new Date(AHORA + dias * 86_400_000 + horas * 3_600_000).toISOString();

const lead = (o = {}) => L.leadDesdeFila({
  id: o.id ?? 'x', nombre: o.nombre ?? 'Persona', email: o.email === undefined ? 'p@correo.cr' : o.email, telefono: o.telefono ?? null,
  etapa: o.etapa ?? 'nuevo', etapa_cambiada_en: o.etapaDesde ?? hace(1), canal: o.canal ?? 'chat_web', origen: o.origen ?? {}, fuente: o.fuente ?? 'directo',
  provincia: o.provincia ?? null, etiquetas: o.etiquetas ?? [], valor_estimado: o.valor ?? 0, responsable: o.responsable ?? null,
  proximo_contacto: o.proximo ?? null, ultima_interaccion: o.ultima ?? hace(1), mensajes: o.mensajes ?? 0, archivado: o.archivado ?? false,
  created_at: o.creado ?? hace(2), updated_at: hace(1),
});

// ---- normalización y textos ----
igual('correo en minúsculas y sin espacios', L.normalizarEmail('  Ana@Correo.CR '), 'ana@correo.cr');
igual('correo nulo', L.normalizarEmail(null), '');
igual('teléfono con +506 y guion', L.normalizarTelefono('+506 8888-1111'), '88881111');
igual('teléfono sin prefijo', L.normalizarTelefono('8888 1111'), '88881111');
igual('teléfono demasiado corto', L.normalizarTelefono('2222'), '');
igual('iniciales de dos nombres', L.iniciales('ana mora', null), 'AM');
igual('iniciales de un correo', L.iniciales('', 'beto@correo.cr'), 'BC');
igual('iniciales de nada', L.iniciales('', ''), '?');
igual('primer nombre', L.primerNombre('Ana María Mora'), 'Ana');
igual('primer nombre en mayúsculas', L.primerNombre('ANA MORA'), 'Ana');
igual('plantilla con nombre', L.plantillaConNombre('¡Hola {nombre}! ¿Cómo estás {nombre}?', 'Ana Mora'), '¡Hola Ana! ¿Cómo estás Ana?');
igual('plantilla sin nombre quita la marca y su espacio', L.plantillaConNombre('¡Hola {nombre}!', ''), '¡Hola!');
igual('hace unos minutos', L.haceCuanto(hace(0, 0.5), AHORA), 'hace 30 min');
igual('hace horas', L.haceCuanto(hace(0, 5), AHORA), 'hace 5 h');
igual('hace días', L.haceCuanto(hace(3), AHORA), 'hace 3 d');
igual('hace semanas', L.haceCuanto(hace(21), AHORA), 'hace 3 sem');
igual('hace meses', L.haceCuanto(hace(95), AHORA), 'hace 3 meses');
igual('fecha inválida', L.haceCuanto('no es fecha', AHORA), '');
prueba('vence hoy', /^hoy/.test(L.cuandoVence(en(0, 2), AHORA)), L.cuandoVence(en(0, 2), AHORA));
prueba('vence mañana', /^mañana/.test(L.cuandoVence(en(1), AHORA)), L.cuandoVence(en(1), AHORA));
igual('vence en 4 días', L.cuandoVence(en(4), AHORA), 'en 4 d');
igual('venció hace 3 días', L.cuandoVence(hace(3), AHORA), 'hace 3 d');
igual('etiqueta: nombre, correo o teléfono', [L.etiquetaDeLead({ nombre: '', email: null, telefono: '8888 1111' }), L.etiquetaDeLead({ nombre: '', email: 'a@b.cr', telefono: null }), L.etiquetaDeLead({ nombre: 'Ana', email: 'a@b.cr', telefono: null })], ['8888 1111', 'a@b.cr', 'Ana']);

// ---- fila de la base ----
const crudo = L.leadDesdeFila({ id: 'a', etapa: 'ganado', canal: 'inventado', fuente: 'marte', etiquetas: ['vip', 7, null], valor_estimado: '1500.50', origen: [1], archivado: null });
igual('etapa inventada → nuevo', crudo.etapa, 'nuevo');
igual('canal inventado → manual', crudo.canal, 'manual');
igual('origen inventado → directo', crudo.fuente, 'directo');
igual('etiquetas: solo texto', crudo.etiquetas, ['vip']);
igual('valor numérico', crudo.valorEstimado, 1500.5);
igual('origen que no es objeto → vacío', crudo.origen, {});
igual('archivado nulo → falso', crudo.archivado, false);
igual('evento con tipo raro → sistema', L.eventoDesdeFila({ id: '3', lead_id: 'a', tipo: 'zzz', resumen: 'x' }).tipo, 'sistema');
igual('respuesta activa por defecto', L.respuestaDesdeFila({ id: '1', atajo: 'hola' }).activa, true);

// ---- seguimiento ----
igual('sin recordatorio', L.estadoSeguimiento({ proximoContacto: null }, AHORA), 'sin_recordatorio');
igual('vencido', L.estadoSeguimiento({ proximoContacto: hace(0, 3) }, AHORA), 'vencido');
igual('para hoy (más tarde)', L.estadoSeguimiento({ proximoContacto: en(0, 4) }, AHORA), 'hoy');
igual('próximo (mañana)', L.estadoSeguimiento({ proximoContacto: en(1) }, AHORA), 'proximo');
prueba('estancado: abierto, sin recordatorio y 6 días quieto', L.estaEstancado(lead({ etapa: 'conversacion', ultima: hace(6) }), AHORA));
prueba('no estancado: movimiento reciente', !L.estaEstancado(lead({ etapa: 'conversacion', ultima: hace(1) }), AHORA));
prueba('no estancado: ya tiene recordatorio', !L.estaEstancado(lead({ etapa: 'conversacion', ultima: hace(9), proximo: en(2) }), AHORA));
prueba('no estancado: ya compró', !L.estaEstancado(lead({ etapa: 'cerrado', ultima: hace(30) }), AHORA));
prueba('no estancado: archivado', !L.estaEstancado(lead({ etapa: 'nuevo', ultima: hace(30), archivado: true }), AHORA));
const orden = L.ordenarPorUrgencia([lead({ id: 'reciente', ultima: hace(0, 1) }), lead({ id: 'vencido', ultima: hace(9), proximo: hace(1) }), lead({ id: 'viejo', ultima: hace(5) })], AHORA).map(l => l.id);
igual('los vencidos van primero, luego lo más reciente', orden, ['vencido', 'reciente', 'viejo']);

// ---- búsqueda ----
const ana = lead({ id: 'ana', nombre: 'Ana Mora', email: 'ana@correo.cr', telefono: '+506 8888-1111', provincia: 'Heredia', etiquetas: ['vip'], origen: { utm_campaign: 'Verano' } });
prueba('busca por nombre sin tildes ni mayúsculas', L.coincideTexto(ana, 'MORA'));
prueba('busca por correo', L.coincideTexto(ana, 'ana@corr'));
prueba('busca por teléfono con otro formato', L.coincideTexto(ana, '8888 1111'));
prueba('busca por provincia', L.coincideTexto(ana, 'heredia'));
prueba('busca por etiqueta', L.coincideTexto(ana, 'vip'));
prueba('busca por campaña', L.coincideTexto(ana, 'verano'));
prueba('no encuentra lo que no está', !L.coincideTexto(ana, 'zapato'));
prueba('texto vacío coincide con todo', L.coincideTexto(ana, '  '));

// ---- compras ----
const pedidos = [
  { id: 'F1', customerEmail: 'Carla@correo.cr', total: 45000, status: 'Completado', timestamp: hace(70) },
  { id: 'F2', customerEmail: 'carla@correo.cr', total: 30000, status: 'Completado', timestamp: hace(3) },
  { id: 'N1', customerEmail: 'dani@correo.cr', total: 9000, status: 'Devuelto', timestamp: hace(3) },
  { id: 'F3', customerEmail: '', total: 100, status: 'Completado', timestamp: hace(1) },
  { id: 'F4', customerEmail: 'ana@correo.cr', total: 120000, status: 'Completado', timestamp: hace(80) },
];
const compras = L.comprasPorCorreo(pedidos);
igual('compras de Carla: 2 pedidos y ₡75 000, sin importar mayúsculas', [compras.get('carla@correo.cr')?.pedidos, compras.get('carla@correo.cr')?.total], [2, 75000]);
igual('su última compra es la más reciente', compras.get('carla@correo.cr')?.ultima, hace(3));
prueba('un pedido devuelto no cuenta', !compras.has('dani@correo.cr'));
prueba('un pedido sin correo no cuenta', compras.size === 2);

// ---- segmentos ----
const dataset = [
  lead({ id: 'ana',   nombre: 'Ana',   email: 'ana@correo.cr',   etapa: 'cerrado',        ultima: hace(40), provincia: 'Heredia',  etiquetas: ['vip'], canal: 'chat_web', fuente: 'redes' }),
  lead({ id: 'beto',  nombre: 'Beto',  email: 'beto@correo.cr',  etapa: 'nuevo',          ultima: hace(6),  canal: 'chat_web',   fuente: 'directo' }),
  lead({ id: 'carla', nombre: 'Carla', email: 'carla@correo.cr', etapa: 'postventa',      ultima: hace(20), canal: 'pedido',     fuente: 'directo', provincia: 'Cartago' }),
  lead({ id: 'dani',  nombre: 'Dani',  email: null, telefono: '8123-4567', etapa: 'cotizacion', ultima: hace(8), canal: 'taller', fuente: 'pauta' }),
  lead({ id: 'eli',   nombre: 'Eli',   email: 'eli@correo.cr',   etapa: 'pago_pendiente', ultima: hace(2),  canal: 'taller',     fuente: 'busqueda' }),
  lead({ id: 'fer',   nombre: 'Fer',   email: 'fer@correo.cr',   etapa: 'nuevo',          ultima: hace(1),  archivado: true }),
];
const ids = (f) => L.aplicarFiltro(dataset, f, compras, AHORA).map(l => l.id).join(',');
igual('sin filtro: todos menos los archivados', ids({}), 'ana,beto,carla,dani,eli');
igual('con archivados', ids({ incluirArchivados: true }), 'ana,beto,carla,dani,eli,fer');
igual('por etapa', ids({ etapas: ['nuevo'] }), 'beto');
igual('por varias etapas', ids({ etapas: ['cotizacion', 'pago_pendiente'] }), 'dani,eli');
igual('por canal', ids({ canales: ['taller'] }), 'dani,eli');
igual('por origen', ids({ fuentes: ['pauta', 'redes'] }), 'ana,dani');
igual('por etiqueta', ids({ etiquetas: ['vip'] }), 'ana');
igual('por provincia', ids({ provincias: ['Cartago'] }), 'carla');
igual('solo con correo', ids({ conCorreo: true }), 'ana,beto,carla,eli');
igual('ya compraron', ids({ compra: 'si' }), 'ana,carla');
igual('nunca compraron', ids({ compra: 'no' }), 'beto,dani,eli');
igual('gastaron ₡100 000 o más (Ana ₡120 000; Carla ₡75 000 no llega)', ids({ gastoMinimo: 100000 }), 'ana');
igual('última compra hace más de 60 días', ids({ ultimaCompraHaceMasDe: 60 }), 'ana');
igual('sin actividad hace más de 5 días', ids({ sinActividadMasDe: 5 }), 'ana,beto,carla,dani');
igual('filtros combinados', ids({ compra: 'si', conCorreo: true, sinActividadMasDe: 30 }), 'ana');
igual('texto + etapa', ids({ texto: 'dani', etapas: ['cotizacion'] }), 'dani');
for (const s of L.SEGMENTOS_SUGERIDOS) prueba(`el segmento sugerido «${s.nombre}» se puede aplicar`, Array.isArray(L.aplicarFiltro(dataset, s.filtro, compras, AHORA)));
igual('segmento «para recompra»', L.aplicarFiltro(dataset, L.SEGMENTOS_SUGERIDOS.find(s => s.id === 'recompra').filtro, compras, AHORA).map(l => l.id).join(','), 'ana');
igual('el filtro se describe en frases', L.describirFiltro({ etapas: ['nuevo'], compra: 'no', sinActividadMasDe: 7 }), ['Etapa: Nuevos', 'Nunca compraron', 'Sin actividad hace más de 7 d']);

// ---- exportar ----
const csv = L.aCsv([lead({ nombre: '=HYPERLINK("http://x")', email: 'a@b.cr', etiquetas: ['uno', 'dos'] }), lead({ nombre: 'Con, coma "y comillas"', email: 'c@d.cr' })], compras);
const lineas = csv.split('\r\n');
igual('el CSV tiene encabezado y una fila por contacto', lineas.length, 3);
prueba('una celda que empieza con = se neutraliza', lineas[1].startsWith(`"'=HYPERLINK(""http://x"")"`) || lineas[1].startsWith(`'=HYPERLINK`), lineas[1].slice(0, 40));
prueba('las comas y comillas se escapan', lineas[2].includes('"Con, coma ""y comillas"""'), lineas[2].slice(0, 60));
igual('correos sin repetir y en minúsculas', L.correosDe([lead({ email: 'A@b.cr' }), lead({ email: 'a@B.cr' }), lead({ email: null }), lead({ email: 'c@d.cr' })]), ['a@b.cr', 'c@d.cr']);

// ---- métricas ----
const base = [
  lead({ id: '1', etapa: 'nuevo',          creado: hace(1),  ultima: hace(1), canal: 'chat_web', fuente: 'redes', valor: 10000 }),
  lead({ id: '2', etapa: 'nuevo',          creado: hace(3),  ultima: hace(1), canal: 'chat_web', fuente: 'directo', proximo: hace(1) }),
  lead({ id: '3', etapa: 'conversacion',   creado: hace(10), ultima: hace(6), canal: 'tienda_form', fuente: 'redes', valor: 20000 }),
  lead({ id: '4', etapa: 'cotizacion',     creado: hace(12), ultima: hace(2), canal: 'taller', fuente: 'directo', valor: 50000, proximo: en(0, 3) }),
  lead({ id: '5', etapa: 'cerrado',        creado: hace(40), ultima: hace(30), etapaDesde: hace(30), canal: 'pedido', fuente: 'pauta', email: 'carla@correo.cr' }),
  lead({ id: '6', etapa: 'postventa',      creado: hace(50), ultima: hace(10), canal: 'registro', fuente: 'redes', email: 'ana@correo.cr' }),
  lead({ id: '7', etapa: 'nuevo',          creado: hace(9),  ultima: hace(9), canal: 'chat_web', fuente: 'busqueda', archivado: true }),
];
const m = L.calcularMetricas(base, pedidos, AHORA);
igual('total sin archivados', m.total, 6);
igual('abiertos', m.abiertos, 4);
igual('ganados', m.ganados, 2);
igual('conversión 2 de 6', Math.round((m.conversion ?? 0) * 1000) / 1000, 0.333);
igual('contactos por etapa', m.porEtapa.map(e => e.n), [2, 1, 1, 0, 1, 1]);
igual('embudo: llegaron al menos a cada etapa', m.embudo.map(e => e.n), [6, 4, 3, 2, 2, 1]);
igual('paso de «nuevo» a «conversación»', Math.round((m.embudo[0].paso ?? 0) * 100), 67);
igual('la última etapa no tiene paso siguiente', m.embudo[5].paso, null);
igual('nuevos en 7 días', m.nuevos7, 2);
igual('nuevos en los 7 días anteriores', m.nuevosPrevios7, 2);
igual('nuevos en 30 días', m.nuevos30, 4);
igual('ocho semanas', m.semanas.length, 8);
igual('la suma de semanas no pasa del total', m.semanas.reduce((s, x) => s + x.n, 0) <= m.total, true);
igual('contactos de esta semana (jueves): los de hace 1 y 3 días', m.semanas[7].n >= 1, true);
igual('por canal: chat primero con 2', [m.porCanal[0].clave, m.porCanal[0].n], ['chat_web', 2]);
igual('por origen: redes primero con 3 y 1 ganado', [m.porFuente[0].clave, m.porFuente[0].n, m.porFuente[0].ganados], ['redes', 3, 1]);
igual('valor abierto', m.valorAbierto, 80000);
igual('días promedio de cierre (40 − 30 = 10)', Math.round(m.diasPromedioCierre ?? 0), 10);
igual('vencidos', m.vencidos, 1);
igual('para hoy', m.paraHoy, 1);
igual('estancados (abierto, sin recordatorio, 5+ días quieto)', m.estancados, 1);
igual('ventas de 30 días a personas del CRM (Carla ₡30 000 + Ana no tiene pedidos recientes)', m.ventas30, 30000);
const vacio = L.calcularMetricas([], [], AHORA);
igual('sin contactos: conversión nula y nada se rompe', [vacio.total, vacio.conversion, vacio.diasPromedioCierre, vacio.semanas.length], [0, null, null, 8]);

// ---- duplicados ----
igual('duplicado por correo (otra forma de escribirlo)', L.buscarDuplicado(dataset, ' ANA@correo.cr ')?.id, 'ana');
igual('duplicado por teléfono', L.buscarDuplicado(dataset, null, '+506 8123 4567')?.id, 'dani');
igual('no es duplicado de sí mismo', L.buscarDuplicado(dataset, 'ana@correo.cr', null, 'ana'), null);
igual('sin datos no hay duplicado', L.buscarDuplicado(dataset, '', ''), null);

// ---- respuestas rápidas del chat («/atajo») ----
const resps = L.RESPUESTAS_BASE;
igual('«/» solo muestra todas, en su orden', L.filtrarRespuestas(resps, '/').map(r => r.atajo), resps.map(r => r.atajo));
igual('sin consulta muestra todas', L.filtrarRespuestas(resps, '').length, resps.length);
igual('«/co» empieza como cotizar', L.filtrarRespuestas(resps, '/co').map(r => r.atajo)[0], 'cotizar');
igual('el atajo que EMPIEZA gana al que solo lo contiene', L.filtrarRespuestas([{ atajo: 'precio', titulo: 'a', texto: 'a' }, { atajo: 'pre', titulo: 'b', texto: 'b' }, { atajo: 'xpre', titulo: 'c', texto: 'c' }], 'pre').map(r => r.atajo), ['precio', 'pre', 'xpre']);
igual('sin tildes ni mayúsculas', L.filtrarRespuestas(resps, 'GARANTÍA').map(r => r.atajo), ['garantia']);
igual('también busca en el título', L.filtrarRespuestas(resps, 'saludo').map(r => r.atajo), ['hola']);
igual('y en el texto, al final', L.filtrarRespuestas(resps, 'sinpe').map(r => r.atajo), ['pagos']);
igual('nada coincide → lista vacía', L.filtrarRespuestas(resps, 'zzzz'), []);
igual('no modifica la lista original', resps.length, 6);

console.log(`✓ ${pasan} comprobaciones del CRM pasan`);
if (fallos.length) {
  console.log(`✗ ${fallos.length} fallan:`);
  for (const f of fallos) console.log('  -', f);
  process.exit(1);
}
