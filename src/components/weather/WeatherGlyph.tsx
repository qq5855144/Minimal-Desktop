import { Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun } from 'lucide-react';
export default function WeatherGlyph({ code, day = true, className = '' }: { code: number | null; day?: boolean; className?: string }) {
  const Icon = code === null ? Cloud : code >= 95 ? CloudLightning : (code >= 71 && code <= 77) || code === 85 || code === 86
    ? CloudSnow : code >= 51 ? CloudRain : code >= 45 ? CloudFog : code === 3 ? Cloud
      : code === 0 ? (day ? Sun : Moon) : day ? CloudSun : CloudMoon;
  return <Icon aria-hidden="true" className={`weather-glyph ${className}`} strokeWidth={1.8} />;
}
