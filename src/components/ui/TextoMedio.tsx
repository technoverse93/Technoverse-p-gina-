// =====================================================================
// TEXTO CORTADO AL MEDIO — «dueno.technoverse.c…@gmail.com», «dev-0-aaaa…eeeeeeee»
// =====================================================================
// Un correo, una IP o el ID de un aparato son largos y NO tienen espacios, así
// que no se parten: o se salían de su tarjeta (se leían a medias, o tapaban el
// ícono de al lado) o, al forzarlos a partirse, bajaban a un segundo renglón y
// empujaban lo de abajo. El dueño no quiere que nada se mueva por tamaño
// (2026-10-14), así que van en UNA línea y lo que sobra se corta DE LA PARTE DEL
// MEDIO: en un correo se conserva el dominio («@gmail.com»), en un ID el final.
// No usa JavaScript para medir: es solo CSS (`.tm` en admin.css), por eso se
// adapta sola a cualquier ancho y a la letra agrandada del teléfono.
//
// El texto completo queda en el DOM (se copia y lo lee un lector de pantalla) y en
// `title` (se ve al pasar el ratón).
// =====================================================================

interface Props {
  texto: string;
  /** Cuántos caracteres finales se conservan cuando no es un correo (por defecto 8). */
  fin?: number;
  className?: string;
}

export function TextoMedio({ texto, fin = 8, className = '' }: Props) {
  // Un correo se corta en la arroba: lo que se ve al final es «@dominio».
  const arroba = texto.lastIndexOf('@');
  const corte = arroba > 0 ? arroba : Math.max(0, texto.length - fin);
  return (
    <span className={`tm ${className}`.trim()} title={texto}>
      <span className="tm-a">{texto.slice(0, corte)}</span>
      <span className="tm-b">{texto.slice(corte)}</span>
    </span>
  );
}

export default TextoMedio;
