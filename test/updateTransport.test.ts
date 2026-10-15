import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_API, RELEASES_PAGE } from '../src/shared/updates';
const state = vi.hoisted(() => ({ requests: [] as EventEmitter[], options: [] as Record<string, unknown>[], headers: [] as Record<string, string>[], abort: vi.fn(), open: vi.fn(), partition: vi.fn(), ntlm: vi.fn() }));
vi.mock('electron', () => ({
  session: { fromPartition: (...args: unknown[]) => { state.partition(...args); return { allowNTLMCredentialsForDomains: state.ntlm }; } },
  shell: { openExternal: state.open },
  net: { request: (options: Record<string, unknown>) => {
    const request = new EventEmitter() as EventEmitter & { setHeader: (key: string, value: string) => void; end: () => void; abort: () => void };
    const headers: Record<string, string> = {}; state.headers.push(headers); state.options.push(options); state.requests.push(request);
    request.setHeader = (key, value) => { headers[key] = value; }; request.end = () => {}; request.abort = state.abort;
    return request;
  } },
}));
import { UpdateChecker } from '../src/main/updates';
beforeEach(() => { state.requests.length = 0; state.options.length = 0; state.headers.length = 0; state.open.mockClear(); state.partition.mockClear(); state.abort.mockClear(); });
afterEach(() => vi.useRealTimers());
function answer(status = 200, text = JSON.stringify({ tag_name: 'v1.3.0', draft: false, prerelease: false, html_url: `${RELEASES_PAGE}/tag/v1.3.0` })) {
  const response = Object.assign(new EventEmitter(), { statusCode: status });
  state.requests.at(-1)!.emit('response', response); response.emit('data', Buffer.from(text)); response.emit('end');
}
describe('isolated update requests', () => {
  it('does nothing until clicked, makes one fixed request without Exchange auth, opens only verified releases', async () => {
    const checker = new UpdateChecker(); expect(state.requests).toHaveLength(0); expect(state.partition).not.toHaveBeenCalled();
    await expect(checker.open()).rejects.toThrow(/Сначала/);
    const pending = checker.check('1.2.0');
    expect(state.options[0]).toMatchObject({ url: RELEASES_API, useSessionCookies: false, redirect: 'manual', credentials: 'omit' });
    expect(state.headers[0]).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'OWA-Widget' });
    expect(state.ntlm).toHaveBeenLastCalledWith('');
    const login = vi.fn(); state.requests[0].emit('login', {}, login); expect(login).toHaveBeenCalledWith();
    await expect(checker.check('1.2.0')).rejects.toThrow(); expect(state.requests).toHaveLength(1);
    answer(); await expect(pending).resolves.toMatchObject({ status: 'available' });
    await checker.open(); expect(state.open).toHaveBeenCalledExactlyOnceWith(`${RELEASES_PAGE}/tag/v1.3.0`);
  });
  it.each([403, 429, 500])('handles HTTP %s without retaining a download destination', async status => {
    const checker = new UpdateChecker(); const promise = checker.check('1.2.0'); const rejected = expect(promise).rejects.toThrow(); answer(status); await rejected;
    await expect(checker.open()).rejects.toThrow();
  });
  it('aborts redirects without following or leaking credentials', async () => {
    const checker = new UpdateChecker(); const pending = checker.check('1.2.0'); const rejected = expect(pending).rejects.toThrow(/перенаправил/);
    state.requests[0].emit('redirect', 302, 'GET', 'https://other.example.com', {}); await rejected; expect(state.abort).toHaveBeenCalledOnce();
  });
  it('bounds response size, rejects malformed data and stops timed-out requests', async () => {
    const checker = new UpdateChecker();
    let pending = checker.check('1.2.0'); let rejected = expect(pending).rejects.toThrow(/слишком большой/); answer(200, 'x'.repeat(128 * 1024 + 1)); await rejected;
    pending = checker.check('1.2.0'); rejected = expect(pending).rejects.toThrow(/прочитать/); answer(200, 'invalid'); await rejected;
    vi.useFakeTimers(); pending = checker.check('1.2.0'); rejected = expect(pending).rejects.toThrow(/вовремя/); await vi.advanceTimersByTimeAsync(10_000); await rejected;
  });
});
