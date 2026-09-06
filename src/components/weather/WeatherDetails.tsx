import { ArrowLeft, MapPin, RefreshCw, Search, LocateFixed, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDesktop } from '@/contexts/DesktopContext';
import type { useWeather } from '@/hooks/use-weather';
import { dayKey, POPULAR_WEATHER_CITIES, saveWeatherCity, searchWeatherCities, weatherDate, weatherLabel, weatherTone, WEATHER_TTL, type WeatherCity, type WeatherDay } from '@/lib/weather';
import WeatherGlyph from './WeatherGlyph';
import { locateWeather } from '@/lib/weatherLocation';
import { degrees } from './WeatherWidget';

function CityPicker({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherCity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const search = useRef<AbortController | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; ++generation.current; search.current?.abort(); }; }, []);
  const choose = (city: WeatherCity) => {
    try { saveWeatherCity({ ...city, source: 'manual' }); onDone(); } catch { setError('无法保存城市，请检查浏览器存储权限'); }
  };
  const locate = async () => {
    search.current?.abort(); const request = ++generation.current;
    setBusy(true); setError('');
    try { await locateWeather(true); if (active.current && request === generation.current) onDone(); }
    catch (error) { if (active.current && request === generation.current) setError(error instanceof Error ? error.message : '定位失败，请重试'); }
    finally { if (active.current && request === generation.current) setBusy(false); }
  };
  return <section className="weather-panel weather-city-picker">
    <div className="weather-panel-heading"><h2>选择城市</h2><button type="button" aria-label="关闭城市选择" onClick={onDone}><X size={20} /></button></div>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (query.trim().length < 2) { setError('请输入至少两个字符'); return; }
      search.current?.abort(); const controller = new AbortController(); search.current = controller;
      const request = ++generation.current; setBusy(true); setError('');
      try { const cities = await searchWeatherCities(query, controller.signal); if (active.current && request === generation.current) { setResults(cities); if (!cities.length) setError('未找到城市，可尝试城市拼音'); } }
      catch { if (!controller.signal.aborted && active.current && request === generation.current) setError('城市搜索暂不可用，可选择下方常用城市'); }
      finally { if (active.current && request === generation.current) setBusy(false); }
    }}>
      <input aria-label="城市名称" placeholder="搜索城市，如厦门 / Xiamen" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="submit" disabled={busy} aria-label="搜索城市"><Search size={20} /></button>
    </form>
    <button className="weather-location-button" type="button" onClick={locate} disabled={busy}><LocateFixed size={18} />使用当前位置</button>
    {busy && <p role="status">正在查找…</p>}
    {error && <p role="status">{error}</p>}
    {results.map((city, index) => <button className="weather-city-result" type="button" key={`${city.latitude}-${city.longitude}-${index}`} onClick={() => choose(city)}><b>{city.name}</b><small>{city.region}</small></button>)}
    <div className="weather-popular">{POPULAR_WEATHER_CITIES.map((city) => <button type="button" key={city.name} onClick={() => choose(city)}>{city.name}</button>)}</div>
  </section>;
}

export default function WeatherDetails({ itemId, weather, onClose }: { itemId?: string; weather: ReturnType<typeof useWeather>; onClose: () => void }) {
  const { data, city, loading, error, refresh, locating, locationError, locate } = weather;
  const { data: desktop, setWeatherSize } = useDesktop();
  const item = desktop.pages.flat().find((candidate) => candidate.id === itemId);
  const [picker, setPicker] = useState(false);
  const [options, setOptions] = useState(false);
  const [mode, setMode] = useState<'chart' | 'list'>('chart');
  const [selected, setSelected] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  const timezone = data?.timezone ?? 'Asia/Shanghai';
  const todayKey = dayKey(Date.now() / 1000, timezone);
  const today = data?.days.find((day) => dayKey(day.time, timezone) === todayKey);
  const selectedDay = data?.days.find((day) => day.time === selected) ?? today;
  const dayLabel = (day: WeatherDay) => dayKey(day.time, timezone) === todayKey ? '今天' : weatherDate(day.time, timezone, { weekday: 'short' });
  const hours = data?.hours.filter((hour) => hour.time + 3600 > Date.now() / 1000) ?? [];
  const days = data?.days ?? [];
  const values = days.flatMap((day) => [day.high, day.low]).filter((value): value is number => value !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const y = (value: number) => 132 - (value - min) / Math.max(max - min, 1) * 100;
  const aqi = data?.aqi;
  const aqiText = aqi == null ? '暂无数据' : aqi <= 50 ? '优' : aqi <= 100 ? '中等' : aqi <= 150 ? '敏感人群不健康' : aqi <= 200 ? '不健康' : aqi <= 300 ? '很不健康' : '危险';
  return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="天气详情"
    className={`weather-details weather-${weatherTone(data?.code ?? null, data?.day ?? true)}`}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]') ?? []);
        if (!controls.length) return;
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <header className="weather-header">
      <button type="button" aria-label="返回桌面" onClick={onClose}><ArrowLeft /></button>
      <button type="button" className="weather-title" onClick={() => setPicker(!picker)}><MapPin size={19} /><span>{city?.name ?? '天气'}</span></button>
      <button type="button" aria-label="刷新天气" disabled={!city || loading} onClick={() => void refresh(true)}><RefreshCw className={loading ? 'animate-spin' : ''} size={21} /></button>
      <button type="button" aria-label="天气组件设置" onClick={() => setOptions(!options)}><Settings2 size={21} /></button>
    </header>
    <main className="weather-detail-body">
      {picker && <CityPicker onDone={() => setPicker(false)} />}
      {options && <section className="weather-panel"><div className="weather-panel-heading"><h2>组件尺寸</h2><button type="button" onClick={() => setPicker(true)}>更换城市</button></div><div className="weather-size-options">{(['small', 'large'] as const).map((size) => <button type="button" key={size} aria-pressed={(item?.weatherSize ?? 'small') === size} disabled={!item} onClick={() => { if (itemId && !setWeatherSize(itemId, size)) toast.error('空间不足'); }}>{size === 'small' ? '小 · 2行×2列' : '大 · 2行×4列'}</button>)}</div></section>}
      {locationError && <div className="weather-notice" role="status">{locationError}<button type="button" disabled={locating} onClick={() => void locate()}>允许定位 / 重试</button></div>}
      {error && <div className="weather-notice" role="status">{error}{data ? '，当前显示上次数据。' : ''}<button type="button" disabled={loading} onClick={() => void refresh(true)}>重试</button></div>}
      {!data && <section className="weather-empty"><WeatherGlyph code={null} /><h2>{locating ? '正在定位' : loading ? '正在获取天气' : city ? '暂时没有天气数据' : '当地天气'}</h2><p>{city ? '网络恢复后可刷新重试' : '允许定位后自动获取当地天气'}</p>{!city && <button type="button" disabled={locating} onClick={() => void locate()}>允许定位</button>}{!city && !picker && <button type="button" onClick={() => setPicker(true)}>选择城市</button>}</section>}
      {data && <>
        <section className="weather-hero"><WeatherGlyph code={data.code} day={data.day} /><strong>{degrees(data.temp)}</strong><h1>{weatherLabel(data.code)}</h1><p>最低 {degrees(today?.low)} · 最高 {degrees(today?.high)}</p><small>{Date.now() - data.updated >= WEATHER_TTL ? '缓存 · ' : ''}{weatherDate(data.observed, timezone, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} 更新</small></section>
        <section className="weather-panel"><div className="weather-panel-heading"><h2>逐小时预报</h2><small>未来 24 小时</small></div><div className="weather-hours">{hours.map((hour) => <div key={hour.time}><span>{weatherDate(hour.time, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span><WeatherGlyph code={hour.code} day={hour.day} /><small>{hour.rain == null ? '—' : `${Math.round(hour.rain)}%`}</small><strong>{degrees(hour.temp)}</strong></div>)}</div></section>
        <section className="weather-panel"><div className="weather-panel-heading"><h2>多日天气预报</h2><div className="weather-segment">{(['chart', 'list'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'chart' ? '折线' : '列表'}</button>)}</div></div>
          {mode === 'chart' ? <div className="weather-chart-scroll"><div style={{ width: days.length * 88 }}>
            <div className="weather-days">{days.map((day) => <button type="button" key={day.time} style={{ opacity: dayKey(day.time, timezone) < todayKey ? 0.45 : 1 }} onClick={() => setSelected(day.time)}><b>{dayLabel(day)}</b><small>{weatherDate(day.time, timezone, { month: 'numeric', day: 'numeric' })}</small><span>{weatherLabel(day.code)}</span><WeatherGlyph code={day.code} /><small>{day.rain == null ? '—' : `${Math.round(day.rain)}%`}</small></button>)}</div>
            <svg className="weather-temp-chart" width={days.length * 88} height="178" role="img" aria-label="每日最高与最低气温趋势，具体数值可切换列表查看">
              {(['high', 'low'] as const).map((kind) => <g key={kind}>{days.map((day, i) => {
                const temp = day[kind]; if (temp === null) return null;
                const previous = days[i - 1]?.[kind]; const x = i * 88 + 44; const cy = y(temp);
                return <g key={day.time}>{previous != null && <line x1={x - 88} y1={y(previous)} x2={x} y2={cy} stroke="white" strokeOpacity={kind === 'high' ? 0.75 : 0.45} strokeWidth="3" strokeLinecap="round" />}<circle cx={x} cy={cy} r="4" fill="white" /><text x={x} y={cy + (kind === 'high' ? -12 : 23)} textAnchor="middle" fill="white" fontSize="17">{degrees(temp)}</text></g>;
              })}</g>)}
            </svg>
          </div></div> : <div className="weather-day-list">{days.map((day) => <button type="button" key={day.time} onClick={() => setSelected(day.time)}><span>{dayLabel(day)}<small>{weatherDate(day.time, timezone, { month: 'numeric', day: 'numeric' })}</small></span><WeatherGlyph code={day.code} /><span>{weatherLabel(day.code)}</span><b>{degrees(day.low)} / {degrees(day.high)}</b></button>)}</div>}
          {selectedDay && <div className="weather-day-summary"><b>{dayLabel(selectedDay)}详情</b><span>降水概率 {selectedDay.rain == null ? '—' : `${Math.round(selectedDay.rain)}%`}</span><span>日出 {selectedDay.sunrise == null ? '—' : weatherDate(selectedDay.sunrise, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span><span>日落 {selectedDay.sunset == null ? '—' : weatherDate(selectedDay.sunset, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span><span>紫外线指数 {selectedDay.uv ?? '—'}</span></div>}
        </section>
        <section className="weather-panel weather-air"><div className="weather-panel-heading"><h2>空气质量</h2><small>美标 AQI · 模型预报</small></div><strong>{aqiText} {aqi == null ? '' : Math.round(aqi)}</strong><p>PM₂.₅ {data.pm25 == null ? '暂无数据' : `${data.pm25.toFixed(1)} μg/m³`}</p>{aqi != null && <div className="weather-aqi-bar"><i style={{ left: `${Math.min(100, Math.max(0, aqi / 500 * 100))}%` }} /></div>}</section>
        <section className="weather-facts"><div><small>体感温度</small><b>{degrees(data.feels)}</b></div><div><small>相对湿度</small><b>{data.humidity == null ? '—' : `${Math.round(data.humidity)}%`}</b></div><div><small>风速</small><b>{data.wind == null ? '—' : `${Math.round(data.wind)} km/h`}</b></div></section>
      </>}
      <footer className="weather-attribution">天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · 空气质量：CAMS<br />城市数据：GeoNames · 非商业免费 API<br /><span>网络异常时保留最近缓存，预报可能与实况存在差异</span></footer>
    </main>
  </div>;
}
