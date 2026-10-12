// =====================================================================
// PROPUESTAS DE CÓDIGO — Javier propone, vos aprobás
// =====================================================================
// Javier puede leer el repositorio y PROPONER un cambio como Pull Request.
// Nunca lo fusiona: queda en una rama «phill/…» (y en borrador, si el
// repositorio lo permite) esperando que lo revises en GitHub.
//
// REGLAS DURAS (están acá, en código, no en un pedido a la IA):
//   · Solo escribe en ramas que empiezan con «phill/». Jamás en main.
//   · No existe ninguna llamada para fusionar, borrar ramas ni tocar etiquetas.
//   · No puede tocar los workflows (.github/), archivos .env, claves, la
//     configuración de compilación (package.json, vite, capacitor), los candados
//     de dependencias, CLAUDE.md ni ESTE archivo (sus propias reglas).
//   · Hasta 8 archivos por propuesta, de tamaño razonable y de tipos de texto.
//   · Un reemplazo solo se aplica si el trozo a cambiar aparece UNA sola vez.
//   · Con un tope de propuestas por día (lo cuenta la función que lo usa).
// El token es el secreto GITHUB_TOKEN de Supabase (un token de GitHub con
// permiso de «Contents» y «Pull requests» SOLO de este repositorio).
// =====================================================================

export interface ConfigRepo { token: string; repo: string; base: string }

export function configRepo(env: { get(k: string): string | undefined } = (globalThis as any).Deno?.env): ConfigRepo | null {
  const token = env?.get('GITHUB_TOKEN');
  if (!token || token.length < 20) return null;
  return { token, repo: env.get('GITHUB_REPO') || 'technoverse93/Technoverse-p-gina-', base: env.get('GITHUB_BASE') || 'main' };
}

export const MAX_ARCHIVOS = 8;
export const MAX_BYTES_ARCHIVO = 250_000;
export const MAX_BYTES_TOTAL = 500_000;
export const MAX_PROPUESTAS_DIA = 5;
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|css|html|md|json|sql|java|kt|xml|txt|svg)$/i;
const PROHIBIDAS: RegExp[] = [
  /^\.github\//i, /^\.git\//i, /(^|\/)node_modules\//i, /(^|\/)\.env/i,
  /(^|\/)package(-lock)?\.json$/i, /(^|\/)\.npmrc$/i, /(^|\/)(vite|capacitor)\.config\.[cm]?[jt]s$/i,
  /^CLAUDE\.md$/i, /^supabase\/functions\/asistente-ia\/repo\.ts$/i,
  /google-services\.json$/i, /\.(keystore|jks|pem|p12|key)$/i, /(^|\/)secrets?\b/i,
];

export type Verificada = { ok: true; ruta: string } | { ok: false; error: string };

/** Una ruta del repositorio, limpia, de un tipo permitido y fuera de lo protegido. */
export function rutaPermitida(cruda: unknown, op: { escritura?: boolean } = {}): Verificada {
  let r = String(cruda ?? '').trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/{2,}/g, '/');
  if (!r || r.length > 200) return { ok: false, error: 'La ruta no es válida.' };
  if (r.split('/').some(p => p === '..' || p === '.' || p === '')) return { ok: false, error: 'La ruta no es válida (sin «..»).' };
  if (/[\u0000-\u001f]/.test(r)) return { ok: false, error: 'La ruta no es válida.' };
  if (PROHIBIDAS.some(re => re.test(r))) return { ok: false, error: `«${r}» está protegido: no lo puedo ${op.escritura ? 'cambiar' : 'leer'} desde acá.` };
  if (op.escritura && !EXTENSIONES.test(r)) return { ok: false, error: `Solo cambio archivos de texto del proyecto (${r} no es de un tipo permitido).` };
  return { ok: true, ruta: r };
}

export interface Reemplazo { buscar: string; poner: string }
export type Aplicado = { ok: true; contenido: string; cambios: number } | { ok: false; error: string };

/** Aplica reemplazos exactos: cada `buscar` tiene que aparecer una sola vez. */
export function aplicarReemplazos(original: string, reemplazos: Reemplazo[]): Aplicado {
  let t = original;
  let n = 0;
  for (const [i, r] of reemplazos.entries()) {
    const buscar = String(r?.buscar ?? '');
    const poner = String(r?.poner ?? '');
    if (buscar.length < 3) return { ok: false, error: `Reemplazo ${i + 1}: el trozo a buscar es muy corto; copiá un fragmento más largo y exacto.` };
    if (buscar === poner) return { ok: false, error: `Reemplazo ${i + 1}: no cambia nada.` };
    const veces = t.split(buscar).length - 1;
    if (veces === 0) return { ok: false, error: `Reemplazo ${i + 1}: no encontré ese trozo en el archivo (tiene que ser EXACTO, con su indentación). Volvé a leer esa parte con repo_leer y copialo tal cual.` };
    if (veces > 1) return { ok: false, error: `Reemplazo ${i + 1}: ese trozo aparece ${veces} veces; agregá unas líneas de alrededor para que sea único.` };
    t = t.replace(buscar, () => poner);
    n++;
  }
  return { ok: true, contenido: t, cambios: n };
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** «phill/2026-10-12-boton-dorado-a1b2». */
export function ramaPropuesta(titulo: string, ahora = new Date(), azar = Math.random().toString(36).slice(2, 6)): string {
  const dia = ahora.toISOString().slice(0, 10);
  const slug = sinTildes(String(titulo || 'cambio')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cambio';
  return `phill/${dia}-${slug}-${azar}`;
}

export interface CambioPropuesto {
  ruta: string;
  /** Cambios exactos a un archivo que ya existe. */
  reemplazos?: Reemplazo[];
  /** Contenido completo de un archivo NUEVO. */
  contenido?: string;
}
export interface Propuesta { titulo: string; descripcion: string; pedido?: string; cambios: CambioPropuesto[] }
export type ResultadoPropuesta = { ok: true; url: string; numero: number; rama: string; archivos: string[]; borrador: boolean } | { ok: false; error: string };

export const PIE_PR = '_Propuesto por Javier, el asistente del dueño. **Nadie lo fusionó**: revisalo con calma antes de aprobarlo (y mirá que compile)._';

export function cuerpoPR(p: Propuesta, archivos: string[]): string {
  return [
    p.descripcion.trim().slice(0, 4000),
    archivos.length ? `**Archivos:**\n${archivos.map(a => `- \`${a}\``).join('\n')}` : '',
    p.pedido ? `**Lo que se pidió:** ${p.pedido.trim().slice(0, 600)}` : '',
    PIE_PR,
  ].filter(Boolean).join('\n\n');
}

// ------------------------------- cliente -------------------------------
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class ClienteRepo {
  private cfg: ConfigRepo;
  private f: Fetch;
  constructor(cfg: ConfigRepo, f: Fetch = (u, i) => fetch(u, i)) { this.cfg = cfg; this.f = f; }

  private async api(ruta: string, init: RequestInit & { raw?: boolean; global?: boolean } = {}): Promise<{ ok: boolean; status: number; json: any; texto: string }> {
    const { raw, global, ...resto } = init;
    const r = await this.f(`https://api.github.com${global ? '' : `/repos/${this.cfg.repo}`}${ruta}`, {
      ...resto,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'phill-technoverse',
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        ...(resto.body ? { 'Content-Type': 'application/json' } : {}),
        ...(resto.headers as Record<string, string> | undefined),
      },
    });
    const texto = await r.text();
    let json: any = null;
    if (!raw) { try { json = JSON.parse(texto); } catch { /* sin JSON */ } }
    return { ok: r.ok, status: r.status, json, texto };
  }

  private falla(r: { status: number; json: any }, que: string): string {
    if (r.status === 401) return 'GitHub rechazó el token (venció o está mal). Hay que renovar el secreto GITHUB_TOKEN.';
    if (r.status === 403 || r.status === 404) return `GitHub no me deja ${que}: revisá que el token tenga permisos de «Contents» y «Pull requests» sobre ${this.cfg.repo}.`;
    return `GitHub respondió ${r.status} al ${que}${r.json?.message ? `: ${String(r.json.message).slice(0, 160)}` : ''}.`;
  }

  /** El texto de un archivo (de main). */
  async leer(ruta: string): Promise<{ ok: true; contenido: string } | { ok: false; error: string; noExiste?: boolean }> {
    const v = rutaPermitida(ruta);
    if (!v.ok) return v;
    const r = await this.api(`/contents/${v.ruta.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.cfg.base)}`, { raw: true });
    if (r.status === 404) return { ok: false, error: `No existe «${v.ruta}».`, noExiste: true };
    if (!r.ok) return { ok: false, error: this.falla(r, `leer ${v.ruta}`) };
    return { ok: true, contenido: r.texto };
  }

  async listar(ruta: string): Promise<{ ok: true; entradas: { nombre: string; tipo: string; tamano: number }[] } | { ok: false; error: string }> {
    const v = ruta.trim() === '' || ruta.trim() === '/' ? ({ ok: true, ruta: '' } as const) : rutaPermitida(ruta);
    if (!v.ok) return v;
    const r = await this.api(`/contents/${v.ruta.split('/').filter(Boolean).map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.cfg.base)}`);
    if (r.status === 404) return { ok: false, error: `No existe «${v.ruta || '/'}».` };
    if (!r.ok || !Array.isArray(r.json)) return { ok: false, error: this.falla(r, `listar ${v.ruta || '/'}`) };
    return { ok: true, entradas: r.json.filter((e: any) => !PROHIBIDAS.some(re => re.test(String(e.path || '')))).map((e: any) => ({ nombre: String(e.name), tipo: String(e.type), tamano: Number(e.size || 0) })) };
  }

  async buscar(texto: string): Promise<{ ok: true; resultados: { ruta: string; fragmentos: string[] }[] } | { ok: false; error: string }> {
    const q = String(texto || '').replace(/["\\]/g, ' ').trim().slice(0, 100);
    if (q.length < 2) return { ok: false, error: 'Decime qué buscar.' };
    const r = await this.api(`/search/code?q=${encodeURIComponent(`${q} repo:${this.cfg.repo}`)}&per_page=10`, { global: true, headers: { Accept: 'application/vnd.github.text-match+json' } });
    if (!r.ok) return { ok: false, error: this.falla(r, 'buscar en el código') };
    const items = Array.isArray(r.json?.items) ? r.json.items : [];
    return { ok: true, resultados: items.filter((i: any) => !PROHIBIDAS.some(re => re.test(String(i.path || '')))).slice(0, 10).map((i: any) => ({ ruta: String(i.path), fragmentos: (i.text_matches || []).map((m: any) => String(m.fragment || '').slice(0, 300)).slice(0, 2) })) };
  }

  /** Arma la rama phill/… con UN commit y abre el Pull Request. Nunca toca main. */
  async proponer(p: Propuesta): Promise<ResultadoPropuesta> {
    const titulo = String(p.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (titulo.length < 6) return { ok: false, error: 'Falta un título claro para la propuesta.' };
    if (String(p.descripcion || '').trim().length < 20) return { ok: false, error: 'Falta explicar qué cambia y por qué (descripción).' };
    const cambios = Array.isArray(p.cambios) ? p.cambios : [];
    if (!cambios.length) return { ok: false, error: 'No hay cambios que proponer.' };
    if (cambios.length > MAX_ARCHIVOS) return { ok: false, error: `Son demasiados archivos (máximo ${MAX_ARCHIVOS} por propuesta): proponé primero una parte.` };
    const vistas = new Set<string>();
    const nuevos: { ruta: string; contenido: string }[] = [];
    let total = 0;
    for (const c of cambios) {
      const v = rutaPermitida(c.ruta, { escritura: true });
      if (!v.ok) return v;
      if (vistas.has(v.ruta)) return { ok: false, error: `«${v.ruta}» está repetido: juntá sus cambios en uno solo.` };
      vistas.add(v.ruta);
      let contenido: string;
      if (Array.isArray(c.reemplazos) && c.reemplazos.length) {
        const actual = await this.leer(v.ruta);
        if (!actual.ok) return { ok: false, error: actual.noExiste ? `«${v.ruta}» no existe (para un archivo nuevo mandá su contenido completo).` : actual.error };
        const a = aplicarReemplazos(actual.contenido, c.reemplazos);
        if (!a.ok) return { ok: false, error: `${v.ruta}: ${a.error}` };
        contenido = a.contenido;
      } else if (typeof c.contenido === 'string' && c.contenido.length) {
        const ya = await this.leer(v.ruta);
        if (ya.ok) return { ok: false, error: `«${v.ruta}» ya existe: para cambiarlo mandá reemplazos exactos, no el archivo entero.` };
        if (!ya.noExiste) return { ok: false, error: ya.error };
        contenido = c.contenido;
      } else return { ok: false, error: `${v.ruta}: faltan los reemplazos (o el contenido, si es un archivo nuevo).` };
      const bytes = new TextEncoder().encode(contenido).length;
      if (bytes > MAX_BYTES_ARCHIVO) return { ok: false, error: `${v.ruta} queda muy grande (${Math.round(bytes / 1000)} KB).` };
      total += bytes;
      if (total > MAX_BYTES_TOTAL) return { ok: false, error: 'La propuesta es demasiado grande en total: dividila.' };
      if (v.ruta.endsWith('.json')) { try { JSON.parse(contenido); } catch { return { ok: false, error: `${v.ruta} quedaría con un JSON inválido.` }; } }
      nuevos.push({ ruta: v.ruta, contenido });
    }

    // La punta de main y su árbol.
    const ref = await this.api(`/git/ref/heads/${encodeURIComponent(this.cfg.base)}`);
    if (!ref.ok) return { ok: false, error: this.falla(ref, `leer la rama ${this.cfg.base}`) };
    const base = String(ref.json?.object?.sha || '');
    const com = await this.api(`/git/commits/${base}`);
    if (!com.ok) return { ok: false, error: this.falla(com, 'leer el último commit') };
    const arbolBase = String(com.json?.tree?.sha || '');
    // Un blob por archivo y UN árbol con todos.
    const entradas: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const n of nuevos) {
      const b = await this.api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: n.contenido, encoding: 'utf-8' }) });
      if (!b.ok) return { ok: false, error: this.falla(b, 'subir un archivo') };
      entradas.push({ path: n.ruta, mode: '100644', type: 'blob', sha: String(b.json.sha) });
    }
    const arbol = await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: arbolBase, tree: entradas }) });
    if (!arbol.ok) return { ok: false, error: this.falla(arbol, 'armar el árbol') };
    const commit = await this.api('/git/commits', { method: 'POST', body: JSON.stringify({ message: `${titulo}\n\nPropuesto por Javier.`, tree: String(arbol.json.sha), parents: [base] }) });
    if (!commit.ok) return { ok: false, error: this.falla(commit, 'crear el commit') };
    // La rama: SIEMPRE phill/… (si el nombre ya existe, otro intento con otro sufijo).
    let rama = '';
    for (let intento = 0; intento < 3 && !rama; intento++) {
      const nombre = ramaPropuesta(titulo);
      if (!nombre.startsWith('phill/')) return { ok: false, error: 'Nombre de rama inválido.' };
      const r = await this.api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${nombre}`, sha: String(commit.json.sha) }) });
      if (r.ok) rama = nombre;
      else if (r.status !== 422) return { ok: false, error: this.falla(r, 'crear la rama') };
    }
    if (!rama) return { ok: false, error: 'No pude crear la rama de la propuesta.' };
    // El Pull Request, en borrador si el repositorio lo permite.
    const archivos = nuevos.map(n => n.ruta);
    const cuerpo = JSON.stringify({ title: titulo, head: rama, base: this.cfg.base, body: cuerpoPR(p, archivos), draft: true });
    let pr = await this.api('/pulls', { method: 'POST', body: cuerpo });
    let borrador = true;
    if (!pr.ok && pr.status === 422 && /draft/i.test(pr.texto)) {
      borrador = false;
      pr = await this.api('/pulls', { method: 'POST', body: JSON.stringify({ title: titulo, head: rama, base: this.cfg.base, body: cuerpoPR(p, archivos) }) });
    }
    if (!pr.ok) return { ok: false, error: `Armé la rama ${rama} pero no pude abrir el Pull Request. ${this.falla(pr, 'abrir el Pull Request')}` };
    return { ok: true, url: String(pr.json.html_url), numero: Number(pr.json.number), rama, archivos, borrador };
  }
}

// ------------------------ las herramientas de la IA ------------------------
/** Largo máximo (ya escapado como JSON) del texto de un archivo en cada lectura. */
const LARGO_LECTURA = 7800;
export const NOMBRES_REPO = { leer: 'repo_leer', listar: 'repo_listar', buscar: 'repo_buscar', proponer: 'proponer_cambio' } as const;
export interface EstadoRepo { cliente: ClienteRepo; propuesta: ResultadoPropuesta | null }

/**
 * Lo que responde cada herramienta del agente de código. Un error se le devuelve a la IA
 * (con qué corregir) en vez de romper la tarea; una propuesta ya abierta no se repite.
 */
export async function correrHerramientaRepo(nombre: string, args: Record<string, unknown>, repo: EstadoRepo): Promise<unknown> {
  if (nombre === NOMBRES_REPO.leer) {
    const r = await repo.cliente.leer(String(args?.ruta ?? ''));
    if (!r.ok) return { error: r.error };
    const lineas = r.contenido.split('\n');
    const desde = Math.max(1, Math.floor(Number(args?.desde) || 1));
    let hasta = Math.min(lineas.length, Math.max(desde, Math.floor(Number(args?.hasta) || desde + 199)), desde + 299);
    let trozo = lineas.slice(desde - 1, hasta).join('\n');
    // Cada respuesta tiene que caber entera (el motor corta lo que pase de ~9000 caracteres): se mide ya escapada como JSON.
    const cabe = (x: string) => JSON.stringify(x).length <= LARGO_LECTURA;
    while (!cabe(trozo) && hasta > desde) { hasta = desde + Math.max(0, Math.floor((hasta - desde) * 0.8) - 1); trozo = lineas.slice(desde - 1, hasta).join('\n'); }
    if (!cabe(trozo)) trozo = `${trozo.slice(0, 3000)}… [línea muy larga: recortada]`;
    return { ruta: String(args?.ruta), desde, hasta, totalLineas: lineas.length, contenido: trozo, ...(hasta < lineas.length ? { siguiente: `Para seguir leyendo: desde=${hasta + 1}` } : { fin: 'Es el final del archivo.' }) };
  }
  if (nombre === NOMBRES_REPO.listar) {
    const r = await repo.cliente.listar(String(args?.ruta ?? ''));
    return r.ok ? { entradas: r.entradas.slice(0, 80) } : { error: r.error };
  }
  if (nombre === NOMBRES_REPO.buscar) {
    const r = await repo.cliente.buscar(String(args?.texto ?? ''));
    return r.ok ? { resultados: r.resultados, ...(r.resultados.length ? {} : { nota: 'Sin resultados: probá otra palabra o recorré las carpetas con repo_listar.' }) } : { error: r.error };
  }
  if (nombre === NOMBRES_REPO.proponer) {
    if (repo.propuesta?.ok) return { hecho: true, url: repo.propuesta.url, nota: 'Ya abriste esa propuesta; no abras otra.' };
    const crudos = Array.isArray(args?.cambios) ? args.cambios as Record<string, unknown>[] : [];
    const r = await repo.cliente.proponer({
      titulo: String(args?.titulo ?? ''), descripcion: String(args?.descripcion ?? ''),
      cambios: crudos.slice(0, MAX_ARCHIVOS + 1).map(c => ({
        ruta: String(c?.ruta ?? ''),
        ...(Array.isArray(c?.reemplazos) ? { reemplazos: (c.reemplazos as Record<string, unknown>[]).slice(0, 40).map(x => ({ buscar: String(x?.buscar ?? ''), poner: String(x?.poner ?? '') })) } : {}),
        ...(typeof c?.contenido === 'string' ? { contenido: c.contenido } : {}),
      })),
    });
    if (!r.ok) return { error: r.error };
    repo.propuesta = r;
    return { hecho: true, url: r.url, rama: r.rama, archivos: r.archivos, nota: 'El Pull Request quedó abierto (nadie lo fusionó: lo revisa el dueño). Contestá con un resumen corto de qué cambiaste y por qué; el enlace lo agrego yo.' };
  }
  return { error: 'Esa herramienta no existe.' };
}
