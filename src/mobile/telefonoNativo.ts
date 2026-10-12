// =====================================================================
// EL TELÉFONO DE PHILL — puente con el complemento nativo
// =====================================================================
// Alarmas, temporizadores, abrir apps, llamar, WhatsApp, SMS, calendario,
// mapas, música, linterna, ajustes y enlaces: el código vive en
// native-android/telefono/ (lo copia el CI a la APK). Esta pieza solo
// declara cómo se lo llama; quien decide qué hacer es src/utils/telefono.ts.
// Todas las llamadas responden `{ ok }` (y `error` si falló) en vez de lanzar.
// =====================================================================

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface Resp { ok: boolean; error?: string }
export interface PluginTelefono {
  alarma(o: { hora: number; minutos: number; dias?: number[]; etiqueta?: string }): Promise<Resp>;
  temporizador(o: { segundos: number; etiqueta?: string }): Promise<Resp>;
  /** Abre una app por nombre (o por paquete). Si hay varias parecidas, devuelve `candidatos`. */
  abrirApp(o: { nombre?: string; paquete?: string }): Promise<Resp & { app?: string; candidatos?: { nombre: string; paquete: string }[] }>;
  /** Busca contactos por nombre. Los números NUNCA salen de este aparato. */
  contactos(o: { nombre: string }): Promise<Resp & { permiso?: 'concedido' | 'denegado'; contactos?: { nombre: string; numeros: string[] }[] }>;
  marcar(o: { numero: string }): Promise<Resp>;
  /** `negocio`: abrir en WhatsApp Business (si está instalado). */
  whatsapp(o: { numero: string; mensaje?: string; negocio?: boolean }): Promise<Resp>;
  sms(o: { numero: string; mensaje?: string }): Promise<Resp>;
  calendario(o: { titulo: string; inicioMs: number; finMs: number; todoElDia?: boolean; lugar?: string; descripcion?: string }): Promise<Resp>;
  mapa(o: { consulta: string; navegar?: boolean }): Promise<Resp>;
  musica(o: { consulta: string }): Promise<Resp>;
  linterna(o: { encender: boolean }): Promise<Resp>;
  ajustes(o: { pantalla: string }): Promise<Resp>;
  enlace(o: { url: string }): Promise<Resp>;
}

export const telefonoNativo = registerPlugin<PluginTelefono>('TelefonoNativo');

/** ¿Esta APK trae el complemento? (una APK vieja no) */
export const telefonoNativoDisponible = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TelefonoNativo');
/** ¿Estamos dentro de la app del teléfono (aunque sea una versión vieja)? */
export const enAppDelTelefono = (): boolean => Capacitor.isNativePlatform();
