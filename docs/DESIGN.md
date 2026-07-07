## Vibe
- iOS Springboard / Glassmorphism OS：复刻 iOS 主屏幕的毛玻璃材质、圆角图标网格、底部 Dock 与页面指示器，强调触控式桌面操作系统的沉浸质感

## Color
- Primary: #0A84FF（iOS 系统蓝）
- On Primary: #FFFFFF
- Accent: #30D158（iOS 系统绿，用于同步成功 / 激活态）
- On Accent: #FFFFFF
- Background: #F2F2F7（iOS 浅灰背景）
- Foreground: #1C1C1E（近黑文字）
- Muted: #E5E5EA（卡片 / Dock 底色）
- Border: #D1D1D6（分隔线）
- Secondary: #C7C7CC（次级表面）
[色彩规则：大面积背景使用中性浅灰，Primary/Accent 仅用于图标高亮、激活态、按钮；Dock 与弹窗使用半透明毛玻璃；深色模式背景 #000000，卡片 #1C1C1E]

## Typography
- Heading: SF Pro Display / -apple-system（系统字体栈，weight 600）
- Body: SF Pro Text / -apple-system（系统字体栈，weight 400）
[使用系统字体栈保证 iOS 原生质感，无需外部加载]

## Visual Language
- 核心视觉签名：毛玻璃材质（backdrop-blur + 半透明背景）应用于 Dock、弹窗、文件夹展开层，模拟 iOS 控制中心质感
- 材质与深度：图标使用多层柔和投影（shadow-card / shadow-hover）营造浮起感；Dock 与弹窗使用 backdrop-blur-xl + bg-white/70
- 容器与按钮：图标采用 rounded-[22%] 圆角（iOS squircle 风格）；弹窗 rounded-3xl；按钮 rounded-full
- 布局节奏：4 列网格（移动端）/ 6 列网格（桌面端），图标间距均匀，底部 Dock 固定 4 个常用位

## Animation
- 入场：图标淡入 + 轻微缩放（fade-in 0.3s ease-out）
- 交互：拖拽时图标放大 1.1 + 投影增强；长按进入编辑态时图标抖动（wiggle 动画）
- 过渡：页面切换横向滑动；文件夹展开 spring 弹性缩放；翻页边缘悬停时页面平滑滑动

## Forbidden
- 禁止使用 Emoji 作为图标（使用 lucide-react）
- 禁止大色块纯色铺底作为核心视觉
- 禁止通用细描边卡片充当视觉签名

## Additional Notes
- 所有用户可见文案使用中文
- 桌面壁纸使用渐变 + 柔和光斑营造氛围，避免纯色背景
- 图标加载失败时显示首字母占位 + 渐变背景兜底