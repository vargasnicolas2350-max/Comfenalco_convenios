const assert = require('assert');
const { normalizarResultadoCorreo } = require('../lib/resultadoCorreo');

const warning = normalizarResultadoCorreo({
  warning: 'El correo no se pudo enviar, pero el registro quedó guardado.',
  enviadoA: 'prueba@correo.com',
  modoPrueba: true
});
assert.strictEqual(warning.ok, true);
assert.strictEqual(warning.warning.includes('registro quedó guardado'), true);

const ok = normalizarResultadoCorreo({ ok: true, enviadoA: 'ok@correo.com' }, { ok: true });
assert.strictEqual(ok.ok, true);
assert.strictEqual(ok.enviadoA, 'ok@correo.com');

const error = normalizarResultadoCorreo({ error: 'Fallo SMTP' }, { ok: false });
assert.strictEqual(error.ok, false);
assert.strictEqual(error.warning, 'Fallo SMTP');

console.log('Las pruebas del manejo del resultado del correo pasaron');
