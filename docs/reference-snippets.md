# 参考代码 & Prompt 灵感库

> 收集好用的 CSS/SVG 特效、写得好 prompt 模板、设计参考。不定期更新。

---

## CSS / SVG 特效

### 流体玻璃（Liquid Glass）— SVG 滤镜

来源：toge 朋友的 prompt（2026-06-17）

**核心思路**：不用 `backdrop-filter: blur()`，用 SVG `<filter>` 的 `<feTurbulence>` + `<feDisplacementMap>` 做真实的像素折射和边缘扭曲，模拟水滴/厚玻璃的物理光学效果。

```html
<!-- 完整 HTML + CSS + SVG 滤镜 -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liquid Glass Demo</title>
<style>
  /* ── 背景（用来展示折射效果） ── */
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    /* 彩色渐变背景，折射后能看到明显的 RGB 分离效果 */
    background:
      radial-gradient(circle at 20% 20%, #ff6b6b 0%, transparent 50%),
      radial-gradient(circle at 80% 80%, #4ecdc4 0%, transparent 50%),
      radial-gradient(circle at 50% 50%, #ffe66d 0%, transparent 50%),
      linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%);
    font-family: system-ui, -apple-system, sans-serif;
  }

  /* ── 流体玻璃卡片 ── */
  .glass-card {
    position: relative; width: 360px; padding: 32px;
    border-radius: 24px; color: #fff;
    /* 关键：应用 SVG 滤镜 */
    filter: url(#liquid-glass);
    /* 半透明底，让背景能透过来被折射 */
    background: rgba(255, 255, 255, 0.08);
    /* 边缘高光模拟光线汇聚 */
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .glass-card h2 { margin: 0 0 12px; font-size: 24px; font-weight: 600; }
  .glass-card p  { margin: 0; font-size: 14px; line-height: 1.6; opacity: 0.85; }
</style>

<!-- SVG 滤镜定义（隐藏，只用来被 CSS 引用） -->
<svg width="0" height="0" style="position:absolute">
  <defs>
    <filter id="liquid-glass" x="-20%" y="-20%" width="140%" height="140%">

      <!-- 1. 湍流噪声 → 模拟玻璃表面微观不平整 -->
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.03"
        numOctaves="3"
        seed="5"
        result="noise"
      />

      <!-- 2. 位移贴图 → 根据噪声值偏移像素，产生折射弯曲 -->
      <!--     scale 控制扭曲强度：越大越扭曲（建议 8~25） -->
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="14"
        xChannelSelector="R"
        yChannelSelector="G"
        result="displaced"
      />

      <!-- 3. 高斯模糊 → 轻微柔化边缘（可选，值很小时才有玻璃感） -->
      <feGaussianBlur
        in="displaced"
        stdDeviation="0.5"
        result="blurred"
      />

      <!-- 4. 亮度/对比度 → 增强边缘光感 -->
      <feComponentTransfer in="blurred" result="bright">
        <feFuncA type="linear" slope="1.05" intercept="0"/>
      </feComponentTransfer>

      <!-- 5. 混合 → 把折射后的内容和原始背景合并 -->
      <feBlend in="bright" in2="SourceGraphic" mode="screen"/>

    </filter>
  </defs>
</svg>

<div class="glass-card">
  <h2>Liquid Glass</h2>
  <p>这不是普通的高斯模糊。背景图案在卡片边缘发生了真实的像素折射和弯曲——就像透过一块厚玻璃看世界。</p>
</div>
```

**参数调节说明**：

| 参数 | 位置 | 作用 | 建议范围 |
|------|------|------|----------|
| `scale` | `<feDisplacementMap>` | 扭曲强度，越大背景弯曲越明显 | 8~25（玻璃感 12~16） |
| `baseFrequency` | `<feTurbulence>` | 噪声粒度，越小扭曲越"大块"，越大越"细碎" | 0.01~0.05 |
| `numOctaves` | `<feTurbulence>` | 噪声细节层数，越高越细腻但越吃性能 | 2~4 |
| `stdDeviation` | `<feGaussianBlur>` | 边缘柔化程度 | 0~1.5（0 = 锐利边缘） |
| `rgba(255,255,255,0.08)` | `.glass-card` background | 底色透明度，越透折射越明显 | 0.05~0.15 |
| `border` | `.glass-card` | 边缘高光描边 | 建议保持 1px + 25% 白 |

**进阶玩法**：
- 把 `<feTurbulence>` 换成 `<feImage>` 加载自定义法线贴图，可以做特定形状的折射（比如水滴轮廓）
- 给 `seed` 加动画（JS 改属性）可以让玻璃"流动"起来
- 边缘扭曲更剧烈：用径向渐变做 mask，让 `scale` 在边缘更大

---

## Prompt 模板

### CSS/SVG 特效类 Prompt 结构

从上面流体玻璃的 prompt 总结出的好结构：

```
1. 一句话说清楚要什么效果（"流体玻璃 + 物理折射"）
2. 点出关键技术点，不要让 AI 猜（"不是 blur，是 feDisplacementMap"）
3. 分点细化需求，每点讲清楚要什么 + 为什么
4. 明确交付物格式（"完整 HTML/CSS/SVG + 参数调节说明"）
```

**模板**：
```
我需要实现 [具体效果名称]，重点是 [核心技术差异]，而不是 [常见但不够的方案]。

请提供 [技术栈] 的代码方案：

【需求点 1】：
具体描述 + 技术方向

【需求点 2】：
具体描述 + 技术方向

请提供完整的 [代码文件列表]，并附带 [参数说明/使用说明]。
```

---

**最后更新**：2026-06-17
