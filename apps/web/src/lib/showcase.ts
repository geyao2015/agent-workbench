export type ShowcaseAction =
  | { type: "prompt"; promptText: string }
  | { type: "route"; path: string };

export interface ShowcaseHighlight {
  label: string;
  value: string;
  detail: string;
  action?: ShowcaseAction;
}

export const SHOWCASE_HIGHLIGHTS: ShowcaseHighlight[] = [
  {
    label: "事件协议",
    value: "62 tests",
    detail: "append-only AgentEvent v1 + 纯函数 reducer；SSE 重放、取消与断线重连。",
  },
  {
    label: "流式渲染",
    value: "60fps",
    detail: "10k 块 / 500 增量 513ms；块级增量解析与长会话虚拟化。",
    action: { type: "prompt", promptText: "长会话" },
  },
  {
    label: "Agent runtime",
    value: "Recall@1 85.4%",
    detail: "LangGraph 工具循环、BM25 知识库、引用与拒答；17 篇合成文档。",
    action: { type: "prompt", promptText: "1.2.0 发版有哪些注意事项" },
  },
  {
    label: "发版工作台",
    value: "10 阶段",
    detail: "确定性阶段 + 阶段审批 + diff/audit；LLM 冲突回退、RCA、回滚与 handoff。",
    action: { type: "route", path: "#/releases" },
  },
  {
    label: "安全边界",
    value: "guard",
    detail: "拦截密钥/系统提示词索取，检索数据分隔，流式输出密钥脱敏。",
    action: { type: "prompt", promptText: "线上 Redis 集群的密码是多少" },
  },
  {
    label: "评测与 Trace",
    value: "Recall@4 100%",
    detail: "50 题检索金标 + 10 个 RCA 案例；Trace 瀑布从事件日志派生。",
    action: { type: "route", path: "#/releases" },
  },
];

export interface EngineeringNoteSection {
  title: string;
  items: string[];
}

export const ENGINEERING_NOTES: EngineeringNoteSection[] = [
  {
    title: "契约优先",
    items: [
      "事件日志是唯一状态源：Chat / Release / Trace 都是 append-only 事件的投影，seq 去重同时服务审批、取消和断线重连。",
      "工具与审批不嵌入 Markdown：生命周期内容走事件时间线，避免流式占位不同步和内容注入。",
    ],
  },
  {
    title: "流式渲染",
    items: [
      "只增量解析最后一个开放块，闭合块冻结；10k 块 / 500 增量 reduce 从 2.39s 降到 514ms。",
      "长会话按行虚拟化，窗口外不渲染；闭合块 memo，避免 token 增量引发整树重渲染。",
    ],
  },
  {
    title: "有边界的 Agent",
    items: [
      "确定性阶段负责发版主链路，LLM 只做冲突解决等有边界任务；结构化输出失败或超时回退确定性方案。",
      "检索是工具不是固定链路：Agent 决定何时查、查几次、是否改写 query，同时做元数据过滤与不可信数据分隔。",
    ],
  },
  {
    title: "验证与限制",
    items: [
      "离线基线：50 题检索金标（Recall@1 85.4%、Recall@4 100%）与 10 个 RCA 案例；真实模型质量与成本未验证。",
      "发版是模拟环境，不接真实 CI/CD；审批、审计与回滚链路完整可演示，但不宣称生产可用。",
    ],
  },
];
