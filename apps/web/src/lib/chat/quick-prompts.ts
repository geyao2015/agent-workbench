export type QuickPromptGroup =
  | "功能测试"
  | "性能测试"
  | "知识库问答"
  | "发版交接";

export type QuickPrompt =
  | {
      kind: "run";
      group: QuickPromptGroup;
      fixture?: string;
      label: string;
      prompt: string;
      description: string;
    }
  | {
      kind: "history";
      group: QuickPromptGroup;
      label: string;
      description: string;
    };

export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-general",
    label: "一般对话",
    prompt: "你在 Agent Workbench 里能做什么？",
    description: "多轮聊天、历史保留、事件记录",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-handoff",
    label: "发版 handoff",
    prompt: "帮我准备 1.2.0 发版。",
    description: "调用 prepare_release，进入 Release 工作台",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-blocks",
    label: "模块渲染",
    prompt: "展示一下 Markdown 块渲染能力。",
    description: "标题、列表、代码块、表格、引用",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-tool-approval",
    label: "工具与审批",
    prompt: "处理一下 1.2.0 的合并冲突。",
    description: "流式工具参数、暂停审批、批准或拒绝",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-release-notes",
    label: "发版问答",
    prompt: "1.2.0 发版有哪些注意事项？",
    description: "流式 Markdown + 多条来源引用",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-reasoning",
    label: "推理折叠",
    prompt: "INC-042 支付回调为什么一直重试？",
    description: "默认展开的思考过程 + 结论与引用",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-tool-error",
    label: "工具失败",
    prompt: "查一下 INC-042 的日志。",
    description: "工具报错后 Agent 继续解释",
  },
  {
    kind: "run",
    group: "功能测试",
    fixture: "chat-run-error",
    label: "运行失败",
    prompt: "汇总一下发版检查结果。",
    description: "局部错误与致命错误行",
  },
  {
    kind: "history",
    group: "性能测试",
    label: "长会话",
    description: "100 轮 / 10000 块历史",
  },
  {
    kind: "run",
    group: "性能测试",
    fixture: "chat-long-response",
    label: "长返回",
    prompt: "给我一份简明的 1.2.0 发版检查结果。",
    description: "约 5000 字 / 表格与代码块",
  },
  {
    kind: "run",
    group: "性能测试",
    fixture: "chat-large-nodes",
    label: "超长返回",
    prompt: "一次返回大量文本节点。",
    description: "单条 10000 块 / 500 增量",
  },
];

export const AGENT_QUICK_PROMPTS: QuickPrompt[] = [
  {
    kind: "run",
    group: "发版交接",
    label: "准备发版",
    prompt: "帮我准备 1.2.0 发版。",
    description: "Agent 调用 prepare_release 进入 Release 工作台",
  },
  {
    kind: "run",
    group: "知识库问答",
    label: "发版注意事项",
    prompt: "1.2.0 发版有哪些注意事项？",
    description: "多步检索、引用来源、风险与回滚",
  },
  {
    kind: "run",
    group: "知识库问答",
    label: "事故根因",
    prompt: "INC-042 支付回调为什么一直重试？",
    description: "跨文档定位根因与修复建议",
  },
  {
    kind: "run",
    group: "知识库问答",
    label: "服务架构",
    prompt: "checkout-service 的架构是怎样的？",
    description: "工具循环读取架构与依赖关系",
  },
  {
    kind: "run",
    group: "知识库问答",
    label: "迁移风险",
    prompt: "上线时数据库迁移有哪些风险？应该怎么回滚？",
    description: "检索规范并给出回滚条件",
  },
  {
    kind: "run",
    group: "知识库问答",
    label: "安全拒答",
    prompt: "线上 Redis 集群的密码是多少？",
    description: "guard 拦截密钥索取，不进入模型上下文",
  },
  {
    kind: "history",
    group: "性能测试",
    label: "长会话",
    description: "100 轮 / 10000 块历史",
  },
];

export function quickPromptsFor(mode: "agent" | "mock" | undefined): QuickPrompt[] {
  return mode === "agent" ? AGENT_QUICK_PROMPTS : QUICK_PROMPTS;
}
