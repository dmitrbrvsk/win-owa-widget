import { type OwaApi } from '../shared/types';

import { mockApi } from './browserDemoApi';

declare const BROWSER_DEMO_BUILD: boolean;

declare global {
    interface Window {
        owa?: OwaApi;
    }
}

export const preloadError =
    !window.owa && !BROWSER_DEMO_BUILD
        ? 'Не удалось подключить preload приложения. Перезапустите OWA Widget. / The application preload bridge is unavailable. Restart OWA Widget.'
        : null;

function unavailableApi(): OwaApi {
    // The startup gate shows this error before mounting any screen. Keep accidental later API use
    // explicit too, instead of silently replacing a broken Electron bridge with fictional meetings.
    return new Proxy({} as OwaApi, {
        get() {
            throw new Error(preloadError ?? 'The application preload bridge is unavailable.');
        },
    });
}

export const api: OwaApi = window.owa ?? (BROWSER_DEMO_BUILD ? mockApi() : unavailableApi());
