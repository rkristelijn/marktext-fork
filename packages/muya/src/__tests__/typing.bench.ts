// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { en } from '../locales';
import { Muya } from '../muya';

// WALL-CLOCK micro-benchmark (NOT a CI assertion — it only logs numbers).
// Answers: does collapsing the redundant cursor-check tokenizations produce a
// MEASURABLE per-keystroke time reduction, and does it scale with paragraph
// length? Run with:
//   pnpm --filter @muyajs/core exec vitest run src/__tests__/typingBench.spec.ts
//
// The absolute numbers are environment-dependent (happy-dom, not a real
// browser) so we report relative cost across paragraph sizes and iterations.

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) bootedHosts.pop()!.remove();
    window.getSelection()?.removeAllRanges();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, locale: en } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function benchType(existing: string, iterations: number): number {
    const muya = bootMuya(`${existing}\n`);
    const content = muya.editor.scrollPage!.firstContentInDescendant() as Content;
    muya.editor.activeContentBlock = content;
    let text = existing;

    // Warm up (JIT, caches).
    for (let i = 0; i < 50; i++) {
        text = `${existing}x`;
        content.domNode!.textContent = text;
        content.setCursor(text.length, text.length);
        content.inputHandler(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
        text = existing + (i % 10);
        content.domNode!.textContent = text;
        content.setCursor(text.length, text.length);
        content.inputHandler(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
    const t1 = performance.now();
    return (t1 - t0) / iterations; // ms per keystroke
}

describe('typing wall-clock bench @bench', () => {
    it('reports per-keystroke cost across paragraph sizes', () => {
        const iterations = 500;
        const sizes = [
            { label: 'short (~40 chars)', text: 'The quick brown fox jumps over the lazy' },
            { label: 'medium (~400 chars)', text: 'word '.repeat(80).trim() },
            { label: 'large (~2000 chars)', text: 'word '.repeat(400).trim() },
            { label: 'xl (~5000 chars)', text: 'word '.repeat(1000).trim() },
        ];
        for (const s of sizes) {
            const ms = benchType(s.text, iterations);
            // eslint-disable-next-line no-console
            console.log(`[bench] ${s.label.padEnd(22)} ${ms.toFixed(4)} ms/keystroke (${iterations} iters)`);
            // Sanity assertion (this is a measurement, not a timing gate): the
            // per-keystroke cost must be a finite, positive number. Guards
            // against benchType silently returning NaN/0 (e.g. if inputHandler
            // no-ops), which would make the reported baselines meaningless.
            expect(ms).toBeGreaterThan(0);
            expect(Number.isFinite(ms)).toBe(true);
        }
    });
});
