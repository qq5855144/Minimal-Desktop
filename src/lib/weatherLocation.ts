import { z } from 'zod';
import { weatherCitySchema, readWeatherCity, saveWeatherCity, type WeatherCity } from './weather';

let pending: Promise<void> | null = null;
let attemptedAt: number | null = null;
let lastError: unknown = null;

class LocationError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
export function resetWeatherLocationRetry(): void { lastError = null; attemptedAt = null; }
function devicePosition(highAccuracy = false): Promise<WeatherCity> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new LocationError(2, '当前浏览器无法定位')); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({
      name: '附近天气', source: 'device',
      latitude: Math.round(coords.latitude * 100) / 100,
      longitude: Math.round(coords.longitude * 100) / 100,
    }), (error) => reject(new LocationError(error.code, error.code === 1 ? '请在浏览器设置中允许定位' : error.code === 3 ? '定位超时，点击重试' : '暂时无法定位，请检查系统定位开关')),
    { timeout: highAccuracy ? 15_000 : 8_000, maximumAge: highAccuracy ? 0 : 600_000, enableHighAccuracy: highAccuracy });
  });
}
const localitySchema = z.object({
  city: z.string().optional(), locality: z.string().optional(),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
});
// This free endpoint must be called client-side, using a fresh device fix or its IP fallback.
export async function resolveWeatherLocality(position?: WeatherCity): Promise<WeatherCity> {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('localityLanguage', 'zh');
  if (position) {
    url.searchParams.set('latitude', String(position.latitude));
    url.searchParams.set('longitude', String(position.longitude));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('城市名称暂不可用');
    const result = localitySchema.parse(await response.json());
    const name = result.city?.trim() || result.locality?.trim();
    if (!name) throw new Error('未能识别城市');
    return weatherCitySchema.parse({
      name: position ? name : `${name}（大致）`, source: 'device',
      latitude: position?.latitude ?? Math.round(result.latitude * 100) / 100,
      longitude: position?.longitude ?? Math.round(result.longitude * 100) / 100,
    });
  } finally { clearTimeout(timer); }
}
async function currentCity(): Promise<WeatherCity> {
  let position: WeatherCity;
  try { position = await devicePosition(); }
  catch (error) {
    if (!(error instanceof LocationError) || error.code === 1) throw error;
    try { position = await devicePosition(true); }
    catch (retryError) {
      if (!(retryError instanceof LocationError) || retryError.code === 1) throw retryError;
      // Some Android browsers grant permission but their location provider never returns a fix.
      try { return await resolveWeatherLocality(); } catch { throw retryError; }
    }
  }
  try { return await resolveWeatherLocality(position); }
  catch {
    const cached = readWeatherCity();
    if (cached?.source === 'device' && cached.latitude === position.latitude && cached.longitude === position.longitude) return cached;
    return position; // A name lookup failure must not prevent weather for valid coordinates.
  }
}

// Geolocation is a required manifest permission in Chromium; the browser manages consent.
export function locateWeather(userGesture = false): Promise<void> {
  if (pending) return pending;
  if (!userGesture && lastError && !(lastError instanceof LocationError && lastError.code !== 1)) return Promise.reject(lastError);
  if (!userGesture && attemptedAt !== null && Date.now() - attemptedAt < 30 * 60_000) return lastError ? Promise.reject(lastError) : Promise.resolve();
  lastError = null;
  attemptedAt = Date.now();
  const initialCity = JSON.stringify(readWeatherCity());
  pending = (async () => {
    const city = await currentCity();
    // A city selected while permission/location was pending takes precedence.
    if (JSON.stringify(readWeatherCity()) === initialCity) saveWeatherCity(city);
  })().catch((error) => { lastError = error; throw error; }).finally(() => { pending = null; });
  return pending;
}
