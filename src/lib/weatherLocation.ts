import { readWeatherCity, saveWeatherCity, type WeatherCity } from './weather';

let pending: Promise<void> | null = null;
let attemptedAt: number | null = null;
let lastError: unknown = null;

function devicePosition(): Promise<WeatherCity> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('当前浏览器无法定位')); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({
      name: '当前位置', source: 'device',
      latitude: Math.round(coords.latitude * 100) / 100,
      longitude: Math.round(coords.longitude * 100) / 100,
    }), (error) => reject(new Error(error.code === 1 ? '请在浏览器设置中允许定位' : error.code === 3 ? '定位超时，点击重试' : '暂时无法定位，请检查系统定位开关')),
    { timeout: 10_000, maximumAge: 600_000, enableHighAccuracy: false });
  });
}

// Only explicit user actions request optional extension permissions.
export function locateWeather(userGesture = false): Promise<void> {
  if (pending) return pending;
  if (!userGesture && lastError) return Promise.reject(lastError);
  if (!userGesture && attemptedAt !== null && Date.now() - attemptedAt < 30 * 60_000) return lastError ? Promise.reject(lastError) : Promise.resolve();
  lastError = null;
  attemptedAt = Date.now();
  const initialCity = JSON.stringify(readWeatherCity());
  const permissions = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.permissions : undefined;
  // Call request synchronously while the click's user activation is still present.
  const permission = permissions
    ? userGesture ? permissions.request({ permissions: ['geolocation'] }) : permissions.contains({ permissions: ['geolocation'] })
    : Promise.resolve(true);
  pending = (async () => {
    if (!await permission) throw new Error('点击允许定位，自动获取当地天气');
    const city = await devicePosition();
    // A city selected while permission/location was pending takes precedence.
    if (JSON.stringify(readWeatherCity()) === initialCity) saveWeatherCity(city);
  })().catch((error) => { lastError = error; throw error; }).finally(() => { pending = null; });
  return pending;
}
