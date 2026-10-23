# Read Aloud Loop

**语言 / Language:** 简体中文 | [English](./README.md)

为 Zotero 阅读器（PDF / EPUB）的 **Read Aloud（朗读）** 功能增加一个“循环播放当前句”开关。

开启后，朗读完当前句会自动重播同一句；此时点击“上一句/下一句”，循环目标会切换到新选中的句子，并继续循环。适用于精读、跟读、语言学习等场景。

## 功能

- 在朗读弹出条上增加循环开关，不改变原有按钮行布局
- 开关以播放/暂停键右下角的小角标形式显示：
  - 灰色：关闭
  - 蓝色：已开启循环
- 循环对本地语音和云端语音都有效
- 切换上一句/下一句后，自动循环新句子
- 暂停/恢复、切换音色、调节语速后循环状态保持
- 关闭循环时如果当前句刚好播完，会正常推进到下一句，不会卡住

## 安装

1. 打开 Zotero → 设置 → 插件
2. 点击右上角齿轮 → **从文件安装插件**
3. 选择：

   ```
   dist/read-aloud-loop.xpi
   ```

4. 安装后建议重启 Zotero
5. 打开一篇 PDF 或 EPUB，点击工具栏上的喇叭按钮打开朗读条

如果朗读条在安装前已经打开，请先关闭再重新打开，让插件重新注入阅读器。

## 使用

1. 打开朗读条并开始播放
2. 点击播放/暂停键**右下角的循环角标**
   - 角标变蓝即表示循环已开启
   - 再次点击关闭
3. 当前句读完后会自动重播
4. 循环期间可以正常使用上一句/下一句、暂停、调速、切换音色

## 项目结构

```
.
├── manifest.json              # 插件清单
├── bootstrap.js               # Zotero 插件入口
├── content/
│   ├── plugin.js              # 主进程侧：注册事件、定位 reader、注入与清理
│   ├── inject.js              # reader iframe 内：角标 UI + 循环控制
│   └── icon.svg               # 插件图标
├── dist/
│   └── read-aloud-loop.xpi    # 可安装包
├── README.md                  # English README
└── README.zh-CN.md            # 中文 README
```

## 实现原理

### 1. 注入到 reader iframe

`content/plugin.js` 通过 `Zotero.Reader.registerEventListener('renderToolbar', ...)` 监听阅读器渲染，并通过 `reader._iframeWindow` 把 `content/inject.js` 加载进阅读器 iframe。

对于已经打开的 reader，插件会在初始化时遍历 `Zotero.Reader._readers` 补挂；reader 尚未初始化完成时会定时重试。

### 2. 循环角标

`inject.js` 在 iframe 内：

- 找到 `.read-aloud-popup` 和中间那组播放控制按钮
- 读取播放/暂停按钮（或缓冲时的 spinner）的位置
- 把角标绝对定位到其右下角

因为角标使用 `position: absolute`，它不占据按钮行宽度，也不会再造成弹层横向溢出。

角标每 250ms 校验一次，React 重绘把角标移除后会自动补回。

### 3. 循环播放

- 通过 `window._reader._readAloudManager` 取得朗读管理器
- 拦截 `manager._createController`，保证每次控制器重建后都会重新挂上循环钩子
- 包裹控制器的 `_handleSegmentEnd`：
  - 循环关闭：走原生逻辑，推进到下一句
  - 循环开启：不推进，短暂延迟后调用 `_speak()` 重播当前段
- 云端语音重播前会清掉 `_indexAtPause`，确保从段首开始播放，而不是从暂停偏移处开始

`_handleSegmentEnd` 是本地 `speechSynthesis` 控制器和云端音频控制器共用的结束回调，因此两种语音引擎都能生效。

## 开发与打包

修改 `content/` 下的文件后，在项目根目录执行：

```bash
rm -f dist/read-aloud-loop.xpi
zip -r dist/read-aloud-loop.xpi manifest.json bootstrap.js content
```

然后在 Zotero 中重新安装 `dist/read-aloud-loop.xpi`。

修改版本号时同步更新 `manifest.json` 中的 `version`。

## 兼容性

- 目标版本：Zotero 11（PDF / EPUB 阅读器）
- `manifest.json` 中声明 `strict_min_version: 7.0`、`strict_max_version: *`
- 依赖阅读器内部成员名：
  - `_readAloudManager`
  - `_createController`
  - `_handleSegmentEnd`
  - `_speak`
  - `_indexAtPause`

这些成员在当前 Zotero 11 源码与构建产物中存在。若未来 Zotero 重命名内部实现，插件需要同步调整。

## 常见问题

### 安装时提示“可能无法与该版本的 Zotero 兼容”

确认 `manifest.json` 中：

- `applications.zotero.update_url` 存在
- `strict_min_version` 不高于当前 Zotero 版本
- `strict_max_version` 为 `*`

### 朗读条上看不到循环角标

- 关闭朗读条再重新打开
- 确认插件已启用
- 查看 Zotero 调试日志中是否有 `Read Aloud Loop` 相关信息

### 角标位置偏移

角标位置按播放键实时计算。如果弹层刚打开或正在切换缓冲状态，最多 250ms 后会重新对齐。

## 已知限制

- 循环单位是朗读引擎的“段”（segment）；本地语音与云端语音通常按句子分段
- 角标沿用朗读条原生的 `tabIndex=-1` 交互方式，不进入 Tab 焦点序列

## 卸载

Zotero → 设置 → 插件 → 找到 **Read Aloud Loop** → 移除。

---

[切换到英文版 / English version](./README.md)
