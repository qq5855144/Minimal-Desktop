import { describe, expect, it } from 'vitest';
import { CURRENT_DESKTOP_VERSION, parseDesktopData } from './desktopSchema';

const validData = {
  version: CURRENT_DESKTOP_VERSION,
  pages: [[{
    id: 'app-1', type: 'app', name: 'Example', color: 'blue',
    page: 0, row: 0, col: 0, url: 'https://example.com/',
  }]],
};

describe('desktop backup schema', () => {
  it('accepts a valid backup', () => {
    expect(parseDesktopData(validData).ok).toBe(true);
  });

  it('rejects executable URL schemes', () => {
    const malicious = structuredClone(validData);
    malicious.pages[0][0].url = 'javascript:alert(1)';
    expect(parseDesktopData(malicious).ok).toBe(false);
  });

  it('strips legacy or unknown fields while validating known data', () => {
    const result = parseDesktopData({ ...validData, dock: [], injected: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty('injected');
  });

  it('accepts legacy v2 privacy vault metadata', () => {
    const result = parseDesktopData({
      ...validData,
      privacyVault: { salt: 'AA==', iv: 'AA==', ct: 'AA==', v: 2 },
    });
    expect(result.ok).toBe(true);
  });
});
