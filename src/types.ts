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
export type FolderLayout = '1x1' | '2x2';

/**
 * 图标裁剪参数（相对值，单位 %，范围 0~100）
 * x/y：裁剪框左上角在原图中的位置
 * size：裁剪框边长占原图短边的百分比
 * 渲染时用 CSS transform 实现，无需 canvas，无跨域限制。
 */
export interface IconCrop {
  x: number;   // 0~100
  y: number;   // 0~100
  size: number; // 1~100
}

// 桌面项（应用 / 文件夹 / 系统应用 / 组件）
export interface DesktopItem {
  id: string;
  type: ItemType;
  name: string;
  // 应用 URL（system / widget 类型可为空）
  url?: string;
  // 图标来源：favicon URL 或自定义 dataURL
  iconUrl?: string;
  // 图标裁剪参数（CSS 模式，无跨域限制）
  iconCrop?: IconCrop;
  // 图标颜色主题（无自定义图标时使用）
  color: IconColor;
  // 所在页面索引（普通桌面从 0 起；隐私桌面从 -1 向左递减）
  page: number;
  // 网格位置（行, 列）—— widget 始终 col=0，视觉占满整行
  row: number;
  col: number;
  // 文件夹内应用列表
  children?: DesktopItem[];
  // 文件夹在桌面网格中的占位；旧数据未声明时按 1x1 处理
  folderLayout?: FolderLayout;
  // 组件类型（仅 type='widget' 时有效）
  widgetType?: WidgetType;
}

import type { PrivacyVault } from '@/lib/privacyCrypto';

// 桌面数据
export interface DesktopData {
  pages: DesktopItem[][];
  version: number;
  /** 加密后的隐私桌面 vault（AES-256-GCM，多端同步用） */
  privacyVault?: PrivacyVault;
  /** @deprecated 旧版 PIN 哈希，已由 privacyVault 替代 */
  pinHash?: string;
  /** @deprecated 旧版明文隐私数据，已由 privacyVault 替代 */
  privacyItems?: DesktopItem[];
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
  /** 上一次确认过的远端分支 HEAD；用于阻止多设备静默覆盖 */
  lastRemoteHead?: string;
  /** 最近一次成功上传/下载的背景媒体摘要，用于避免重复上传大文件。 */
  lastBackgroundSha256?: string;
  /** 最近一次成功上传/下载的 GitHub 背景媒体 blob SHA。 */
  lastBackgroundBlobSha?: string;
  /** 勾选后 Token 持久化到 localStorage；默认仅保留在当前会话 */
  rememberToken?: boolean;
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
  bgImage?: string;        // URL / blob URL；本地文件本体持久化在 IndexedDB
  bgVideo?: string;        // URL / blob URL；本地文件本体持久化在 IndexedDB
  bgType?: 'image' | 'video' | 'default';
  style: DesktopStyle;
  iconSize: number;        // 默认 46
  iconRadiusPct: number;   // 图标圆角百分比，默认 25，范围 0-50
  cols: 4 | 5;
  rows: number;            // 每页总视觉行数（含 widget 行），默认 8，范围 1-16
  bgOverlayEnabled?: boolean;
  bgOverlayScheme?: BgOverlayScheme;
  applyOverlayToWallpaper?: boolean;
  searchEngine?: string;          // 当前搜索引擎 ID，默认 'bing'
  /** 用户新增的搜索引擎，以及对同 ID 内置引擎的本地覆盖。 */
  customEngines?: CustomSearchEngine[];
  /** 被用户删除的内置搜索引擎 ID；自定义引擎删除时直接从 customEngines 移除。 */
  deletedSearchEngineIds?: string[];
}

/** 云端备份中的背景媒体索引；文件本体与 JSON 分开存储，避免重复传输。 */
export interface BackupBackground {
  kind: 'image' | 'video';
  mimeType: string;
  fileName: string;
  size: number;
  sha256: string;
  lastModified?: number;
}

/** 云同步专用备份格式；旧版只有 DesktopData 字段的备份仍保持兼容。 */
export interface DesktopBackup extends DesktopData {
  settings?: DesktopSettings;
  background?: BackupBackground;
}

/** 构建阶段的内存快照；背景文件不会嵌入 JSON。 */
export interface SyncSnapshot {
  data: DesktopBackup;
  backgroundFile?: File;
}

// 拖拽来源信息
export interface DragSource {
  type: 'desktop' | 'folder' | 'privacy';
  itemId: string;
  folderId?: string;
  page?: number;
}
