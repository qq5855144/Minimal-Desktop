import { afterEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  const getCurrentPosition = vi.fn();
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  const service = await import('./weatherLocation');
  const weather = await import('./weather');
  return { ...service, ...weather, getCurrentPosition };
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('automatic weather location', () => {
  it('deduplicates permission requests and stores rounded device coordinates', async () => {
    const service = await setup();
    const first = service.locateWeather();
    const second = service.locateWeather();
    await Promise.resolve();
    expect(service.getCurrentPosition).toHaveBeenCalledTimes(1);
    service.getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 24.47981, longitude: 118.08941 } });
    await Promise.all([first, second]);
    expect(service.readWeatherCity()).toEqual({ name: '当前位置', source: 'device', latitude: 24.48, longitude: 118.09 });
    await service.locateWeather();
    expect(service.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
  it('retains permission error without repeatedly prompting, but allows explicit retry', async () => {
    const service = await setup();
    service.getCurrentPosition.mockImplementation((_success, failure) => failure({ code: 1 }));
    await expect(service.locateWeather()).rejects.toThrow('允许定位');
    await expect(service.locateWeather()).rejects.toThrow('允许定位');
    expect(service.getCurrentPosition).toHaveBeenCalledTimes(1);
    await expect(service.locateWeather(true)).rejects.toThrow('允许定位');
    expect(service.getCurrentPosition).toHaveBeenCalledTimes(2);
  });
  it('does not overwrite a city chosen while a location request was pending', async () => {
    const service = await setup();
    const request = service.locateWeather();
    await Promise.resolve();
    service.saveWeatherCity({ name: '上海', source: 'manual', latitude: 31.23, longitude: 121.47 });
    service.getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 24.48, longitude: 118.09 } });
    await request;
    expect(service.readWeatherCity()?.name).toBe('上海');
  });
  it('requests optional extension permission only from an explicit gesture', async () => {
    const service = await setup();
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('chrome', { runtime: { id: 'test' }, permissions: { contains: vi.fn().mockResolvedValue(false), request } });
    await expect(service.locateWeather()).rejects.toThrow('点击允许定位');
    expect(request).not.toHaveBeenCalled();
    const located = service.locateWeather(true);
    expect(request).toHaveBeenCalledWith({ permissions: ['geolocation'] });
    await Promise.resolve();
    service.getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 24.48, longitude: 118.09 } });
    await located;
    expect(service.readWeatherCity()?.source).toBe('device');
  });
});
