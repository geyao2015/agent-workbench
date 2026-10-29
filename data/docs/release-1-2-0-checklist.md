# 1.2.0 发版清单

版本：1.2.0。服务：checkout-service。计划窗口：周二 20:00–22:00。负责人：release captain（轮值）。

## 本次变更

- 支付回调增加幂等键校验，修复 INC-042 中的重复扣款风险。
- 新增 `POST /v1/checkout/sessions/{id}/confirm` 接口，默认关闭，由 feature flag `checkout.confirm_v2` 控制。
- 订单表增加 `payment_attempts` 字段，需要执行迁移 `20261014_add_payment_attempts`。
- 升级 `payment-sdk` 到 3.8.1，修复超时重试没有退避的问题。

## 发版前检查

1. 确认迁移已在 staging 执行，并验证回滚脚本。
2. 确认 `checkout.confirm_v2` 在 staging 与生产都为关闭状态。
3. 确认 payment-sdk 3.8.1 的灰度实例没有新的 5xx。
4. 检查最近 24 小时支付回调失败率低于 0.5%。
5. 通知值班同学和支付团队，确认变更窗口没有其他发布。

## 风险与回滚

- 高风险项：订单表迁移。回滚策略是停写、反向迁移、恢复旧版本镜像；数据不回滚。
- 中风险项：payment-sdk 升级。回滚方式是切回 3.7.4，并清空 SDK 本地重试队列。
- 低风险项：confirm 接口默认关闭，回滚只需关闭 feature flag。

## 上线顺序

1. 执行数据库迁移（只加列，向后兼容）。
2. 发布 10% 实例，观察 10 分钟支付成功率与回调延迟。
3. 扩到 50%，再观察 10 分钟。
4. 全量发布，保持 feature flag 关闭 24 小时。
5. 第二天的发版窗口再打开 `checkout.confirm_v2` 做 5% 灰度。

## 验收指标

- 支付成功率不低于 99.5%。
- 回调处理 P95 延迟低于 800ms。
- 无新增 `payment_conflict` 以外的 4xx 峰值。
- 错误预算剩余不低于 30%。
