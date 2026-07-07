// 面板双风格主题工具
// glassmorphism: 深色毛玻璃  neumorphism: 浅色新拟态

export interface PanelTheme {
  // 底部 sheet 背景 + 边框
  sheetBg: string;
  sheetBorder: string;
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
      sheetBg: 'bg-[rgba(225,232,245,0.98)]',
      sheetBorder: 'border-t border-gray-200/80',
      handle: 'bg-gray-300/80',
      textPrimary: 'text-gray-800',
      textMuted: 'text-gray-500',
      textDim: 'text-gray-400',
      itemBg: 'bg-white/70',
      itemBgHover: 'hover:bg-white/90',
      itemBgActive: 'bg-white/90',
      itemBorder: 'border-gray-200/60',
      divider: 'bg-gray-200/80',
      closeBtn: 'bg-gray-200/70',
      closeBtnHover: 'hover:bg-gray-300/70',
      inputCls: 'w-full rounded-xl bg-white/80 border border-gray-200 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-primary/60',
      selectCls: 'rounded-xl bg-white/80 border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-primary/60',
      labelCls: 'text-sm text-gray-500',
      dangerBg: 'bg-orange-50',
      dangerText: 'text-orange-500',
      backText: 'text-gray-400',
      iconPlaceholder: 'bg-gray-200/80',
      tabBg: 'bg-gray-200/60',
      tabActive: 'bg-white/90',
      tabActiveText: 'text-gray-800',
      tabInactiveText: 'text-gray-400',
    };
  }
  return {
    sheetBg: 'bg-[rgba(20,20,30,0.92)] backdrop-blur-2xl',
    sheetBorder: 'border-t border-white/10',
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
