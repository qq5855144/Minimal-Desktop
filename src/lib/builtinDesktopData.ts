import type { DesktopData, DesktopSettings } from '@/types';
import { resolveBuiltinIcons } from './builtinDesktopIcons';

/**
 * 内置默认桌面数据：来自作者桌面备份快照。
 * 已按要求剔除隐私桌面（privacyVault）与书签（bookmarks）。
 * 这些条目是普通桌面项，不属于 SYSTEM_APPS，用户可自由删除且不会被迁移逻辑补回。
 */
const BUILTIN_PAGES_RAW: DesktopData['pages'] = [
  [
    {
      "id": "widget-clock",
      "type": "widget",
      "name": "时钟",
      "color": "blue",
      "page": 0,
      "row": 0,
      "col": 0,
      "widgetType": "clock"
    },
    {
      "id": "widget-search",
      "type": "widget",
      "name": "搜索栏",
      "color": "blue",
      "page": 0,
      "row": 2,
      "col": 0,
      "widgetType": "search"
    },
    {
      "id": "widget-weather",
      "type": "widget",
      "name": "天气",
      "color": "blue",
      "page": 0,
      "row": 3,
      "col": 0,
      "widgetType": "weather",
      "weatherSize": "small"
    },
    {
      "id": "id_1787625226008_0iq6ei",
      "type": "folder",
      "name": "文件夹",
      "color": "gray",
      "page": 0,
      "row": 3,
      "col": 2,
      "children": [
        {
          "id": "id_1785278322821_o6mggn",
          "type": "app",
          "name": "手机壁纸",
          "url": "https://haowallpaper.com/mobileView",
          "iconUrl": "https://favicon.im/haowallpaper.com",
          "iconCrop": {
            "x": 0,
            "y": 0,
            "size": 100
          },
          "color": "blue",
          "page": 0,
          "row": 3,
          "col": 2
        },
        {
          "id": "id_1784021229944_5mwmct",
          "type": "app",
          "name": "PixForge",
          "url": "https://qq5855144.github.io/PixForge/",
          "iconUrl": "@@ICON@@id_1784021229944_5mwmct@@",
          "iconCrop": {
            "x": 10,
            "y": 10,
            "size": 80
          },
          "color": "blue",
          "page": 0,
          "row": 3,
          "col": 2
        },
        {
          "id": "id_1795680278807_fghaxp",
          "type": "app",
          "name": "iOS 高清与 4K 壁纸",
          "url": "https://applewalls.com/zh/ios-wallpapers",
          "iconUrl": "https://applewalls.com/android-chrome-192x192.png",
          "color": "blue",
          "page": 0,
          "row": 3,
          "col": 2
        }
      ],
      "folderLayout": "2x1"
    },
    {
      "id": "sys-bookmarks",
      "type": "system",
      "name": "书签",
      "color": "orange",
      "page": 0,
      "row": 3,
      "col": 3
    },
    {
      "id": "id_1794192239547_k7uftc",
      "type": "app",
      "name": "GitHubM",
      "url": "https://githubm-web.pages.dev/",
      "iconUrl": "@@ICON@@id_1794192239547_k7uftc@@",
      "iconCrop": {
        "x": 0,
        "y": 0,
        "size": 100
      },
      "color": "blue",
      "page": 0,
      "row": 4,
      "col": 3
    },
    {
      "id": "id_1785131053839_m2t248",
      "type": "app",
      "name": "DeepSeek",
      "url": "https://chat.deepseek.com/",
      "iconUrl": "@@ICON@@id_1785131053839_m2t248@@",
      "iconCrop": {
        "x": 10,
        "y": 10,
        "size": 80
      },
      "color": "blue",
      "page": 0,
      "row": 5,
      "col": 3
    },
    {
      "id": "id_1784466621487_x7z6zg",
      "type": "folder",
      "name": "文件夹",
      "color": "gray",
      "page": 0,
      "row": 5,
      "col": 0,
      "children": [
        {
          "id": "id_1784451858769_nqqyzf",
          "type": "app",
          "name": "huang1111网盘",
          "url": "https://pan.huang1111.cn/login",
          "iconUrl": "@@ICON@@id_1784451858769_nqqyzf@@",
          "iconCrop": {
            "x": 5,
            "y": 5,
            "size": 90
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1784638854574_c1zloc",
          "type": "app",
          "name": "SMS",
          "url": "https://lubansms.com/",
          "iconUrl": "@@ICON@@id_1784638854574_c1zloc@@",
          "iconCrop": {
            "x": 7.5,
            "y": 7.5,
            "size": 85
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1784451479354_my103l",
          "type": "app",
          "name": "Yesicon",
          "url": "https://yesicon.app/",
          "iconUrl": "@@ICON@@id_1784451479354_my103l@@",
          "iconCrop": {
            "x": 10,
            "y": 10,
            "size": 80
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1784638886262_p0uddx",
          "type": "app",
          "name": "Free email",
          "url": "https://www.mail.com/",
          "iconUrl": "@@ICON@@id_1784638886262_p0uddx@@",
          "iconCrop": {
            "x": 10,
            "y": 10,
            "size": 80
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1786270302129_nkpit1",
          "type": "app",
          "name": "脚本集",
          "url": "https://gitlink.org.cn/damengzhu/XBrowser-User-Scripts/tree/master/X%E6%B5%8F%E8%A7%88%E5%99%A8%E8%84%9A%E6%9C%AC%E6%95%B4%E7%90%86.md",
          "iconUrl": "https://gitlink.org.cn/images/avatars/LaboratorySetting/1tab?t=1638344457",
          "iconCrop": {
            "x": 0,
            "y": 0,
            "size": 100
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1785625543328_hm1gk1",
          "type": "app",
          "name": "Greasy Fork",
          "url": "https://greasyfork.org/zh-CN",
          "iconUrl": "https://greasyfork.org/vite/assets/blacklogo96-CxYTSM_T.png",
          "iconCrop": {
            "x": 0,
            "y": 0,
            "size": 100
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1786270458431_vxazu9",
          "type": "app",
          "name": "Login",
          "url": "https://qyun.org/login",
          "iconUrl": "https://qyun.org/assets/img/favicon.png",
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1787639194882_cvijvs",
          "type": "app",
          "name": "新标签页",
          "url": "https://go.itab.link/",
          "iconUrl": "https://go.itab.link/favicon.ico",
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        },
        {
          "id": "id_1784777048635_4wx602",
          "type": "app",
          "name": "MT图床",
          "url": "https://img.binmt.cc/",
          "iconUrl": "@@ICON@@id_1784777048635_4wx602@@",
          "iconCrop": {
            "x": 10,
            "y": 10,
            "size": 80
          },
          "color": "blue",
          "page": 0,
          "row": 5,
          "col": 0
        }
      ],
      "folderLayout": "2x2"
    },
    {
      "id": "id_1786108696922_h1tet8",
      "type": "app",
      "name": "ChatGPT",
      "url": "https://chatgpt.com/",
      "iconUrl": "@@ICON@@id_1786108696922_h1tet8@@",
      "iconCrop": {
        "x": 0,
        "y": 0,
        "size": 100
      },
      "color": "blue",
      "page": 0,
      "row": 5,
      "col": 2
    },
    {
      "id": "id_1787625238886_f2kllx",
      "type": "folder",
      "name": "桌面设置",
      "color": "gray",
      "page": 0,
      "row": 6,
      "col": 2,
      "children": [
        {
          "id": "sys-add",
          "type": "system",
          "name": "添加应用",
          "color": "blue",
          "page": 0,
          "row": 6,
          "col": 2
        },
        {
          "id": "sys-settings",
          "type": "system",
          "name": "设置",
          "color": "gray",
          "page": 0,
          "row": 6,
          "col": 2
        },
        {
          "id": "sys-sync",
          "type": "system",
          "name": "同步",
          "iconUrl": "@@ICON@@sys-sync@@",
          "color": "indigo",
          "page": 0,
          "row": 6,
          "col": 2
        }
      ],
      "folderLayout": "1x2"
    }
  ],
  [
    {
      "id": "id_1785406850521_o41gc6",
      "type": "app",
      "name": "YouTube",
      "url": "https://m.youtube.com/",
      "iconUrl": "@@ICON@@id_1785406850521_o41gc6@@",
      "iconCrop": {
        "x": 7.5,
        "y": 7.5,
        "size": 85
      },
      "color": "blue",
      "page": 1,
      "row": 2,
      "col": 0
    },
    {
      "id": "id_1784801261722_onaish",
      "type": "app",
      "name": "脚本猫",
      "url": "https://scriptcat.org/zh-CN/users/181254",
      "iconUrl": "@@ICON@@id_1784801261722_onaish@@",
      "iconCrop": {
        "x": 10,
        "y": 10,
        "size": 80
      },
      "color": "blue",
      "page": 1,
      "row": 1,
      "col": 1
    },
    {
      "id": "sys-drive",
      "type": "system",
      "name": "云盘",
      "color": "teal",
      "page": 1,
      "row": 0,
      "col": 0
    },
    {
      "id": "id_1784467090052_0bim3n",
      "type": "app",
      "name": "Crx搜搜",
      "url": "https://www.crxsoso.com/",
      "iconUrl": "https://www.crxsoso.com/apple-touch-icon.png",
      "iconCrop": {
        "x": 0,
        "y": 0,
        "size": 100
      },
      "color": "blue",
      "page": 1,
      "row": 1,
      "col": 0
    },
    {
      "id": "id_1792017993594_sx5l80",
      "type": "app",
      "name": "notrackAI",
      "url": "https://notrack.ai/zh-CN/chat",
      "iconUrl": "https://notrack.ai/favicon.ico",
      "color": "blue",
      "page": 1,
      "row": 0,
      "col": 1
    },
    {
      "id": "id_1783909726432_nze6mj",
      "type": "app",
      "name": "秒哒",
      "url": "https://www.miaoda.cn/",
      "iconUrl": "@@ICON@@id_1783909726432_nze6mj@@",
      "iconCrop": {
        "x": 10,
        "y": 10,
        "size": 80
      },
      "color": "blue",
      "page": 1,
      "row": 0,
      "col": 2
    },
    {
      "id": "id_1785122264303_5312up",
      "type": "app",
      "name": "网易音乐",
      "url": "https://y.music.163.com/m/",
      "iconUrl": "@@ICON@@id_1785122264303_5312up@@",
      "iconCrop": {
        "x": 10,
        "y": 10,
        "size": 80
      },
      "color": "blue",
      "page": 1,
      "row": 0,
      "col": 3
    },
    {
      "id": "id_1791588498045_dz0cw3",
      "type": "app",
      "name": "彩虹云盘",
      "url": "https://4m7uabr0ttm9e.doubaoapps.com/app/app_17fp1fzfbgg",
      "iconUrl": "https://miaoda.feishu.cn/aily/api/v1/files/static/adcf4368f8aea5fed3186aa008cdd95a1d57256fbbd7818a01f8cb3b8af6bf04_ve_miaoda?x-tos-process=image%2Fresize%2Cw_120%2Ch_120%2Cm_fixed%7Crounded-corners%2Cr_14%2Fformat%2Cpng",
      "color": "blue",
      "page": 1,
      "row": 1,
      "col": 2
    },
    {
      "id": "id_1787584132792_ie4ehg",
      "type": "app",
      "name": "千问",
      "url": "https://www.qianwen.com/?ch=webtongyi@sem_360mt360semwebty1_wbzy2_1&planid=2227276185&unitid=58862482&a_keywordid=74801752669&a_creative=11276285309&from=360sem&aid=3632490730&tag=&qhclickid=2cfa385abcbccea1",
      "iconUrl": "https://img.alicdn.com/imgextra/i2/O1CN01taBbMS1CfyJoOt0lB_!!6000000000109-2-tps-80-80.png",
      "color": "blue",
      "page": 1,
      "row": 1,
      "col": 3
    },
    {
      "id": "id_1785830610894_pgucfs",
      "type": "app",
      "name": "导读",
      "url": "https://bbs.binmt.cc/forum.php?mod=guide&view=newthread&index=1",
      "iconUrl": "https://image.goapk.com/goapkmarket/imgfile/20260319/19114543yryi.jpg",
      "iconCrop": {
        "x": 0,
        "y": 0,
        "size": 100
      },
      "color": "blue",
      "page": 1,
      "row": 2,
      "col": 2
    },
    {
      "id": "id_1795241792061_cpfglq",
      "type": "app",
      "name": "AndVM",
      "url": "https://andvm.cn/#top",
      "iconUrl": "https://andvm.cn/assets/andvm-icon.webp",
      "color": "blue",
      "page": 1,
      "row": 2,
      "col": 1
    }
  ]
];

export const BUILTIN_DESKTOP_PAGES: DesktopData['pages'] = BUILTIN_PAGES_RAW.map(resolveBuiltinIcons);

/** 内置桌面配套的外观设置，保证首次渲染的网格行数与快照一致。 */
export const BUILTIN_DESKTOP_SETTINGS: Partial<DesktopSettings> = {
  "bgType": "image",
  "style": "glassmorphism",
  "iconSize": 56,
  "iconRadiusPct": 25,
  "cols": 4,
  "rows": 7,
  "bgOverlayEnabled": false,
  "bgOverlayScheme": "aurora",
  "applyOverlayToWallpaper": false,
  "searchBarStyle": "outline",
  "searchEngine": "duckduckgo",
  "customEngines": [
    {
      "id": "custom-1787577137532",
      "name": "Apkpure",
      "urlTemplate": "https://apkpure.com/search?q={q}",
      "iconUrl": "https://favicon.im/apkpure.com",
      "color": "#039BE5"
    },
    {
      "id": "custom-1787577280953",
      "name": "Crxsoso",
      "urlTemplate": "https://www.crxsoso.com/search?keyword={q}&store={q}",
      "iconUrl": "https://favicon.im/www.crxsoso.com",
      "color": "#43A047"
    }
  ],
  "deletedSearchEngineIds": []
};
