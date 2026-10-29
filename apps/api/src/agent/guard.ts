export type GuardCategory = "secret" | "prompt" | "jailbreak";

export interface GuardDecision {
  blocked: boolean;
  category?: GuardCategory;
  reply?: string;
}

const EXTRACT_INTENT =
  /(是什么|是多少|多少|告诉我|给我|发我|贴出|输出|打印|列出|查看|展示|泄露|复述|重复|原文|完整|忘记|忽略|覆盖|reveal|show|tell|print|dump|list|leak|repeat|what\s+is|what's|ignore|forget|override)/i;

const PROMPT_TERM =
  /(系统提示词|系统提示|系统指令|内部指令|初始指令|提示词原文|system\s*prompt|system\s*message|developer\s*message|your\s+instructions|你的指令|你的设定)/i;

const SECRET_TERM =
  /(api[\s_-]?key|apikey|access[\s_-]?key|secret[\s_-]?key|private[\s_-]?key|credential|\.env|environment\s+variable|env\s+file|api\s*密钥|访问密钥|私钥|密钥|秘钥|凭证|口令)/i;

const GENERIC_SECRET = /(密码|令牌)/;
const SECRET_CONTEXT = /(redis|数据库|集群|生产|线上|admin|root|账号|账户|配置中心|secret\s*manager)/i;

const JAILBREAK =
  /(忽略(之前|以上|前面|所有|先前)的?(指令|规则|要求|设定)|ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|rules)|进入开发者模式|开启开发者模式|developer\s*mode|从现在开始你是|现在你是一个没有限制)/i;

const REFUSALS: Record<GuardCategory, string> = {
  secret:
    "我不能提供 API Key、密码、密钥、环境变量或内部配置。可以继续问 checkout-service 的工程问题。",
  prompt:
    "我不能披露系统提示词或内部指令。可以继续问知识库里的工程问题。",
  jailbreak:
    "我会保持既定角色，不执行覆盖规则或改变身份的指令。可以继续问工程问题。",
};

export function inspectUserPrompt(prompt: string): GuardDecision {
  const text = prompt.trim();

  if (!text) {
    return { blocked: false };
  }

  if (JAILBREAK.test(text)) {
    return {
      blocked: true,
      category: "jailbreak",
      reply: REFUSALS.jailbreak,
    };
  }

  const intent = EXTRACT_INTENT.test(text);

  if (PROMPT_TERM.test(text) && intent) {
    return {
      blocked: true,
      category: "prompt",
      reply: REFUSALS.prompt,
    };
  }

  const secretRequest =
    SECRET_TERM.test(text) ||
    (GENERIC_SECRET.test(text) && SECRET_CONTEXT.test(text));

  if (secretRequest && intent) {
    return {
      blocked: true,
      category: "secret",
      reply: REFUSALS.secret,
    };
  }

  return { blocked: false };
}

const REDACTED = "[已脱敏]";

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:OPENAI|ANTHROPIC|API)[-_]?KEY\s*[:=]\s*[^\s"'`]+/gi,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s"'`]+/gi,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/g,
];

export function redactSecrets(text: string): string {
  let output = text;

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }

  return output;
}

const HOLD_BACK = 24;

const SENSITIVE_PREFIXES = [
  "sk-ant-",
  "sk-",
  "bearer ",
  "openai_api_key",
  "anthropic_api_key",
  "api_key",
  "apikey",
  "secret=",
  "password=",
  "token=",
];

export class StreamingRedactor {
  private buffer = "";

  push(text: string): string {
    this.buffer += text;

    const cut = this.safeCut();

    if (cut <= 0) {
      return "";
    }

    const ready = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);

    return redactSecrets(ready);
  }

  flush(): string {
    const output = redactSecrets(this.buffer);
    this.buffer = "";

    return output;
  }

  private safeCut(): number {
    const lower = this.buffer.toLowerCase();
    let cut = Math.max(0, this.buffer.length - HOLD_BACK);

    for (const prefix of SENSITIVE_PREFIXES) {
      const index = lower.indexOf(prefix);

      if (index >= 0 && index < cut) {
        cut = index;
      }
    }

    return cut;
  }
}
