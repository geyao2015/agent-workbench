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
    detail: "LangGraph 工具循环、BM25 知识库、引用与拒答；16 篇合成文档。",
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
    title: "协议与状态",
    items: [
      "append-only AgentEvent v1，按 seq 去重；未知事件与字段前向兼容。",
      "纯函数 reducer 是唯一 UI 状态源；Chat / Release / Trace 都是事件投影。",
      "SSE Last-Event-ID 重放；取消与审批恢复不产生重复事件。",
    ],
  },
  {
    title: "流式渲染",
    items: [
      "块级增量分段，闭合块冻结；避免每 token 全量 parse 与整树重渲染。",
      "长会话行级虚拟化；10k 块 / 500 增量 reduce 513ms，headless 60fps。",
    ],
  },
  {
    title: "Agent runtime",
    items: [
      "LangGraph 工具循环 + checkpointer；知识库工具包含元数据过滤。",
      "本地 BM25 检索：Recall@1 85.4%、Recall@4 100%、MRR 0.920。",
      "确定性输入 guard、检索数据分隔与流式输出脱敏。",
    ],
  },
  {
    title: "Release 工作台",
    items: [
      "确定性阶段 + 阶段级人工审批；diff、日志、审计与指标全部来自事件。",
      "LLM 冲突解决使用结构化输出，失败/超时回退确定性方案。",
      "失败 RCA、回滚 child run 与 Chat handoff 均保留审计链。",
    ],
  },
  {
    title: "评测与限制",
    items: [
      "50 题检索金标与会话、10 个 RCA 案例；命令：pnpm eval:retrieval / pnpm eval:rca。",
      "Trace 当前由事件日志派生，模型调用细粒度 Span 待 runtime 埋点。",
      "模拟发版环境；真实模型端到端质量与成本仍需配置 Key 后验证。",
    ],
  },
];
