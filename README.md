# Desktop AI — Live2D 桌面 AI 伙伴

一个基于 Electron + PixiJS 的 Live2D 桌面 AI 程序。导入任意 Live2D Cubism 3/4 模型，配上 AI 后端，你就拥有了一个有性格、会聊天、会做表情的桌面伙伴。

> 这是我随便写着玩的项目，不过会继续完善到真正好用的程度。

## 快速开始

### 第一步：安装 Node.js

前往 [nodejs.org](https://nodejs.org/) 下载并安装 Node.js（LTS 版本即可）。装好后，你的电脑就有了 `npm` 命令。

> 怎么确认装好了？在终端（命令提示符 / PowerShell / Windows 终端）输入 `npm -v`，如果显示版本号（如 `10.x.x`）就是装好了。

### 第二步：下载并启动本项目

1. 从 [Releases](https://github.com/zhe070822-creator/desktop-ai/releases) 下载最新版本的压缩包，解压到任意文件夹
2. 双击文件夹内的 `start.bat` 即可启动（首次会自动安装依赖，之后直接启动）
3. 或者手动：在文件夹地址栏输入 `cmd` 回车，依次输入：
   ```bash
   npm install    # 首次需运行，下载依赖
   npm start      # 启动程序
   ```

### 第三步：开始使用

1. 首次启动弹出设置窗口 → 填入 API Key（支持 DeepSeek / Claude / OpenAI / 自定义）
2. **导入模型**：托盘右键 → 导入模型 → 选择 Live2D 模型文件夹
3. 双击模型 → 打字聊天

## 导入模型

**文件夹名称就是角色名称**。比如文件夹叫 `Alex`，角色名就是 Alex。

模型文件夹需要包含与文件夹同名的 `.model3.json`（如 `Alex/Alex.model3.json`）。

导入时会自动：
- 生成默认角色卡（`character.json`）
- 扫描 `Expressions/` 目录并注册表情
- 尝试去除水印（不一定成功）

### AI 融合角色卡

设置界面可以导入 `.md` / `.json` 角色描述文件，让 AI 将其与当前角色卡融合，生成更完整的角色设定。支持多文件同时导入。

## 功能

- 多模型支持，导入即用
- 多后端 AI（DeepSeek / Claude / OpenAI / 自定义），API Key 加密存储
- 分层记忆：短期对话 + AI 自动提取长期事实
- 表情联动：AI 回复关键词触发 Live2D 表情，4 秒自动恢复
- 宠物模式（透明置顶）/ 窗口模式（可调大小）
- 系统托盘：切换模型、切换模式、导入模型、API 设置

## 待完成

- [x] **Motions 动作系统**：读取并触发模型的 `.motion3.json` 动画（如变身、睡觉等）
- [ ] **泛化模型导入**：兼容更多 Live2D 模型格式，自动处理缺少 Expressions/Motions 等目录的情况，优雅降级
- [x] **鼠标穿透**：宠物模式/窗口模式下鼠标点击完全穿透，系统托盘可控开关
- [ ] **打包为 exe**：一键安装包，无需装 Node.js 即可运行
- [ ] **遗忘与强化记忆**：保留全部历史，重要信息被 AI 反复强化，无关内容随时间淡忘，模拟人类记忆机制
- [ ] 导出/导入角色卡与记忆
- [ ] 多语言支持
- [ ] **多设备兼容**：Windows / macOS / Linux 桌面端，Android / iOS 移动端（远期目标）

## 更新日志

### v1.2
- AI 通过 `{动作名}` 标签自主控制 Live2D 动作动画（含音频）
- 动作播放前后自动快照，结束后恢复原状
- 流萤（Firefly）Live2D 模型随项目附带

### v1.1
- AI 通过 `[表情名]` 标签自主控制表情，不再依赖关键词匹配
- 自动角色卡生成：模型加载时无 `character.json` 则自动创建
- 默认托盘图标：模型无 `icon.png` 时使用内置图标
- 设置界面切换模型即时生效
- AI 融合角色卡 max_tokens 增至 20000，修复大文本截断
- JSON 解析三级容错：正则 → 补全 → 字段提取
- `start.bat` 首次自动检测并安装依赖

### v1.0
- 首个可用版本

## 技术栈

Electron + PixiJS + pixi-live2d-display + Live2D Cubism Core

## 模型版权

本项目包含的流萤（Firefly）Live2D 模型，版权归原作者所有：

- **模型作者**：[@是依七哒](https://space.bilibili.com/)（B站）
- **来源视频**：[前瞻小人模型](https://www.bilibili.com/video/BV1wSyjBFEfD/)

模型仅用于角色演示。如需使用该模型，请尊重原作者版权。

## License

ISC
