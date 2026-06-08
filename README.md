# Desktop AI — Live2D 桌面 AI 伙伴

一个基于 Electron + PixiJS 的 Live2D 桌面 AI 程序。导入任意 Live2D Cubism 3/4 模型，配上 AI 后端，你就拥有了一个有性格、会聊天、会做表情的桌面伙伴。

> 这是我随便写着玩的项目，不过会继续完善到真正好用的程度。

## 快速开始

### 第一步：安装 Node.js

前往 [nodejs.org](https://nodejs.org/) 下载并安装 Node.js（LTS 版本即可）。装好后，你的电脑就有了 `npm` 命令。

> 怎么确认装好了？在终端（命令提示符 / PowerShell / Windows 终端）输入 `npm -v`，如果显示版本号（如 `10.x.x`）就是装好了。

### 第二步：下载并启动本项目

1. 从 [Releases](https://github.com/zhe070822-creator/desktop-ai/releases) 下载最新版本的压缩包，解压到任意文件夹
2. 在该文件夹内打开终端：
   - **最简单的方法**：双击文件夹内的 `start.bat`，它会自动完成下面的步骤
   - **或者手动**：在文件夹地址栏输入 `cmd` 回车，然后依次输入：
     ```bash
     npm install
     npm start
     ```
   - `npm install` 只需运行一次（会下载项目依赖到 `node_modules/` 文件夹），以后每次启动只需 `npm start`

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

- [ ] **Motions 动作系统**：读取并触发模型的 `.motion3.json` 动画（如变身、睡觉等）
- [ ] **泛化模型导入**：兼容更多 Live2D 模型格式，自动处理缺少 Expressions/Motions 等目录的情况，优雅降级
- [ ] **鼠标穿透**：宠物模式下透明区域穿透鼠标点击（系统托盘可选开关，不遮挡桌面操作）
- [ ] **打包为 exe**：一键安装包，无需装 Node.js 即可运行
- [ ] **遗忘与强化记忆**：保留全部历史，重要信息被 AI 反复强化，无关内容随时间淡忘，模拟人类记忆机制
- [ ] 导出/导入角色卡与记忆
- [ ] 多语言支持
- [ ] **多设备兼容**：Windows / macOS / Linux 桌面端，Android / iOS 移动端（远期目标）

## 更新日志

### v1.1
- AI 通过 `[表情名]` 标签自主控制表情，不再依赖关键词匹配
- 自动角色卡生成：模型加载时无 `character.json` 则自动创建
- 默认托盘图标：模型无 `icon.png` 时使用内置图标
- 设置界面切换模型即时生效
- AI 融合角色卡 max_tokens 增至 20000，修复大文本截断
- JSON 解析三级容错：正则 → 补全 → 字段提取
- 流萤(Firefly)模型适配：清理缺失引用，中文表情命名

### v1.0
- 首个可用版本

## 技术栈

Electron + PixiJS + pixi-live2d-display + Live2D Cubism Core

## License

ISC
