require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');

const { extraerTextoPdf, extraerDatosCamara } = require('./lib/camara');
const { construirCorreo } = require('./lib/correo');
const {
  CAMPOS_DOCUMENTO,
  nitKey,
  guardarExpediente,
  cargarAdjuntosGuardados,
  listarEmpresas
} = require('./lib/expediente');

const PORT = Number(process.env.PORT) || 3000;
const MODO_PRUEBA = String(process.env.MODO_PRUEBA || 'true').toLowerCase() !== 'false';
const MAIL_DAYANA = process.env.MAIL_DAYANA || 'dayana.vasquez@comfenalcoantioquia.com';
const MAIL_PRUEBA = process.env.MAIL_PRUEBA || '';

// Correos propios del envío a Jurídica (Paso 2). Aceptan varios separados por coma.
const MAIL_JURIDICA = process.env.MAIL_JURIDICA || '';
const MAIL_PRUEBA_JURIDICA = process.env.MAIL_PRUEBA_JURIDICA || MAIL_PRUEBA;
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL_PREDETERMINADO = 'vargasnicolas2350@gmail.com';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 }
});

const uploadExpediente = upload.fields(
  CAMPOS_DOCUMENTO.map((d) => ({ name: d.campo, maxCount: 1 }))
);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const correoValido = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
  .every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

function crearTransporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const puerto = Number(SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    secure: String(process.env.SMTP_SECURE || (puerto === 465)).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function solicitarAuthSupabase(ruta, datos) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const error = new Error('Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en .env.');
    error.status = 500;
    throw error;
  }

  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/${ruta}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(datos)
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(
      resultado.msg || resultado.message || resultado.error_description || resultado.error || 'Supabase Auth rechazó la solicitud.'
    );
    error.status = respuesta.status;
    throw error;
  }
  return resultado;
}

async function solicitarSupabase(ruta, { apiKey = SUPABASE_ANON_KEY, accessToken, method = 'GET', body, prefer } = {}) {
  if (!SUPABASE_URL || !apiKey) {
    const error = new Error('Falta configurar la conexión con Supabase en .env.');
    error.status = 500;
    throw error;
  }
  const headers = { apikey: apiKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${SUPABASE_URL}${ruta}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const resultado = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(resultado.message || resultado.msg || resultado.error_description || resultado.error || 'Supabase rechazó la solicitud.');
    error.status = response.status;
    throw error;
  }
  return resultado;
}

function exigirClaveSupabasePrivada() {
  if (SUPABASE_SECRET_KEY) return;
  const error = new Error('Falta SUPABASE_SECRET_KEY en .env para administrar perfiles.');
  error.status = 500;
  throw error;
}

async function buscarPerfilPorEmail(email) {
  exigirClaveSupabasePrivada();
  const query = new URLSearchParams({
    select: 'user_id,email,role,active,created_at',
    email: `eq.${String(email).toLowerCase()}`,
    limit: '1'
  });
  const perfiles = await solicitarSupabase(`/rest/v1/profiles?${query}`, { apiKey: SUPABASE_SECRET_KEY });
  return perfiles[0] || null;
}

async function buscarPerfilPorId(userId) {
  exigirClaveSupabasePrivada();
  const query = new URLSearchParams({
    select: 'user_id,email,role,active,created_at',
    user_id: `eq.${userId}`,
    limit: '1'
  });
  const perfiles = await solicitarSupabase(`/rest/v1/profiles?${query}`, { apiKey: SUPABASE_SECRET_KEY });
  return perfiles[0] || null;
}

async function exigirPerfilAutenticado(req) {
  exigirClaveSupabasePrivada();
  const autorizacion = String(req.get('authorization') || '');
  const coincidencia = autorizacion.match(/^Bearer\s+(.+)$/i);
  if (!coincidencia) {
    const error = new Error('La sesión venció. Vuelve a iniciar sesión.');
    error.status = 401;
    throw error;
  }
  const usuario = await solicitarSupabase('/auth/v1/user', {
    accessToken: coincidencia[1]
  });
  const perfil = usuario && usuario.id ? await buscarPerfilPorId(usuario.id) : null;
  if (!perfil || !perfil.active) {
    const error = new Error('El usuario no tiene un perfil activo autorizado.');
    error.status = 403;
    throw error;
  }
  return perfil;
}

async function exigirAdministrador(req) {
  const perfil = await exigirPerfilAutenticado(req);
  if (perfil.role !== 'admin') {
    const error = new Error('Acceso restringido a administradores.');
    error.status = 403;
    throw error;
  }
  return perfil;
}

async function exigirUsuarioAutenticado(req, res, next) {
  try {
    req.perfil = await exigirPerfilAutenticado(req);
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Inicie sesión para consultar los convenios.' });
  }
}

async function exigirEditorAdministrador(req, res, next) {
  try {
    const perfil = await exigirPerfilAutenticado(req);
    if (!['admin', 'editor'].includes(perfil.role)) {
      return res.status(403).json({ error: 'Solo administradores y editores pueden crear convenios.' });
    }
    req.perfil = perfil;
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Inicie sesión con un perfil autorizado para crear convenios.' });
  }
}

app.post('/api/auth/otp/enviar', express.json({ limit: '10kb' }), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!correoValido(email)) return res.status(400).json({ error: 'Ingrese un correo válido.' });

  try {
    const perfil = await buscarPerfilPorEmail(email);
    if (!perfil || !perfil.active) {
      return res.status(403).json({ error: 'El correo no tiene permisos asignados en el sistema.' });
    }
    await solicitarAuthSupabase('otp', { email, create_user: true });
    res.json({ ok: true, email });
  } catch (err) {
    console.error('Error solicitando OTP a Supabase:', err.message);
    const status = err.status === 429 ? 429 : (err.status >= 400 && err.status < 500 ? err.status : 502);
    res.status(status).json({ error: err.message || 'Supabase no pudo enviar el código OTP.' });
  }
});

app.post('/api/auth/otp/verificar', express.json({ limit: '10kb' }), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const codigo = String(req.body.codigo || '').trim();

  if (!/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'Ingrese el código de 6 dígitos enviado a su correo.' });
  }

  try {
    const resultado = await solicitarAuthSupabase('verify', { email, token: codigo, type: 'email' });
    const emailVerificado = String(resultado.user && resultado.user.email || '').trim().toLowerCase();
    if (emailVerificado !== email) {
      return res.status(401).json({ error: 'Supabase no confirmó el correo solicitado.' });
    }
    const perfil = resultado.user && resultado.user.id ? await buscarPerfilPorId(resultado.user.id) : null;
    if (!perfil || !perfil.active) {
      return res.status(403).json({ error: 'El correo no tiene permisos asignados en el sistema.' });
    }
    res.json({
      ok: true,
      email,
      rol: perfil.role,
      userId: perfil.user_id,
      accessToken: resultado.access_token
    });
  } catch (err) {
    console.error('Error verificando OTP con Supabase:', err.message);
    const status = err.status === 429 ? 429 : (err.status >= 400 && err.status < 500 ? 400 : 502);
    res.status(status).json({ error: err.message || 'No se pudo verificar el código OTP.' });
  }
});

app.get('/api/admin/profiles', async (req, res) => {
  try {
    await exigirAdministrador(req);
    const query = new URLSearchParams({
      select: 'user_id,email,role,active,created_at',
      order: 'email.asc'
    });
    const perfiles = await solicitarSupabase(`/rest/v1/profiles?${query}`, { apiKey: SUPABASE_SECRET_KEY });
    res.json({ ok: true, profiles: perfiles });
  } catch (err) {
    console.error('Error listando perfiles:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudieron cargar los perfiles.' });
  }
});

app.post('/api/admin/profiles', express.json({ limit: '10kb' }), async (req, res) => {
  try {
    await exigirAdministrador(req);
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || '').trim();
    if (!correoValido(email)) return res.status(400).json({ error: 'Ingrese un correo válido.' });
    if (!['admin', 'editor', 'juridico'].includes(role)) {
      return res.status(400).json({ error: 'El perfil seleccionado no es válido.' });
    }
    if (email === ADMIN_EMAIL_PREDETERMINADO && role !== 'admin') {
      return res.status(400).json({ error: 'No se puede cambiar el perfil del administrador principal.' });
    }

    let perfil = await buscarPerfilPorEmail(email);
    if (perfil) {
      const query = new URLSearchParams({ user_id: `eq.${perfil.user_id}` });
      const actualizados = await solicitarSupabase(`/rest/v1/profiles?${query}`, {
        apiKey: SUPABASE_SECRET_KEY,
        method: 'PATCH',
        body: { role, active: true },
        prefer: 'return=representation'
      });
      perfil = actualizados[0] || await buscarPerfilPorEmail(email);
    } else {
      let usuarioAuth;
      try {
        usuarioAuth = await solicitarSupabase('/auth/v1/admin/users', {
          apiKey: SUPABASE_SECRET_KEY,
          method: 'POST',
          body: { email, email_confirm: true }
        });
      } catch (err) {
        if (err.status !== 422 && !/already registered|already exists/i.test(err.message)) throw err;
        usuarioAuth = await buscarUsuarioAuthPorEmail(email);
      }
      const userId = usuarioAuth && (usuarioAuth.id || usuarioAuth.user && usuarioAuth.user.id);
      if (!userId) throw new Error('Supabase Auth no devolvió el usuario creado.');
      const insertados = await solicitarSupabase('/rest/v1/profiles', {
        apiKey: SUPABASE_SECRET_KEY,
        method: 'POST',
        body: { user_id: userId, email, role, active: true },
        prefer: 'return=representation'
      });
      perfil = insertados[0] || await buscarPerfilPorEmail(email);
    }
    res.json({ ok: true, profile: perfil });
  } catch (err) {
    console.error('Error guardando perfil:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo guardar el perfil.' });
  }
});

app.patch('/api/admin/profiles/:userId', express.json({ limit: '10kb' }), async (req, res) => {
  try {
    const admin = await exigirAdministrador(req);
    const role = String(req.body.role || '').trim();
    if (!['admin', 'editor', 'juridico'].includes(role)) {
      return res.status(400).json({ error: 'El perfil seleccionado no es válido.' });
    }
    const target = await buscarPerfilPorId(req.params.userId);
    if (!target) return res.status(404).json({ error: 'No se encontró el perfil.' });
    if (target.email === ADMIN_EMAIL_PREDETERMINADO || target.user_id === admin.user_id) {
      return res.status(400).json({ error: 'No se puede cambiar el perfil del administrador principal ni el propio.' });
    }
    const perfiles = await solicitarSupabase('/rest/v1/profiles?select=user_id,email,role,active', { apiKey: SUPABASE_SECRET_KEY });
    if (target.role === 'admin' && role !== 'admin' && perfiles.filter((p) => p.active && p.role === 'admin').length <= 1) {
      return res.status(400).json({ error: 'Debe quedar al menos un administrador activo.' });
    }
    const query = new URLSearchParams({ user_id: `eq.${target.user_id}` });
    const actualizados = await solicitarSupabase(`/rest/v1/profiles?${query}`, {
      apiKey: SUPABASE_SECRET_KEY,
      method: 'PATCH',
      body: { role },
      prefer: 'return=representation'
    });
    res.json({ ok: true, profile: actualizados[0] });
  } catch (err) {
    console.error('Error actualizando perfil:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo actualizar el perfil.' });
  }
});

app.delete('/api/admin/profiles/:userId', async (req, res) => {
  try {
    const admin = await exigirAdministrador(req);
    const target = await buscarPerfilPorId(req.params.userId);
    if (!target) return res.status(404).json({ error: 'No se encontró el perfil.' });
    if (target.email === ADMIN_EMAIL_PREDETERMINADO || target.user_id === admin.user_id) {
      return res.status(400).json({ error: 'No se puede desactivar el administrador principal ni el propio.' });
    }
    const perfiles = await solicitarSupabase('/rest/v1/profiles?select=user_id,email,role,active', { apiKey: SUPABASE_SECRET_KEY });
    if (target.role === 'admin' && target.active && perfiles.filter((p) => p.active && p.role === 'admin').length <= 1) {
      return res.status(400).json({ error: 'Debe quedar al menos un administrador activo.' });
    }
    const query = new URLSearchParams({ user_id: `eq.${target.user_id}` });
    await solicitarSupabase(`/rest/v1/profiles?${query}`, {
      apiKey: SUPABASE_SECRET_KEY,
      method: 'PATCH',
      body: { active: false },
      prefer: 'return=minimal'
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error desactivando perfil:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo eliminar el acceso.' });
  }
});

async function buscarUsuarioAuthPorEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const resultado = await solicitarSupabase(`/auth/v1/admin/users?page=${page}&per_page=100`, { apiKey: SUPABASE_SECRET_KEY });
    const usuarios = resultado.users || [];
    const coincidencia = usuarios.find((usuario) => String(usuario.email || '').toLowerCase() === email);
    if (coincidencia) return coincidencia;
    if (usuarios.length < 100) break;
  }
  throw new Error('El correo ya existe en Auth, pero no se pudo localizar su usuario.');
}

// 1) Lee la Cámara de Comercio y devuelve los datos para que el usuario los revise
app.post('/api/camara/analizar', upload.single('camara'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió el archivo.' });
  if (req.file.mimetype !== 'application/pdf' && !/\.pdf$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'La Cámara de Comercio debe ser un archivo PDF.' });
  }
  try {
    const texto = await extraerTextoPdf(req.file.buffer);
    if (!texto.trim()) {
      return res.json({ datos: null, aviso: 'El PDF no tiene texto legible (parece escaneado). Complete los datos manualmente.' });
    }
    res.json({ datos: extraerDatosCamara(texto) });
  } catch (err) {
    console.error('Error leyendo la Cámara de Comercio:', err.message);
    res.json({ datos: null, aviso: 'No se pudo leer el PDF. Complete los datos manualmente.' });
  }
});

app.get('/api/empresas', async (_req, res) => {
  try {
    const empresas = await listarEmpresas();
    res.json({
      empresas: empresas.map((e) => ({
        razonSocial: e.razonSocial || '',
        nit: e.nit || '',
        ciudad: e.ciudad || '',
        unidadRegional: e.unidadRegional || '',
        correo: e.correo || '',
        nombreContacto: e.nombreContacto || '',
        numeroContacto: e.numeroContacto || '',
        interventor: e.interventor || '',
        camara: e.camara || null,
        documentos: (e.documentos || []).map((d) => d.etiqueta || d.campo)
      }))
    });
  } catch (err) {
    console.error('Error listando empresas:', err.message);
    res.status(500).json({ error: 'No se pudieron leer las empresas registradas.' });
  }
});

app.get('/api/config/supabase', (_req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Falta configurar la conexión pública con Supabase.' });
  }
  res.json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, bucket: 'convenio-documents' });
});

app.post('/api/empresas/expediente', exigirEditorAdministrador, express.json({ limit: '100kb' }), async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'Falta configurar Supabase para guardar el expediente.' });
  }

  const { empresa = {}, documentos = [] } = req.body || {};
  const nit = nitKey(empresa.nit);
  if (!nit || !String(empresa.razonSocial || '').trim() || !Array.isArray(documentos) || documentos.length === 0) {
    return res.status(400).json({ error: 'Complete los datos de la empresa y cargue al menos un documento.' });
  }
  if (documentos.some((documento) => {
    const campoValido = CAMPOS_DOCUMENTO.some((item) => item.campo === documento.campo);
    const rutaValida = String(documento.storagePath || '').startsWith(`expedientes/${nit}/`);
    return !campoValido || !rutaValida || !String(documento.originalname || '').trim();
  })) {
    return res.status(400).json({ error: 'La lista de documentos contiene datos no válidos.' });
  }

  try {
    await guardarExpediente(nit, {}, {
      ...empresa,
      nit,
      camara: empresa.camara && typeof empresa.camara === 'object' ? empresa.camara : {}
    });
    const queryEmpresa = new URLSearchParams({ select: 'id', nit: `eq.${nit}`, limit: '1' });
    const empresas = await solicitarSupabase(`/rest/v1/companies?${queryEmpresa}`, { apiKey: SUPABASE_SECRET_KEY });
    const empresaGuardada = Array.isArray(empresas) ? empresas[0] : null;
    if (!empresaGuardada || !empresaGuardada.id) {
      throw new Error('Supabase no confirmó el registro de la empresa.');
    }

    const filasDocumentos = documentos.map((documento) => ({
      company_id: empresaGuardada.id,
      agreement_id: null,
      document_type: documento.campo,
      storage_path: documento.storagePath,
      original_name: String(documento.originalname),
      mime_type: String(documento.mimetype || 'application/octet-stream'),
      size_bytes: Number(documento.sizeBytes) || null,
      uploaded_by: req.perfil.user_id
    }));
    await solicitarSupabase('/rest/v1/documents?on_conflict=storage_path', {
      apiKey: SUPABASE_SECRET_KEY,
      method: 'POST',
      body: filasDocumentos,
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
    res.json({ ok: true, razonSocial: empresa.razonSocial, documentos: documentos.length });
  } catch (err) {
    console.error('Error guardando expediente en Supabase:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo guardar el expediente en Supabase.' });
  }
});

app.get('/api/convenios', exigirUsuarioAutenticado, async (_req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'Falta configurar Supabase para consultar los convenios.' });
  }

  try {
    const queryConvenios = new URLSearchParams({
      select: 'id,company_id,stage_number,responsible,status,stage_started_at,notes,created_at',
      order: 'created_at.desc'
    });
    const convenios = await solicitarSupabase(`/rest/v1/agreements?${queryConvenios}`, { apiKey: SUPABASE_SECRET_KEY });
    if (!Array.isArray(convenios) || convenios.length === 0) return res.json({ ok: true, convenios: [] });

    const companyIds = [...new Set(convenios.map((convenio) => convenio.company_id).filter(Boolean))];
    const queryEmpresas = new URLSearchParams({
      select: 'id,nit,razon_social,ciudad,unidad_regional,correo,nombre_contacto,interventor,camara_datos',
      id: `in.(${companyIds.join(',')})`
    });
    const empresas = await solicitarSupabase(`/rest/v1/companies?${queryEmpresas}`, { apiKey: SUPABASE_SECRET_KEY });
    const porId = new Map((Array.isArray(empresas) ? empresas : []).map((empresa) => [empresa.id, empresa]));

    const queryDocumentos = new URLSearchParams({
      select: 'company_id,document_type,original_name',
      company_id: `in.(${companyIds.join(',')})`
    });
    const documentos = await solicitarSupabase(`/rest/v1/documents?${queryDocumentos}`, { apiKey: SUPABASE_SECRET_KEY });
    const documentosPorEmpresa = new Map();
    for (const documento of Array.isArray(documentos) ? documentos : []) {
      const lista = documentosPorEmpresa.get(documento.company_id) || [];
      const etiqueta = CAMPOS_DOCUMENTO.find((item) => item.campo === documento.document_type)?.etiqueta || documento.document_type;
      lista.push(`${etiqueta} (${documento.original_name})`);
      documentosPorEmpresa.set(documento.company_id, lista);
    }

    res.json({
      ok: true,
      convenios: convenios.map((convenio) => {
        const empresa = porId.get(convenio.company_id) || {};
        const camara = empresa.camara_datos && typeof empresa.camara_datos === 'object' ? empresa.camara_datos : {};
        const datosCamara = camara.datos && typeof camara.datos === 'object' ? camara.datos : camara;
        return {
          id: convenio.id,
          entidad: empresa.razon_social || '',
          nit: empresa.nit || '',
          ciudad: empresa.ciudad || '',
          unidadRegional: empresa.unidad_regional || '',
          contacto: empresa.nombre_contacto || '',
          correo: empresa.correo || '',
          interventor: empresa.interventor || '',
          representanteLegal: datosCamara.representanteLegal || 'N/A',
          tipoEmpresa: datosCamara.tipoEmpresa || 'Privada',
          etapaNumero: Number(convenio.stage_number) || 1,
          estado: convenio.status || 'Activa',
          fechaEtapa: convenio.stage_started_at || convenio.created_at,
          responsable: convenio.responsible || '',
          notas: convenio.notes || '',
          adjuntos: documentosPorEmpresa.get(convenio.company_id) || []
        };
      })
    });
  } catch (err) {
    console.error('Error listando convenios desde Supabase:', err.message);
    res.status(err.status || 500).json({ error: 'No se pudieron cargar los convenios guardados en Supabase.' });
  }
});

app.post('/api/convenios', exigirEditorAdministrador, express.json({ limit: '20kb' }), async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'Falta configurar Supabase para guardar los convenios.' });
  }

  const datos = req.body || {};
  const nit = nitKey(datos.nit);
  const razonSocial = String(datos.razonSocial || '').trim();
  if (!nit || !razonSocial) {
    return res.status(400).json({ error: 'La razón social y el NIT son obligatorios para guardar el convenio.' });
  }

  try {
    const queryEmpresa = new URLSearchParams({ select: 'id', nit: `eq.${nit}`, limit: '1' });
    let empresas = await solicitarSupabase(`/rest/v1/companies?${queryEmpresa}`, { apiKey: SUPABASE_SECRET_KEY });
    let empresa = Array.isArray(empresas) ? empresas[0] : null;

    if (!empresa) {
      empresas = await solicitarSupabase('/rest/v1/companies', {
        apiKey: SUPABASE_SECRET_KEY,
        method: 'POST',
        body: {
          nit,
          razon_social: razonSocial,
          ciudad: String(datos.ciudad || ''),
          unidad_regional: String(datos.unidadRegional || ''),
          correo: String(datos.correo || ''),
          nombre_contacto: String(datos.contacto || ''),
          interventor: String(datos.interventor || ''),
          camara_datos: datos.camara && typeof datos.camara === 'object' ? datos.camara : {}
        },
        prefer: 'return=representation'
      });
      empresa = Array.isArray(empresas) ? empresas[0] : null;
    }

    if (!empresa || !empresa.id) throw new Error('No se pudo localizar o crear la empresa en Supabase.');

    const id = `CONV-${new Date().getFullYear()}-${Date.now()}`;
    const guardados = await solicitarSupabase('/rest/v1/agreements', {
      apiKey: SUPABASE_SECRET_KEY,
      method: 'POST',
      body: {
        id,
        company_id: empresa.id,
        stage_number: 1,
        responsible: String(datos.responsable || ''),
        status: 'Activa',
        stage_started_at: new Date().toISOString(),
        notes: String(datos.notas || '')
      },
      prefer: 'return=representation'
    });

    const guardado = Array.isArray(guardados) ? guardados[0] : guardados;
    res.status(201).json({ ok: true, id: guardado.id });
  } catch (err) {
    console.error('Error guardando convenio en Supabase:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'No se pudo guardar el convenio en Supabase.' });
  }
});

app.post('/api/empresas/documentos', uploadExpediente, async (req, res) => {
  const nit = String(req.body.nit || '').trim();
  if (!nitKey(nit)) {
    return res.status(400).json({ error: 'El NIT de la empresa no es válido.' });
  }

  const campos = Object.keys(req.files || {});
  if (!campos.length) {
    return res.status(400).json({ error: 'Seleccione el documento que desea actualizar.' });
  }

  let datosCamara;
  if (req.files.camara) {
    const archivoCamara = req.files.camara[0];
    if (archivoCamara.mimetype !== 'application/pdf' && !/\.pdf$/i.test(archivoCamara.originalname)) {
      return res.status(400).json({ error: 'La Cámara de Comercio debe ser un archivo PDF.' });
    }
    try {
      datosCamara = JSON.parse(req.body.datosCamara || '{}');
    } catch {
      return res.status(400).json({ error: 'Los datos extraídos de la Cámara de Comercio no son válidos.' });
    }
    const datosObligatorios = ['razonSocial', 'nit', 'representanteLegal', 'cedula'];
    if (datosObligatorios.some((campo) => !String(datosCamara[campo] || '').trim())) {
      return res.status(400).json({ error: 'Revise y complete los datos de la Cámara de Comercio antes de guardarla.' });
    }
    if (nitKey(datosCamara.nit) !== nitKey(nit)) {
      return res.status(400).json({ error: 'El NIT de la Cámara de Comercio no coincide con la empresa seleccionada.' });
    }
  }

  try {
    const empresas = await listarEmpresas();
    const empresa = empresas.find((item) => nitKey(item.nit) === nitKey(nit));
    if (!empresa) {
      return res.status(404).json({ error: 'No se encontró una empresa guardada con ese NIT.' });
    }

    const metaEmpresa = datosCamara
      ? {
          razonSocial: datosCamara.razonSocial,
          camara: { ...(empresa.camara || {}), datos: datosCamara }
        }
      : {};
    const actualizada = await guardarExpediente(nit, req.files, metaEmpresa);
    res.json({
      ok: true,
      razonSocial: actualizada.razonSocial,
      documentos: (actualizada.documentos || []).map((documento) => documento.etiqueta || documento.campo),
      camara: actualizada.camara || null
    });
  } catch (err) {
    console.error('Error actualizando documentos de empresa:', err.message);
    res.status(500).json({ error: 'No se pudo guardar el documento actualizado.' });
  }
});

// 2) Envía el correo a Dayana (o al correo de prueba si MODO_PRUEBA=true)
app.post('/api/convenios/notificar', exigirEditorAdministrador, express.json({ limit: '20kb' }), async (req, res) => {
  let datos;
  try {
    datos = typeof req.body.datos === 'string' ? JSON.parse(req.body.datos || '{}') : (req.body.datos || {});
  } catch {
    return res.status(400).json({ error: 'Datos inválidos.' });
  }

  const requeridos = {
    razonSocial: 'Razón social',
    nit: 'NIT',
    representanteLegal: 'Representante legal',
    cedula: 'Cédula',
    tipoEmpresa: 'Tipo de empresa',
    interventor: 'Interventor(a)'
  };
  const faltantes = Object.entries(requeridos)
    .filter(([k]) => !String(datos[k] || '').trim())
    .map(([, etiqueta]) => etiqueta);
  if (faltantes.length) {
    return res.status(400).json({ error: `Faltan datos: ${faltantes.join(', ')}.` });
  }

  const nitEmpresa = String(datos.nit || req.body.nit || '').trim();
  if (!nitKey(nitEmpresa)) {
    return res.status(400).json({ error: 'El NIT debe contener al menos un número. Revise el NIT ingresado para la empresa.' });
  }

  const transporte = crearTransporte();
  if (!transporte) {
    return res.status(500).json({ error: 'El servidor no tiene configurado el correo (revise SMTP_* en el archivo .env).' });
  }
  if (MODO_PRUEBA && !MAIL_PRUEBA) {
    return res.status(500).json({ error: 'MODO_PRUEBA está activo pero falta MAIL_PRUEBA en el archivo .env.' });
  }

  const modoEmpresa = String(req.body.modoEmpresa || 'nueva');
  let attachments;
  try {
    attachments = await cargarAdjuntosGuardados(nitEmpresa);
  } catch (err) {
    console.error('Error guardando/leyendo expediente:', err.message);
    return res.status(500).json({ error: 'No se pudo preparar el expediente de la empresa.' });
  }

  if (!attachments.length) {
    return res.status(400).json({
      error: modoEmpresa === 'registrada'
        ? 'Esta empresa no tiene documentos guardados. Debe registrarla desde 0 con el expediente completo.'
        : 'Debe adjuntar el expediente completo de documentos.'
    });
  }

  const { asunto, texto, html } = construirCorreo(datos);
  const listaAdjuntos = attachments.map((a) => a.filename).join(', ');
  const textoConAdjuntos = `${texto}\n\nDocumentos adjuntos:\n${attachments.map((a) => `- ${a.filename}`).join('\n')}`;
  const htmlConAdjuntos = html.replace(
    '</div>',
    `<p><strong>Documentos adjuntos:</strong><br>${attachments.map((a) => escapeHtml(a.filename)).join('<br>')}</p></div>`
  );
  const destinatario = MODO_PRUEBA ? MAIL_PRUEBA : MAIL_DAYANA;

  const mensaje = {
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: destinatario,
    subject: MODO_PRUEBA ? `[PRUEBA] ${asunto}` : asunto,
    text: MODO_PRUEBA ? `(Correo de prueba. En producción llegaría a ${MAIL_DAYANA})\n\n${textoConAdjuntos}` : textoConAdjuntos,
    html: MODO_PRUEBA
      ? `<p style="font-family:Arial;font-size:12px;color:#92400e;background:#fef3c7;padding:8px;border-radius:4px">Correo de prueba. En producción llegaría a ${MAIL_DAYANA}.</p>${htmlConAdjuntos}`
      : htmlConAdjuntos,
    attachments
  };

  try {
    await transporte.sendMail(mensaje);
    res.json({
      ok: true,
      enviadoA: destinatario,
      modoPrueba: MODO_PRUEBA,
      adjuntos: listaAdjuntos
    });
  } catch (err) {
    console.error('Error enviando correo:', err.message);
    res.status(502).json({ error: 'No se pudo enviar el correo. Revise las credenciales SMTP.' });
  }
});

// 3) Envío a Jurídica (Paso 2): correo con 2 adjuntos (minuta + hoja de ruta)
app.post('/api/convenios/enviar-juridica',
  upload.fields([{ name: 'archivo1', maxCount: 1 }, { name: 'archivo2', maxCount: 1 }]),
  async (req, res) => {
    const archivo1 = req.files && req.files.archivo1 && req.files.archivo1[0];
    const archivo2 = req.files && req.files.archivo2 && req.files.archivo2[0];
    if (!archivo1 || !archivo2) {
      return res.status(400).json({ error: 'Debe adjuntar los 2 archivos obligatorios.' });
    }

    const { idConvenio = '', entidad = '', nit = '', correoDestino = '', asunto = '', mensaje = '' } = req.body;

    // Producción: usa el correo escrito en el formulario (o MAIL_JURIDICA si viene vacío).
    // Prueba: siempre MAIL_PRUEBA_JURIDICA.
    const destinoReal = String(correoDestino).trim() || MAIL_JURIDICA;
    const destinatario = MODO_PRUEBA ? MAIL_PRUEBA_JURIDICA : destinoReal;

    if (!destinatario) {
      return res.status(500).json({
        error: MODO_PRUEBA
          ? 'MODO_PRUEBA está activo pero falta MAIL_PRUEBA_JURIDICA (o MAIL_PRUEBA) en el archivo .env.'
          : 'No hay correo destino para Jurídica (escríbalo en el formulario o defina MAIL_JURIDICA en .env).'
      });
    }
    if (!correoValido(destinatario)) {
      return res.status(400).json({ error: 'El correo destino no es válido.' });
    }

    const transporte = crearTransporte();
    if (!transporte) {
      return res.status(500).json({ error: 'El servidor no tiene configurado el correo (revise SMTP_* en el archivo .env).' });
    }

    const asuntoFinal = String(asunto).trim() || 'Solicitud de Asignación de Asesor Jurídico - Paso 2';
    const lineas = [
      `Convenio: ${idConvenio}${entidad ? ' - ' + entidad : ''}`,
      nit ? `NIT: ${nit}` : '',
      `Adjuntos: ${archivo1.originalname}, ${archivo2.originalname}`,
      mensaje ? `\nObservaciones:\n${mensaje}` : ''
    ].filter(Boolean);
    const texto = `Cordial saludo,\n\nSe solicita la asignación de asesor jurídico para el siguiente convenio.\n\n${lineas.join('\n')}\n\nTiempo de respuesta (ANS): 36 horas.\n\nPortal de Convenios - Comfenalco Antioquia`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      <p>Cordial saludo,</p>
      <p>Se solicita la asignación de asesor jurídico para el siguiente convenio.</p>
      <ul>
        <li><strong>Convenio:</strong> ${escapeHtml(idConvenio)}${entidad ? ' - ' + escapeHtml(entidad) : ''}</li>
        ${nit ? `<li><strong>NIT:</strong> ${escapeHtml(nit)}</li>` : ''}
        <li><strong>Adjuntos:</strong> ${escapeHtml(archivo1.originalname)}, ${escapeHtml(archivo2.originalname)}</li>
      </ul>
      ${mensaje ? `<p><strong>Observaciones:</strong><br>${escapeHtml(mensaje).replace(/\n/g, '<br>')}</p>` : ''}
      <p>Tiempo de respuesta (ANS): <strong>36 horas</strong>.</p>
      <p>Portal de Convenios - Comfenalco Antioquia</p></div>`;

    const aviso = `Correo de prueba. En producción llegaría a ${destinoReal || '(sin destino definido)'}.`;
    const mensajeCorreo = {
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: destinatario,
      subject: MODO_PRUEBA ? `[PRUEBA] ${asuntoFinal}` : asuntoFinal,
      text: MODO_PRUEBA ? `(${aviso})\n\n${texto}` : texto,
      html: MODO_PRUEBA
        ? `<p style="font-family:Arial;font-size:12px;color:#92400e;background:#fef3c7;padding:8px;border-radius:4px">${escapeHtml(aviso)}</p>${html}`
        : html,
      attachments: [archivo1, archivo2].map((f) => ({
        filename: f.originalname, content: f.buffer, contentType: f.mimetype
      }))
    };

    try {
      await transporte.sendMail(mensajeCorreo);
      res.json({ ok: true, enviadoA: destinatario, modoPrueba: MODO_PRUEBA });
    } catch (err) {
      console.error('Error enviando correo a Jurídica:', err.message);
      res.status(200).json({
        ok: true,
        warning: 'El convenio quedó registrado, pero no se pudo enviar el correo a Jurídica. Revise las credenciales SMTP.',
        enviadoA: destinatario,
        modoPrueba: MODO_PRUEBA
      });
    }
  });

// Errores de multer (archivo muy grande, etc.)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const mensaje = err.code === 'LIMIT_UNEXPECTED_FILE'
      ? `Campo de archivo no esperado: ${err.field || '(sin nombre)'}. Recargue la página e intente de nuevo.`
      : err.message;
    return res.status(400).json({ error: mensaje });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  console.log(`Portal de Convenios en http://localhost:${PORT}  (modo prueba: ${MODO_PRUEBA ? 'SÍ' : 'NO'})`);
});