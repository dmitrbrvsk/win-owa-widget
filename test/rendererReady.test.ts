import { type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

import {
    afterRendererReady,
    markRendererReady,
    trackRendererReady,
} from '../src/main/rendererReady';

function renderer() {
    let destroyed = false;
    // eslint-disable-next-line unicorn/prefer-event-target -- Electron WebContents uses the Node EventEmitter API, including once and listenerCount.
    const emitter = new EventEmitter();
    const contents = Object.assign(emitter, {
        isDestroyed: () => destroyed,
    }) as unknown as WebContents;
    return {
        contents,
        emitter,
        destroy: () => {
            destroyed = true;
            emitter.emit('destroyed');
        },
    };
}

it('waits for committed route readiness without an arbitrary load timer', () => {
    vi.useFakeTimers();
    try {
        const { contents, emitter } = renderer();
        const send = vi.fn();
        trackRendererReady(contents);
        afterRendererReady(contents, send);
        // Electron can report the initial load after openMeeting has queued its request.
        emitter.emit('did-start-loading');
        emitter.emit('did-finish-load');
        vi.advanceTimersByTime(60_000);
        expect(send).not.toHaveBeenCalled();
        markRendererReady(contents);
        expect(send).toHaveBeenCalledOnce();
        markRendererReady(contents);
        expect(send).toHaveBeenCalledOnce();
    } finally {
        vi.useRealTimers();
    }
});

it('dispatches immediately in a warm renderer and keeps tracking idempotent', () => {
    const { contents, emitter } = renderer();
    trackRendererReady(contents);
    trackRendererReady(contents);
    markRendererReady(contents);
    const send = vi.fn();
    afterRendererReady(contents, send);
    expect(send).toHaveBeenCalledOnce();
    expect(emitter.listenerCount('did-start-loading')).toBe(1);
    expect(emitter.listenerCount('render-process-gone')).toBe(1);
    expect(emitter.listenerCount('destroyed')).toBe(1);
});

it('retains only the latest intent and requires a fresh marker after reload', () => {
    const { contents, emitter } = renderer();
    const obsolete = vi.fn();
    const latest = vi.fn();
    afterRendererReady(contents, obsolete);
    afterRendererReady(contents, latest);
    emitter.emit('did-start-loading');
    markRendererReady(contents);
    expect(obsolete).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    emitter.emit('did-start-loading');
    const reloaded = vi.fn();
    afterRendererReady(contents, reloaded);
    expect(reloaded).not.toHaveBeenCalled();
    markRendererReady(contents);
    expect(reloaded).toHaveBeenCalledOnce();
});

it('clears queued actions on renderer crash and waits again after recovery', () => {
    const { contents, emitter } = renderer();
    const stale = vi.fn();
    afterRendererReady(contents, stale);
    emitter.emit('render-process-gone');
    markRendererReady(contents);
    expect(stale).not.toHaveBeenCalled();
    emitter.emit('render-process-gone');
    const recovered = vi.fn();
    afterRendererReady(contents, recovered);
    expect(recovered).not.toHaveBeenCalled();
    markRendererReady(contents);
    expect(recovered).toHaveBeenCalledOnce();
});

it('discards disposed actions and never sends to a destroyed WebContents', () => {
    const { contents, destroy } = renderer();
    const send = vi.fn();
    afterRendererReady(contents, send);
    destroy();
    markRendererReady(contents);
    afterRendererReady(contents, send);
    trackRendererReady(contents);
    expect(send).not.toHaveBeenCalled();
});
