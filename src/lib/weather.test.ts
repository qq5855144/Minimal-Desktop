import { describe, expect, it, vi, afterEach } from 'vitest';
import { weatherTone, dayKey, forecastURL, normalizeWeather, weatherLabel, weatherCitySchema, searchWeatherCities, loadWeather, readWeatherCache } from './weather';
const city = { name: '厦门', latitude: 24.48, longitude: 118.09 };
const now = Date.parse('2026-09-06T03:30:00Z');
const hour = Math.floor(now / 3600000) * 3600;
const fixture = () => ({ timezone: 'Asia/Shanghai',
  current: { time: hour, temperature_2m: 29, apparent_temperature: 32, relative_humidity_2m: 80, wind_speed_10m: 8, weather_code: 2, is_day: 1 },
  hourly: { time: [hour - 3600, hour, hour + 3600], temperature_2m: [28, null, 31], weather_code: [0, 2, 61], precipitation_probability: [0, 10, 80], is_day: [1, 1, 1] },
  daily: { time: [hour - 11 * 3600], weather_code: [61], temperature_2m_max: [31], temperature_2m_min: [26], precipitation_probability_max: [80], sunrise: [hour - 5 * 3600], sunset: [hour + 7 * 3600], uv_index_max: [5] },
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Open-Meteo weather', () => {
  it('uses documented no-key parameters with UTC timestamps and automatic city timezone', () => {
    const url = forecastURL(city);
    expect(url.hostname).toBe('api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBeNull();
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('forecast_days')).toBe('7');
  });
  it('does not convert missing temperatures or AQI to zero and excludes expired hours', () => {
    const data = normalizeWeather(city, fixture(), null, now);
    expect(data.hours).toHaveLength(2);
    expect(data.hours[0].temp).toBeNull();
    expect(data.aqi).toBeNull();
    expect(data.days[0]).toMatchObject({ high: 31, low: 26 });
  });
  it('uses the selected city date across timezones, not the device date', () => {
    const time = Date.parse('2026-09-05T18:00:00Z') / 1000;
    expect(dayKey(time, 'Asia/Shanghai')).toBe('2026-09-06');
    expect(dayKey(time, 'America/New_York')).toBe('2026-09-05');
  });
  it('matches air quality by timestamp and keeps it distinct from weather availability', () => {
    const data = normalizeWeather(city, fixture(), { hourly: { time: [hour - 3600, hour], us_aqi: [99, 41], pm2_5: [20, 8] } }, now);
    expect(data.aqi).toBe(41); expect(data.pm25).toBe(8);
    expect(() => normalizeWeather(city, { error: true }, null, now)).toThrow();
  });
  it('handles weather codes and rejects invalid location coordinates', () => {
    expect(weatherLabel(95)).toBe('雷雨'); expect(weatherLabel(85)).toBe('雪'); expect(weatherLabel(null)).toBe('暂无天气');
    expect(weatherCitySchema.safeParse({ ...city, latitude: 91 }).success).toBe(false);
  });
  it('deduplicates requests, reuses cached weather, and preserves the last success on failure', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const fetcher = vi.fn(async (url: URL) => ({ ok: true, json: async () => url.hostname.startsWith('air-quality') ? {} : fixture() }));
    vi.stubGlobal('fetch', fetcher);
    const place = { ...city, latitude: 24.481 };
    const [a, b] = await Promise.all([loadWeather(place), loadWeather(place)]);
    expect(a).toEqual(b); expect(fetcher).toHaveBeenCalledTimes(2);
    await loadWeather(place); expect(fetcher).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now + 31 * 60 * 1000);
    fetcher.mockRejectedValue(new Error('offline'));
    await expect(loadWeather(place)).rejects.toThrow('offline');
    expect(readWeatherCache(place)?.temp).toBe(29);
  });
  it('aborted city searches do not retry', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetcher);
    await expect(searchWeatherCities('厦门', controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('weather backgrounds', () => {
  it.each([[0, 'sunny'], [2, 'partly-cloudy'], [3, 'cloud'], [45, 'fog'], [65, 'rain'], [85, 'snow'], [95, 'storm'], [null, 'unknown'], [123, 'unknown']] as const)('maps current WMO code %s and preserves weather at night', (code, tone) => {
    expect(weatherTone(code, true)).toBe(tone);
    expect(weatherTone(code, false)).toBe(`${tone} weather-night`);
  });
});
