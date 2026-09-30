// Pruebas rápidas del lector de Cámara de Comercio con textos de ejemplo (sintéticos).
const assert = require('assert');
const { extraerDatosCamara } = require('../lib/camara');
const { construirCorreo, sumarMeses, saludoSegunHora } = require('../lib/correo');

// Formato A: NIT con dígito de verificación separado por espacio, datos en tabla
const textoA = `CAMARA DE COMERCIO DE MEDELLIN PARA ANTIOQUIA
CERTIFICADO DE EXISTENCIA Y REPRESENTACION LEGAL
NOMBRE, IDENTIFICACION Y DOMICILIO
Razón social: DISTRIBUIDORA XYZ S.A.S
Sigla: XYZ
N.I.T. : 900.123.456 1
Domicilio principal: Medellín
REPRESENTANTES LEGALES
NOMBRE IDENTIFICACION CARGO
CARLOS ANDRES PEREZ GOMEZ C.C. No. 71.123.456 GERENTE
MARIA LOPEZ C.C. 43.222.111 SUPLENTE DEL GERENTE`;

// Formato B: etiquetas con dos puntos y NIT con guion
const textoB = `CERTIFICADO DE EXISTENCIA Y REPRESENTACIÓN LEGAL
Razón Social: FUNDACION EJEMPLO
Nit: 890907215-8
REPRESENTACIÓN LEGAL
Nombre: LUZ MARINA RESTREPO Identificación: C.C. 32.100.200 Cargo: Directora`;

// Formato C: entidad pública (prefijo 899.999)
const textoC = `Razón social: MINISTERIO DE EJEMPLO
NIT 899999061 7
REPRESENTANTES LEGALES
JUAN DAVID RUIZ C.C. 79.000.111`;

const a = extraerDatosCamara(textoA);
assert.strictEqual(a.razonSocial, 'DISTRIBUIDORA XYZ S.A.S');
assert.strictEqual(a.nit, '900123456-1');
assert.strictEqual(a.representanteLegal, 'CARLOS ANDRES PEREZ GOMEZ');
assert.strictEqual(a.cedula, '71.123.456');
assert.strictEqual(a.tipoEmpresa, 'Privada');

const b = extraerDatosCamara(textoB);
assert.strictEqual(b.razonSocial, 'FUNDACION EJEMPLO');
assert.strictEqual(b.nit, '890907215-8');
assert.strictEqual(b.representanteLegal, 'LUZ MARINA RESTREPO');
assert.strictEqual(b.cedula, '32.100.200');

const c = extraerDatosCamara(textoC);
assert.strictEqual(c.nit, '899999061-7');
assert.strictEqual(c.representanteLegal, 'JUAN DAVID RUIZ');
assert.strictEqual(c.tipoEmpresa, 'Pública');

// Fechas
assert.deepStrictEqual(sumarMeses({ anio: 2026, mes: 12, dia: 31 }, 2), { anio: 2027, mes: 2, dia: 28 });
assert.deepStrictEqual(sumarMeses({ anio: 2026, mes: 9, dia: 28 }, 2), { anio: 2026, mes: 11, dia: 28 });
assert.deepStrictEqual(sumarMeses({ anio: 2026, mes: 11, dia: 28 }, 12), { anio: 2027, mes: 11, dia: 28 });

// Saludo
assert.strictEqual(saludoSegunHora(9), 'buenos días');
assert.strictEqual(saludoSegunHora(12), 'buenas tardes');

// Correo (28/09/2026 10:00 Bogotá = 15:00 UTC)
const m = construirCorreo({ ...a, interventor: 'María Gómez' }, new Date('2026-09-28T15:00:00Z'));
assert.ok(m.texto.startsWith('Hola Daya, buenos días.'));
assert.ok(m.texto.includes('Fecha de inicio: 28/11/2026'));
assert.ok(m.texto.includes('Fecha de finalización: 28/11/2027'));
assert.ok(m.texto.includes('Interventor(a) del contrato: María Gómez'));
const t = construirCorreo({ ...a, interventor: 'X' }, new Date('2026-09-28T20:00:00Z'));
assert.ok(t.texto.startsWith('Hola Daya, buenas tardes.'));

console.log('Todas las pruebas pasaron');
console.log('\n--- Ejemplo de correo ---\n' + m.texto);
