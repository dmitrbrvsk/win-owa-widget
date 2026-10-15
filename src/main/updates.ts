import { net, session, shell } from 'electron';

import { type UpdateCheckResult } from '../shared/types';
import { releaseInfo, RELEASES_API } from '../shared/updates';

import { RequestGate } from './limits';

/** Created only after a deliberate click. This session never carries Exchange cookies or credentials. */
export class UpdateChecker {
    private readonly gate = new RequestGate(1, 6, 60_000);
    private verifiedUrl?: string;
    async check(current: string): Promise<UpdateCheckResult> {
        const release = this.gate.enter();
        this.verifiedUrl = undefined;
        try {
            const ses = session.fromPartition('updates', { cache: false });
            ses.allowNTLMCredentialsForDomains('');
            const raw = await new Promise<unknown>((resolve, reject) => {
                const req = net.request({
                    url: RELEASES_API,
                    method: 'GET',
                    session: ses,
                    useSessionCookies: false,
                    redirect: 'manual',
                    credentials: 'omit',
                });
                req.setHeader('Accept', 'application/vnd.github+json');
                req.setHeader('User-Agent', 'OWA-Widget');
                let settled = false;
                const finish = (error?: Error, value?: unknown) => {
                    if (settled) return;
                    settled = true;
                    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- finish is invoked only by asynchronous request or timer callbacks after timer initialization.
                    clearTimeout(timer);
                    if (error) {
                        req.abort();
                        reject(error);
                    } else resolve(value);
                };
                const timer = setTimeout(
                    () => finish(new Error('GitHub не ответил вовремя. Повторите проверку позже')),
                    10_000,
                );
                req.on('login', (_info, callback) => callback());
                req.on('redirect', () =>
                    finish(new Error('GitHub перенаправил запрос: проверка остановлена')),
                );
                req.on('error', () =>
                    finish(
                        new Error('Не удалось связаться с GitHub. Проверьте интернет или прокси'),
                    ),
                );
                req.on('response', (response) => {
                    if (response.statusCode !== 200) {
                        finish(
                            new Error(
                                response.statusCode === 403 || response.statusCode === 429
                                    ? 'GitHub временно ограничил запросы. Повторите позже'
                                    : `GitHub: HTTP ${response.statusCode}`,
                            ),
                        );
                        return;
                    }
                    let size = 0;
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > 128 * 1024) finish(new Error('Ответ GitHub слишком большой'));
                        else if (!settled) chunks.push(Buffer.from(chunk));
                    });
                    response.on('error', () =>
                        finish(new Error('Ответ GitHub не удалось получить полностью')),
                    );
                    response.on('end', () => {
                        if (settled) return;
                        try {
                            finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')));
                        } catch {
                            finish(new Error('Не удалось прочитать ответ GitHub'));
                        }
                    });
                });
                req.end();
            });
            const info = releaseInfo(raw, current);
            if (info.result.status === 'available') this.verifiedUrl = info.url;
            return info.result;
        } finally {
            release();
        }
    }
    async open(): Promise<void> {
        if (!this.verifiedUrl) throw new Error('Сначала проверьте наличие новой версии');
        await shell.openExternal(this.verifiedUrl);
    }
}
