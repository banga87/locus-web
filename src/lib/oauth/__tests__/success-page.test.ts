import { describe, expect, it } from 'vitest';
import { buildSuccessPageHtml } from '../success-page';

describe('buildSuccessPageHtml', () => {
  it('starts with doctype and contains the redirect target in iframe and fallback link', () => {
    const html = buildSuccessPageHtml({ redirectTarget: 'http://localhost:3000/cb?code=xyz&state=abc' });
    expect(html).toMatch(/^<!doctype/i);
    expect(html).toContain('<iframe src="http://localhost:3000/cb?code=xyz&amp;state=abc"');
    expect(html).toContain('<a href="http://localhost:3000/cb?code=xyz&amp;state=abc">');
  });

  it('html-escapes special characters in the target', () => {
    const html = buildSuccessPageHtml({ redirectTarget: 'http://localhost/cb?x="y"&z=<1>' });
    expect(html).not.toContain('"y"');
    expect(html).toContain('&quot;y&quot;');
    expect(html).toContain('&lt;1&gt;');
  });

  it('includes Connected to Locus heading and noindex meta', () => {
    const html = buildSuccessPageHtml({ redirectTarget: 'http://localhost/cb' });
    expect(html).toContain('Connected to Locus');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});
