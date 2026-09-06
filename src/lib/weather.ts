import { z } from 'zod';

export const WEATHER_TTL = 30 * 60 * 1000;
const nullable = z.number().finite().nullable();
export const weatherCitySchema = z.object({
  name: z.string().min(1).max(160),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  region: z.string().optional(),
  source: z.enum(['device', 'manual']).optional(),
});
export type WeatherCity = z.infer<typeof weatherCitySchema>;
export interface WeatherHour { time: number; temp: number | null; code: number | null; rain: number | null; day: boolean }
export interface WeatherDay { time: number; code: number | null; high: number | null; low: number | null; rain: number | null; sunrise: number | null; sunset: number | null; uv: number | null }
export interface WeatherData {
  city: WeatherCity; timezone: string; updated: number; observed: number;
  temp: number | null; feels: number | null; humidity: number | null; wind: number | null;
  code: number | null; day: boolean; hours: WeatherHour[]; days: WeatherDay[];
  aqi: number | null; pm25: number | null;
}
const forecastSchema = z.object({
  timezone: z.string(),
  current: z.object({ time: z.number(), temperature_2m: nullable, apparent_temperature: nullable,
    relative_humidity_2m: nullable, wind_speed_10m: nullable, weather_code: nullable, is_day: nullable }),
  hourly: z.object({ time: z.array(z.number()), temperature_2m: z.array(nullable),
    weather_code: z.array(nullable), precipitation_probability: z.array(nullable), is_day: z.array(nullable) }),
  daily: z.object({ time: z.array(z.number()), weather_code: z.array(nullable),
    temperature_2m_max: z.array(nullable), temperature_2m_min: z.array(nullable),
    precipitation_probability_max: z.array(nullable), sunrise: z.array(nullable), sunset: z.array(nullable), uv_index_max: z.array(nullable) }),
});
const airSchema = z.object({ hourly: z.object({ time: z.array(z.number()), us_aqi: z.array(nullable), pm2_5: z.array(nullable) }) });
export function weatherLabel(code: number | null): string {
  if (code === null) return '暂无天气';
  if (code === 0) return '晴';
  if (code <= 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return code === 65 ? '大雨' : '雨';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 95 && code <= 99) return '雷雨';
  return '暂无天气';
}
export function weatherTone(code: number | null, day = true): string {
  let tone = 'unknown';
  if (code === 0 || code === 1) tone = 'sunny';
  else if (code === 2) tone = 'partly-cloudy';
  else if (code === 3) tone = 'cloud';
  else if (code === 45 || code === 48) tone = 'fog';
  else if ([71, 73, 75, 77, 85, 86].includes(code ?? -1)) tone = 'snow';
  else if ([95, 96, 99].includes(code ?? -1)) tone = 'storm';
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code ?? -1)) tone = 'rain';
  return day ? tone : `${tone} weather-night`;
}
export function weatherDate(time: number, timezone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: timezone }).format(time * 1000);
}
export function dayKey(time: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time * 1000);
}
export function normalizeWeather(city: WeatherCity, raw: unknown, air: unknown = null, now = Date.now()): WeatherData {
  const data = forecastSchema.parse(raw);
  // Validate provider timezone before it reaches formatting code.
  new Intl.DateTimeFormat('en', { timeZone: data.timezone });
  const h = data.hourly; const d = data.daily;
  const airData = airSchema.safeParse(air);
  const a = airData.success ? airData.data.hourly : null;
  const airIndex = a ? a.time.findIndex((time) => time <= now / 1000 && time + 3600 > now / 1000) : -1;
  return {
    city, timezone: data.timezone, updated: now, observed: data.current.time,
    temp: data.current.temperature_2m, feels: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m, wind: data.current.wind_speed_10m,
    code: data.current.weather_code, day: data.current.is_day !== 0,
    hours: h.time.map((time, i) => ({ time, temp: h.temperature_2m[i] ?? null,
      code: h.weather_code[i] ?? null, rain: h.precipitation_probability[i] ?? null, day: h.is_day[i] !== 0 }))
      .filter((hour) => hour.time + 3600 > now / 1000).slice(0, 24),
    days: d.time.map((time, i) => ({ time, code: d.weather_code[i] ?? null,
      high: d.temperature_2m_max[i] ?? null, low: d.temperature_2m_min[i] ?? null,
      rain: d.precipitation_probability_max[i] ?? null, sunrise: d.sunrise[i] ?? null,
      sunset: d.sunset[i] ?? null, uv: d.uv_index_max[i] ?? null })),
    aqi: a?.us_aqi[airIndex] ?? null, pm25: a?.pm2_5[airIndex] ?? null,
  };
}

async function fetchJSON(url: URL, signal?: AbortSignal, timeoutMs = 8000, attempts = 2): Promise<unknown> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        if (response.status >= 500 && attempt + 1 < attempts) continue;
        throw new Error(response.status === 429 ? '请求较多，请稍后再试' : `天气服务暂不可用（${response.status}）`);
      }
      return await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt + 1 < attempts && (error instanceof TypeError || controller.signal.aborted)) continue;
      throw error instanceof Error ? error : new Error('天气更新失败');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  throw new Error('天气服务暂不可用');
}
export function forecastURL(city: WeatherCity): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max',
    timezone: 'auto', timeformat: 'unixtime', forecast_days: '7', past_days: '1', wind_speed_unit: 'kmh', temperature_unit: 'celsius',
  }).toString();
  return url;
}
const cacheKey = (city: WeatherCity) => `${city.latitude.toFixed(4)},${city.longitude.toFixed(4)}`;
const memory = new Map<string, WeatherData>();
const inFlight = new Map<string, Promise<WeatherData>>();
export function readWeatherCache(city: WeatherCity): WeatherData | null {
  const key = cacheKey(city);
  const memo = memory.get(key);
  if (memo && Date.now() - memo.updated < 24 * 60 * 60 * 1000) return { ...memo, city };
  memory.delete(key);
  try {
    const entry = JSON.parse(localStorage.getItem('md-weather-cache-v1') ?? 'null');
    if (entry?.key !== key || Date.now() - entry.updated > 24 * 60 * 60 * 1000) return null;
    const data = normalizeWeather(city, entry.raw, entry.air, entry.updated);
    memory.set(key, data); return data;
  } catch { return null; }
}
export function loadWeather(city: WeatherCity, force = false): Promise<WeatherData> {
  const key = cacheKey(city);
  const cached = readWeatherCache(city);
  if (cached && Date.now() - cached.updated < (force ? 60_000 : WEATHER_TTL)) return Promise.resolve(cached);
  const pending = inFlight.get(key); if (pending) return pending;
  const task = (async () => {
    const airURL = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    airURL.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
      hourly: 'us_aqi,pm2_5', timeformat: 'unixtime', forecast_days: '1', timezone: 'auto' }).toString();
    const [raw, air] = await Promise.all([fetchJSON(forecastURL(city)), fetchJSON(airURL, undefined, 3000, 1).catch(() => null)]);
    const result = normalizeWeather(city, raw, air);
    memory.set(key, result);
    // Keep the most recent city only; no unbounded coordinate history.
    if (memory.size > 4) memory.delete(memory.keys().next().value!);
    try { localStorage.setItem('md-weather-cache-v1', JSON.stringify({ key, raw, air, updated: result.updated })); } catch { /* storage full/private mode */ }
    return result;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task); return task;
}
export async function searchWeatherCities(name: string, signal?: AbortSignal): Promise<WeatherCity[]> {
  if (name.trim().length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: name.trim(), count: '8', language: 'zh', format: 'json' }).toString();
  const raw = await fetchJSON(url, signal);
  const parsed = z.object({ results: z.array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number(),
    admin1: z.string().optional(), country: z.string().optional() })).optional() }).parse(raw);
  return (parsed.results ?? []).map((city) => weatherCitySchema.parse({ ...city, region: [city.admin1, city.country].filter(Boolean).join(' · ') }));
}
export const POPULAR_WEATHER_CITIES: WeatherCity[] = [
  { name: '北京', latitude: 39.9042, longitude: 116.4074 },
  { name: '上海', latitude: 31.2304, longitude: 121.4737 },
  { name: '广州', latitude: 23.1291, longitude: 113.2644 },
  { name: '深圳', latitude: 22.5431, longitude: 114.0579 },
  { name: '厦门', latitude: 24.4798, longitude: 118.0894 },
  { name: '成都', latitude: 30.5728, longitude: 104.0668 },
];
export function readWeatherCity(): WeatherCity | null {
  try { const result = weatherCitySchema.safeParse(JSON.parse(localStorage.getItem('md-weather-city-v1') ?? 'null')); return result.success ? result.data : null; } catch { return null; }
}
export function saveWeatherCity(city: WeatherCity): void {
  const parsed = weatherCitySchema.parse(city);
  localStorage.setItem('md-weather-city-v1', JSON.stringify(parsed));
  window.dispatchEvent(new Event('md-weather-city-change'));
}
