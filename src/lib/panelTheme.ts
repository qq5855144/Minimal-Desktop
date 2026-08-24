// 面板双风格主题工具
// glassmorphism: 深色毛玻璃  neumorphism: 浅色新拟态
import type React from 'react';

export interface PanelTheme {
  // 底部 sheet 背景 + 边框
  sheetBg: string;
  sheetBorder: string;
  // sheet 内联样式（用于渐变背景等无法用 class 表达的样式）
  sheetStyle?: React.CSSProperties;
  // 拖拽把手
  handle: string;
  // 文字
  textPrimary: string;
  textMuted: string;
  textDim: string;
  // 列表项 / 卡片背景
  itemBg: string;
  itemBgHover: string;
  itemBgActive: string;
  itemBorder: string;
  // 分割线
  divider: string;
  // 关闭按钮
  closeBtn: string;
  closeBtnHover: string;
  // 输入框
  inputCls: string;
  // select 下拉
  selectCls: string;
  // 小标签文字
  labelCls: string;
  // 危险/警告区域背景（orange）
  dangerBg: string;
  dangerText: string;
  // 返回按钮文字
  backText: string;
  // 图标预览占位背景
  iconPlaceholder: string;
  // Tab 选择器背景
  tabBg: string;
  tabActive: string;
  tabActiveText: string;
  tabInactiveText: string;
}

export function getPanelTheme(isNeu: boolean): PanelTheme {
  if (isNeu) {
    return {
      sheetBg: 'bg-white',
      sheetBorder: 'border-t border-slate-900/[0.04]',
      sheetStyle: {
        background: '#ffffff',
        boxShadow: '0 -14px 40px rgba(15,23,42,0.13), 0 -3px 10px rgba(71,85,105,0.07)',
      },
      handle: 'bg-slate-300/80',
      textPrimary: 'text-gray-800',
      textMuted: 'text-gray-500',
      textDim: 'text-gray-400',
      itemBg: 'bg-white shadow-[4px_5px_14px_rgba(15,23,42,0.08),-3px_-3px_10px_rgba(255,255,255,1)]',
      itemBgHover: 'hover:bg-slate-50/70',
      itemBgActive: 'bg-slate-50/80',
      itemBorder: 'border-slate-900/[0.05]',
      divider: 'bg-gray-200/80',
      closeBtn: 'bg-white shadow-[3px_4px_10px_rgba(15,23,42,0.10),-2px_-2px_8px_rgba(255,255,255,1)]',
      closeBtnHover: 'hover:bg-slate-50/70',
      inputCls: 'w-full rounded-xl bg-white border border-slate-900/[0.05] shadow-[inset_3px_3px_8px_rgba(15,23,42,0.10),inset_-3px_-3px_8px_rgba(255,255,255,1)] px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-primary/50',
      selectCls: 'rounded-xl bg-white border border-slate-900/[0.05] shadow-[inset_3px_3px_8px_rgba(15,23,42,0.10),inset_-3px_-3px_8px_rgba(255,255,255,1)] px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-primary/50',
      labelCls: 'text-sm text-gray-500',
      dangerBg: 'bg-orange-50',
      dangerText: 'text-orange-500',
      backText: 'text-gray-400',
      iconPlaceholder: 'bg-slate-100',
      tabBg: 'bg-white shadow-[inset_3px_3px_8px_rgba(15,23,42,0.09),inset_-3px_-3px_8px_rgba(255,255,255,1)]',
      tabActive: 'bg-white shadow-[3px_4px_10px_rgba(15,23,42,0.10),-2px_-2px_8px_rgba(255,255,255,1)]',
      tabActiveText: 'text-gray-800',
      tabInactiveText: 'text-gray-400',
    };
  }
  return {
    sheetBg: 'backdrop-blur-2xl',
    sheetBorder: 'border-t border-white/10',
    sheetStyle: {
      background: 'linear-gradient(180deg, rgba(60,40,120,0.45) 0%, rgba(30,70,140,0.38) 45%, rgba(20,110,130,0.35) 100%)',
    },
    handle: 'bg-white/20',
    textPrimary: 'text-white',
    textMuted: 'text-white/60',
    textDim: 'text-white/30',
    itemBg: 'bg-white/10',
    itemBgHover: 'hover:bg-white/15',
    itemBgActive: 'bg-white/20',
    itemBorder: 'border-white/10',
    divider: 'bg-white/10',
    closeBtn: 'bg-white/10',
    closeBtnHover: 'hover:bg-white/20',
    inputCls: 'w-full rounded-xl bg-white/10 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60',
    selectCls: 'rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/60',
    labelCls: 'text-sm text-white/60',
    dangerBg: 'bg-orange-500/20',
    dangerText: 'text-orange-400',
    backText: 'text-white/60',
    iconPlaceholder: 'bg-white/10',
    tabBg: 'bg-white/8',
    tabActive: 'bg-white/20',
    tabActiveText: 'text-white',
    tabInactiveText: 'text-white/40',
  };
}
