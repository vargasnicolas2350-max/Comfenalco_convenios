// Lectura de datos de un certificado de Cámara de Comercio (PDF con texto).
// Es una extracción "mejor esfuerzo": el usuario siempre puede corregir los
// datos en el formulario antes de enviar el correo.

let pdfjs = null;

function cargarPdfjs() {
  if (pdfjs) return pdfjs;

  const { log, warn } = console;
  const filtro = fn => (msg, ...resto) => {
    if (typeof msg === 'string' && msg.includes('polyfill')) return;
    fn(msg, ...resto);
  };

  console.log = filtro(log);
  console.warn = filtro(warn);

  try {
    const modulo = require('pdfjs-dist/legacy/build/pdf.js');
    if (modulo && modulo.GlobalWorkerOptions) {
      const workerPath = (() => {
        try {
          return require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
        } catch {
          return null;
        }
      })();
      if (workerPath) {
        modulo.GlobalWorkerOptions.workerSrc = workerPath;
      }
    }
    pdfjs = modulo;
  } catch (error) {
    console.error('No se pudo cargar pdfjs-dist:', error.message);
    throw error;
  } finally {
    console.log = log;
    console.warn = warn;
  }

  return pdfjs;
}

async function extraerTextoPdf(buffer) {
  const lib = cargarPdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  }).promise;

  let texto = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const contenido = await pagina.getTextContent();
    let ultimaY = null;
    for (const item of contenido.items) {
      const y = item.transform[5];
      if (ultimaY !== null) texto += Math.abs(y - ultimaY) > 2 ? '\n' : ' ';
      texto += item.str;
      ultimaY = y;
    }
    texto += '\n';
  }
  return texto.replace(/\r/g, '');
}

// "900.123.456 1" | "900123456-1" | "9001234561"  ->  "900123456-1"
function normalizarNit(base, dv) {
  const digitos = String(base).replace(/\D/g, '');
  return `${digitos}-${dv}`;
}

function extraerRazonSocial(texto) {
  const m = texto.match(/Raz[oó]n\s+Social\s*:?[ \t]*\n?[ \t]*([^\n]+)/i);
  if (!m) return '';
  return m[1]
    .split(/\s+(?:Sigla|N\.?\s?I\.?\s?T\b|Nit\b|Identificaci[oó]n)/i)[0]
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extraerNit(texto) {
  const re = /N\.?\s?I\.?\s?T\.?\s*(?:No\.?|N[°º]\.?)?\s*[:.]?\s*([\d.,]{6,})\s*[-–]?\s*(\d)(?!\d)/i;
  // Se busca primero después de "Razón social" (para no tomar el NIT de otra persona).
  const idxRazon = texto.search(/Raz[oó]n\s+Social/i);
  const zona = idxRazon >= 0 ? texto.slice(idxRazon) : texto;
  const m = zona.match(re) || texto.match(re);
  return m ? normalizarNit(m[1], m[2]) : '';
}

const PALABRAS_ENCABEZADO = new Set([
  'NOMBRE', 'NOMBRES', 'IDENTIFICACION', 'IDENTIFICACIÓN', 'CARGO', 'PRINCIPAL',
  'PRINCIPALES', 'REPRESENTANTE', 'REPRESENTANTES', 'LEGAL', 'LEGALES', 'GERENTE',
  'SUPLENTE', 'GENERAL', 'PRESIDENTE', 'DE', 'Y'
]);

function limpiarNombre(nombre) {
  const tokens = nombre.replace(/\s{2,}/g, ' ').trim().split(' ');
  while (tokens.length > 2 && PALABRAS_ENCABEZADO.has(tokens[0].toUpperCase())) tokens.shift();
  return tokens.join(' ').trim();
}

function extraerRepresentante(texto) {
  // Zona: a partir del primer encabezado "REPRESENTANTE(S) LEGAL(ES)".
  // Si no existe, a partir de la última mención de "REPRESENTACIÓN LEGAL"
  // (la primera suele ser el título del certificado).
  let inicio = texto.search(/REPRESENTANTES?\s+LEGALES?/i);
  if (inicio < 0) {
    const todas = [...texto.matchAll(/REPRESENTACI[OÓ]N\s+LEGAL/gi)];
    inicio = todas.length ? todas[todas.length - 1].index : 0;
  }
  const zona = texto.slice(inicio);

  const re = new RegExp(
    "([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.'\\- ]{4,}?)" +               // nombre en mayúsculas (una sola línea)
      '\\s*[,:]?\\s*' +
      '(?:Identificaci[oó]n\\s*:?\\s*)?' +
      '(?:C\\.?\\s?C\\.?|C\\.?\\s?E\\.?|C[ée]dula(?:\\s+de\\s+(?:ciudadan[ií]a|extranjer[ií]a))?)' +
      '\\s*(?:No\\.?|N[°º]\\.?|#)?\\s*:?\\s*' +
      '([\\d.,]{5,})',                                     // número de documento
    'm'
  );
  const m = zona.match(re);
  if (!m) return { representanteLegal: '', cedula: '' };
  return {
    representanteLegal: limpiarNombre(m[1]),
    cedula: m[2].replace(/[.,]+$/, '')
  };
}

const PATRON_PUBLICA = new RegExp(
  [
    'entidad(?:es)?\\s+de\\s+derecho\\s+p[uú]blico',
    'entidad\\s+estatal',
    'empresa\\s+industrial\\s+y\\s+comercial\\s+del\\s+estado',
    'empresa\\s+social\\s+del\\s+estado',
    'establecimiento\\s+p[uú]blico',
    'naturaleza\\s+jur[ií]dica\\s*:?\\s*p[uú]blica'
  ].join('|'),
  'i'
);

// Ojo: el NIT por sí solo NO define si una empresa es pública o privada
// (p. ej. muchos NIT 890.9xx son privados). Se usan como señales el prefijo
// 899.999 (entidades del sector público) y la naturaleza jurídica en el texto.
function clasificarTipoEmpresa(nit, texto) {
  const digitos = String(nit).replace(/\D/g, '');
  if (digitos.startsWith('899999')) return 'Pública';
  if (PATRON_PUBLICA.test(texto)) return 'Pública';
  return 'Privada';
}

function extraerDatosCamara(texto) {
  const razonSocial = extraerRazonSocial(texto);
  const nit = extraerNit(texto);
  const { representanteLegal, cedula } = extraerRepresentante(texto);
  return {
    razonSocial,
    nit,
    representanteLegal,
    cedula,
    tipoEmpresa: clasificarTipoEmpresa(nit, texto)
  };
}

module.exports = {
  extraerTextoPdf,
  extraerDatosCamara,
  extraerNit,
  extraerRazonSocial,
  extraerRepresentante,
  clasificarTipoEmpresa
};
