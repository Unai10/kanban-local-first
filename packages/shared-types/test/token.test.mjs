import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSecureToken,
  generateSecureId,
  generateUuid,
  isValidTokenFormat,
  generateJoinCode,
  normalizeJoinCode,
  isValidJoinCode,
} from '../dist/crypto/token.js';

test('generateSecureToken - Generación con alta entropía y validación de formato', () => {
  const token1 = generateSecureToken();
  const token2 = generateSecureToken();

  assert.ok(token1.startsWith('sec-'), 'Debe iniciar con el prefijo por defecto sec-');
  assert.equal(token1.length, 36, 'Prefijo sec- (4) + 16 bytes hex (32) = 36 caracteres');
  assert.notEqual(token1, token2, 'Dos tokens consecutivos deben ser únicos y diferentes');
  assert.equal(isValidTokenFormat(token1), true);
  assert.equal(isValidTokenFormat('1234'), false);
  assert.equal(isValidTokenFormat('sec-invalid!'), false);

  const customPrefixToken = generateSecureToken('custom_');
  assert.ok(customPrefixToken.startsWith('custom_'), 'Debe respetar prefijos personalizados');
});

test('generateSecureId & generateUuid - Identificadores únicos', () => {
  const id1 = generateSecureId('sprint');
  const id2 = generateSecureId('sprint');

  assert.ok(id1.startsWith('sprint-'), 'Debe iniciar con prefijo');
  assert.notEqual(id1, id2, 'Dos IDs deben ser únicos');

  const uuid1 = generateUuid();
  const uuid2 = generateUuid();
  assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(uuid1, uuid2);
});

test('generateJoinCode y normalizeJoinCode - Códigos legibles de sala', () => {
  const code1 = generateJoinCode();
  const code2 = generateJoinCode();

  assert.equal(code1.length, 7, 'Formato XXX-XXX debe medir 7 caracteres');
  assert.equal(code1[3], '-', 'El cuarto carácter debe ser un guión');
  assert.notEqual(code1, code2, 'Dos códigos deben ser únicos');
  assert.equal(isValidJoinCode(code1), true);
  assert.equal(/[01IO]/.test(code1), false, 'No debe contener caracteres ambiguos (0, 1, I, O)');

  assert.equal(normalizeJoinCode('8k2-9mw'), '8K2-9MW');
  assert.equal(normalizeJoinCode('8k29mw'), '8K2-9MW');
  assert.equal(normalizeJoinCode(' 8k2 9mw '), '8K2-9MW');
});
