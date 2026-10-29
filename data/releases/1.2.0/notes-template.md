# checkout-service {{version}} 发布说明

## 变更

- 支付回调增加幂等键校验，修复 INC-042 中的重复回调风险。
- 新增 confirm 接口，由 feature flag `checkout.confirm_v2` 控制，默认关闭。
- 订单表增加 `payment_attempts` 字段，执行迁移 `20261014_add_payment_attempts`。

## 风险与回滚

- 数据库迁移只加列，回滚需停写并执行反向迁移。
- 灰度节奏：10% → 50% → 100%，每档观察至少 10 分钟。
- 回滚条件：支付成功率低于 99.5% 或回调 P95 超过 800ms。

## 审批

- 冲突解决方案与 diff 已由人工审批。
