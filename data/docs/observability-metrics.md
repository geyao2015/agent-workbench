# checkout-service 可观测性指标

## 核心 SLO

- 支付成功率：99.5%，按 5 分钟窗口统计。
- 回调处理延迟：P95 低于 800ms。
- 订单状态一致率：99.99%，以 outbox 追平为准。
- 错误预算：每月允许 0.5% 不可用时间。

## 关键指标

- `checkout_payment_success_total`：按渠道与错误码分组。
- `checkout_callback_duration_ms`：直方图，关注 P95 与 P99。
- `checkout_retry_queue_depth`：重试队列积压。
- `checkout_outbox_lag_seconds`：outbox 投递延迟。

## 告警

- 支付成功率连续 5 分钟低于 99%：P1。
- 回调 P95 连续 10 分钟高于 800ms：P2。
- 重试队列深度超过 1 万：P2。
- 告警必须带 runbook 链接与最近变更记录。

## 面板

- 支付成功率与错误码 Top 5。
- 回调延迟分位数。
- 重试队列与死信数量。
- 发布窗口内的版本对比。
