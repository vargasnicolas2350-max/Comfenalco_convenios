const assert = require('assert');
const { crearTicketCorreo, validarTicketCorreo } = require('../lib/ticketCorreo');

const clave = 'test-secret';
const ahora = Date.UTC(2026, 8, 29);
const registro = {
  razonSocial: 'Empresa Ejemplo S.A.S.',
  nit: '900.123.456-1',
  ciudad: 'Medellín',
  interventor: 'Persona Responsable',
  camara: { datos: { tipoEmpresa: 'Privada' } }
};

const ticket = crearTicketCorreo(clave, registro, ahora);
const payload = validarTicketCorreo(ticket, clave, registro, ahora + 1000);
assert.ok(payload);
assert.strictEqual(payload.nit, '9001234561');
assert.strictEqual(validarTicketCorreo(ticket, clave, { ...registro, notas: 'Alteradas' }, ahora), null);
assert.strictEqual(validarTicketCorreo(ticket, 'wrong-secret', registro, ahora), null);
assert.strictEqual(validarTicketCorreo(ticket, clave, registro, ahora + 10 * 60 * 1000), null);

console.log('Las pruebas del comprobante de correo pasaron');