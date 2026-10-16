import { type WebContents } from 'electron';

interface RendererState {
    ready: boolean;
    pending?: () => void;
}

const states = new WeakMap<WebContents, RendererState>();

function stateFor(contents: WebContents): RendererState | undefined {
    const existing = states.get(contents);
    if (contents.isDestroyed()) {
        if (existing) existing.pending = undefined;
        states.delete(contents);
        return undefined;
    }
    if (existing) return existing;
    const state: RendererState = { ready: false };
    states.set(contents, state);
    contents.on('did-start-loading', () => {
        state.ready = false;
        // Initial loading can start after a caller queues its first request. Preserve the latest
        // intent through loading/reload; the caller still checks account/privacy at dispatch time.
    });
    contents.on('render-process-gone', () => {
        state.ready = false;
        state.pending = undefined;
    });
    contents.once('destroyed', () => {
        state.ready = false;
        state.pending = undefined;
        states.delete(contents);
    });
    return state;
}

/** Track before loadURL so every new document must announce its own committed route. */
export function trackRendererReady(contents: WebContents): void {
    stateFor(contents);
}

/** Called only by the existing trusted renderer console marker handler. */
export function markRendererReady(contents: WebContents): void {
    const state = stateFor(contents);
    if (!state) return;
    state.ready = true;
    const { pending } = state;
    state.pending = undefined;
    pending?.();
}

/** One pending action per window: repeated requests replace the obsolete intent. */
export function afterRendererReady(contents: WebContents, callback: () => void): void {
    const state = stateFor(contents);
    if (!state) return;
    if (state.ready) callback();
    else state.pending = callback;
}
