# Desktop AI — Live2D 桌面 AI 伙伴

一个基于 Electron + PixiJS 的 Live2D 桌面 AI 程序。导入任意 Live2D Cubism 3/4 模型，配上 AI 后端，你就拥有了一个有性格、会聊天、会做表情的桌面伙伴。

> 这是我随便写着玩的项目，不过会继续完善到真正好用的程度。

## 快速开始

```bash
npm install
npm start
```

1. 首次启动弹出设置窗口 → 填入 API Key（支持 DeepSeek / Claude / OpenAI / 自定义）
2. **导入模型**：托盘右键 → 导入模型 → 选择 Live2D 模型文件夹
3. 双击模型 → 打字聊天

## 导入模型

**文件夹名称就是角色名称**。比如文件夹叫 `Miku`，角色名就是 Miku。

模型文件夹需要包含与文件夹同名的 `.model3.json`（如 `Miku/Miku.model3.json`）。

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

## 技术栈

Electron + PixiJS + pixi-live2d-display + Live2D Cubism Core

## License

ISC
