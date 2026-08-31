/**
 * Test harness: loads Komplexiti class without a browser environment.
 *
 * main.js is a plain script that assumes a browser global `math` (mathjs).
 * We provide that global, strip the DOMContentLoaded bootstrapper so the
 * constructor is never called automatically, then use new Function to execute
 * the class definition and return the class. Test instances are created via
 * Object.create so the DOM-heavy constructor is bypassed entirely.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as mathjs from 'mathjs';

const __dir = dirname(fileURLToPath(import.meta.url));

// Provide mathjs as the `math` global that every method references.
globalThis.math = mathjs;

const src = readFileSync(resolve(__dir, '../main.js'), 'utf8')
    // Strip the DOMContentLoaded bootstrapper at the very end of the file.
    .replace(/\ndocument\.addEventListener\s*\(\s*['"]DOMContentLoaded['"][\s\S]*$/, '');

// Execute the class definition inside a Function so we can return the class
// without triggering any browser-specific top-level code. The 'use strict'
// directive at the top of main.js is preserved and applies to the function body.
const Komplexiti = new Function(src + '\nreturn Komplexiti;')();

/**
 * Creates a minimal Komplexiti instance suitable for testing pure computation
 * methods. DOM setup and canvas are bypassed entirely.
 *
 * @param {Array} [expressions] - optional pre-populated expressions (for
 *   tests that need defined constants in scope, e.g. arg(z-a) with a=-2-2i).
 */
export function createK(expressions = []) {
    const k = Object.create(Komplexiti.prototype);
    k.expressions = expressions;
    k.nextExpressionId = expressions.length + 1;
    k.viewport = { minX: -10, maxX: 10, minY: -10, maxY: 10, scale: 60, centerX: 0, centerY: 0 };
    return k;
}
