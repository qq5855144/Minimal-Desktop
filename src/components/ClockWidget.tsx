import React, { useState, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { CLOCK_VISUAL_MIN_HEIGHT_PX } from '@/lib/widgetConfig';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

// 天干地支
const HEAVENLY = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const EARTHLY = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 获取农历信息（近似算法，精度满足日常显示需求）
function getLunarDate(date: Date): string {
  // 以2000年1月6日为农历1999年腊月初一作为基准
  const baseDate = new Date(2000, 0, 6);
  const baseLunarMonth = 11; // 腊月(索引)
  const baseLunarDay = 0;   // 初一(索引)
  const baseLunarYear = 1999;

  const diff = Math.floor((date.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));

  // 农历月份天数（简化：交替29/30天）
  let totalDays = 0;
  let lunarYear = baseLunarYear;
  let lunarMonth = baseLunarMonth;
  let lunarDay = baseLunarDay;

  if (diff >= 0) {
    let remaining = diff;
    while (remaining > 0) {
      const daysInMonth = ((lunarYear * 12 + lunarMonth) % 2 === 0) ? 30 : 29;
      const daysLeft = daysInMonth - lunarDay;
      if (remaining < daysLeft) {
        lunarDay += remaining;
        remaining = 0;
      } else {
        remaining -= daysLeft;
        lunarDay = 0;
        lunarMonth++;
        if (lunarMonth >= 12) {
          lunarMonth = 0;
          lunarYear++;
        }
      }
    }
  }

  const monthName = LUNAR_MONTHS[lunarMonth] + '月';
  const dayName = LUNAR_DAYS[lunarDay] || '初一';
  return `${monthName}${dayName}`;
}

const ClockWidget: React.FC = () => {
  const [now, setNow] = useState(new Date());
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];
  const lunar = getLunarDate(now);

  return (
    <div
      className="flex select-none flex-col items-center justify-end pt-2 pb-1"
      style={{ minHeight: CLOCK_VISUAL_MIN_HEIGHT_PX }}
    >
      <div
        className={`font-bold leading-none ${isNeu ? 'text-slate-700' : 'text-white drop-shadow-lg'}`}
        style={{ fontSize: 'clamp(56px, 14vw, 88px)', letterSpacing: '-2px' }}
      >
        {hours}<span className="opacity-80">:</span>{minutes}
      </div>
      <div className={`mt-1 text-sm md:text-base font-medium tracking-wide ${isNeu ? 'text-slate-500' : 'text-white/90 drop-shadow-md'}`}>
        {month}月{day}日 {weekday} {lunar}
      </div>
    </div>
  );
};

export default ClockWidget;
