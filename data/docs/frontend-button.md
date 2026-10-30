# Button 按钮组件

前端组件库 `@workbench/ui` 的基础按钮，用于触发当前页面的操作；页面跳转使用 Link，不用 Button。

## 何时使用

- 提交、保存、重试、确认等页面内操作。
- 同一区域只保留一个主操作，其余操作降级为次要按钮。
- 删除、回滚等不可逆操作使用 `danger`，并配合二次确认。

## 基本用法

```tsx
import { Button } from "@workbench/ui";

<Button variant="primary" size="md" loading={submitting} onClick={submit}>
  保存
</Button>
```

## 属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `variant` | `primary \| secondary \| ghost \| danger` | `secondary` | 视觉层级 |
| `size` | `sm \| md \| lg` | `md` | 尺寸，跟随表单密度 |
| `loading` | `boolean` | `false` | 请求中，禁止重复提交 |
| `disabled` | `boolean` | `false` | 不可用 |
| `block` | `boolean` | `false` | 占满容器宽度 |
| `icon` | `ReactNode` | — | 前置图标 |

## 交互与无障碍

- `loading` 时保留按钮宽度并显示 spinner，同时设置 `aria-busy`，避免布局跳动。
- 键盘焦点使用 `:focus-visible` 描边，禁止 `outline: none`。
- 纯图标按钮必须提供 `aria-label`；带文本的按钮不再重复设置。
- 不可用状态使用 `disabled`，不能只靠降低颜色对比度表达。

## 使用规范

- 文案使用动词，例如“保存”“重试”“回滚”，不使用“确定”这类模糊词。
- 异步操作进行中禁止再次点击；失败信息展示在按钮附近，不用全局 toast 代替。
- 尺寸与间距使用设计 token，不写死像素值。
- 组件变更需要同步 Storybook 示例与视觉回归快照。
