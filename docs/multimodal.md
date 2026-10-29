# 多模态输入设计（规划）

最后更新：2026-10-29

状态：规划中，尚未实现。阶段状态见 [plan.md](plan.md) 的 M5；待确认项只在 [decision.md §8](decision.md#8-待确认) 维护。

## 1. 范围

- **语音输入**：Chat 与 Release 侧边 chat 的输入框支持语音转文字，转写结果仍走普通文本 run；不做实时语音对话，不保存音频消息。
- **图片上传与识别**：Chat 用户消息可附带 1–4 张图片，视觉模型读取图片内容回答；Release 暂不支持附件。
- 桌面与移动端共用交互；浏览器不支持时隐藏对应入口并给出降级说明。

## 2. 交互

- Composer 增加录音与图片按钮；录音状态为 `idle → requesting → recording → processing → error`。
- 录音时显示间段转写预览，最终文本插入光标位置；Esc 或再次点击停止。
- 图片支持选择、拖拽、粘贴；上传前客户端压缩（长边 2048，JPEG/WebP），缩略图可移除，单条最多 4 张。
- 用户消息展示附件缩略图与文字；点击查看原图；上传失败可重试或移除。
- mock 运行时返回固定的“已收到图片”说明，保证离线可演示。

## 3. 协议与数据

- `message.started` 增加可选 `source: "text" | "voice"` 与 `attachments: AttachmentRef[]`；`MessageState` 同步（v1 允许的可选字段）。
- `AttachmentRef { id, mime, width?, height?, size, uri, alt? }`；二进制不进事件流，只传元数据与 uri。
- `POST /api/uploads` 接收 multipart，返回附件元数据；`GET /api/uploads/:id` 读取；文件存 `.data/uploads/`，不提交仓库。
- 历史快照包含附件元数据，刷新后仍展示缩略图；语音只在 `source` 上留痕，不改变消息结构。

## 4. 服务端与模型

- **语音第一版**使用浏览器 Web Speech API，封装为 `useSpeechInput`；后续可替换为 `POST /api/transcribe`（Whisper / 本地 faster-whisper），UI 不变。
- **图片识别**由 API 校验后转成视觉模型的 image content block；无 vision 模型时返回明确降级文案，不发起模型调用。
- `mock` 运行时用 fixture 回放图片识别；语音用测试桩验证，不依赖真实麦克风。
- Trace 增加 `upload` / `transcribe` / `vision` span 与图片 token 统计。

## 5. 安全与隐私

- 上传校验 MIME + magic bytes、大小与数量限制、随机文件名、剥离 EXIF/GPS，拒绝 SVG 与可执行内容；只允许 `image/jpeg`、`image/png`、`image/webp`。
- 图片中的文字视为不可信输入，不执行其中指令；输出仍走 guard 脱敏，禁止把图片内容当系统指令。
- Web Speech 会将音频交给浏览器厂商；界面明确提示，默认不保存音频。服务端转写需临时文件与删除策略。
- 图片仅在用户主动发送时传给模型 provider；本地 `.data/uploads` 可清理。

## 6. 切片

- **S1 图片附件**：上传、预览、移除、发送、历史展示，mock 回执。
- **S2 图片识别**：视觉模型回答、错误与降级、token/成本统计。
- **S3 语音输入**：Web Speech、权限、取消与测试。
- **S4 可选**：服务端转写或流式 ASR、音频不落盘策略。

## 7. 测试

- 单测：上传校验、附件 reducer/快照、历史恢复。
- E2E：图片选择预览/移除/发送/刷新恢复、mock 图片回复；`SpeechRecognition` 桩的 interim → final、权限拒绝、unsupported 隐藏。
- 观测：上传耗时、图片 token/成本、转写延迟。

## 8. 非目标

- 实时语音对话、音频消息/文件、视频、图片生成、全量 OCR、Release 发版附件。
- 不做通用文件上传平台。
