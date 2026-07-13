// 应用图标颜色主题
export type IconColor =
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'purple'
  | 'yellow'
  | 'pink'
  | 'teal'
  | 'indigo'
  | 'gray';

// 桌面项类型（widget = 全宽组件，占满一整行）
export type ItemType = 'app' | 'folder' | 'system' | 'widget';
export type WidgetType = 'clock' | 'search' | 'combined';

// 桌面项（应用 / 文件夹 / 系统应用 / 组件）
export interface DesktopItem {
  id: string;
  type: ItemType;
  name: string;
  // 应用 URL（system / widget 类型可为空）
  url?: string;
  // 图标来源：favicon URL 或自定义 dataURL
  iconUrl?: string;
  // 图标颜色主题（无自定义图标时使用）
  color: IconColor;
  // 所在页面索引（0 起）
  page: number;
  // 网格位置（行, 列）—— widget 始终 col=0，视觉占满整行
  row: number;
  col: number;
  // 文件夹内应用列表
  children?: DesktopItem[];
  // 组件类型（仅 type='widget' 时有效）
  widgetType?: WidgetType;
}

// 桌面数据
export interface DesktopData {
  pages: DesktopItem[][];
  dock: DesktopItem[];
  version: number;
}

// GitHub 同步配置
export interface SyncConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  fileName: string;
  syncInterval: 'manual' | '1d' | '7d' | '30d';
  autoSync: boolean;   // 数据变更时自动上传
  lastSyncAt?: string; // ISO string
}

// 搜索引擎
export interface CustomSearchEngine {
  id: string;
  name: string;
  urlTemplate: string;   // 含 {q} 占位符，如 https://example.com/search?q={q}
  iconUrl?: string;      // 自定义图标 URL（可选）
  color: string;         // 背景色
}

// 桌面外观设置
export type DesktopStyle = 'glassmorphism' | 'neumorphism';
export type BgOverlayScheme = 'aurora' | 'sunset' | 'forest' | 'midnight' | 'warm';
export interface DesktopSettings {
  bgImage?: string;        // base64 或 URL（图片/GIF）
  bgVideo?: string;        // object URL（视频，非持久化）
  bgType?: 'image' | 'video' | 'default';
  style: DesktopStyle;
  dockEnabled?: boolean;   // 是否显示底部 Dock 栏
  iconSize: number;        // 默认 46
  cols: 4 | 5;
  rows: number;            // 每页最大行数，默认 7，范围 1-14
  bgOverlayEnabled?: boolean;
  bgOverlayScheme?: BgOverlayScheme;
  applyOverlayToWallpaper?: boolean;
  searchEngine?: string;          // 当前搜索引擎 ID，默认 'bing'
  customEngines?: CustomSearchEngine[]; // 用户自定义搜索引擎列表
  pixabayKey?: string;            // Pixabay API Key（用于壁纸分类加载）
}

// 拖拽来源信息
export interface DragSource {
  type: 'desktop' | 'folder' | 'dock';
  itemId: string;
  folderId?: string;
  page?: number;
}
