import React, { useState, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { CLOCK_VISUAL_MIN_HEIGHT_PX } from '@/lib/widgetConfig';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 用 lunar-javascript 获取精确农历信息及节日
// getMonth() < 0 表示闰月，getMonthInChinese() 已包含"闰"前缀（如"闰六"）
async function getLunarInfo(date: Date): Promise<string> {
  try {
    const { Solar } = await import('lunar-javascript');
    const solar = Solar.fromDate(date);
    const lunar = solar.getLunar();

    // 农历月日：getMonthInChinese() 闰月时已返回"闰六"等，直接拼月
    const monthCn = lunar.getMonthInChinese() + '月';
    const dayCn = lunar.getDayInChinese();
    const lunarDate = `${monthCn}${dayCn}`;

    // 节日优先级：公历节日 > 农历节日 > 节气
    const solarFestivals: string[] = solar.getFestivals();
    const lunarFestivals: string[] = lunar.getFestivals();
    const jieQi: string = lunar.getJieQi();

    const festival = solarFestivals[0] || lunarFestivals[0] || jieQi || '';
    return festival ? `${lunarDate} · ${festival}` : lunarDate;
  } catch {
    // 兜底：若库异常则仅显示公历
    return '';
  }
}

const ClockWidget: React.FC = () => {
  const [now, setNow] = useState(new Date());
  const [lunarLabel, setLunarLabel] = useState('');
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  useEffect(() => {
    let active = true;
    const [year, month, day] = dateKey.split('-').map(Number);
    getLunarInfo(new Date(year, month, day)).then((label) => { if (active) setLunarLabel(label); });
    return () => { active = false; };
  }, [dateKey]);

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const solarMonth = now.getMonth() + 1;
  const solarDay = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];

  return (
    <div
      className="flex select-none flex-col items-center justify-end pt-2 pb-1"
      style={{ minHeight: CLOCK_VISUAL_MIN_HEIGHT_PX }}
    >
      {/* 整体下移 10px，视觉上拉近与下方行的距离 */}
      <div className="translate-y-[10px]">
        <div
          className={`font-bold leading-none text-center ${isNeu ? 'text-slate-700' : 'text-white drop-shadow-lg'}`}
          style={{ fontSize: 'clamp(56px, 14vw, 88px)', letterSpacing: '-2px' }}
        >
          {hours}<span className="opacity-80">:</span>{minutes}
        </div>
        <div className={`mt-1 text-sm md:text-base font-medium tracking-wide ${isNeu ? 'text-slate-500' : 'text-white/90 drop-shadow-md'}`}>
          {solarMonth}月{solarDay}日 {weekday} {lunarLabel}
        </div>
      </div>
    </div>
  );
};

export default ClockWidget;
