// Construye el correo de solicitud de Hoja de Ruta para un Convenio de Mutuo Acuerdo.

const ZONA_HORARIA = 'America/Bogota';

const OBJETO_CONTRATO =
  'Facilitar a los beneficiarios del presente convenio el acceso a la oferta de servicios de ' +
  'Comfenalco Antioquia, mediante la aplicación de tarifas preferenciales y/o condiciones especiales ' +
  'en actividades, cursos, programas, servicios y demás oferta disponible, de acuerdo con los ' +
  'términos y condiciones establecidos por la Caja.';

// Fecha "de hoy" en hora de Colombia como {anio, mes (1-12), dia, hora}
function ahoraEnColombia(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(fecha).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour)
  };
}

function saludoSegunHora(hora) {
  return hora < 12 ? 'buenos días' : 'buenas tardes';
}

// Suma meses sin desbordar (31 ene + 1 mes = 28/29 feb)
function sumarMeses({ anio, mes, dia }, meses) {
  const total = anio * 12 + (mes - 1) + meses;
  const nuevoAnio = Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(nuevoAnio, nuevoMes, 0)).getUTCDate();
  return { anio: nuevoAnio, mes: nuevoMes, dia: Math.min(dia, ultimoDia) };
}

function formatearFecha({ anio, mes, dia }) {
  const dd = String(dia).padStart(2, '0');
  const mm = String(mes).padStart(2, '0');
  return `${dd}/${mm}/${anio}`;
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function construirCorreo(datos, fechaEnvio = new Date()) {
  const ahora = ahoraEnColombia(fechaEnvio);
  const inicio = sumarMeses(ahora, 2);          // dos meses después del envío
  const fin = sumarMeses(inicio, 12);           // un año después del inicio

  const saludo = `Hola Daya, ${saludoSegunHora(ahora.hora)}.`;
  const filas = [
    ['Tipo de empresa', datos.tipoEmpresa],
    ['Tipo de contrato', 'Convenio de Mutuo Acuerdo'],
    ['Afiliado a la Caja', 'No afiliado'],
    ['Nombre de la empresa', datos.razonSocial],
    ['NIT', datos.nit],
    ['Representante legal', datos.representanteLegal],
    ['Cédula', datos.cedula],
    ['Fecha de inicio', formatearFecha(inicio)],
    ['Fecha de finalización', formatearFecha(fin)],
    ['Requiere aportes', 'N/A'],
    ['Valor del contrato', 'N/A'],
    ['Objeto del contrato', OBJETO_CONTRATO],
    ['Interventor(a) del contrato', datos.interventor]
  ];

  const intro = [
    'Espero que te encuentres muy bien.',
    `De manera atenta, solicito tu apoyo con la creación de la Hoja de Ruta para la formalización de un Convenio de Mutuo Acuerdo con la Unidad ${datos.razonSocial}.`,
    'A continuación, comparto la información requerida para el proceso:'
  ];
  const cierre = [
    'Agradezco tu apoyo con la gestión y quedo atenta a cualquier información adicional que se requiera para continuar con el proceso.',
    'Muchas gracias.'
  ];

  const texto = [
    saludo, '', intro[0], '', intro[1], '', intro[2], '',
    ...filas.map(([k, v]) => `${k}: ${v}`),
    '', cierre[0], '', cierre[1]
  ].join('\n');

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.55">` +
    `<p>${escaparHtml(saludo)}</p>` +
    `<p>${escaparHtml(intro[0])}</p>` +
    `<p>${escaparHtml(intro[1])}</p>` +
    `<p>${escaparHtml(intro[2])}</p>` +
    `<p>${filas.map(([k, v]) => `<strong>${escaparHtml(k)}:</strong> ${escaparHtml(v)}`).join('<br>')}</p>` +
    `<p>${escaparHtml(cierre[0])}</p>` +
    `<p>${escaparHtml(cierre[1])}</p>` +
    `</div>`;

  const asunto = `Solicitud Hoja de Ruta - Convenio de Mutuo Acuerdo - ${datos.razonSocial}`;
  return { asunto, texto, html };
}

module.exports = { construirCorreo, sumarMeses, formatearFecha, saludoSegunHora, ahoraEnColombia };
