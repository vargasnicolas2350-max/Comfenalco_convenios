// app.js

// Nombres oficiales de las 5 etapas
const ETAPAS_NOMBRES = {
  1: "Creación de hoja de ruta y minuta",
  2: "Asignación de asesor jurídico",
  3: "Validación de documentos y firmas",
  4: "Creación de convenio en SAP y marcación en CRM",
  5: "Carga de beneficiarios, registros y afiliaciones"
};
const ANS_HORAS_POR_ETAPA = { 1: 24, 2: 36, 3: 48, 4: 72, 5: 72 };

const DOCUMENTOS_EXPEDIENTE = [
  { id: "file-camara", campo: "camara", etiqueta: "Cámara de Comercio" },
  { id: "file-rut", campo: "rut", etiqueta: "RUT" },
  { id: "file-cedula", campo: "cedula", etiqueta: "Cédula Representante Legal" },
  { id: "file-inhabilidades", campo: "inhabilidades", etiqueta: "Formato de Inhabilidades" },
  { id: "file-codigo-etica", campo: "codigoEtica", etiqueta: "Código de Ética" },
  { id: "file-tratamiento-datos", campo: "tratamientoDatos", etiqueta: "Tratamiento de Datos" },
  { id: "file-manual-contratacion", campo: "manualContratacion", etiqueta: "Manual de Contratación" },
  { id: "file-rub", campo: "rub", etiqueta: "RUB" },
  { id: "file-composicion", campo: "composicion", etiqueta: "Composición Accionaria" }
];

// ==========================================
// CONFIGURACIÓN DE SEGURIDAD Y PERMISOS OTP
// ==========================================
// Correo del Administrador Determinado (Aquí puedes cambiarlo según lo requieras)
const adminEmailPredeterminado = "vargasnicolas2350@gmail.com";

// Base de Datos de Usuarios y sus Roles
let baseUsuarios = [];

// Estado de la Sesión Actual
let usuarioSesion = {
  autenticado: false,
  email: "",
  rol: "invitado",
  userId: "",
  accessToken: ""
};

let emailEnProcesoAuth = "";

// Estado Inicial de Convenios
let conveniosData = [];
let errorCargaConvenios = "Inicie sesión para consultar los convenios guardados.";

let empresasRegistradasData = [];

let modoEmpresaActual = 'registrada';
let lecturaCamaraId = 0;
let lecturaCamaraEdicionId = 0;
let convenioEnEdicionId = "";
let matriculaPdfDocumento = null;
let matriculaPdfPromesa = null;
let matriculaPdfPaginaActual = 1;
let matriculaPdfZoom = 1;
let matriculaPdfTareaRender = null;
let matriculaPdfRenderId = 0;
let matriculaPdfResizeTimer = null;

// Inicialización
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  aplicarPermisosEnUI();
  poblarFiltroResponsables();
  renderTablero();
  actualizarSelectEmpresas();
  inicializarEditorDocumentos();
  poblarSelectConveniosPaso2();
  cargarEmpresasGuardadas();
  window.addEventListener("resize", () => {
    if (!matriculaPdfDocumento || !document.getElementById("sec-matricula").classList.contains("active")) return;
    clearTimeout(matriculaPdfResizeTimer);
    matriculaPdfResizeTimer = setTimeout(renderizarPaginaMatricula, 120);
  });
  window.setInterval(() => {
    if (usuarioSesion.autenticado && !document.hidden) cargarConveniosGuardados();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (usuarioSesion.autenticado && !document.hidden) cargarConveniosGuardados();
  });
});

// ==========================================
// FLUJO DE AUTENTICACIÓN Y VALIDACIÓN OTP
// ==========================================

function abrirModalAuth() {
  if (usuarioSesion.autenticado) {
    // Si ya está autenticado, funciona como Logout
    if (confirm(`¿Desea cerrar la sesión actual (${usuarioSesion.email})?`)) {
      usuarioSesion = { autenticado: false, email: "", rol: "invitado", userId: "", accessToken: "" };
      aplicarPermisosEnUI();
      switchTab("convenios");
      alert("Sesión cerrada correctamente.");
    }
    return;
  }
  resetFormAuth();
  openModal("modal-auth-otp");
}

function resetFormAuth() {
  document.getElementById("step-auth-email").style.display = "block";
  document.getElementById("step-auth-otp").style.display = "none";
  document.getElementById("auth-email-input").value = "";
  document.getElementById("auth-otp-input").value = "";
  emailEnProcesoAuth = "";
}

function mensajeErrorOtp(mensaje, tipo) {
  const texto = String(mensaje || "");
  const espera = texto.match(/only request this after\s+(\d+)\s+seconds?/i);
  if (espera) {
    return `Por seguridad, espera ${espera[1]} segundos antes de pedir otro código. Si ya lo solicitaste, revisa la bandeja de entrada y correo no deseado.`;
  }
  if (/rate limit|too many requests/i.test(texto)) {
    return "Se solicitaron códigos demasiado seguido. Espera un momento y revisa tu correo antes de volver a intentarlo.";
  }
  if (tipo === "verificar" && /token|otp|expired|invalid/i.test(texto)) {
    return "El código venció o no coincide. Solicita uno nuevo y revisa el correo más reciente.";
  }
  return texto || (tipo === "verificar" ? "No se pudo verificar el código OTP." : "No se pudo enviar el código OTP.");
}

async function enviarCodigoOTP() {
  const emailInput = valorDe("auth-email-input").toLowerCase().trim();

  if (!emailInput || !emailInput.includes("@")) {
    alert("Por favor ingrese un correo electrónico válido.");
    return;
  }

  const boton = document.querySelector("#step-auth-email .btn-primary");
  const textoOriginal = boton ? boton.textContent : "";
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Enviando código...";
  }

  try {
    const respuesta = await fetch("/api/auth/otp/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput })
    });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok) throw new Error(json.error || "No se pudo enviar el código OTP.");

    emailEnProcesoAuth = json.email;
    document.getElementById("auth-otp-destination").textContent = json.email;
    document.getElementById("auth-otp-input").value = "";
    document.getElementById("step-auth-email").style.display = "none";
    document.getElementById("step-auth-otp").style.display = "block";
  } catch (err) {
    alert(mensajeErrorOtp(err.message, "enviar"));
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

async function validarCodigoOTP() {
  const otpInput = valorDe("auth-otp-input").trim();

  if (!/^\d{6}$/.test(otpInput)) {
    alert("Ingrese el código de 6 dígitos enviado a su correo.");
    return;
  }

  const boton = document.querySelector("#step-auth-otp .btn-primary");
  const textoOriginal = boton ? boton.textContent : "";
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Verificando...";
  }

  try {
    const respuesta = await fetch("/api/auth/otp/verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailEnProcesoAuth, codigo: otpInput })
    });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok) throw new Error(json.error || "No se pudo verificar el código OTP.");

    usuarioSesion = {
      autenticado: true,
      email: json.email,
      rol: json.rol,
      userId: json.userId,
      accessToken: json.accessToken
    };
    alert(`¡Autenticación exitosa!\nBienvenido: ${usuarioSesion.email}\nRol: ${usuarioSesion.rol.toUpperCase()}`);
    closeModal("modal-auth-otp");
    aplicarPermisosEnUI();
  } catch (err) {
    alert(mensajeErrorOtp(err.message, "verificar"));
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

// Control Visual de Interfaz según Roles y Sesión
function aplicarPermisosEnUI() {
  const elName = document.getElementById("header-user-name");
  const elEmail = document.getElementById("header-user-email");
  const elAvatar = document.getElementById("header-avatar");
  const btnTrigger = document.getElementById("lbl-btn-login");
  const tabAdminUsuarios = document.getElementById("tab-nav-admin-usuarios");
  const tabEnvioJuridico = document.getElementById("tab-nav-envio-juridica");

  if (!usuarioSesion.autenticado) {
    if (elName) elName.textContent = "Visitante";
    if (elEmail) elEmail.textContent = "Sin autenticar (Solo lectura)";
    if (elAvatar) elAvatar.textContent = "VS";
    if (btnTrigger) btnTrigger.textContent = "Ingreso Corporativo";
    if (tabAdminUsuarios) tabAdminUsuarios.style.display = "none";
    if (tabEnvioJuridico) tabEnvioJuridico.style.display = "none";
    conveniosData = [];
    errorCargaConvenios = "Inicie sesión para consultar los convenios guardados.";
  } else {
    if (btnTrigger) btnTrigger.textContent = "Cerrar Sesión";
    if (elEmail) elEmail.textContent = usuarioSesion.email;

    if (usuarioSesion.rol === "admin") {
      if (elName) elName.textContent = "Administrador Raíz";
      if (elAvatar) elAvatar.textContent = "AD";
      if (tabAdminUsuarios) tabAdminUsuarios.style.display = "inline-flex";
      if (tabEnvioJuridico) tabEnvioJuridico.style.display = "inline-flex";
    } else if (usuarioSesion.rol === "editor") {
      if (elName) elName.textContent = "Editor Autorizado";
      if (elAvatar) elAvatar.textContent = "ED";
      if (tabAdminUsuarios) tabAdminUsuarios.style.display = "none";
      if (tabEnvioJuridico) tabEnvioJuridico.style.display = "none";
    } else if (usuarioSesion.rol === "juridico") {
      if (elName) elName.textContent = "Personal Jurídico";
      if (elAvatar) elAvatar.textContent = "JU";
      if (tabAdminUsuarios) tabAdminUsuarios.style.display = "none";
      if (tabEnvioJuridico) tabEnvioJuridico.style.display = "inline-flex";
    }
    cargarConveniosGuardados();
  }

  // El guardado usa la clave privada de Supabase y requiere un perfil editor.
  const btnNuevoConv = document.getElementById("btn-nuevo-convenio");
  if (btnNuevoConv) {
    btnNuevoConv.style.display = (usuarioSesion.autenticado && (usuarioSesion.rol === "admin" || usuarioSesion.rol === "editor")) ? "inline-flex" : "none";
  }
  poblarFiltroResponsables();
  renderTablero();
  poblarSelectConveniosPaso2();
}

// ==========================================
// GESTIÓN DE ADMINISTRADOR Y PERMISOS
// ==========================================

async function agregarOActualizarUsuarioRol() {
  if (usuarioSesion.rol !== "admin") {
    alert("Acceso denegado. Solo un administrador puede gestionar usuarios.");
    return;
  }
  const emailInput = valorDe("admin-nuevo-email").toLowerCase().trim();
  const rolSelect = valorDe("admin-nuevo-rol");

  if (!emailInput || !emailInput.includes("@")) {
    alert("Ingrese un correo válido.");
    return;
  }

  const existente = baseUsuarios.find((usuario) => usuario.email.toLowerCase() === emailInput);
  if (existente && emailInput === adminEmailPredeterminado.toLowerCase()) {
    alert("El perfil del administrador predeterminado está protegido.");
    return;
  }

  try {
    await llamarAPIAdmin("/api/admin/profiles", {
      method: "POST",
      body: { email: emailInput, role: rolSelect }
    });
    ponerValor("admin-nuevo-email", "");
    document.getElementById("admin-nuevo-rol").value = "editor";
    await cargarUsuariosAutorizados();
  } catch (err) {
    alert(err.message || "No se pudo guardar el perfil.");
  }
}

async function eliminarUsuarioRol(userId) {
  if (usuarioSesion.rol !== "admin") return;
  const usuario = baseUsuarios.find((item) => item.user_id === userId);
  if (!usuario) return;
  if (usuario.email.toLowerCase() === adminEmailPredeterminado.toLowerCase()) {
    alert("No se puede revocar el acceso al correo del Administrador Raíz.");
    return;
  }

  if (!confirm(`¿Eliminar el acceso de ${usuario.email}?`)) return;
  try {
    await llamarAPIAdmin(`/api/admin/profiles/${encodeURIComponent(userId)}`, { method: "DELETE" });
    await cargarUsuariosAutorizados();
  } catch (err) {
    alert(err.message || "No se pudo eliminar el acceso.");
  }
}

async function guardarPerfilUsuario(userId, rol) {
  if (usuarioSesion.rol !== "admin") return;
  const usuario = baseUsuarios.find((item) => item.user_id === userId);
  if (!usuario || usuario.email.toLowerCase() === adminEmailPredeterminado.toLowerCase()) return;
  try {
    await llamarAPIAdmin(`/api/admin/profiles/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { role: rol }
    });
    await cargarUsuariosAutorizados();
  } catch (err) {
    alert(err.message || "No se pudo actualizar el perfil.");
  }
}

async function llamarAPIAdmin(url, { method = "GET", body } = {}) {
  if (!usuarioSesion.accessToken) throw new Error("La sesión venció. Vuelve a iniciar sesión.");
  const respuesta = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${usuarioSesion.accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !json.ok) throw new Error(json.error || "No se pudo completar la operación de usuarios.");
  return json;
}

async function cargarUsuariosAutorizados() {
  const tbody = document.getElementById("tbl-autorizados-body");
  if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="admin-users-empty">Cargando usuarios...</td></tr>';
  try {
    const resultado = await llamarAPIAdmin("/api/admin/profiles");
    baseUsuarios = (resultado.profiles || []).map((perfil) => ({ ...perfil, rol: perfil.role }));
    renderTablaAutorizados();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="admin-users-empty">${escaparHtmlUI(err.message || "No se pudieron cargar los perfiles.")}</td></tr>`;
  }
}

function escaparHtmlUI(valor) {
  return String(valor).replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[caracter]));
}

function renderTablaAutorizados() {
  const tbody = document.getElementById("tbl-autorizados-body");
  if (!tbody) return;

  const consulta = valorDe("buscar-usuario-autorizado").toLowerCase();
  const usuariosFiltrados = baseUsuarios.filter((usuario) => usuario.email.toLowerCase().includes(consulta));
  if (!usuariosFiltrados.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="admin-users-empty">No se encontraron correos.</td></tr>';
    return;
  }

  tbody.innerHTML = usuariosFiltrados.map(u => {
    const esRaiz = u.email.toLowerCase() === adminEmailPredeterminado.toLowerCase();
    const email = escaparHtmlUI(u.email);
    const userId = escaparHtmlUI(u.user_id);
    const perfil = esRaiz
      ? '<span class="admin-user-protected">Administrador principal</span>'
      : `<select class="form-input admin-user-role" aria-label="Perfil de ${email}">
          <option value="editor" ${u.rol === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="juridico" ${u.rol === 'juridico' ? 'selected' : ''}>Jurídico</option>
          <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>`;
    const acciones = esRaiz
      ? '<span class="admin-user-protected">Protegido</span>'
      : `<div class="admin-user-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="save-role" data-user-id="${userId}">Guardar perfil</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-user" data-user-id="${userId}">Eliminar</button>
        </div>`;
    return '<tr>' +
      '<td>' + email + '</td>' +
      '<td>' + perfil + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-action="save-role"]').forEach((button) => {
    button.addEventListener('click', () => {
      const select = button.closest('tr').querySelector('.admin-user-role');
      if (select) guardarPerfilUsuario(button.dataset.userId, select.value);
    });
  });
  tbody.querySelectorAll('[data-action="delete-user"]').forEach((button) => {
    button.addEventListener('click', () => eliminarUsuarioRol(button.dataset.userId));
  });
}

// Switcher de Pestañas
function switchTab(tabId, evt) {
  if (tabId === 'envio-juridica' && !(usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'juridico')) {
    alert("Acceso restringido: Esta pestaña solo está habilitada para personal de Envío Jurídico o Administradores.");
    return;
  }
  if (tabId === 'admin-usuarios' && usuarioSesion.rol !== 'admin') {
    alert("Acceso restringido a administradores.");
    return;
  }

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));

  const targetBtn = (evt && evt.currentTarget)
    ? evt.currentTarget
    : (window.event ? window.event.currentTarget : document.querySelector(`.nav-btn[data-tab="${tabId}"]`));
  if (targetBtn && targetBtn.classList) {
    targetBtn.classList.add('active');
  }
  
  const activeSection = document.getElementById(`sec-${tabId}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  if (tabId === 'tablero') {
    renderTablero();
  }
  if (tabId === 'matricula') {
    cargarPortafolioMatricula();
  }
  if (tabId === 'admin-usuarios') {
    cargarUsuariosAutorizados();
  }
}

async function cargarPortafolioMatricula() {
  const estado = document.getElementById("matricula-pdf-status");
  if (!window.pdfjsLib) {
    if (estado) estado.textContent = "No se pudo cargar el visor PDF. Abre el archivo original con el botón superior.";
    return;
  }

  if (!matriculaPdfPromesa) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
    matriculaPdfPromesa = pdfjsLib.getDocument({
      url: "./Portafolio%20de%20Servicios%202026%20V2%20(Dic%202025)%20(1).pdf"
    }).promise;
  }

  if (estado) estado.textContent = "Cargando portafolio...";
  try {
    matriculaPdfDocumento = await matriculaPdfPromesa;
    document.getElementById("matricula-pdf-total").textContent = matriculaPdfDocumento.numPages;
    await renderizarPaginaMatricula();
  } catch (error) {
    console.error("No se pudo cargar el portafolio PDF:", error);
    if (estado) estado.textContent = "No se pudo cargar el portafolio. Usa el botón Abrir PDF para verlo.";
  }
}

async function renderizarPaginaMatricula() {
  if (!matriculaPdfDocumento) return;

  const canvas = document.getElementById("matricula-pdf-canvas");
  const stage = document.getElementById("matricula-pdf-stage");
  const estado = document.getElementById("matricula-pdf-status");
  const pageLabel = document.getElementById("matricula-pdf-page");
  const zoomLabel = document.getElementById("matricula-pdf-zoom-level");
  const renderId = ++matriculaPdfRenderId;
  if (matriculaPdfTareaRender) matriculaPdfTareaRender.cancel();

  try {
    const pagina = await matriculaPdfDocumento.getPage(matriculaPdfPaginaActual);
    if (renderId !== matriculaPdfRenderId) return;

    const viewportBase = pagina.getViewport({ scale: 1 });
    const anchoDisponible = Math.max(240, stage.clientWidth - 40);
    const altoDisponible = Math.max(320, stage.clientHeight - 40);
    const escalaAjustada = Math.min(anchoDisponible / viewportBase.width, altoDisponible / viewportBase.height);
    const escala = escalaAjustada * matriculaPdfZoom;
    const viewport = pagina.getViewport({ scale: escala });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const contexto = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.style.display = "block";
    if (estado) estado.hidden = true;
    pageLabel.textContent = matriculaPdfPaginaActual;
    zoomLabel.textContent = `${Math.round(matriculaPdfZoom * 100)}%`;

    matriculaPdfTareaRender = pagina.render({
      canvasContext: contexto,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    await matriculaPdfTareaRender.promise;
    if (renderId === matriculaPdfRenderId) matriculaPdfTareaRender = null;
  } catch (error) {
    if (error.name === "RenderingCancelledException") return;
    console.error("No se pudo mostrar la página del portafolio:", error);
    if (estado) {
      estado.hidden = false;
      estado.textContent = "No se pudo mostrar esta página del portafolio.";
    }
  }
}

function cambiarPaginaMatricula(cambio) {
  if (!matriculaPdfDocumento) return;
  const siguiente = matriculaPdfPaginaActual + cambio;
  if (siguiente < 1 || siguiente > matriculaPdfDocumento.numPages) return;
  matriculaPdfPaginaActual = siguiente;
  const stage = document.getElementById("matricula-pdf-stage");
  if (stage) stage.scrollTo({ top: 0, left: 0 });
  renderizarPaginaMatricula();
}

function ajustarZoomMatricula(cambio) {
  matriculaPdfZoom = cambio === 0
    ? 1
    : Math.max(0.7, Math.min(2.5, matriculaPdfZoom + cambio * 0.2));
  renderizarPaginaMatricula();
}

function calcularANS(fechaIso, limiteHoras = 24) {
  if (!fechaIso) return { estaVencido: false, texto: "0 h", horasTranscurridas: 0 };
  
  const inicio = new Date(fechaIso);
  const me = new Date();
  const diffMs = me - inicio;
  const horas = Math.floor(diffMs / (1000 * 60 * 60));

  if (horas >= limiteHoras) {
    const horasExceso = horas - limiteHoras;
    return {
      estaVencido: true,
      horasTranscurridas: horas,
      texto: `Vencido hace ${horasExceso} h (Límite: ${limiteHoras}h)`
    };
  } else {
    const horasRestantes = limiteHoras - horas;
    return {
      estaVencido: false,
      horasTranscurridas: horas,
      texto: `${horas}h / ${limiteHoras}h (${horasRestantes}h restantes)`
    };
  }
}

function limiteAnsPorEtapa(etapaNumero) {
  return ANS_HORAS_POR_ETAPA[etapaNumero] || 24;
}

function poblarFiltroResponsables() {
  const responsables = Array.from(new Set(conveniosData.map(c => c.responsable).filter(Boolean)));
  const select = document.getElementById("filter-tablero-responsable");
  if (!select) return;
  const valorActual = select.value;
  select.replaceChildren(new Option("Todos los responsables", ""));
  responsables.forEach((responsable) => select.add(new Option(responsable, responsable)));
  if (responsables.includes(valorActual)) select.value = valorActual;
}

function fechaEtapaLocal(fechaIso) {
  if (!fechaIso) return "";
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return "";
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function filtrarListaConvenios(data, { responsableId, busquedaId, desdeId, hastaId, buscarCodigo }) {
  const responsable = document.getElementById(responsableId)?.value || "";
  const consulta = document.getElementById(busquedaId)?.value.toLowerCase().trim() || "";
  const desde = document.getElementById(desdeId)?.value || "";
  const hasta = document.getElementById(hastaId)?.value || "";

  return data.filter((convenio) => {
    const fecha = fechaEtapaLocal(convenio.fechaEtapa);
    const coincideResponsable = !responsable || convenio.responsable === responsable;
    const textoBusqueda = [convenio.entidad, convenio.nit, buscarCodigo ? convenio.id : ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const coincideBusqueda = !consulta || textoBusqueda.includes(consulta);
    const coincideFecha = (!desde || (fecha && fecha >= desde)) && (!hasta || (fecha && fecha <= hasta));
    return coincideResponsable && coincideBusqueda && coincideFecha;
  });
}

function renderTablero() {
  const filtrados = filtrarListaConvenios(conveniosData, {
    responsableId: "filter-tablero-responsable",
    busquedaId: "search-convenios",
    desdeId: "filter-tablero-desde",
    hastaId: "filter-tablero-hasta",
    buscarCodigo: true
  });

  for (let etapaNumero = 1; etapaNumero <= 5; etapaNumero++) {
    const contador = document.getElementById(`kpi-etapa-${etapaNumero}`);
    if (contador) contador.textContent = conveniosData.filter((convenio) => Number(convenio.etapaNumero) === etapaNumero).length;
  }

  const totalAnsVencido = conveniosData.filter(c => {
    return calcularANS(c.fechaEtapa, limiteAnsPorEtapa(Number(c.etapaNumero) || 1)).estaVencido;
  }).length;

  const kpiVencidos = document.getElementById("kpi-ans-vencido");

  if (kpiVencidos) kpiVencidos.textContent = totalAnsVencido;

  const tbody = document.getElementById("tbl-convenios-body");
  if (!tbody) return;

  if (filtrados.length === 0) {
    const mensaje = errorCargaConvenios || (conveniosData.length ? "No se encontraron convenios con esos filtros." : "Aún no hay convenios registrados.");
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${escaparHtmlUI(mensaje)}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map((conv, index) => {
    const numEtapa = conv.etapaNumero || 1;
    const limiteAns = limiteAnsPorEtapa(numEtapa);
    const ansInfo = calcularANS(conv.fechaEtapa, limiteAns);
    const badgeAnsClass = ansInfo.estaVencido ? 'badge-inactiva' : 'badge-activa';
    const fechaFormatted = conv.fechaEtapa ? new Date(conv.fechaEtapa).toLocaleDateString('es-CO') : 'N/A';
    const nomEtapa = conv.etapaNombre || ETAPAS_NOMBRES[numEtapa];

    return '<tr class="dashboard-convenio-row" data-convenio-index="' + index + '" tabindex="0">' +
      '<td><strong>' + conv.id + '</strong></td>' +
      '<td>' + conv.entidad + '</td>' +
      '<td>' + (conv.nit || 'N/A') + '</td>' +
      '<td><strong>' + numEtapa + '/5</strong> - ' + nomEtapa + '</td>' +
      '<td>' + (conv.responsable || 'Sin asignar') + '</td>' +
      '<td>' + fechaFormatted + '</td>' +
      '<td><span class="badge ' + badgeAnsClass + '">' + ansInfo.texto + '</span></td>' +
    '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-convenio-index]').forEach((row) => {
    const abrirDetalle = () => {
      const convenio = filtrados[Number(row.dataset.convenioIndex)];
      if (convenio) verDetalleModal(convenio.id);
    };
    row.addEventListener('click', abrirDetalle);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        abrirDetalle();
      }
    });
  });
}

async function cargarConveniosGuardados() {
  try {
    const respuesta = await fetch("/api/convenios", {
      headers: { Authorization: `Bearer ${usuarioSesion.accessToken}` }
    });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok || !Array.isArray(json.convenios)) {
      throw new Error(json.error || "No se pudieron cargar los convenios guardados.");
    }
    conveniosData = json.convenios.map((convenio) => ({
      ...convenio,
      etapaNumero: Number(convenio.etapaNumero) || 1,
      etapaNombre: ETAPAS_NOMBRES[Number(convenio.etapaNumero) || 1],
      etapa: convenio.estado || "Solicitud"
    }));
    errorCargaConvenios = "";
  } catch (error) {
    conveniosData = [];
    errorCargaConvenios = error.message || "No se pudieron cargar los convenios desde Supabase.";
  }
  poblarFiltroResponsables();
  renderTablero();
  poblarSelectConveniosPaso2();
}

function filterConvenios() {
  renderTablero();
}

function toggleTipoEmpresa(tipo) {
  modoEmpresaActual = tipo;
  const btnRegistrada = document.getElementById("btn-tipo-registrada");
  const btnNueva = document.getElementById("btn-tipo-nueva");
  const containerRegistrada = document.getElementById("container-empresa-registrada");
  const containerNueva = document.getElementById("container-empresa-nueva");
  const sectionDoc = document.getElementById("section-documentacion");

  if (!containerRegistrada || !containerNueva || !sectionDoc) return;

  if (tipo === 'registrada') {
    btnRegistrada.classList.add('active');
    btnNueva.classList.remove('active');
    containerRegistrada.style.display = "block";
    containerNueva.style.display = "none";
    sectionDoc.style.display = "none";
  } else {
    btnNueva.classList.add('active');
    btnRegistrada.classList.remove('active');
    containerRegistrada.style.display = "none";
    containerNueva.style.display = "block";
    sectionDoc.style.display = "block";
  }
}

function actualizarSelectEmpresas() {
  const select = document.getElementById("select-empresa-registrada");
  if (!select) return;

  if (empresasRegistradasData.length === 0) {
    select.innerHTML = '<option value="">Selecciona empresa (No hay registros aún)</option>';
  } else {
    let options = '<option value="">Selecciona empresa</option>';
    options += empresasRegistradasData.map(emp => 
      '<option value="' + emp.razonSocial + '">' + emp.razonSocial + ' - ' + emp.ciudad + '</option>'
    ).join('');
    select.innerHTML = options;
  }
}

function alSeleccionarEmpresaRegistrada(razonSocial) {
  const empObj = empresasRegistradasData.find(e => e.razonSocial === razonSocial);
  const inputInterventor = document.getElementById("reg-empresa-interventor");
  const inputRegional = document.getElementById("reg-empresa-unidad-regional");
  const panelDocumentos = document.getElementById("editor-documentos-empresa");
  const selectorDocumento = document.getElementById("documento-empresa-editar");

  if (empObj) {
    if (inputInterventor) inputInterventor.value = empObj.interventor || "";
    if (inputRegional) inputRegional.value = empObj.unidadRegional || "";
    if (panelDocumentos) panelDocumentos.style.display = "block";
  } else {
    if (inputInterventor) inputInterventor.value = "";
    if (inputRegional) inputRegional.value = "";
    if (panelDocumentos) panelDocumentos.style.display = "none";
  }
  if (selectorDocumento) selectorDocumento.value = "";
  seleccionarDocumentoEdicion();
}

function inicializarEditorDocumentos() {
  const selector = document.getElementById("documento-empresa-editar");
  if (!selector) return;
  selector.innerHTML = '<option value="">Seleccione un documento</option>' + DOCUMENTOS_EXPEDIENTE
    .map((documento) => `<option value="${documento.campo}">${documento.etiqueta}</option>`)
    .join("");
}

function seleccionarDocumentoEdicion() {
  lecturaCamaraEdicionId++;
  const campo = valorDe("documento-empresa-editar");
  const esCamara = campo === "camara";
  const inputArchivo = document.getElementById("archivo-empresa-editar");
  const datosCamara = document.getElementById("datos-camara-edicion");
  const estado = document.getElementById("estado-camara-edicion");
  const razonSocial = valorDe("select-empresa-registrada");
  const empresa = empresasRegistradasData.find((item) => item.razonSocial === razonSocial);
  const datos = empresa && empresa.camara ? empresa.camara.datos || {} : {};

  if (inputArchivo) {
    inputArchivo.value = "";
    inputArchivo.accept = esCamara ? "application/pdf,.pdf" : "";
  }
  if (datosCamara) datosCamara.style.display = esCamara ? "block" : "none";
  if (estado) {
    estado.textContent = "";
    estado.style.display = "none";
  }
  ponerValor("edicion-cam-razon-social", esCamara ? datos.razonSocial : "");
  ponerValor("edicion-cam-nit", esCamara ? datos.nit || (empresa && empresa.nit) : "");
  ponerValor("edicion-cam-representante", esCamara ? datos.representanteLegal : "");
  ponerValor("edicion-cam-cedula", esCamara ? datos.cedula : "");
  ponerValor("edicion-cam-tipo-empresa", esCamara ? datos.tipoEmpresa || "Privada" : "Privada");
}

async function analizarCamaraEdicion(input) {
  if (valorDe("documento-empresa-editar") !== "camara" || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const estado = document.getElementById("estado-camara-edicion");
  const bloque = document.getElementById("datos-camara-edicion");
  const miLectura = ++lecturaCamaraEdicionId;

  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    input.value = "";
    if (estado) {
      estado.textContent = "La Cámara de Comercio debe ser un archivo PDF.";
      estado.style.display = "block";
      estado.className = "form-hint form-hint-error";
    }
    return;
  }

  if (bloque) bloque.style.display = "block";
  if (estado) {
    estado.textContent = "Leyendo la Cámara de Comercio...";
    estado.style.display = "block";
    estado.className = "form-hint";
  }

  try {
    const json = await solicitarDatosCamara(file);
    if (miLectura !== lecturaCamaraEdicionId) return;
    if (!json.datos) {
      if (estado) {
        estado.textContent = json.aviso || "No se pudieron leer los datos. Complételos manualmente.";
        estado.className = "form-hint form-hint-error";
      }
      return;
    }
    ponerValor("edicion-cam-razon-social", json.datos.razonSocial);
    ponerValor("edicion-cam-nit", json.datos.nit);
    ponerValor("edicion-cam-representante", json.datos.representanteLegal);
    ponerValor("edicion-cam-cedula", json.datos.cedula);
    ponerValor("edicion-cam-tipo-empresa", json.datos.tipoEmpresa || "Privada");
    if (estado) {
      estado.textContent = "Datos leídos de la Cámara. Revísalos antes de guardar.";
      estado.className = "form-hint";
    }
  } catch (err) {
    if (miLectura !== lecturaCamaraEdicionId) return;
    if (estado) {
      estado.textContent = err.message || "No se pudo leer el PDF. Complételos manualmente.";
      estado.className = "form-hint form-hint-error";
    }
  }
}

async function actualizarDocumentoEmpresa() {
  const razonSocial = valorDe("select-empresa-registrada");
  const empresa = empresasRegistradasData.find((item) => item.razonSocial === razonSocial);
  const campo = valorDe("documento-empresa-editar");
  const inputArchivo = document.getElementById("archivo-empresa-editar");
  const archivo = inputArchivo && inputArchivo.files ? inputArchivo.files[0] : null;
  const boton = document.querySelector("#editor-documentos-empresa button");

  if (!empresa) {
    alert("Seleccione una empresa registrada.");
    return;
  }
  if (!campo || !archivo) {
    alert("Seleccione el documento y adjunte el nuevo archivo.");
    return;
  }

  let datosCamara;
  if (campo === "camara") {
    datosCamara = {
      razonSocial: valorDe("edicion-cam-razon-social"),
      nit: valorDe("edicion-cam-nit"),
      representanteLegal: valorDe("edicion-cam-representante"),
      cedula: valorDe("edicion-cam-cedula"),
      tipoEmpresa: valorDe("edicion-cam-tipo-empresa") || "Privada"
    };
    if (!datosCamara.razonSocial || !datosCamara.nit || !datosCamara.representanteLegal || !datosCamara.cedula) {
      alert("Revise y complete los datos extraídos de la Cámara de Comercio.");
      return;
    }
    if (datosCamara.nit.replace(/\D/g, "") !== String(empresa.nit || "").replace(/\D/g, "")) {
      alert("El NIT de la Cámara debe coincidir con el NIT de la empresa seleccionada.");
      return;
    }
  }

  const datosDocumento = DOCUMENTOS_EXPEDIENTE.find((documento) => documento.campo === campo);
  const formData = new FormData();
  formData.append("nit", empresa.nit);
  formData.append(campo, archivo, archivo.name);
  if (datosCamara) formData.append("datosCamara", JSON.stringify(datosCamara));

  const textoOriginal = boton ? boton.textContent : "";
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Guardando...";
  }
  try {
    const respuesta = await fetch("/api/empresas/documentos", { method: "POST", body: formData });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok) throw new Error(json.error || "No se pudo actualizar el documento.");

    empresa.documentos = json.documentos || empresa.documentos;
    if (datosCamara && json.camara) empresa.camara = json.camara;
    if (json.razonSocial && json.razonSocial !== empresa.razonSocial) {
      empresa.razonSocial = json.razonSocial;
      actualizarSelectEmpresas();
      ponerValor("select-empresa-registrada", empresa.razonSocial);
    }
    inputArchivo.value = "";
    alert(`${datosDocumento.etiqueta} actualizado correctamente para ${empresa.razonSocial}.`);
  } catch (err) {
    alert(err.message || "No se pudo actualizar el documento.");
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

function valorDe(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function ponerValor(id, valor) {
  const el = document.getElementById(id);
  if (el) el.value = valor || "";
}

function leerDatosCamaraFormulario() {
  return {
    razonSocial: valorDe("cam-razon-social"),
    nit: valorDe("cam-nit"),
    representanteLegal: valorDe("cam-representante"),
    cedula: valorDe("cam-cedula"),
    tipoEmpresa: valorDe("cam-tipo-empresa") || "Privada"
  };
}

function mostrarEstadoCamara(mensaje, esError) {
  const estado = document.getElementById("camara-estado");
  if (!estado) return;
  estado.textContent = mensaje;
  estado.className = "form-hint" + (esError ? " form-hint-error" : "");
  estado.style.display = mensaje ? "block" : "none";
}

function limpiarCamara() {
  lecturaCamaraId++;
  ["cam-razon-social", "cam-nit", "cam-representante", "cam-cedula"].forEach(id => ponerValor(id, ""));
  ponerValor("cam-tipo-empresa", "Privada");
  const bloque = document.getElementById("camara-datos");
  if (bloque) bloque.style.display = "none";
  mostrarEstadoCamara("", false);
}

async function analizarCamara(input) {
  if (!input.files || input.files.length === 0) {
    limpiarCamara();
    return;
  }

  const miLectura = ++lecturaCamaraId;
  const bloque = document.getElementById("camara-datos");
  if (bloque) bloque.style.display = "block";
  mostrarEstadoCamara("Leyendo la Cámara de Comercio...", false);

  try {
    const json = await solicitarDatosCamara(input.files[0]);
    if (miLectura !== lecturaCamaraId) return;

    if (!resp.ok) throw new Error(json.error || "No se pudo leer el archivo.");

    if (!json.datos) {
      mostrarEstadoCamara(json.aviso || "No se pudieron leer los datos. Complételos manualmente.", true);
      return;
    }

    const d = json.datos;
    ponerValor("cam-razon-social", d.razonSocial);
    ponerValor("cam-nit", d.nit);
    ponerValor("cam-representante", d.representanteLegal);
    ponerValor("cam-cedula", d.cedula);
    ponerValor("cam-tipo-empresa", d.tipoEmpresa || "Privada");

    if (!valorDe("empresa-razon-social") && d.razonSocial) ponerValor("empresa-razon-social", d.razonSocial);
    if (!valorDe("empresa-nit") && d.nit) ponerValor("empresa-nit", d.nit);

    mostrarEstadoCamara("Datos leídos de la Cámara correctamente.", false);
  } catch (err) {
    if (miLectura !== lecturaCamaraId) return;
    mostrarEstadoCamara("Complete los datos manualmente.", true);
  }
}

async function solicitarDatosCamara(file) {
  const fd = new FormData();
  fd.append("camara", file);
  const resp = await fetch("/api/camara/analizar", { method: "POST", body: fd });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || "No se pudo leer el archivo.");
  return json;
}

function descargarFormatoInhabilidades() {
  const link = document.createElement("a");
  const fileName = "Formato de inhabilidades.xlsx";
  link.href = "./" + encodeURIComponent(fileName);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function descargarCodigoEtica() {
  const link = document.createElement("a");
  const fileName = "Aceptacion Codigo etica.xlsx";
  link.href = "./" + encodeURIComponent(fileName);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function descargarTratamientoDatos() {
  const link = document.createElement("a");
  const fileName = "Autorización tratamiento de datos.xlsx";
  link.href = "./" + encodeURIComponent(fileName);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function descargarManualContratacion() {
  const link = document.createElement("a");
  const fileName = "Formato de aceptación Manual.xlsx";
  link.href = "./" + encodeURIComponent(fileName);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function validarCheckAdjunto(inputEl, checkId) {
  const chk = document.getElementById(checkId);
  if (chk) {
    chk.checked = inputEl.files && inputEl.files.length > 0;
  }
}

function archivoDeInput(id) {
  const el = document.getElementById(id);
  return el && el.files && el.files[0] ? el.files[0] : null;
}

function recolectarExpedienteDelFormulario() {
  const archivos = {};
  const faltantes = [];
  DOCUMENTOS_EXPEDIENTE.forEach((doc) => {
    const file = archivoDeInput(doc.id);
    if (file) archivos[doc.campo] = file;
    else faltantes.push(doc.etiqueta);
  });
  return { archivos, faltantes };
}

async function guardarExpedienteEnSupabase(empresa, archivos) {
  const token = usuarioSesion.accessToken;
  if (!token) throw new Error("Inicie sesión antes de cargar el expediente.");

  const respuestaConfig = await fetch("/api/config/supabase");
  const config = await respuestaConfig.json().catch(() => ({}));
  if (!respuestaConfig.ok || !config.url || !config.anonKey || !config.bucket) {
    throw new Error(config.error || "No se pudo obtener la configuración de almacenamiento.");
  }

  const nit = String(empresa.nit || "").replace(/\D/g, "");
  const documentos = [];
  for (const documento of DOCUMENTOS_EXPEDIENTE) {
    const archivo = archivos[documento.campo];
    if (!archivo) continue;

    const nombreSeguro = archivo.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180);
    const storagePath = `expedientes/${nit}/${documento.campo}__${nombreSeguro}`;
    const rutaCodificada = storagePath.split("/").map(encodeURIComponent).join("/");
    const respuestaArchivo = await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${rutaCodificada}`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": archivo.type || "application/octet-stream",
        "x-upsert": "true"
      },
      body: archivo
    });
    if (!respuestaArchivo.ok) {
      const detalle = await respuestaArchivo.text();
      throw new Error(`No se pudo subir ${documento.etiqueta} a Supabase${detalle ? `: ${detalle}` : "."}`);
    }
    documentos.push({
      campo: documento.campo,
      storagePath,
      originalname: archivo.name,
      mimetype: archivo.type || "application/octet-stream",
      sizeBytes: archivo.size
    });
  }

  const respuestaRegistro = await fetch("/api/empresas/expediente", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ empresa, documentos })
  });
  const resultado = await respuestaRegistro.json().catch(() => ({}));
  if (!respuestaRegistro.ok || !resultado.ok) {
    throw new Error(resultado.error || "Supabase no confirmó el guardado del expediente.");
  }
  return resultado;
}

function nombresExpediente(archivos, documentosGuardados) {
  if (archivos && Object.keys(archivos).length) {
    return DOCUMENTOS_EXPEDIENTE
      .filter((doc) => archivos[doc.campo])
      .map((doc) => doc.etiqueta + " (" + archivos[doc.campo].name + ")");
  }
  if (Array.isArray(documentosGuardados) && documentosGuardados.length) {
    return documentosGuardados.slice();
  }
  return DOCUMENTOS_EXPEDIENTE.map((d) => d.etiqueta);
}

async function cargarEmpresasGuardadas() {
  try {
    const resp = await fetch("/api/empresas");
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !Array.isArray(json.empresas)) return;

    json.empresas.forEach((emp) => {
      const existente = empresasRegistradasData.find((e) =>
        (e.nit && emp.nit && e.nit === emp.nit) || e.razonSocial === emp.razonSocial
      );
      if (existente) {
        existente.documentos = emp.documentos || existente.documentos;
        if (!existente.camara && emp.camara) existente.camara = emp.camara;
        if (!existente.interventor && emp.interventor) existente.interventor = emp.interventor;
      } else {
        empresasRegistradasData.push(emp);
      }
    });
    actualizarSelectEmpresas();
  } catch (err) {
    console.warn("No se pudieron cargar empresas guardadas:", err);
  }
}

function eliminarConvenio(id) {
  if (!(usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor')) {
    alert("Permisos insuficientes para realizar la eliminación de convenios.");
    return;
  }

  if (confirm("¿Está seguro de que desea eliminar el convenio " + id + "?")) {
    conveniosData = conveniosData.filter(c => c.id !== id);
    closeModal("modal-detalle-convenio");
    poblarFiltroResponsables();
    renderTablero();
    poblarSelectConveniosPaso2();
  }
}

async function guardarConvenio(e) {
  e.preventDefault();

  const btnSubmit = e.target.querySelector('button[type="submit"]');

  let razonSocial = "";
  let nit = "";
  let ciudad = "";
  let unidadRegional = "";
  let nombreContacto = "";
  let correoEmpresa = "";
  let interventor = "";
  let camara = null;
  let empresaNueva = null;
  let empObjRegistrada = null;

  if (modoEmpresaActual === 'nueva') {
    razonSocial = valorDe("empresa-razon-social");
    nit = valorDe("empresa-nit");
    ciudad = valorDe("empresa-ciudad");
    unidadRegional = valorDe("empresa-unidad-regional");
    correoEmpresa = valorDe("empresa-correo");
    nombreContacto = valorDe("empresa-nombre-contacto");
    interventor = valorDe("empresa-interventor");

    if (!razonSocial || !nit || !ciudad || !correoEmpresa || !unidadRegional || !interventor || !nombreContacto) {
      alert("Por favor complete todos los campos obligatorios de la empresa.");
      return;
    }

    const datosCamara = leerDatosCamaraFormulario();
    const fileCamara = document.getElementById("file-camara");
    camara = { file: fileCamara ? fileCamara.files[0] : null, datos: datosCamara };
    empresaNueva = { razonSocial, nit, ciudad, unidadRegional, correo: correoEmpresa, nombreContacto, interventor, camara };

  } else {
    const select = document.getElementById("select-empresa-registrada");
    razonSocial = select.value;

    if (!razonSocial) {
      alert("Por favor seleccione una empresa.");
      return;
    }

    const empObj = empresasRegistradasData.find(e => e.razonSocial === razonSocial);
    interventor = valorDe("reg-empresa-interventor");
    nit = empObj ? empObj.nit : "";
    ciudad = empObj ? empObj.ciudad : "";
    unidadRegional = valorDe("reg-empresa-unidad-regional") || (empObj ? empObj.unidadRegional : "");
    nombreContacto = empObj ? empObj.nombreContacto : "";
    correoEmpresa = empObj ? empObj.correo : "";
    camara = empObj ? empObj.camara : null;
    empObjRegistrada = empObj || null;
  }

  const responsable = document.getElementById("convenio-responsable").value || "Administrador";
  const notas = document.getElementById("convenio-notas").value;

  // ==========================================
  // ENVÍO DEL CORREO (HOJA DE RUTA) CON TODOS LOS ADJUNTOS
  // - Empresa nueva: se envían los archivos cargados en el formulario.
  // - Empresa registrada: no se envían archivos; el servidor busca los
  //   que se guardaron cuando la empresa se registró por primera vez.
  // ==========================================
  let expediente = { archivos: {}, faltantes: [] };
  if (modoEmpresaActual === 'nueva') {
    expediente = recolectarExpedienteDelFormulario();
    if (expediente.faltantes.length > 0) {
      const seguir = confirm(
        "Faltan documentos del expediente:\n\n- " + expediente.faltantes.join("\n- ") +
        "\n\n¿Desea registrar el convenio de todas formas?"
      );
      if (!seguir) return;
    }
  }

  const dc = (camara && camara.datos) ? camara.datos : {};
  const datosCorreo = {
    razonSocial: dc.razonSocial || razonSocial,
    nit: nit || dc.nit,
    representanteLegal: dc.representanteLegal || "",
    cedula: dc.cedula || "",
    tipoEmpresa: dc.tipoEmpresa || "Privada",
    interventor: interventor
  };

  const textoBtnOriginal = btnSubmit ? btnSubmit.textContent : "";
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = modoEmpresaActual === "nueva" ? "Guardando documentos..." : "Enviando correo...";
  }

  if (modoEmpresaActual === "nueva") {
    try {
      await guardarExpedienteEnSupabase({
        razonSocial,
        nit,
        ciudad,
        unidadRegional,
        correo: correoEmpresa,
        nombreContacto,
        numeroContacto: valorDe("empresa-num-contacto"),
        interventor,
        camara: camara && camara.datos ? { datos: camara.datos } : {}
      }, expediente.archivos);
    } catch (error) {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = textoBtnOriginal;
      }
      alert("No se pudo guardar el expediente en Supabase; no se enviará el correo ni se creará el convenio.\n\n" + (error.message || "Error guardando documentos."));
      return;
    }
  }

  let resultadoCorreo = { ok: false };
  try {
    if (btnSubmit) btnSubmit.textContent = "Enviando correo...";
    const resp = await fetch("/api/convenios/notificar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${usuarioSesion.accessToken}`
      },
      body: JSON.stringify({
        datos: datosCorreo,
        modoEmpresa: modoEmpresaActual,
        nit: datosCorreo.nit
      })
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok || json.warning) throw new Error(json.error || json.warning || "No se pudo enviar el correo.");
    resultadoCorreo = json;
  } catch (err) {
    resultadoCorreo = {
      ok: false,
      warning: err.message || "No se pudo enviar el correo."
    };
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = textoBtnOriginal;
    }
  }

  if (!resultadoCorreo.ok) {
    alert("No se registró el convenio porque el correo no pudo enviarse.\n\n" + resultadoCorreo.warning);
    return;
  }

  const adjuntos = modoEmpresaActual === 'nueva'
    ? nombresExpediente(expediente.archivos)
    : nombresExpediente(null, empObjRegistrada ? empObjRegistrada.documentos : null);

  let newId;
  try {
    const respuesta = await fetch("/api/convenios", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${usuarioSesion.accessToken}`
      },
      body: JSON.stringify({
        razonSocial,
        nit,
        ciudad,
        unidadRegional,
        correo: correoEmpresa,
        contacto: nombreContacto,
        interventor,
        camara: camara && camara.datos ? { datos: camara.datos } : {},
        responsable,
        notas
      })
    });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok || !json.id) {
      throw new Error(json.error || "Supabase no confirmó el guardado del convenio.");
    }
    newId = json.id;
  } catch (err) {
    alert("El correo sí fue enviado, pero el convenio no se pudo guardar en Supabase. No aparecerá en el tablero hasta que se resuelva este error.\n\n" + (err.message || "Error guardando el convenio."));
    return;
  }

  if (empresaNueva) {
    empresaNueva.documentos = adjuntos.slice();
    empresasRegistradasData.push(empresaNueva);
    actualizarSelectEmpresas();
  }

  const ahoraIso = new Date().toISOString();

  conveniosData.unshift({
    id: newId,
    entidad: razonSocial,
    nit: nit,
    ciudad: ciudad,
    unidadRegional: unidadRegional,
    contacto: nombreContacto,
    correo: correoEmpresa,
    interventor: interventor,
    representanteLegal: (camara && camara.datos) ? camara.datos.representanteLegal : 'N/A',
    tipoEmpresa: (camara && camara.datos) ? camara.datos.tipoEmpresa : 'Privada',
    etapaNumero: 1,
    etapaNombre: ETAPAS_NOMBRES[1],
    etapa: "Solicitud",
    estado: "Activa",
    fechaEtapa: ahoraIso,
    responsable: responsable,
    notas: notas,
    adjuntos: adjuntos
  });

  let mensajeOk = "Convenio " + newId + " registrado en Supabase y en el Paso 1.\n\n";
  mensajeOk += "Correo enviado a " + resultadoCorreo.enviadoA + " con " + adjuntos.length + " archivo(s) adjunto(s).";
  if (resultadoCorreo && resultadoCorreo.modoPrueba) mensajeOk += "\n(Modo prueba: no llegó a los destinatarios reales.)";
  alert(mensajeOk);

  poblarFiltroResponsables();
  renderTablero();
  poblarSelectConveniosPaso2();
  closeModal('modal-nuevo-convenio');

  e.target.reset();
  limpiarCamara();
  toggleTipoEmpresa('registrada');
}

function poblarSelectConveniosPaso2() {
  const select = document.getElementById("paso2-select-convenio");
  if (!select) return;

  const conveniosPaso1 = conveniosData.filter(c => c.etapaNumero === 1);

  if (conveniosPaso1.length === 0) {
    select.innerHTML = '<option value="">No hay convenios en Paso 1 pendientes por enviar</option>';
  } else {
    let options = '<option value="">Seleccione un convenio para enviar a jurídica...</option>';
    options += conveniosPaso1.map(c => `<option value="${c.id}">${c.id} - ${c.entidad}</option>`).join('');
    select.innerHTML = options;
  }
}

async function procesarEnvioPaso2(e) {
  e.preventDefault();

  if (!(usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'juridico')) {
    alert("Error de Permisos: Su usuario no posee autorización para realizar envíos a Jurídica.");
    return;
  }

  const idConvenio = document.getElementById("paso2-select-convenio").value;
  const correoDestino = document.getElementById("paso2-correo-destino").value;
  const asunto = document.getElementById("paso2-asunto").value;
  const mensaje = document.getElementById("paso2-mensaje").value;
  const file1 = document.getElementById("paso2-file-1").files[0];
  const file2 = document.getElementById("paso2-file-2").files[0];
  const boton = e.target.querySelector('button[type="submit"]');

  if (!idConvenio) {
    alert("Por favor seleccione un convenio.");
    return;
  }

  if (!file1 || !file2) {
    alert("Debe adjuntar obligatoriamente los 2 archivos requeridos para avanzar al Paso 2.");
    return;
  }

  const conv = conveniosData.find(c => c.id === idConvenio);
  if (!conv) return;

  const formData = new FormData();
  formData.append("idConvenio", idConvenio);
  formData.append("entidad", conv.entidad || "");
  formData.append("nit", conv.nit || "");
  formData.append("correoDestino", correoDestino);
  formData.append("asunto", asunto);
  formData.append("mensaje", mensaje);
  formData.append("archivo1", file1, file1.name);
  formData.append("archivo2", file2, file2.name);

  const contenidoOriginal = boton ? boton.innerHTML : "";
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Enviando correo...";
  }

  try {
    const respuesta = await fetch("/api/convenios/enviar-juridica", { method: "POST", body: formData });
    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !json.ok) throw new Error(json.error || "No se pudo enviar el correo a Jurídica.");

    conv.etapaNumero = 2;
    conv.etapaNombre = ETAPAS_NOMBRES[2];
    conv.etapa = ETAPAS_NOMBRES[2];
    conv.estado = "Revision";
    conv.fechaEtapa = new Date().toISOString();
    conv.notas = `Correo enviado a ${json.enviadoA}. Asunto: ${asunto}. Mensaje: ${mensaje || 'Sin detalles'}. Adjuntos enviados: ${file1.name}, ${file2.name}`;
    conv.adjuntos = conv.adjuntos || [];
    if (!conv.adjuntos.includes(file1.name)) conv.adjuntos.push(file1.name);
    if (!conv.adjuntos.includes(file2.name)) conv.adjuntos.push(file2.name);

    let confirmacion = `El servidor SMTP aceptó el correo para ${json.enviadoA}.\n\nEl convenio ${conv.id} pasó a la Etapa 2: ${ETAPAS_NOMBRES[2]} (ANS: 36 horas).`;
    if (json.modoPrueba) confirmacion += `\n\nModo prueba activo: no se envió al correo indicado en el formulario (${correoDestino}).`;
    alert(confirmacion);

    renderTablero();
    poblarSelectConveniosPaso2();
    e.target.reset();
  } catch (err) {
    alert(`No se pudo enviar el correo a Jurídica. El convenio no avanzó de etapa.\n\n${err.message}`);
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.innerHTML = contenidoOriginal;
      if (window.lucide) lucide.createIcons();
    }
  }
}

function avanzarEtapaConvenio(id) {
  const conv = conveniosData.find(c => c.id === id);
  if (!conv) return;
  const etapaActual = Number(conv.etapaNumero) || 1;
  if (etapaActual < 2) {
    alert("La etapa 2 solo se inicia enviando la minuta y la hoja de ruta desde Envío Jurídico.");
    return;
  }
  const puedeAvanzar = usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor' ||
    (usuarioSesion.rol === 'juridico' && etapaActual === 2);
  if (!puedeAvanzar) {
    alert("No tiene permisos para modificar la etapa de los convenios.");
    return;
  }

  if (conv.etapaNumero < 5) {
    conv.etapaNumero += 1;
    conv.etapaNombre = ETAPAS_NOMBRES[conv.etapaNumero];
    conv.etapa = ETAPAS_NOMBRES[conv.etapaNumero];
    conv.fechaEtapa = new Date().toISOString();

    if (conv.etapaNumero === 5) {
      conv.etapa = 'Activo';
      conv.estado = 'Activa';
    }

    renderTablero();
    poblarSelectConveniosPaso2();
    verDetalleModal(id);
    alert(`Convenio ${id} avanzado con éxito a la Etapa ${conv.etapaNumero}: ${conv.etapaNombre}`);
  } else {
    alert(`El convenio ${id} ya ha finalizado todas las etapas del ciclo de vida.`);
  }
}

function verDetalleModal(id) {
  const conv = conveniosData.find(c => c.id === id);
  if (!conv) return;

  const content = document.getElementById("detalle-convenio-content");
  if (!content) return;

  const numEtapa = conv.etapaNumero || 1;
  const puedeEditarConvenio = usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor';
  const puedeAvanzar = numEtapa >= 2 && (usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor' ||
    (usuarioSesion.rol === 'juridico' && numEtapa === 2)) && numEtapa < 5;

  let timelineHtml = '<div class="timeline-container">';
  for (let i = 1; i <= 5; i++) {
    const isCompleted = i < numEtapa;
    const isCurrent = i === numEtapa;
    const statusClass = isCompleted ? 'completed' : (isCurrent ? 'active' : 'pending');
    
    timelineHtml += `
      <div class="timeline-step ${statusClass}">
        <div class="step-badge">${isCompleted ? '✓' : i}</div>
        <div class="step-label">${ETAPAS_NOMBRES[i]}</div>
      </div>
    `;
  }
  timelineHtml += '</div>';

  content.innerHTML = `
    <div style="margin-bottom: 1.5rem;">
      <h4 style="color: var(--comfenalco-green-dark); margin-bottom: 0.5rem;">Flujo de Progreso del Convenio</h4>
      ${timelineHtml}
    </div>
    
    <div class="form-grid-2" style="gap: 1rem; margin-bottom: 1rem;">
      <div><strong>Código Convenio:</strong> ${conv.id}</div>
      <div><strong>Razón Social:</strong> ${conv.entidad}</div>
      <div><strong>NIT:</strong> ${conv.nit || 'N/A'}</div>
      <div><strong>Ciudad / Regional:</strong> ${conv.ciudad || 'N/A'} - ${conv.unidadRegional || 'N/A'}</div>
      <div><strong>Contacto:</strong> ${conv.contacto || 'N/A'} (${conv.correo || 'N/A'})</div>
      <div><strong>Interventor:</strong> ${conv.interventor || 'N/A'}</div>
      <div><strong>Responsable Actual:</strong> ${conv.responsable}</div>
      <div><strong>Última Actualización:</strong> ${new Date(conv.fechaEtapa).toLocaleString('es-CO')}</div>
    </div>

    <div style="margin-top: 1rem;">
      <strong>Observaciones / Notas:</strong>
      <p style="background: #f9fafb; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); margin-top: 0.35rem;">
        ${conv.notas || 'Sin observaciones de gestión.'}
      </p>
    </div>

    <div style="margin-top: 1rem;">
      <strong>Documentos y Requisitos Registrados:</strong>
      <ul style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; padding-left: 1.25rem;">
        ${conv.adjuntos ? conv.adjuntos.map(a => `<li style="color: var(--comfenalco-green-dark); font-weight: 600;">${a}</li>`).join('') : '<li>Documentación estándar completa</li>'}
      </ul>
    </div>
    ${numEtapa === 1 ? '<p class="form-hint">Para iniciar la etapa 2, envía la minuta y la hoja de ruta desde Envío Jurídico.</p>' : ''}
    ${puedeAvanzar ? `<div style="display:flex;justify-content:flex-end;margin:1rem 0"><button type="button" id="btn-avanzar-etapa-detalle" class="btn btn-primary">Avanzar a etapa ${numEtapa + 1}</button></div>` : ''}
    ${puedeEditarConvenio ? `<div class="convenio-detail-actions">
      <button type="button" id="btn-editar-convenio-detalle" class="btn btn-secondary">Editar convenio</button>
      <button type="button" id="btn-eliminar-convenio-detalle" class="btn btn-danger">Eliminar convenio</button>
    </div>` : ''}
  `;

  const botonAvanzar = content.querySelector("#btn-avanzar-etapa-detalle");
  if (botonAvanzar) botonAvanzar.addEventListener("click", () => avanzarEtapaConvenio(id));
  const botonEditar = content.querySelector("#btn-editar-convenio-detalle");
  if (botonEditar) botonEditar.addEventListener("click", () => abrirEdicionConvenio(id));
  const botonEliminar = content.querySelector("#btn-eliminar-convenio-detalle");
  if (botonEliminar) botonEliminar.addEventListener("click", () => eliminarConvenio(id));

  openModal('modal-detalle-convenio');
}

function abrirEdicionConvenio(id) {
  if (!(usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor')) {
    alert("Permisos insuficientes para editar convenios.");
    return;
  }
  const convenio = conveniosData.find((item) => item.id === id);
  if (!convenio) return;

  convenioEnEdicionId = id;
  ponerValor("editar-convenio-razon-social", convenio.entidad);
  ponerValor("editar-convenio-nit", convenio.nit);
  ponerValor("editar-convenio-ciudad", convenio.ciudad);
  ponerValor("editar-convenio-regional", convenio.unidadRegional);
  ponerValor("editar-convenio-contacto", convenio.contacto);
  ponerValor("editar-convenio-correo", convenio.correo);
  ponerValor("editar-convenio-interventor", convenio.interventor);
  ponerValor("editar-convenio-responsable", convenio.responsable);
  ponerValor("editar-convenio-notas", convenio.notas);
  closeModal("modal-detalle-convenio");
  openModal("modal-editar-convenio");
}

function cancelarEdicionConvenio() {
  const id = convenioEnEdicionId;
  convenioEnEdicionId = "";
  closeModal("modal-editar-convenio");
  if (id) verDetalleModal(id);
}

function guardarEdicionConvenio(event) {
  event.preventDefault();
  if (!(usuarioSesion.rol === 'admin' || usuarioSesion.rol === 'editor')) {
    alert("Permisos insuficientes para editar convenios.");
    return;
  }
  const convenio = conveniosData.find((item) => item.id === convenioEnEdicionId);
  if (!convenio) return;

  const razonSocial = valorDe("editar-convenio-razon-social");
  const nit = valorDe("editar-convenio-nit");
  const ciudad = valorDe("editar-convenio-ciudad");
  const regional = valorDe("editar-convenio-regional");
  const contacto = valorDe("editar-convenio-contacto");
  const correo = valorDe("editar-convenio-correo");
  const interventor = valorDe("editar-convenio-interventor");
  const responsable = valorDe("editar-convenio-responsable");

  if (!razonSocial || !nit || !ciudad || !correo || !responsable) {
    alert("Complete razón social, NIT, ciudad, correo y responsable.");
    return;
  }

  Object.assign(convenio, {
    entidad: razonSocial,
    nit,
    ciudad,
    unidadRegional: regional,
    contacto,
    correo,
    interventor,
    responsable,
    notas: valorDe("editar-convenio-notas")
  });
  convenioEnEdicionId = "";
  closeModal("modal-editar-convenio");
  poblarFiltroResponsables();
  renderTablero();
  poblarSelectConveniosPaso2();
  verDetalleModal(convenio.id);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    if (window.lucide) {
      lucide.createIcons();
    }
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
  }
}