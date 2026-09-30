const assert = require('assert');
const { combinarDocumentos } = require('../lib/expediente');

const anteriores = [
  { campo: 'camara', filename: 'camara-vieja.pdf' },
  { campo: 'rut', filename: 'rut.pdf' }
];
const reemplazo = { campo: 'camara', filename: 'camara-nueva.pdf' };

assert.deepStrictEqual(combinarDocumentos(anteriores, [reemplazo]), [
  reemplazo,
  anteriores[1]
]);
assert.deepStrictEqual(combinarDocumentos(anteriores, []), anteriores);
console.log('Pruebas de actualización parcial del expediente pasaron');
