/**
 * Implementación robusta y completa de Fractional Indexing (Indexación Fraccionaria).
 * Basado en la especificación y algoritmo de David Greenspan (usado en Figma, Replicache y sistemas CRDTs).
 *
 * Resuelve todos los casos límite:
 * - Inserciones infinitas antes del primer elemento sin desordenar la secuencia.
 * - Inserciones infinitas después del último elemento.
 * - Inserciones intermedias arbitrarias sin colisiones ni duplicados.
 * - Compatible con ordenación lexicográfica directa por código de caracteres (ASCII code point: a < b ? -1 : a > b ? 1 : 0).
 *   NOTA: NUNCA usar localeCompare ya que agrupa mayúsculas y minúsculas alterando la jerarquía de Base62 ('Z' < 'a').
 */

export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const BASE_52_DIGITS = BASE_62_DIGITS.slice(10); // 'A-Z' (enteros negativos) + 'a-z' (enteros positivos)

const digitIndexCache = new Map<string, Uint8Array>();

/**
 * cachea los digitos de una base para encontrar el indice en tiempo constante
 * 
 */
function getDigitIndex(digits: string): Uint8Array {
  let m = digitIndexCache.get(digits);
  if (m === undefined) {
    m = new Uint8Array(256);
    for (let i = 0; i < digits.length; i++) {
      m[digits.charCodeAt(i)] = i;
    }
    digitIndexCache.set(digits, m);
  }
  return m;
}

/**
 * Obtiene la longitud que debe tener la parte entera de la clave según su carácter cabecera (head).
 */
export function getIntegerLength(head: string, intDigits: string = BASE_52_DIGITS): number {
  if (!head || head.length === 0) {
    throw new Error('Carácter de cabecera vacío');
  }
  const intLookup = getDigitIndex(intDigits);
  const code = head.charCodeAt(0);
  if (code < 256) {
    const i = intLookup[code]; // indice del caracter dentro del array
    if (intDigits[i] === head) {
      const half = intDigits.length / 2;
      // verificamos si la parte entera cae en los negativos o en los positivos
      // para calcular correctamente su tamaño
      return i < half ? half - i + 1 : i - half + 2;
    }
  }
  throw new Error(`Carácter de cabecera no válido: "${head}"`);
}

/**
 * Extrae la parte entera de una clave fraccionaria.
 */
export function getIntegerPart(key: string, intDigits: string = BASE_52_DIGITS): string {
  if (!key || key.length === 0) {
    throw new Error('Clave de orden vacía');
  }
  const integerPartLength = getIntegerLength(key[0], intDigits);
  if (integerPartLength > key.length) {
    throw new Error(`Clave de orden inválida (longitud insuficiente): "${key}"`);
  }
  return key.slice(0, integerPartLength); //obtenemos la parte entera incluyendo la cabecera
}

function validateInteger(intPart: string, intDigits: string = BASE_52_DIGITS): void {
  if (intPart.length !== getIntegerLength(intPart[0], intDigits)) {
    throw new Error(`Parte entera inválida para la clave: "${intPart}"`);
  }
}
/**
 *  Metodo que comprueba si es la menor cadena posible representable
 * 
 */
function isSmallestInteger(key: string, digits: string = BASE_62_DIGITS, intDigits: string = BASE_52_DIGITS): boolean {
  return key === intDigits[0] + digits[0].repeat(intDigits.length / 2);
}

function incrementInteger(
  x: string,
  digits: string = BASE_62_DIGITS,
  intDigits: string = BASE_52_DIGITS
): string | null {
  validateInteger(x, intDigits);
  const lookup = getDigitIndex(digits);
  const intLookup = getDigitIndex(intDigits);
  const head = x[0];
  const zero = digits[0];

  let trailing = '';
  for (let i = x.length - 1; i >= 1; i--) {
    const d = lookup[x.charCodeAt(i)] + 1;
    if (d === digits.length) {
      trailing = zero + trailing;
    } else {
      return head + x.slice(1, i) + digits[d] + trailing;
    }
  }

  const headIndex = intLookup[head.charCodeAt(0)];
  if (headIndex === intDigits.length - 1) {
    return null; // Entero máximo alcanzado
  }

  const h = intDigits[headIndex + 1];
  const lengthDelta = getIntegerLength(h, intDigits) - getIntegerLength(head, intDigits);
  return (
    h +
    (lengthDelta > 0
      ? trailing + zero
      : lengthDelta < 0
      ? trailing.slice(1)
      : trailing)
  );
}

/**
 * Metodo que devuelve el entero anterior dentro del orden lexicografico realizando una resta
 * 
 */
function decrementInteger(
  x: string,
  digits: string = BASE_62_DIGITS,
  intDigits: string = BASE_52_DIGITS
): string | null {
  validateInteger(x, intDigits);
  const lookup = getDigitIndex(digits);
  const intLookup = getDigitIndex(intDigits);
  const head = x[0];
  const last = digits[digits.length - 1];

  let trailing = '';
  for (let i = x.length - 1; i >= 1; i--) {
    const d = lookup[x.charCodeAt(i)] - 1;
    if (d === -1) {
      trailing = last + trailing;
    } else {
      return head + x.slice(1, i) + digits[d] + trailing;
    }
  }

  const headIndex = intLookup[head.charCodeAt(0)];
  if (headIndex === 0) {
    return null; // Entero mínimo alcanzado
  }

  const h = intDigits[headIndex - 1];
  const lengthDelta = getIntegerLength(h, intDigits) - getIntegerLength(head, intDigits);
  return (
    h +
    (lengthDelta > 0
      ? trailing + last
      : lengthDelta < 0
      ? trailing.slice(1)
      : trailing)
  );
}

/**
 * Calcula el punto medio entre dos partes fraccionarias.
 */
function midpoint(
  a: string,
  b: string | null | undefined,
  digits: string = BASE_62_DIGITS
): string {
  const lookup = getDigitIndex(digits);
  const zero = digits[0];

  if (b != null && a >= b) {
    throw new Error(`Punto medio inválido: "${a}" >= "${b}"`);
  }
  if (a.slice(-1) === zero || (b && b.slice(-1) === zero)) {
    throw new Error('La clave no debe terminar en cero no significativo (trailing zero)');
  }

  if (b) {
    // Eliminar prefijo común
    let n = 0;
    while ((a[n] || zero) === b[n]) {
      n++;
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
    }
  }

  const digitA = a ? lookup[a.charCodeAt(0)] : 0;
  const digitB = b != null ? lookup[b.charCodeAt(0)] : digits.length;

  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB));
    return digits[midDigit];
  } else {
    if (b && b.length > 1) {
      return b.slice(0, 1);
    } else {
      return digits[digitA] + midpoint(a.slice(1), null, digits);
    }
  }
}

/**
 * Valida que una clave de orden cumpla el formato estricto de Fractional Indexing.
 */
export function validateOrderKey(
  key: string,
  digits: string = BASE_62_DIGITS,
  intDigits: string = BASE_52_DIGITS
): void {
  if (typeof key !== 'string' || key.length < 2 || key.length > 256) {
    throw new Error(`Clave de orden inválida (longitud fuera de rango): "${String(key)}"`);
  }
  if (isSmallestInteger(key, digits, intDigits)) {
    throw new Error(`Clave de orden inválida (mínimo absoluto reservado): "${key}"`);
  }
  const i = getIntegerPart(key, intDigits); // parte entera de la clave
  const lookup = getDigitIndex(digits);
  for (let idx = 1; idx < key.length; idx++) {
    const code = key.charCodeAt(idx);
    if (code >= 256 || (lookup[code] === 0 && key[idx] !== digits[0])) {
      throw new Error(`Clave de orden inválida (carácter fuera de alfabeto): "${key}"`);
    }
  }
  const f = key.slice(i.length); // parte fraccionaria
  //comprobamos que no acabe en 0 ya que un decimal no tiene sentido que termine en 0
  if (f.slice(-1) === digits[0]) {
    throw new Error(`Clave de orden inválida (termina en cero): "${key}"`);
  }
}

/**
 * Genera una clave fraccionaria estrictamente mayor que `prevKey` y estrictamente menor que `nextKey`.
 *
 * @param prevKey Clave del elemento anterior (o null/undefined para insertar al principio de la lista).
 * @param nextKey Clave del elemento posterior (o null/undefined para insertar al final de la lista).
 * @returns Cadena lexicográficamente situada entre prevKey y nextKey.
 *
 * @example
 * const k1 = generateFractionalKey(null, null);       // "a0"
 * const k2 = generateFractionalKey(k1, null);         // "a1"
 * const k3 = generateFractionalKey(null, k1);         // "Zz" (menor que "a0")
 * const kMid = generateFractionalKey(k1, k2);         // "a0V"
 */
export function generateFractionalKey(
  prevKey: string | null | undefined,
  nextKey: string | null | undefined,
  digits: string = BASE_62_DIGITS,
  intDigits: string = BASE_52_DIGITS
): string {

  //validamos que ambas key sean validas y que prev sea menor que next
  if (prevKey != null) {
    validateOrderKey(prevKey, digits, intDigits);
  }
  if (nextKey != null) {
    validateOrderKey(nextKey, digits, intDigits);
  }

  if (prevKey != null && nextKey != null) {
    if (prevKey >= nextKey) {
      throw new Error(`prevKey ("${prevKey}") debe ser estrictamente menor que nextKey ("${nextKey}")`);
    }
  }

  // Caso 1: Lista vacía
  if (prevKey == null && nextKey == null) {
    const head = intDigits[intDigits.length / 2]; // 'a'
    return head + digits[0]; // "a0"
  }

  // Caso 2: Insertar al principio (antes de nextKey)
  if (prevKey == null && nextKey != null) {
    // parte entera y flotante de next
    const ib = getIntegerPart(nextKey, intDigits);
    const fb = nextKey.slice(ib.length);
    // si es el menor entero posible calculamos la mitad de la parte decimal 
    if (isSmallestInteger(ib, digits, intDigits)) {
      return ib + midpoint('', fb, digits);
    }

    // si la parte entera ya es menor que next devolvemos es parte entera como nueva key
    if (ib < nextKey) {
      return ib;
    }

    // en caso contrario decrementamos en 1 la parte entera y retornamos eso como key
    const res = decrementInteger(ib, digits, intDigits);
    if (res == null) {
      throw new Error('Límite inferior alcanzado: no es posible decrementar más');
    }
    return res;
  }

  // Caso 3: Insertar al final (después de prevKey)
  if (prevKey != null && nextKey == null) {
    const ia = getIntegerPart(prevKey, intDigits);
    const fa = prevKey.slice(ia.length);
    const i = incrementInteger(ia, digits, intDigits);
    return i == null ? ia + midpoint(fa, null, digits) : i;
  }

  // Caso 4: Insertar entre dos claves (prevKey < nextKey)
  const ia = getIntegerPart(prevKey!, intDigits);
  const fa = prevKey!.slice(ia.length);
  const ib = getIntegerPart(nextKey!, intDigits);
  const fb = nextKey!.slice(ib.length);

  if (ia === ib) {
    return ia + midpoint(fa, fb, digits);
  }

  const i = incrementInteger(ia, digits, intDigits);
  if (i == null) {
    throw new Error('No es posible incrementar el entero de prevKey');
  }
  if (i < nextKey!) {
    return i;
  }
  return ia + midpoint(fa, null, digits);
}

/**
 * Alias de generateFractionalKey para compatibilidad con librerías estándar como 'fractional-indexing'.
 */
export const generateKeyBetween = generateFractionalKey;

/**
 * Genera N claves distribuidas equitativamente entre prevKey y nextKey.
 * Esencial para inserciones por lotes (batch) y migraciones sin inflar la longitud de las claves.
 */
export function generateNKeysBetween(
  prevKey: string | null | undefined,
  nextKey: string | null | undefined,
  n: number,
  digits: string = BASE_62_DIGITS,
  intDigits: string = BASE_52_DIGITS
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateFractionalKey(prevKey, nextKey, digits, intDigits)];

  if (nextKey == null) {
    let c = generateFractionalKey(prevKey, nextKey, digits, intDigits);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateFractionalKey(c, nextKey, digits, intDigits);
      result.push(c);
    }
    return result;
  }

  if (prevKey == null) {
    let c = generateFractionalKey(prevKey, nextKey, digits, intDigits);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateFractionalKey(prevKey, c, digits, intDigits);
      result.push(c);
    }
    result.reverse();
    return result;
  }

  const mid = Math.floor(n / 2);
  const c = generateFractionalKey(prevKey, nextKey, digits, intDigits);
  return [
    ...generateNKeysBetween(prevKey, c, mid, digits, intDigits),
    c,
    ...generateNKeysBetween(c, nextKey, n - mid - 1, digits, intDigits),
  ];
}

