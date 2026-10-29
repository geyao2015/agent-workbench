# checkout-service API 约定

## 核心接口

- `POST /v1/checkout/sessions`：创建结账会话，返回 `sessionId` 与可选支付方式。
- `GET /v1/checkout/sessions/{id}`：查询会话与订单状态。
- `POST /v1/checkout/sessions/{id}/confirm`：确认支付，1.2.0 起由 feature flag 控制。
- `POST /v1/payments/callback`：支付网关回调，必须校验签名。

## 限流

- 创建会话：每租户 100 QPS，突发 200。
- 查询会话：每租户 500 QPS。
- 支付回调：按网关来源 IP 限流，每来源 200 QPS。
- 超限返回 429，并带 `Retry-After` 头。

## 错误码

- `invalid_request`：参数校验失败，400，不可重试。
- `payment_conflict`：幂等键已存在，回调返回 200 且 `duplicate: true`。
- `state_conflict`：订单状态不允许当前操作，409，需要人工处理。
- `gateway_timeout`：支付网关超时，503，可退避重试。
- `rate_limited`：429，按 `Retry-After` 重试。

## 兼容性

- 只做加法：新增字段与新增接口，不删除或改变已有字段语义。
- 路径版本化：破坏性变更走 `/v2`。
- 回调接口对旧版字段保持至少两个版本的兼容窗口。

## 可观测性

- 每个请求带 `x-request-id`，贯穿日志与 trace。
- 关键指标：支付成功率、回调延迟 P95、409 比例、重试队列深度。
- 审计事件必须包含订单 ID、幂等键、操作来源与结果。
