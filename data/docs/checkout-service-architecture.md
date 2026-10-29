# checkout-service 架构

checkout-service 负责下单、支付确认与回调处理，是结账链路的核心服务。

## 组件

- API 层：对外提供 REST 接口，负责鉴权、限流与请求校验。
- Order worker：处理订单状态机流转，消费内部命令队列。
- Callback consumer：接收支付网关回调，做幂等校验后更新订单。
- Outbox relay：把订单状态变更可靠地投递到消息队列。
- PostgreSQL：订单、支付尝试、幂等键与审计记录的主存储。

## 数据流

1. 客户端调用 `POST /v1/checkout/sessions` 创建结账会话。
2. 支付网关返回结果后回调 `POST /v1/payments/callback`。
3. Callback consumer 校验签名与幂等键，写支付尝试记录。
4. Order worker 推进订单状态，Outbox relay 投递状态变更事件。
5. 下游履约服务消费事件，完成发货或开通。

## 依赖

- payment-gateway：支付结果与签名校验。
- inventory-service：库存预占与释放。
- notification-service：支付成功与失败通知。
- 消息队列：内部命令与状态变更事件。

## 关键约束

- 订单状态机只允许前进，不允许跨状态回退。
- 回调必须幂等，重复回调返回成功而不是错误。
- 所有状态变更先写数据库，再写 outbox，禁止先发消息后落库。
- 跨服务调用必须带超时与重试预算，禁止无限重试。
