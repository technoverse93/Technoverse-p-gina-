// =====================================================================
// ENVÍO DEL COMPROBANTE POR CORREO (Gmail SMTP)
// =====================================================================
// Recibe el id de un comprobante emitido: destinatario, monto y PDF se releen del propio registro en
// `invoices` con service_role, así nadie elige a quién se le escribe cambiando el cuerpo de la petición.
// El desenlace real (enviado / error / sin_pdf…) queda en `invoices.email_status`: la app dispara el
// envío sin esperar respuesta, y esta función es el único punto que sabe si salió.
//
// MODO SANDBOX: `{ sandbox: true, to, customerName, pdfDataUrl }` manda un correo de PRUEBA con un PDF
// embebido, sin tocar `invoices` (una prueba no consume un consecutivo fiscal).
//
// SEGURIDAD (auditoría del 2026-10-27). Hasta la versión 18, desplegada sin estar en el repo:
//   · El modo sandbox lo podía usar CUALQUIERA con la llave pública: un correo a cualquier dirección, con
//     el asunto y el PDF que quisiera, enviado DESDE el Gmail del negocio (spam o phishing en su nombre).
//     Ahora exige una sesión del personal y el asunto es fijo.
//   · Cualquiera podía pedir el reenvío de un comprobante ajeno una y otra vez (inundar a un cliente). Un
//     visitante solo dispara el PRIMER envío de un comprobante; reenviar es del personal.
//   · El PDF se descargaba de la dirección que hubiera en `pdf_url`, fuera cual fuera. Ahora solo del
//     almacenamiento de este proyecto (bucket `invoices`).
//   · El nombre del cliente iba crudo dentro del HTML del correo. Ahora se escapa.
// =====================================================================
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_PDF_BYTES = 3 * 1024 * 1024;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildSmtpClient(gmailUser: string, gmailPassword: string): SMTPClient {
  return new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPassword },
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD');

    // ¿Quién llama? Con la llave pública (visitante de la tienda) no hay usuario; con una sesión, se mira
    // su rol en `profiles` (lo mismo que `is_staff()` en la base).
    const esPersonal = async (): Promise<boolean> => {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return false;
      const { data } = await supabaseAdmin.auth.getUser(token);
      const id = data?.user?.id;
      if (!id) return false;
      const { data: perfil } = await supabaseAdmin.from('profiles').select('role').eq('id', id).maybeSingle();
      return ['superadmin', 'admin', 'empleado'].includes(String(perfil?.role || ''));
    };

    // ---------------------------------------------------------------------
    // MODO SANDBOX — solo el personal, sin tocar `invoices`
    // ---------------------------------------------------------------------
    if (body?.sandbox === true) {
      if (!(await esPersonal())) {
        return json({ error: 'Solo el personal puede enviar correos de prueba.' }, 403);
      }
      const to = typeof body.to === 'string' ? body.to.trim() : '';
      if (!to || to.length > 160 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return json({ error: 'Correo de destino inválido para la prueba.' }, 400);
      }
      if (!gmailUser || !gmailPassword) {
        return json({ error: 'Credenciales de Gmail no configuradas en el servidor.' }, 500);
      }
      let attachments: { filename: string; content: Uint8Array; contentType: string; encoding: 'binary' }[] = [];
      if (typeof body.pdfDataUrl === 'string' && body.pdfDataUrl.startsWith('data:application/pdf')) {
        const bytes = dataUrlToBytes(body.pdfDataUrl);
        if (bytes.length > MAX_PDF_BYTES) return json({ error: 'El PDF de prueba es demasiado grande.' }, 413);
        attachments = [{ filename: 'comprobante-prueba.pdf', content: bytes, contentType: 'application/pdf', encoding: 'binary' }];
      }
      const nombre = typeof body.customerName === 'string' && body.customerName.trim()
        ? escaparHtml(body.customerName.trim().slice(0, 120)) : 'cliente de prueba';

      const client = buildSmtpClient(gmailUser, gmailPassword);
      await client.send({
        from: `Technoverse Costa Rica <${gmailUser}>`,
        to,
        subject: '[PRUEBA] Comprobante de prueba — Technoverse Costa Rica',
        content: 'auto',
        html: `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1408;">
          <p style="background:#fff3cd;border:1px solid #ffe08a;padding:8px 12px;border-radius:6px;font-weight:bold;">
            Esto es un correo de PRUEBA (modo Sandbox). No corresponde a una venta real ni a un comprobante fiscal válido.
          </p>
          <p>Hola ${nombre},</p>
          <p>Este correo valida que el envío por SMTP funciona correctamente.</p>
        </div>
      `,
        attachments,
      });
      await client.close();
      return json({ success: true, sandbox: true });
    }

    // ---------------------------------------------------------------------
    // MODO REAL — comprobante emitido, se lee de `invoices`
    // ---------------------------------------------------------------------
    const { invoiceId } = body;
    if (!invoiceId || typeof invoiceId !== 'string' || invoiceId.length > 60) {
      return json({ error: 'invoiceId es obligatorio.' }, 400);
    }

    // El estado del envío nunca puede tumbar el envío: si anotarlo falla, se ignora.
    const marcarEstado = async (estado: string) => {
      try {
        await supabaseAdmin.from('invoices').update({ email_status: estado.slice(0, 120) }).eq('id', invoiceId);
      } catch { /* el registro del estado jamás afecta al envío */ }
    };

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('id, consecutivo, clave, customer_name, customer_email, total, pdf_url, email_status')
      .eq('id', invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return json({ error: 'Comprobante no encontrado.' }, 404);
    }

    // Un visitante solo dispara el primer envío (lo que hace la tienda al terminar la compra). Reenviar un
    // comprobante ya enviado es del personal (botón «Reenviar» del panel).
    if (invoice.email_status === 'enviado' && !(await esPersonal())) {
      return json({ error: 'Este comprobante ya fue enviado. Para reenviarlo, pídalo a la tienda.' }, 409);
    }

    if (!invoice.customer_email) {
      await marcarEstado('sin_correo');
      return json({ error: 'El comprobante no tiene correo de destino.' }, 422);
    }
    if (!invoice.pdf_url) {
      await marcarEstado('sin_pdf');
      return json({ error: 'El comprobante todavía no tiene PDF generado.' }, 422);
    }
    if (!gmailUser || !gmailPassword) {
      await marcarEstado('sin_credenciales');
      return json({ error: 'Credenciales de Gmail no configuradas en el servidor.' }, 500);
    }

    try {
      let pdfBytes: Uint8Array;
      if (invoice.pdf_url.startsWith('data:application/pdf')) {
        // Comprobantes reprocesados a mano pueden traer el PDF embebido como data URI.
        pdfBytes = dataUrlToBytes(invoice.pdf_url);
      } else {
        // Solo el almacenamiento de ESTE proyecto: nunca se descarga de una dirección ajena.
        const permitido = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/invoices/`;
        if (!invoice.pdf_url.startsWith(permitido)) throw new Error('La dirección del PDF no es del almacenamiento de comprobantes.');
        const pdfResponse = await fetch(invoice.pdf_url);
        if (!pdfResponse.ok) throw new Error('No se pudo descargar el PDF del comprobante.');
        pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
      }
      if (pdfBytes.length > MAX_PDF_BYTES) throw new Error('El PDF del comprobante es demasiado grande.');

      const totalFormatted = '₡' + Number(invoice.total).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const nombre = escaparHtml(String(invoice.customer_name || 'cliente').slice(0, 120));
      const id = escaparHtml(String(invoice.id));

      const client = buildSmtpClient(gmailUser, gmailPassword);
      await client.send({
        from: `Technoverse Costa Rica <${gmailUser}>`,
        to: invoice.customer_email,
        subject: `Comprobante ${invoice.id} — Technoverse Costa Rica`,
        content: 'auto',
        html: `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1408;">
          <p>Hola ${nombre},</p>
          <p>Gracias por su compra en Technoverse Costa Rica. Adjuntamos su comprobante <strong>${id}</strong> por un total de <strong>${totalFormatted}</strong>.</p>
          <p style="font-size: 11px; color: #555;">Consecutivo: ${escaparHtml(String(invoice.consecutivo))}<br/>Clave: ${escaparHtml(String(invoice.clave))}</p>
          <p style="font-size: 11px; color: #888;">Este es un comprobante interno con el formato oficial de Hacienda v4.3. Aún no corresponde a una transmisión electrónica real ante el Ministerio de Hacienda.</p>
        </div>
      `,
        attachments: [
          // denomailer 1.6.0 exige `encoding` explícito: sin él escribe los bytes crudos en la parte MIME y el
          // PDF llega corrupto. "binary" le indica que los codifique en base64.
          { filename: `${invoice.id}.pdf`, content: pdfBytes, contentType: 'application/pdf', encoding: 'binary' },
        ],
      });
      await client.close();

      await marcarEstado('enviado');
      return json({ success: true });
    } catch (errEnvio) {
      const motivo = errEnvio instanceof Error ? errEnvio.message : String(errEnvio);
      await marcarEstado(`error: ${motivo}`);
      throw errEnvio;
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
