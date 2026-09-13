// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as lexer from '../inlineRenderer/lexer';
import { en } from '../locales';
import { Muya } from '../muya';

/**
 * TYPING PERF — per-keystroke redundant-work guard.
 *
 * This is NOT a wall-clock benchmark (those are flaky in CI and under the
 * happy-dom shim). It measures something deterministic and meaningful instead:
 * HOW MANY TIMES the inline `tokenizer` — the single most expensive operation
 * on the input hot path — runs for ONE keystroke.
 *
 * Why this matters (see docs/dev/performance.md): `Format.inputHandler` calls
 * the full inline markdown lexer several times over (largely) the SAME string
 * on every keystroke:
 *   1. `_checkCursorInTokenType(text, ..., 'inline_math')`
 *   2. `_checkCursorInTokenType(text, ..., 'inline_code')`
 *   3. `_checkNotSameToken(oldText, text)` — tokenizes oldText
 *   4. `_checkNotSameToken(oldText, text)` — tokenizes text
 *   5. `checkNeedRender(cursor)` — tokenizes text
 *   6. emoji `_checkCursorInTokenType(text, ..., 'emoji')`
 *
 * The `tokenizer` is a pure function of (src, options, labels, highlights), so
 * repeated calls with the SAME `src` in one input cycle are pure waste.
 *
 * These tests pin the current call count as a baseline. When the hot path is
 * optimized (e.g. per-cycle memoization of `tokenizer`), TIGHTEN the expected
 * bound and the test documents the win. If a refactor silently reintroduces
 * extra parses, the upper bound catches the regression.
 */

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
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

// Simulate one keystroke into the first content block: append a char to the
// DOM text, move the caret to the end, and run the block's `inputHandler`
// exactly as the engine does on a real `input` event. happy-dom does not
// deliver dispatched `input` events to the engine listener, so we call the
// handler directly — the same technique the headingLocaleCrash regression
// test uses.
function typeOneChar(muya: Muya, existing: string, char: string): void {
    const content = muya.editor.scrollPage!.firstContentInDescendant() as Content;
    muya.editor.activeContentBlock = content;
    const next = existing + char;
    content.domNode!.textContent = next;
    content.setCursor(next.length, next.length);
    content.inputHandler(
        new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
}

describe('typing perf — tokenizer calls per keystroke @perf', () => {
    it('runs the inline tokenizer a bounded number of times for a single keystroke', () => {
        const muya = bootMuya('hello world\n');
        const spy = vi.spyOn(lexer, 'tokenizer');

        typeOneChar(muya, 'hello world', '!');

        // After the optimization the post-edit text is parsed once and shared
        // across the math/code/emoji cursor checks. The remaining calls are
        // legitimately distinct (oldText for _checkNotSameToken; a
        // hasBeginRules:true parse for checkNeedRender; checkInlineUpdate).
        // Guard an upper bound so a future refactor that reintroduces
        // per-check re-parsing is caught. Pre-optimization this was 8.
        // eslint-disable-next-line no-console
        console.log(`[perf] tokenizer calls for one keystroke: ${spy.mock.calls.length}`);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it('collapses the math/code/emoji cursor checks into a single tokenization', () => {
        const text = 'The quick brown fox jumps over the lazy dog';
        const muya = bootMuya(`${text}\n`);
        const spy = vi.spyOn(lexer, 'tokenizer');

        typeOneChar(muya, text, '.');

        // The three cursor-type checks (inline_math, inline_code, emoji) all
        // parse with `hasBeginRules: false` and no labels. Before the fix each
        // ran its own tokenizer call; now inputHandler parses once and threads
        // the result through all three. So there must be EXACTLY ONE
        // `hasBeginRules: false` tokenizer call per keystroke.
        const beginRulesFalseCalls = spy.mock.calls.filter((call) => {
            const opts = (call[1] ?? {}) as { hasBeginRules?: boolean };
            return opts.hasBeginRules === false;
        });
        // eslint-disable-next-line no-console
        console.log(`[perf] hasBeginRules:false calls (cursor checks) = ${beginRulesFalseCalls.length}`);

        // Exactly one shared parse for all cursor-type checks (was 3).
        expect(beginRulesFalseCalls.length).toBe(1);
    });

    it('tokenizer call count does not scale up with paragraph length (cost per call does)', () => {
        // Same number of redundant calls whether the paragraph is short or
        // long — but each call scans the whole string, so long paragraphs
        // multiply the wasted work. This pins the call-count invariant so a
        // future optimization can prove it dropped the COUNT, and the docs can
        // explain the per-call cost separately.
        const shortText = 'abc';
        const longText = 'word '.repeat(400).trim(); // ~2000 chars

        const shortMuya = bootMuya(`${shortText}\n`);
        const shortSpy = vi.spyOn(lexer, 'tokenizer');
        typeOneChar(shortMuya, shortText, 'x');
        const shortCalls = shortSpy.mock.calls.length;
        shortSpy.mockRestore();

        const longMuya = bootMuya(`${longText}\n`);
        const longSpy = vi.spyOn(lexer, 'tokenizer');
        typeOneChar(longMuya, longText, 'x');
        const longCalls = longSpy.mock.calls.length;

        // eslint-disable-next-line no-console
        console.log(`[perf] short-para calls=${shortCalls}, long-para calls=${longCalls}`);

        // The COUNT is a property of the hot path, not the content length.
        expect(longCalls).toBe(shortCalls);
    });
});
