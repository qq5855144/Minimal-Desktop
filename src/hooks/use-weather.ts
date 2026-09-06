import { useCallback, useEffect, useRef, useState } from 'react';
import { locateWeather } from '@/lib/weatherLocation';
import { loadWeather, readWeatherCache, readWeatherCity, WEATHER_TTL, type WeatherData } from '@/lib/weather';

export function useWeather(preview = false) {
  const [city, setCity] = useState(readWeatherCity);
  const [data, setData] = useState<WeatherData | null>(() => city ? readWeatherCache(city) : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const locationVersion = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const locate = useCallback(async (userGesture = true) => {
    const request = ++locationVersion.current;
    setLocating(true); setLocationError('');
    try { await locateWeather(userGesture); }
    catch (error) { if (request === locationVersion.current) setLocationError(error instanceof Error ? error.message : '定位失败，请重试'); }
    finally { if (request === locationVersion.current) setLocating(false); }
  }, []);
  useEffect(() => {
    if (preview || city?.source === 'manual') { setLocating(false); setLocationError(''); return; }
    const update = () => { if (document.visibilityState === 'visible') void locate(false); };
    update();
    const timer = setInterval(update, WEATHER_TTL);
    document.addEventListener('visibilitychange', update);
    return () => { ++locationVersion.current; setLocating(false); clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [city?.source, locate, preview]);
  const refresh = useCallback(async (force = false) => {
    if (!city) return;
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      const next = await loadWeather(city, force);
      if (request === version.current) setData(next);
    } catch {
      if (request === version.current) setError('天气暂时无法更新，请检查网络后重试');
    } finally { if (request === version.current) setLoading(false); }
  }, [city]);
  useEffect(() => {
    const update = () => { ++version.current; setCity(readWeatherCity()); };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === 'md-weather-city-v1') update(); };
    window.addEventListener('md-weather-city-change', update);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('md-weather-city-change', update); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => {
    setData(city ? readWeatherCache(city) : null); setError('');
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = setInterval(visibleRefresh, WEATHER_TTL);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    return () => { ++version.current; clearInterval(timer); document.removeEventListener('visibilitychange', visibleRefresh); window.removeEventListener('online', visibleRefresh); };
  }, [city, refresh]);
  return { city, data, loading, error, refresh, locating, locationError, locate };
}
