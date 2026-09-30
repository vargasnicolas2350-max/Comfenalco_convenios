function normalizarResultadoCorreo(json = {}, respuesta) {
  if (json && json.warning) {
    return {
      ok: true,
      warning: json.warning,
      enviadoA: json.enviadoA || '',
      modoPrueba: Boolean(json.modoPrueba),
      ...json
    };
  }

  if (respuesta && respuesta.ok && json && json.ok) {
    return { ...json, ok: true };
  }

  return {
    ok: false,
    warning: (json && (json.error || json.message)) || 'No se pudo enviar el correo.',
    ...json
  };
}

module.exports = { normalizarResultadoCorreo };
