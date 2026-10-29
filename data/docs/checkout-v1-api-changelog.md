# checkout-service v1 API 变更记录

## 1.2.0

- 新增 `POST /v1/checkout/sessions/{id}/confirm`，由 `checkout.confirm_v2` 控制。
- 回调响应新增 `duplicate` 字段；重复回调返回 200。
- 错误码拆分 `payment_conflict` 与 `state_conflict`。

## 1.1.0

- 新增 `GET /v1/checkout/sessions/{id}`。
- 创建会话支持幂等键。
- 下线旧版 `checkout_status` 字段。

## 兼容策略

- 只做加法，至少保留两个版本的兼容窗口。
- 破坏性变更走 `/v2`，v1 只做安全与错误修复。
- 弃用字段先标记 deprecated，再经过一个发布周期删除。

## 回调签名

- 使用 HMAC-SHA256，密钥按租户隔离。
- 时间戳偏差超过 5 分钟拒绝。
- 签名失败返回 401，不进入业务重试。
