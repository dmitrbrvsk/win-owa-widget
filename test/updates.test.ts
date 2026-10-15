import { describe, expect, it } from 'vitest';
import { releaseInfo, RELEASES_PAGE } from '../src/shared/updates';
const release = (tag: string) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `${RELEASES_PAGE}/tag/${tag}`, body: 'UNTRUSTED', name: 'UNTRUSTED' });
describe('manual release check', () => {
  it.each([['v1.10.0', '1.9.0', 'available'], ['v2.0.0', '1.99.99', 'available'], ['v1.2.0', '1.2.0', 'current'], ['v1.1.0', '1.2.0', 'current']])('compares numeric versions %s and %s', (latest, current, status) => {
    const result = releaseInfo(release(latest), current);
    expect(result.result.status).toBe(status); expect(JSON.stringify(result)).not.toContain('UNTRUSTED');
  });
  it('refuses unstable tags, unexpected destinations and malformed release data', () => {
    for (const raw of [null, {}, release('v1.2.0-beta'), release('v01.2.0'), release('1.2'), { ...release('v1.3.0'), draft: true }, { ...release('v1.3.0'), prerelease: true }, { ...release('v1.3.0'), html_url: 'https://evil.example.com' }, { ...release('v1.3.0'), html_url: `${RELEASES_PAGE}/tag/v1.3.0?secret=yes` }]) expect(() => releaseInfo(raw, '1.2.0')).toThrow();
  });
});
