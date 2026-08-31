/**
 * Regression test suite for Komplexiti.
 *
 * Tests are organised around the demo sets available in the app's dropdown so
 * that any change that silently breaks a demo is caught immediately.
 *
 * Tested layers (all pure computation, no DOM):
 *   latexToExpr      - LaTeX string -> mathjs expression string
 *   parseEquation    - full parse pipeline -> type / locus fastPath
 *   _computeLocusExtrema - modulus/argument extrema for geometric loci
 *   niceRealLatex / niceAngleLatex - exact display formatting
 */

import { describe, test, expect } from 'vitest';
import { createK } from './harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PI = Math.PI;

/** Parse a demo-set LaTeX string and return the full parseEquation result. */
function parse(latex, expressions = []) {
    return createK(expressions).parseEquation(latex, null);
}

/** Compute extrema directly from a parseEquation result. */
function extrema(parseResult) {
    const k = createK();
    return k._computeLocusExtrema({ type: parseResult.type, locus: parseResult.locus });
}

// ---------------------------------------------------------------------------
// latexToExpr
// ---------------------------------------------------------------------------

describe('latexToExpr', () => {
    test('simple circle: |w|=2', () => {
        expect(createK().latexToExpr('\\left|w\\right|=2')).toBe('abs(w)=2');
    });

    test('conjugate overline', () => {
        expect(createK().latexToExpr('\\overline{z}')).toBe('conj(z)');
    });

    test('re(z) with frac rhs', () => {
        expect(createK().latexToExpr('re\\left(z\\right)=\\frac{3}{2}')).toBe('re(z)=1.5');
    });

    test('im(z)', () => {
        expect(createK().latexToExpr('im\\left(z\\right)=3')).toBe('im(z)=3');
    });

    test('\\le and \\ge become <= and >=', () => {
        const result = createK().latexToExpr('\\frac{\\pi}{6}\\le\\arg\\left(w+2i\\right)\\le\\frac{\\pi}{3}');
        expect(result).toContain('<=');
        expect(result).toContain('arg(');
        expect(result).toContain('pi');
    });

    test('arg fraction equation', () => {
        const result = createK().latexToExpr('\\arg\\left(\\frac{z-1}{z+1}\\right)=\\frac{\\pi}{4}');
        expect(result).toMatch(/^arg\(/);
        expect(result).toContain('z-1');
        expect(result).toContain('z+1');
        expect(result).toContain('pi');
    });

    test('Joukowski: |z^2 + 1/z^2|', () => {
        const result = createK().latexToExpr('\\left|z^2+\\frac{1}{z^2}\\right|=2');
        expect(result).toMatch(/^abs\(/);
        expect(result).toContain('z^2');
    });

    test('nth-root: w^3 = -27', () => {
        expect(createK().latexToExpr('w^3=-27')).toBe('w^3=-27');
    });
});

// ---------------------------------------------------------------------------
// parseEquation - loci demo set
// ---------------------------------------------------------------------------

describe('parseEquation - loci demo set', () => {

    describe('|w| = 2  (circle)', () => {
        test('type is locus', () => {
            expect(parse('\\left|w\\right|=2').type).toBe('locus');
        });

        test('variable is w', () => {
            expect(parse('\\left|w\\right|=2').variable).toBe('w');
        });

        test('fastPath kind is circle', () => {
            expect(parse('\\left|w\\right|=2').locus.fastPath.kind).toBe('circle');
        });

        test('circle centre is the origin', () => {
            const fp = parse('\\left|w\\right|=2').locus.fastPath;
            expect(fp.center.re).toBeCloseTo(0);
            expect(fp.center.im).toBeCloseTo(0);
        });

        test('circle radius is 2', () => {
            expect(parse('\\left|w\\right|=2').locus.fastPath.radius).toBeCloseTo(2);
        });
    });

    describe('arg((z-1)/(z+1)) = pi/4  (inscribed arc)', () => {
        const latex = '\\arg\\left(\\frac{z-1}{z+1}\\right)=\\frac{\\pi}{4}';

        test('type is locus', () => {
            expect(parse(latex).type).toBe('locus');
        });

        test('variable is z', () => {
            expect(parse(latex).variable).toBe('z');
        });

        test('fastPath kind is inscribed-arc', () => {
            expect(parse(latex).locus.fastPath.kind).toBe('inscribed-arc');
        });

        test('arc endpoint a is (1, 0)', () => {
            const fp = parse(latex).locus.fastPath;
            expect(fp.a.re).toBeCloseTo(1);
            expect(fp.a.im).toBeCloseTo(0);
        });

        test('arc endpoint b is (-1, 0)', () => {
            const fp = parse(latex).locus.fastPath;
            expect(fp.b.re).toBeCloseTo(-1);
            expect(fp.b.im).toBeCloseTo(0);
        });

        test('inscribed angle theta is pi/4', () => {
            expect(parse(latex).locus.fastPath.theta).toBeCloseTo(PI / 4);
        });

        test('circumscribed circle centre is (0, 1)', () => {
            const fp = parse(latex).locus.fastPath;
            expect(fp.center.re).toBeCloseTo(0);
            expect(fp.center.im).toBeCloseTo(1);
        });

        test('circumscribed circle radius is sqrt(2)', () => {
            expect(parse(latex).locus.fastPath.radius).toBeCloseTo(Math.sqrt(2));
        });

        test('locus is not an inequality', () => {
            expect(parse(latex).locus.inequality).toBeUndefined();
        });
    });

    describe('|z^2 + 1/z^2| = 2  (Joukowski)', () => {
        const latex = '\\left|z^2+\\frac{1}{z^2}\\right|=2';

        test('type is locus', () => {
            expect(parse(latex).type).toBe('locus');
        });

        test('fastPath kind is joukowski', () => {
            expect(parse(latex).locus.fastPath.kind).toBe('joukowski');
        });

        test('Joukowski n = 2', () => {
            expect(parse(latex).locus.fastPath.n).toBe(2);
        });

        test('Joukowski k = 2', () => {
            expect(parse(latex).locus.fastPath.k).toBeCloseTo(2);
        });

        test('Joukowski cosSign = +1  (z^n + z^-n form)', () => {
            expect(parse(latex).locus.fastPath.cosSign).toBe(1);
        });
    });
});

// ---------------------------------------------------------------------------
// parseEquation - line-loci demo set
// ---------------------------------------------------------------------------

describe('parseEquation - line-loci demo set', () => {

    test('im(z) = 3  is a horizontal line', () => {
        const result = parse('im\\left(z\\right)=3');
        expect(result.type).toBe('locus');
        const fp = result.locus.fastPath;
        expect(fp.kind).toBe('line');
        expect(fp.perpBisector).toBeFalsy();
        expect(fp.point.im).toBeCloseTo(3);
    });

    test('re(z) = 3/2  is a vertical line', () => {
        const result = parse('re\\left(z\\right)=\\frac{3}{2}');
        expect(result.type).toBe('locus');
        const fp = result.locus.fastPath;
        expect(fp.kind).toBe('line');
        expect(fp.point.re).toBeCloseTo(1.5);
    });

    test('|z-(2-3i)| = |z-1+2i|  is a perpendicular bisector', () => {
        const result = parse('\\left|z-\\left(2-3i\\right)\\right|=\\left|z-1+2i\\right|');
        expect(result.type).toBe('locus');
        const fp = result.locus.fastPath;
        expect(fp.kind).toBe('line');
        expect(fp.perpBisector).toBe(true);
        // Focus points
        expect(fp.focusA.re).toBeCloseTo(2);
        expect(fp.focusA.im).toBeCloseTo(-3);
        expect(fp.focusB.re).toBeCloseTo(1);
        expect(fp.focusB.im).toBeCloseTo(-2);
    });

    test('arg(z - a) = pi/3  is a ray from a  (needs a in scope)', () => {
        const exprs = [{ id: 1, name: 'a', re: -2, im: -2 }];
        const result = parse('\\arg\\left(z-a\\right)=\\frac{\\pi}{3}', exprs);
        expect(result.type).toBe('locus');
        const fp = result.locus.fastPath;
        expect(fp.kind).toBe('ray');
        expect(fp.origin.re).toBeCloseTo(-2);
        expect(fp.origin.im).toBeCloseTo(-2);
        expect(fp.angle).toBeCloseTo(PI / 3);
    });
});

// ---------------------------------------------------------------------------
// parseEquation - inequalities demo set
// ---------------------------------------------------------------------------

describe('parseEquation - inequalities demo set', () => {

    test('pi/6 <= arg(w+2i) <= pi/3  is a compound locus', () => {
        const result = parse('\\frac{\\pi}{6}\\le\\arg\\left(w+2i\\right)\\le\\frac{\\pi}{3}');
        expect(result.type).toBe('compound-locus');
        expect(result.variable).toBe('w');
        expect(result.loci).toHaveLength(2);
    });

    test('|z-(1-i)| < 2  is a strict circle inequality', () => {
        const result = parse('\\left|z-\\left(1-i\\right)\\right|<2');
        expect(result.type).toBe('locus');
        const fp = result.locus.fastPath;
        expect(fp.kind).toBe('circle');
        expect(fp.center.re).toBeCloseTo(1);
        expect(fp.center.im).toBeCloseTo(-1);
        expect(fp.radius).toBeCloseTo(2);
        expect(result.locus.inequality.strict).toBe(true);
    });

    test('|z+i| < |z-2|  is a perpendicular bisector inequality', () => {
        const result = parse('\\left|z+i\\right|<\\left|z-2\\right|');
        expect(result.type).toBe('locus');
        expect(result.locus.fastPath.kind).toBe('line');
        expect(result.locus.fastPath.perpBisector).toBe(true);
        expect(result.locus.inequality.strict).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// parseEquation - complex equations demo set
// ---------------------------------------------------------------------------

describe('parseEquation - complex equations demo set', () => {

    test('w^3 = -27  has 3 roots', () => {
        const result = parse('w^3=-27');
        expect(result.type).toBe('equation');
        expect(result.variable).toBe('w');
        expect(result.roots).toHaveLength(3);
    });

    test('w^3 = -27  one root is (-3, 0)', () => {
        const result = parse('w^3=-27');
        const root = result.roots.find(r => Math.abs(r.re + 3) < 1e-6 && Math.abs(r.im) < 1e-6);
        expect(root).toBeDefined();
    });

    test('z^3 = 8i  has 3 roots all at radius 2', () => {
        const result = parse('z^3=8i');
        expect(result.type).toBe('equation');
        expect(result.roots).toHaveLength(3);
        for (const r of result.roots) {
            expect(Math.hypot(r.re, r.im)).toBeCloseTo(2);
        }
    });

    test('z + 1/z = 1  has 2 roots', () => {
        const result = parse('z+\\frac{1}{z}=1');
        expect(result.type).toBe('equation');
        expect(result.roots).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// parseEquation - extrema demo set
// ---------------------------------------------------------------------------

describe('parseEquation - extrema demo set', () => {
    const latex = '\\left|z-\\sqrt{2}\\left(1+i\\right)\\right|=1';

    test('is a circle', () => {
        expect(parse(latex).locus.fastPath.kind).toBe('circle');
    });

    test('circle centre is (sqrt(2), sqrt(2))', () => {
        const fp = parse(latex).locus.fastPath;
        expect(fp.center.re).toBeCloseTo(Math.SQRT2);
        expect(fp.center.im).toBeCloseTo(Math.SQRT2);
    });

    test('circle radius is 1', () => {
        expect(parse(latex).locus.fastPath.radius).toBeCloseTo(1);
    });
});

// ---------------------------------------------------------------------------
// _computeLocusExtrema
// ---------------------------------------------------------------------------

describe('_computeLocusExtrema', () => {

    describe('circle |w| = 2  (origin inside)', () => {
        const result = parse('\\left|w\\right|=2');

        test('modMin = modMax = 2', () => {
            const ex = extrema(result);
            expect(ex.modMin).toBeCloseTo(2);
            expect(ex.modMax).toBeCloseTo(2);
        });

        test('fullArgRange is true because origin lies on the circle', () => {
            expect(extrema(result).fullArgRange).toBe(true);
        });

        test('argMin / argMax are null when fullArgRange', () => {
            const ex = extrema(result);
            expect(ex.argMin).toBeNull();
            expect(ex.argMax).toBeNull();
        });

        test('approximate is false (exact geometry)', () => {
            expect(extrema(result).approximate).toBe(false);
        });
    });

    describe('inscribed arc  arg((z-1)/(z+1)) = pi/4', () => {
        const latex = '\\arg\\left(\\frac{z-1}{z+1}\\right)=\\frac{\\pi}{4}';
        const result = parse(latex);

        test('modMin = 1  (endpoints lie on unit circle)', () => {
            expect(extrema(result).modMin).toBeCloseTo(1);
        });

        test('modMax = 1 + sqrt(2)  (far point of circumscribed circle on the arc)', () => {
            expect(extrema(result).modMax).toBeCloseTo(1 + Math.SQRT2);
        });

        test('argMin = 0', () => {
            expect(extrema(result).argMin).toBeCloseTo(0);
        });

        test('argMax = pi  (endpoint b at (-1, 0))', () => {
            expect(extrema(result).argMax).toBeCloseTo(PI);
        });

        test('approximate is false (exact geometry)', () => {
            expect(extrema(result).approximate).toBe(false);
        });
    });

    describe('extrema demo circle  |z - sqrt(2)(1+i)| = 1', () => {
        const latex = '\\left|z-\\sqrt{2}\\left(1+i\\right)\\right|=1';
        const result = parse(latex);

        test('modMin = 1  (distance from origin to circle minus radius)', () => {
            expect(extrema(result).modMin).toBeCloseTo(1);
        });

        test('modMax = 3  (distance from origin to far side of circle)', () => {
            expect(extrema(result).modMax).toBeCloseTo(3);
        });

        test('argMin = pi/12', () => {
            expect(extrema(result).argMin).toBeCloseTo(PI / 12);
        });

        test('argMax = 5*pi/12', () => {
            expect(extrema(result).argMax).toBeCloseTo(5 * PI / 12);
        });

        test('approximate is false', () => {
            expect(extrema(result).approximate).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// niceRealLatex  - exact surd / rational display
// ---------------------------------------------------------------------------

describe('niceRealLatex', () => {
    const k = createK();

    test('0', () => expect(k.niceRealLatex(0)).toBe('0'));
    test('1', () => expect(k.niceRealLatex(1)).toBe('1'));
    test('2', () => expect(k.niceRealLatex(2)).toBe('2'));
    test('3', () => expect(k.niceRealLatex(3)).toBe('3'));
    test('-1', () => expect(k.niceRealLatex(-1)).toBe('-1'));

    test('1/2', () => expect(k.niceRealLatex(0.5)).toBe('\\frac{1}{2}'));
    test('3/4', () => expect(k.niceRealLatex(0.75)).toBe('\\frac{3}{4}'));
    test('2/3', () => expect(k.niceRealLatex(2 / 3)).toBe('\\frac{2}{3}'));

    test('sqrt(2)', () => expect(k.niceRealLatex(Math.SQRT2)).toBe('\\sqrt{2}'));
    test('sqrt(3)', () => expect(k.niceRealLatex(Math.sqrt(3))).toBe('\\sqrt{3}'));
    test('2*sqrt(2)', () => expect(k.niceRealLatex(2 * Math.SQRT2)).toBe('2\\sqrt{2}'));
    test('sqrt(2)/2', () => expect(k.niceRealLatex(Math.SQRT2 / 2)).toBe('\\frac{\\sqrt{2}}{2}'));
});

// ---------------------------------------------------------------------------
// niceAngleLatex  - exact pi-fraction display
// ---------------------------------------------------------------------------

describe('niceAngleLatex', () => {
    const k = createK();

    test('0', () => expect(k.niceAngleLatex(0)).toBe('0'));
    test('pi', () => expect(k.niceAngleLatex(PI)).toBe('\\pi'));
    test('-pi', () => expect(k.niceAngleLatex(-PI)).toBe('-\\pi'));
    test('pi/2', () => expect(k.niceAngleLatex(PI / 2)).toBe('\\frac{\\pi}{2}'));
    test('pi/3', () => expect(k.niceAngleLatex(PI / 3)).toBe('\\frac{\\pi}{3}'));
    test('pi/4', () => expect(k.niceAngleLatex(PI / 4)).toBe('\\frac{\\pi}{4}'));
    test('pi/6', () => expect(k.niceAngleLatex(PI / 6)).toBe('\\frac{\\pi}{6}'));
    test('pi/12', () => expect(k.niceAngleLatex(PI / 12)).toBe('\\frac{\\pi}{12}'));
    test('5*pi/12', () => expect(k.niceAngleLatex(5 * PI / 12)).toBe('\\frac{5\\pi}{12}'));
    test('-pi/4', () => expect(k.niceAngleLatex(-PI / 4)).toBe('-\\frac{\\pi}{4}'));
    test('2*pi/3', () => expect(k.niceAngleLatex(2 * PI / 3)).toBe('\\frac{2\\pi}{3}'));

    test('returns null for non-multiple of pi/30', () => {
        expect(k.niceAngleLatex(1.23456789)).toBeNull();
    });
});
