# 评测记录

最后更新：2026-10-30

本文件是评测数据集、指标与基线的唯一来源。执行计划见 [plan.md](../product/plan.md)，渲染性能见 [rendering.md](../architecture/rendering.md)，产品状态见 [README.md](../../README.md)。

## 1. 数据集

- 检索：`data/eval/retrieval.jsonl`，50 题（48 可回答 + 2 不可回答），覆盖 16 篇合成文档（知识库共 17 篇，Button 组件文档暂未入金标）；标签含 single-doc、multi-doc、version、unanswerable。
- RCA：`data/eval/rca.jsonl`，10 个合成事故；每个案例包含日志文件、证据行与 runbook sourceId。
- 答案：`data/eval/answer.jsonl`，12 题（含 2 道无答案），补充 goldPoints 与引用来源，用于端到端 harness。
- 文档元数据：`data/docs/metadata.json`，含 service / type / tags，用于过滤。
- 规则：金标人工编写并校验；test set 冻结，不用于调参；新增样本只做版本化追加。

## 2. 检索基线

运行：`pnpm eval:retrieval`

| 指标 | 当前值 | 阈值 |
| --- | --- | --- |
| Recall@1 | 85.4% | ≥ 80% |
| Recall@4 | 100% | ≥ 95% |
| MRR | 0.920 | ≥ 0.85 |
| Abstain@4 | 2/2（100%） | 100% |

- 检索为本地 BM25；Abstain 定义为 top1 score < 4，阈值由当前数据集校准，不代表通用阈值。
- 元数据过滤在 `KnowledgeBase.search` 中实现，单测覆盖 service / type / tags。

## 3. RCA 基线

运行：`pnpm eval:rca`

| 指标 | 当前值 |
| --- | --- |
| 证据定位 | 100% |
| 证据进入检索结果 | 100% |
| runbook@1 | 80% |
| runbook@4 | 100% |

- 评测的是日志证据检索与 runbook 检索，不是根因文本的生成质量。
- 根因准确率与修复建议质量需要真实模型 + judge + 人工抽检，未纳入当前离线基线。

## 4. 答案评测 harness

运行：`pnpm eval:answer`

- 无模型 Key 时直接跳过并提示配置；有 Key 时逐题运行真实 Chat Agent。
- 指标：引用 recall / precision、gold point 覆盖率、拒答准确率。
- 当前未运行真实模型，因此没有答案质量基线；不得把检索基线当作答案质量。

## 5. Trace 与性能

- Trace 从 run 事件日志派生：`agent.run`、`stage.*`、`tool.*`、`approval.wait`，包含耗时、状态与 token usage。
- Release 详情 Trace tab 展示 waterfall；当前没有独立的模型调用 Span，细粒度模型 telemetry 待 runtime 埋点。
- 渲染性能基线见 [rendering.md §5](../architecture/rendering.md#5-性能数据)。
- token 来自 `run.completed.usage`；成本需要提供 provider 单价后才能计算，当前不展示估算成本。

## 6. 尚未评测

- 真实模型端到端答案质量：harness 已实现，但需要配置 Key 后运行；忠实度 judge 与人工抽检未接入。
- 成本与真实 provider 延迟。
- 多轮对话与跨 run 记忆的端到端指标。

## 7. 维护规则

- 数据集变更必须记录原因；test set 冻结后不用于调参。
- 指标变化超过 5 个百分点时更新本文件的基线与解释。
- 新增评测类型时先补数据集与脚本，再更新待办状态。
