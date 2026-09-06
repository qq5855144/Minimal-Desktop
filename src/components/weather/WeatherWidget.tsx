import { MapPin, CloudSun, Umbrella } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWeather } from '@/hooks/use-weather';
import { dayKey, weatherLabel, weatherTone } from '@/lib/weather';
import type { DesktopItem } from '@/types';
import WeatherGlyph from './WeatherGlyph';
import './weather.css';
const WeatherDetails = lazy(() => import('./WeatherDetails'));
export const degrees = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}°`;

export default function WeatherWidget({ item, preview = false }: { item?: DesktopItem; preview?: boolean }) {
  const weather = useWeather(preview);
  const { city, data, loading, error, locating, locationError, locate } = weather;
  const [open, setOpen] = useState(false);
  const wide = item?.weatherSize === 'large';
  const today = data?.days.find((day) => dayKey(day.time, data.timezone) === dayKey(Date.now() / 1000, data.timezone));
  const hours = data?.hours.filter((hour) => hour.time + 3600 > Date.now() / 1000).slice(0, 3) ?? [];
  return <>
    <button type="button" data-press-intent-surface="true"
      className={`weather-card ${wide ? 'weather-card-wide' : ''} weather-${weatherTone(data?.code ?? null, data?.day ?? true)}`}
      aria-label={city ? `${city.name}天气，${degrees(data?.temp)}，查看详情` : '自动定位天气'}
      onClick={() => { if (preview) return; if (!city && !locating) void locate(); setOpen(true); }}>
      <div className="weather-card-main">
        <div className="weather-city"><MapPin size={14} /><span>{city?.name ?? (locating ? '正在定位' : '当地天气')}</span></div>
        <div className="weather-card-reading"><strong>{degrees(data?.temp)}</strong><WeatherGlyph code={data?.code ?? null} day={data?.day} /></div>
        <div className="weather-card-range">{data ? weatherLabel(data.code) : loading ? '正在更新' : '天气'}<span>{degrees(today?.low)} / {degrees(today?.high)}</span></div>
        <div className="weather-card-hint"><Umbrella size={14} /><span>{locating ? '正在获取位置…' : locationError ? '点击查看定位设置' : error ? '更新失败 · 查看详情' : !city ? '点击允许定位' : !data ? '点击查看天气' : today?.rain == null ? '查看天气趋势' : `今日降水概率 ${Math.round(today.rain)}%`}</span></div>
      </div>
      {wide && <div className="weather-card-extra">
        {hours.length ? hours.map((hour) => <div key={hour.time}><span>{new Intl.DateTimeFormat('zh-CN', { timeZone: data!.timezone, hour: '2-digit', hourCycle: 'h23' }).format(hour.time * 1000)}时</span><WeatherGlyph code={hour.code} day={hour.day} /><b>{degrees(hour.temp)}</b></div>) : <CloudSun size={48} />}
      </div>}
    </button>
    {open && !preview && createPortal(<Suspense fallback={<div className="weather-detail-loading" role="status">正在打开天气…</div>}><WeatherDetails itemId={item?.id} weather={weather} onClose={() => setOpen(false)} /></Suspense>, document.body)}
  </>;
}
