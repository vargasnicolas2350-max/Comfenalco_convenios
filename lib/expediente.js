const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ROOT = path.join(DATA_DIR, 'expedientes');
const INDEX = path.join(DATA_DIR, 'empresas.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = 'convenio-documents';

const CAMPOS_DOCUMENTO = [
  { campo: 'camara', etiqueta: 'Cámara de Comercio' },
  { campo: 'rut', etiqueta: 'RUT' },
  { campo: 'cedula', etiqueta: 'Cédula Representante Legal' },
  { campo: 'inhabilidades', etiqueta: 'Formato de Inhabilidades' },
  { campo: 'codigoEtica', etiqueta: 'Código de Ética' },
  { campo: 'tratamientoDatos', etiqueta: 'Tratamiento de Datos' },
  { campo: 'manualContratacion', etiqueta: 'Manual de Contratación' },
  { campo: 'rub', etiqueta: 'RUB' },
  { campo: 'composicion', etiqueta: 'Composición Accionaria' }
];

function nitKey(nit) {
  return String(nit || '').replace(/[^\d]/g, '');
}

function nombreSeguro(nombre) {
  return String(nombre || 'archivo').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180);
}

function etiquetaDeCampo(campo) {
  const item = CAMPOS_DOCUMENTO.find((d) => d.campo === campo);
  return item ? item.etiqueta : campo;
}

function supabaseDisponible() {
  return Boolean(SUPABASE_URL && (SUPABASE_ANON_KEY || SUPABASE_SECRET_KEY));
}

async function supabaseRequest({ path: urlPath, method = 'GET', apiKey = SUPABASE_ANON_KEY, body, headers = {} } = {}) {
  if (!supabaseDisponible()) {
    throw new Error('Supabase no está configurado');
  }

  const requestHeaders = { ...headers, apikey: apiKey };
  if (body !== undefined && !(body instanceof Uint8Array) && !(body instanceof Buffer)) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
  }
  if (apiKey && !headers.Authorization) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: body instanceof Uint8Array || body instanceof Buffer ? body : JSON.stringify(body) })
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload.message || payload.msg || payload.error_description || payload.error || 'Supabase rechazó la consulta.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function obtenerEmpresaSupabase(nit) {
  if (!supabaseDisponible()) return null;
  const key = nitKey(nit);
  const query = new URLSearchParams({
    select: 'id,nit,razon_social,ciudad,unidad_regional,correo,nombre_contacto,numero_contacto,interventor,camara_datos',
    nit: `eq.${key}`,
    limit: '1'
  });

  try {
    const resultado = await supabaseRequest({
      path: `/rest/v1/companies?${query}`,
      apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY
    });
    return Array.isArray(resultado) ? resultado[0] || null : null;
  } catch (err) {
    if (err.status === 406 || err.status === 404) return null;
    throw err;
  }
}

async function actualizarEmpresaSupabase(nit, metaEmpresa) {
  const empresaActual = await obtenerEmpresaSupabase(nit);
  const payload = {
    nit: String(metaEmpresa.nit || nit || '').trim(),
    razon_social: String(metaEmpresa.razonSocial || metaEmpresa.razon_social || '').trim(),
    ciudad: String(metaEmpresa.ciudad || '').trim(),
    unidad_regional: String(metaEmpresa.unidadRegional || metaEmpresa.unidad_regional || '').trim(),
    correo: String(metaEmpresa.correo || '').trim(),
    nombre_contacto: String(metaEmpresa.nombreContacto || metaEmpresa.nombre_contacto || '').trim(),
    numero_contacto: String(metaEmpresa.numeroContacto || metaEmpresa.numero_contacto || '').trim(),
    interventor: String(metaEmpresa.interventor || '').trim(),
    camara_datos: metaEmpresa.camara && typeof metaEmpresa.camara === 'object' ? metaEmpresa.camara : {}
  };

  if (empresaActual && empresaActual.id) {
    const query = new URLSearchParams({ id: `eq.${empresaActual.id}` });
    const resultado = await supabaseRequest({
      path: `/rest/v1/companies?${query}`,
      method: 'PATCH',
      apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY,
      body: payload,
      headers: { Prefer: 'return=representation' }
    });
    return Array.isArray(resultado) ? resultado[0] : resultado;
  }

  const resultado = await supabaseRequest({
    path: '/rest/v1/companies',
    method: 'POST',
    apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY,
    body: payload,
    headers: { Prefer: 'return=representation' }
  });
  return Array.isArray(resultado) ? resultado[0] : resultado;
}

async function subirArchivoSupabase(storagePath, file) {
  if (!supabaseDisponible()) return null;
  const apiKey = SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY;
  const urlPath = `/storage/v1/object/${STORAGE_BUCKET}/${encodeURIComponent(storagePath)}`;
  try {
    const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': file.mimetype || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: file.buffer
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'No se pudo subir el archivo a Storage.');
    }
    return true;
  } catch (err) {
    console.warn('No se pudo subir archivo a Supabase Storage:', err.message);
    return null;
  }
}

async function guardarDocumentosSupabase(companyId, nit, files, metaEmpresa = {}) {
  const mapa = archivosDesdeMulter(files);
  const documentos = [];
  for (const [campo, file] of Object.entries(mapa)) {
    const storagePath = `expedientes/${nitKey(nit)}/${campo}__${nombreSeguro(file.originalname)}`;
    const subido = await subirArchivoSupabase(storagePath, file);
    const docPayload = {
      company_id: companyId,
      agreement_id: null,
      document_type: campo,
      storage_path: storagePath,
      original_name: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      size_bytes: file.size || file.buffer.length,
      version: 1,
      uploaded_by: null
    };
    try {
      const resultado = await supabaseRequest({
        path: '/rest/v1/documents',
        method: 'POST',
        apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY,
        body: docPayload,
        headers: { Prefer: 'return=representation' }
      });
      const row = Array.isArray(resultado) ? resultado[0] : resultado;
      documentos.push({
        campo,
        etiqueta: etiquetaDeCampo(campo),
        filename: row && row.storage_path ? row.storage_path.split('/').slice(-1)[0] : `${campo}__${nombreSeguro(file.originalname)}`,
        originalname: file.originalname,
        mimetype: file.mimetype,
        storagePath: row && row.storage_path ? row.storage_path : storagePath,
        subido
      });
    } catch (err) {
      if (subido === null) {
        console.warn('No fue posible registrar el documento en Supabase:', err.message);
      }
    }
  }
  return documentos;
}

async function listarEmpresasSupabase() {
  if (!supabaseDisponible()) return [];
  try {
    const empresas = await supabaseRequest({
      path: `/rest/v1/companies?select=id,nit,razon_social,ciudad,unidad_regional,correo,nombre_contacto,numero_contacto,interventor,camara_datos`,
      apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY
    });

    const lista = [];
    for (const empresa of Array.isArray(empresas) ? empresas : []) {
      const docs = await supabaseRequest({
        path: `/rest/v1/documents?select=id,document_type,storage_path,original_name,mime_type,size_bytes&company_id=eq.${empresa.id}`,
        apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY
      });
      lista.push({
        nit: empresa.nit,
        razonSocial: empresa.razon_social,
        ciudad: empresa.ciudad || '',
        unidadRegional: empresa.unidad_regional || '',
        correo: empresa.correo || '',
        nombreContacto: empresa.nombre_contacto || '',
        numeroContacto: empresa.numero_contacto || '',
        interventor: empresa.interventor || '',
        camara: empresa.camara_datos || null,
        documentos: Array.isArray(docs) ? docs.map((doc) => ({
          campo: doc.document_type,
          etiqueta: etiquetaDeCampo(doc.document_type),
          filename: doc.storage_path ? doc.storage_path.split('/').slice(-1)[0] : doc.original_name,
          originalname: doc.original_name,
          mimetype: doc.mime_type,
          storagePath: doc.storage_path
        })) : []
      });
    }
    return lista;
  } catch (err) {
    console.warn('No fue posible leer empresas desde Supabase, usando almacenamiento local:', err.message);
    return [];
  }
}

async function cargarAdjuntosSupabase(nit) {
  if (!supabaseDisponible()) return [];
  try {
    const empresa = await obtenerEmpresaSupabase(nit);
    if (!empresa) return [];
    const docs = await supabaseRequest({
      path: `/rest/v1/documents?select=id,document_type,storage_path,original_name,mime_type&company_id=eq.${empresa.id}`,
      apiKey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY
    });
    const resultados = [];
    for (const doc of Array.isArray(docs) ? docs : []) {
      const urlPath = `/storage/v1/object/${STORAGE_BUCKET}/${encodeURIComponent(doc.storage_path)}`;
      const response = await fetch(`${SUPABASE_URL}${urlPath}`, {
        headers: {
          apikey: SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY || SUPABASE_ANON_KEY}`
        }
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      resultados.push({
        filename: `${etiquetaDeCampo(doc.document_type)} - ${doc.original_name}`,
        content: buffer,
        contentType: doc.mime_type || 'application/octet-stream'
      });
    }
    return resultados;
  } catch (err) {
    console.warn('No fue posible leer documentos desde Supabase Storage:', err.message);
    return [];
  }
}

async function asegurarDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function leerIndice() {
  try {
    const raw = await fs.promises.readFile(INDEX, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function escribirIndice(lista) {
  await asegurarDir(path.dirname(INDEX));
  await fs.promises.writeFile(INDEX, JSON.stringify(lista, null, 2), 'utf8');
}

function archivosDesdeMulter(files) {
  const mapa = {};
  if (!files) return mapa;
  for (const { campo } of CAMPOS_DOCUMENTO) {
    const lista = files[campo];
    if (lista && lista[0]) mapa[campo] = lista[0];
  }
  return mapa;
}

function adjuntosDesdeMulter(files) {
  const mapa = archivosDesdeMulter(files);
  return Object.entries(mapa).map(([campo, file]) => ({
    filename: `${etiquetaDeCampo(campo)} - ${file.originalname}`,
    content: file.buffer,
    contentType: file.mimetype
  }));
}

function combinarDocumentos(previos = [], actualizados = []) {
  const porCampo = new Map((previos || []).map((documento) => [documento.campo, documento]));
  actualizados.forEach((documento) => porCampo.set(documento.campo, documento));
  return Array.from(porCampo.values());
}

async function guardarExpediente(nit, files, metaEmpresa = {}) {
  const key = nitKey(nit);
  if (!key) throw new Error('NIT inválido para guardar el expediente.');

  if (supabaseDisponible()) {
    try {
      const empresaGuardada = await actualizarEmpresaSupabase(key, {
        nit: key,
        razonSocial: metaEmpresa.razonSocial || metaEmpresa.razon_social || '',
        ciudad: metaEmpresa.ciudad || '',
        unidadRegional: metaEmpresa.unidadRegional || metaEmpresa.unidad_regional || '',
        correo: metaEmpresa.correo || '',
        nombreContacto: metaEmpresa.nombreContacto || metaEmpresa.nombre_contacto || '',
        numeroContacto: metaEmpresa.numeroContacto || metaEmpresa.numero_contacto || '',
        interventor: metaEmpresa.interventor || '',
        camara: metaEmpresa.camara || {}
      });
      const companyId = empresaGuardada && empresaGuardada.id ? empresaGuardada.id : null;
      const docs = companyId ? await guardarDocumentosSupabase(companyId, key, files, metaEmpresa) : [];
      return {
        nit: key,
        razonSocial: metaEmpresa.razonSocial || metaEmpresa.razon_social || '',
        ciudad: metaEmpresa.ciudad || '',
        unidadRegional: metaEmpresa.unidadRegional || metaEmpresa.unidad_regional || '',
        correo: metaEmpresa.correo || '',
        nombreContacto: metaEmpresa.nombreContacto || metaEmpresa.nombre_contacto || '',
        interventor: metaEmpresa.interventor || '',
        camara: metaEmpresa.camara || null,
        documentos: docs
      };
    } catch (err) {
      console.warn('Supabase falló al guardar expediente; usando almacenamiento local:', err.message);
    }
  }

  const mapa = archivosDesdeMulter(files);
  const dir = path.join(ROOT, key);
  await asegurarDir(dir);

  const documentos = [];
  for (const [campo, file] of Object.entries(mapa)) {
    const filename = `${campo}__${nombreSeguro(file.originalname)}`;
    await fs.promises.writeFile(path.join(dir, filename), file.buffer);
    documentos.push({
      campo,
      etiqueta: etiquetaDeCampo(campo),
      filename,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
  }

  const indice = await leerIndice();
  const i = indice.findIndex((e) => nitKey(e.nit) === key);
  const previo = i >= 0 ? indice[i] : {};
  const rec = {
    ...previo,
    ...metaEmpresa,
    nit: metaEmpresa.nit || nit,
    documentos: combinarDocumentos(previo.documentos, documentos)
  };
  if (i >= 0) indice[i] = rec;
  else indice.push(rec);
  await escribirIndice(indice);
  return rec;
}

async function cargarAdjuntosGuardados(nit) {
  const key = nitKey(nit);
  if (!key) return [];

  if (supabaseDisponible()) {
    const desdeSupabase = await cargarAdjuntosSupabase(key);
    if (desdeSupabase.length) {
      return desdeSupabase;
    }
  }

  const indice = await leerIndice();
  const rec = indice.find((e) => nitKey(e.nit) === key);
  if (!rec || !Array.isArray(rec.documentos) || rec.documentos.length === 0) return [];

  const dir = path.join(ROOT, key);
  const adjuntos = [];
  for (const doc of rec.documentos) {
    try {
      const content = await fs.promises.readFile(path.join(dir, doc.filename));
      adjuntos.push({
        filename: `${doc.etiqueta || etiquetaDeCampo(doc.campo)} - ${doc.originalname}`,
        content,
        contentType: doc.mimetype
      });
    } catch (err) {
      console.warn('No se pudo leer documento del expediente:', doc.filename, err.message);
    }
  }
  return adjuntos;
}

async function listarEmpresas() {
  if (supabaseDisponible()) {
    return listarEmpresasSupabase();
  }
  return leerIndice();
}

module.exports = {
  CAMPOS_DOCUMENTO,
  nitKey,
  archivosDesdeMulter,
  adjuntosDesdeMulter,
  combinarDocumentos,
  guardarExpediente,
  cargarAdjuntosGuardados,
  listarEmpresas
};
