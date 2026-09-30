const crypto = require('crypto');

const VIGENCIA_TICKET_MS = 10 * 60 * 1000;

function normalizarDatos(datos = {}) {
  return {
    razonSocial: String(datos.razonSocial || '').trim(),
    nit: String(datos.nit || '').replace(/\D/g, ''),
    ciudad: String(datos.ciudad || '').trim(),
    unidadRegional: String(datos.unidadRegional || '').trim(),
    correo: String(datos.correo || '').trim(),
    contacto: String(datos.contacto || '').trim(),
    numeroContacto: String(datos.numeroContacto || '').trim(),
    interventor: String(datos.interventor || '').trim(),
    camara: datos.camara && typeof datos.camara === 'object' ? datos.camara : {},
    responsable: String(datos.responsable || ''),
    notas: String(datos.notas || '')
  };
}

function hashDatos(datos) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizarDatos(datos))).digest('base64url');
}

function crearTicketCorreo(clave, datos, ahora = Date.now()) {
  if (!clave) throw new Error('Falta la clave para firmar el comprobante de correo.');
  const registro = normalizarDatos(datos);
  const contenido = Buffer.from(JSON.stringify({
    nit: registro.nit,
    hash: hashDatos(registro),
    exp: ahora + VIGENCIA_TICKET_MS
  })).toString('base64url');
  const firma = crypto.createHmac('sha256', clave).update(contenido).digest('base64url');
  return `${contenido}.${firma}`;
}

function validarTicketCorreo(ticket, clave, datos, ahora = Date.now()) {
  if (!clave || typeof ticket !== 'string') return null;
  const [contenido, firma] = ticket.split('.');
  if (!contenido || !firma) return null;

  const firmaEsperada = crypto.createHmac('sha256', clave).update(contenido).digest();
  const firmaRecibida = Buffer.from(firma, 'base64url');
  if (firmaRecibida.length !== firmaEsperada.length || !crypto.timingSafeEqual(firmaEsperada, firmaRecibida)) return null;

  try {
    const payload = JSON.parse(Buffer.from(contenido, 'base64url').toString('utf8'));
    const registro = normalizarDatos(datos);
    if (payload.exp <= ahora || payload.nit !== registro.nit || payload.hash !== hashDatos(registro)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { crearTicketCorreo, validarTicketCorreo };