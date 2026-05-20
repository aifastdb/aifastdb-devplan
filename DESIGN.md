---
version: alpha
name: aifastdb-devplan-design
description: "DevPlan 可视化前端的设计宪法。基线参考 awesome-design-md/design-md/linear.app/DESIGN.md — 深黑画布（#010102，带极淡蓝色色调）+ Linear 薰衣草紫（#5e6ad2）单一彩色 accent，四级 surface ladder（surface-1 → surface-4）配 hairline 边线承担层级，无投影、无氛围渐变、无第二个彩色 accent。所有 UI 组件按 4px 网格、Inter / -apple-system 字体栈、500/600 字重、轻微负字距实现。激活态用 surface 抬升 + hairline-strong 描边而非左侧实色边；图标统一 stroke-width 1.6–1.9 的 line icons，禁止与 emoji 混用。"

tokens:
  source: "src/visualize/template-styles.ts → getStyles() 顶部 :root 块"
  themes:
    - id: "deep-black"
      label: "深黑色 (Linear-inspired)"
      default: true
      sidebar-bg: "#010102"
      sidebar-border: "#23252a"
      app-bg: "#010102"
      app-bg-elevated: "#0f1011"
      accent: "#5e6ad2"
    - id: "ink-blue"
      label: "墨蓝色 (原 DevPlan)"
      sidebar-bg: "#0f172a"
      sidebar-border: "#1e293b"
      app-bg: "#111827"
      app-bg-elevated: "#1f2937"
      accent: "#6366f1"
  theme-toggle:
    storage-key: "devplan_app_theme"
    early-init: "template.ts <head> 内联脚本读 localStorage 并 setAttribute('data-theme', ...) 避免闪烁"
    runtime-api: "setAppTheme('deep-black' | 'ink-blue')  ← template-core.ts"
    ui-entry: "Settings 页顶部 '🌗 外观主题' section"
  migration:
    - "新增/重写的组件优先消费 var(--ds-*) 变量；尤其是 --ds-app-bg / --ds-sidebar-bg / --ds-hairline / --ds-ink-*。"
    - "未迁移的旧硬编码值（#111827、#1f2937、#374151、#6366f1 等）暂时保留，遇到修改时再替换为 token。"
    - "page-level 背景（body / .graph-container / .docs-page / .memory-page / .stats-page / .settings-page / .page-code-intel）已全部消费 --ds-app-bg，主题切换时自动响应。"
    - "禁止再新增任何硬编码颜色 / 间距 / radius；统一通过 token 引用。"

colors:
  # Brand
  primary: "#5e6ad2"            # --ds-primary  ·  CTA / active accent / focus ring
  primary-hover: "#828fff"      # --ds-primary-hover
  primary-focus: "#5e69d1"      # --ds-primary-focus
  on-primary: "#ffffff"         # --ds-on-primary

  # Surface ladder
  canvas: "#010102"             # --ds-canvas    ·  侧边栏、根背景、最深层
  surface-1: "#0f1011"          # --ds-surface-1 ·  hover 抬升、内容卡片
  surface-2: "#141516"          # --ds-surface-2 ·  active 抬升、突出卡片
  surface-3: "#18191a"          # --ds-surface-3 ·  徽章背景、下拉
  surface-4: "#191a1b"          # --ds-surface-4 ·  最浅抬升（罕用）

  # Hairline
  hairline: "#23252a"           # --ds-hairline           ·  1px 默认边线
  hairline-strong: "#34343a"    # --ds-hairline-strong    ·  active / focus 边线
  hairline-tertiary: "#3e3e44"  # --ds-hairline-tertiary  ·  嵌套面板边线

  # Text
  ink: "#f7f8f8"                # --ds-ink         ·  标题 / 强调正文
  ink-muted: "#d0d6e0"          # --ds-ink-muted   ·  二级正文
  ink-subtle: "#8a8f98"         # --ds-ink-subtle  ·  三级文字、未激活导航
  ink-tertiary: "#62666d"       # --ds-ink-tertiary ·  禁用、脚注

  # Semantic (沿用 Linear，按需扩展)
  success: "#27a644"
  warning: "#f59e0b"            # 暂保留，未来用 --ds-warning
  danger:  "#ef4444"            # 暂保留，未来用 --ds-danger

typography:
  fontStack: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif"
  monoStack: "'Cascadia Code', 'JetBrains Mono', ui-monospace, SF Mono, Menlo, monospace"
  # 字号 / 字重 / 字距遵循 Linear 节奏，先在新建组件落地，旧组件按需迁移
  display-xl: { size: 56px, weight: 600, lineHeight: 1.10, letterSpacing: -1.8px }
  display-md: { size: 40px, weight: 600, lineHeight: 1.15, letterSpacing: -1.0px }
  headline:   { size: 24px, weight: 600, lineHeight: 1.20, letterSpacing: -0.4px }
  card-title: { size: 18px, weight: 600, lineHeight: 1.25, letterSpacing: -0.3px }
  body-lg:    { size: 16px, weight: 400, lineHeight: 1.50, letterSpacing: -0.1px }
  body:       { size: 14px, weight: 400, lineHeight: 1.50, letterSpacing: -0.05px }
  body-sm:    { size: 13px, weight: 400, lineHeight: 1.50, letterSpacing: 0 }
  caption:    { size: 12px, weight: 400, lineHeight: 1.40, letterSpacing: 0 }
  button:     { size: 13px, weight: 500, lineHeight: 1.20, letterSpacing: 0 }
  eyebrow:    { size: 11px, weight: 500, lineHeight: 1.30, letterSpacing: 0.4px, uppercase: true }
  nav-item:   { size: 13px, weight: 500, lineHeight: 1.20, letterSpacing: -0.1px }
  mono:       { size: 12px, weight: 400, lineHeight: 1.50, letterSpacing: 0 }

rounded:
  xs: 4px        # --ds-radius-xs   ·  徽章、status pill
  sm: 6px        # --ds-radius-sm   ·  内联标签、tooltip
  md: 8px        # --ds-radius-md   ·  按钮、表单、nav-item
  lg: 12px       # --ds-radius-lg   ·  卡片、面板
  xl: 16px       # --ds-radius-xl   ·  大型容器、screenshot frame
  pill: 9999px   # --ds-radius-pill ·  digital badge、toggle

spacing:
  base: 4px
  xxs: 4px       # --ds-space-xxs
  xs:  8px       # --ds-space-xs
  sm:  12px      # --ds-space-sm
  md:  16px      # --ds-space-md
  lg:  24px      # --ds-space-lg
  xl:  32px      # --ds-space-xl

icons:
  family: "Lucide-like line icons, 24×24 viewBox"
  strokeWidth: "1.6 → 1.9（小尺寸 16px 用 1.6；20px+ 用 1.8–1.9）"
  rules:
    - "禁止 emoji 出现在导航、按钮、表单标签上（紧急情况除外）。"
    - "禁止填充图标与线性图标在同一组件里混用。"
    - "stroke 颜色用 currentColor，由父级文字颜色驱动。"

components:
  sidebar:
    width-collapsed: 56px       # --ds-sidebar-w-collapsed
    width-expanded: 224px       # --ds-sidebar-w-expanded
    header-height: 52px         # --ds-sidebar-header-h
    item-height: 36px           # --ds-sidebar-item-h
    background: "{colors.canvas}"
    border-right: "1px solid {colors.hairline}"
    transition: "width 0.24s cubic-bezier(0.32, 0.72, 0.24, 1)"
    logo:
      mark: "7px lavender dot + product wordmark"
      typography: "13–14px / 600 / -0.2px"
      color: "{colors.ink}"
    nav-item-default:
      color: "{colors.ink-subtle}"
      background: "transparent"
      rounded: "{rounded.md}"
      padding: "0 10px"
    nav-item-hover:
      color: "{colors.ink-muted}"
      background: "{colors.surface-1}"
    nav-item-active:
      color: "{colors.ink}"
      background: "{colors.surface-2}"
      ring: "inset 0 0 0 1px {colors.hairline-strong}"
      icon-color: "{colors.primary}"
    tooltip:
      background: "{colors.surface-2}"
      border: "1px solid {colors.hairline-strong}"
      color: "{colors.ink}"
      rounded: "{rounded.sm}"
      shadow: "0 8px 20px rgba(0,0,0,0.5)"

  button-primary:
    background: "{colors.primary}"
    color: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    typography: "{typography.button}"
    hover-background: "{colors.primary-hover}"
    focus-ring: "2px {colors.primary-focus} at 50% opacity"

  button-secondary:
    background: "{colors.surface-1}"
    color: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: "8px 14px"

  card:
    background: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"

  status-badge:
    background: "{colors.surface-2}"
    color: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"

---

## Overview

aifastdb-devplan 的可视化前端（DevPlan Web UI）以 **Linear 风格的深黑技术画布**为基线 —— 安静、致密、克制的开发者工具气质。

整套 UI 由三件事承担层级：

1. **Surface ladder**：canvas → surface-1 → surface-2 → surface-3 → surface-4，越往上越亮，1 步一个台阶，禁止越级。
2. **Hairline 边线**：1px 的 `#23252a` 边线在卡片、面板、激活态上承担"切片感"，几乎不用阴影。
3. **薰衣草紫 `#5e6ad2` 是唯一彩色 accent**：只允许出现在 active 图标、focus ring、品牌点（logo dot）、primary CTA 上。其它地方（背景、装饰、图表数据色）一律走灰阶 / 类型语义色。

### 与 Linear 的差异

| 维度 | Linear marketing | aifastdb-devplan 实现 |
|---|---|---|
| 字体家族 | Linear Display / Text / Mono（私有） | `Inter` / `-apple-system` / `Cascadia Code` |
| 字号峰值 | display-xl 80px | display-xl 56px（我们没有 marketing hero） |
| Active 视觉 | primary CTA 用 lavender 填充 | nav-item 用 surface-2 抬升 + hairline-strong 描边，icon 染薰衣草 |
| 节点 / 图表色 | 仅产品截图内出现 | 图谱节点保留语义色（项目橙 / 模块橙 / 任务绿 / 文档蓝 / 记忆紫），作为 **数据色**而非 brand accent |

---

## Migration Strategy（迁移策略）

由于全量重构成本极高、收益边际递减，本次采用 **token-first, component-by-component** 策略：

1. **第一步（已完成）**：在 `src/visualize/template-styles.ts` 的 `getStyles()` 顶部注入 `:root { --ds-* }` token 表，并把**左侧导航栏**完整迁移为 token 消费。
2. **第二步（已完成）**：双主题（deep-black / ink-blue）+ 主题切换基础设施，所有 page-level 背景迁移到 `--ds-app-bg`。
3. **第三步（进行中）**：每次修改任何 UI 组件时，必须：
   - 用 `var(--ds-*)` 替换该组件用到的所有硬编码值；
   - 该组件视觉对齐到上方 `components:` 表里对应条目（或在 DESIGN.md 中**新增**一个条目）。
4. **第四步**：项目级别的"全局重构 PR"在已迁移组件覆盖率 ≥ 60% 后再启动，统一收尾遗留硬编码。

### 主题切换工作机制

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 用户点击 Settings → 外观主题 → "深黑色" 或 "墨蓝色"      │
│ 2. setAppTheme(theme) 写入 localStorage('devplan_app_theme')│
│ 3. document.documentElement.setAttribute('data-theme', t)   │
│ 4. CSS 变量 :root[data-theme="..."] 覆盖生效（无需 reload）  │
│ 5. 下次打开页面：<head> 内联脚本先读 localStorage 同步主题   │
│    → 完全避免 flash-of-wrong-theme                          │
└─────────────────────────────────────────────────────────────┘
```

> **不要为了迁移而迁移。** 没动到的旧代码继续保持原样，避免无意义的 diff 噪音。

---

## Do's and Don'ts

### Do

- 用 `{colors.canvas}` 作为侧边栏、应用根背景的最深层。
- 用四级 surface ladder（surface-1 → surface-4）承担层级，越突出越靠上。
- 用 1px hairline (`{colors.hairline}` / `{colors.hairline-strong}`) 替代阴影做"切片"。
- 把 `{colors.primary}` 薰衣草紫**严格限定**在：active 图标、focus ring、品牌 logo dot、primary CTA。
- 图标统一 line icons，stroke-width 1.6–1.9，颜色用 `currentColor`。
- 字体 weight 500/600 + 轻微负字距（-0.05 → -0.4px），保持 Linear 的"克制感"。
- 所有间距、半径走 4px 倍数并使用 `--ds-space-*` / `--ds-radius-*` token。

### Don't

- 不要再写多色渐变文字（4 色彩虹 logo 已废弃）。
- 不要在导航、按钮、表单标签中混用 emoji 和 line icon。
- 不要新增第二个 brand accent 色（橙、青、粉等）—— 这些颜色只能作为**数据语义色**出现在图谱节点 / 状态徽章上。
- 不要用 drop-shadow 营造层级，永远优先用 surface ladder + hairline。
- 不要给 nav-item 加左侧 3px 实色边作激活态（已废弃，改用 surface 抬升）。
- 不要把 active 背景做成 `rgba(99,102,241,0.1)` 这种"半透明品牌色"—— 改用 surface-2 + hairline-strong 描边。
- 不要在新代码里出现 `#0f172a` / `#1f2937` / `#374151` / `#6366f1` 这类硬编码值；改用 token。

---

## Responsive

| 视口 | 行为 |
|---|---|
| ≥ 1280px | sidebar 默认折叠（56px），点击展开（224px） |
| 768–1279px | 同上 |
| < 768px | sidebar 折叠态，由顶栏 hamburger 触发覆盖式展开（未实装） |

---

## Iteration Guide（给 AI Agent 的提示词模板）

```
请按照仓库根目录的 DESIGN.md 修改 <组件名> 的样式：
- 文件位置：src/visualize/<file>.ts
- 必须消费 var(--ds-*) token，不允许新增硬编码颜色 / 间距 / radius
- 遵守 components.<名称> 一节的规范；如该组件尚未在 DESIGN.md 中，请先补全条目再实现
- 完成后跑 `npm run typecheck` 验证
```

---

## References

- Linear DESIGN.md（基线）: `D:/Project/git/awesome-design-md/design-md/linear.app/DESIGN.md`
- Awesome DESIGN.md 集合: `D:/Project/git/awesome-design-md/README.md`
- Token 实现入口: `src/visualize/template-styles.ts` (`getStyles()` 顶部 `:root` 块)
- Sidebar 实现: `src/visualize/template-styles.ts` 中"Sidebar — Linear-inspired"块 + `src/visualize/template-html.ts` 中 `.sidebar` 节点
