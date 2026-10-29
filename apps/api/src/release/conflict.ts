import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createChatModel } from "../agent/model.js";
import type { RuntimeConfig } from "../config.js";
import { resolveFiles } from "./diff.js";
import type {
  ConflictResolution,
  ReleaseFile,
  ReleaseScenario,
  ResolvedFile,
} from "./types.js";

export interface ConflictInput {
  scenario: ReleaseScenario;
  signal: AbortSignal;
}

export interface ConflictResolver {
  resolve(input: ConflictInput): Promise<ConflictResolution>;
}

export const llmResolutionSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      hunks: z.array(
        z.object({
          id: z.string().min(1),
          resolved: z.string().min(1),
          rationale: z.string().min(1),
        }),
      ),
    }),
  ),
});

export type LlmResolution = z.infer<typeof llmResolutionSchema>;

export function mergeResolution(
  files: ReleaseFile[],
  output: LlmResolution,
): ResolvedFile[] {
  const byPath = new Map(output.files.map((file) => [file.path, file]));

  return files.map((file) => {
    const resolvedFile = byPath.get(file.path);

    if (!resolvedFile) {
      throw new Error(`LLM 冲突方案缺少文件：${file.path}`);
    }

    const byId = new Map(
      resolvedFile.hunks.map((hunk) => [hunk.id, hunk]),
    );

    return {
      path: file.path,
      hunks: file.hunks.map((hunk) => {
        const resolved = byId.get(hunk.id);

        if (!resolved) {
          throw new Error(`LLM 冲突方案缺少 hunk：${file.path}#${hunk.id}`);
        }

        if (!resolved.resolved.trim()) {
          throw new Error(`LLM 冲突方案 resolved 为空：${file.path}#${hunk.id}`);
        }

        return {
          ...hunk,
          resolved: resolved.resolved,
          rationale: resolved.rationale.trim() || hunk.rationale,
        };
      }),
    };
  });
}

export class DeterministicConflictResolver implements ConflictResolver {
  async resolve(input: ConflictInput): Promise<ConflictResolution> {
    return {
      files: resolveFiles(input.scenario.files),
      mode: "deterministic",
      latencyMs: 0,
    };
  }
}

export type StructuredInvoker = (
  input: { system: string; user: string },
  signal: AbortSignal,
) => Promise<unknown>;

function buildPrompt(scenario: ReleaseScenario): {
  system: string;
  user: string;
} {
  return {
    system: [
      "你是 checkout-service 的发版冲突解决助手。",
      "你会收到文件级 hunk 的 base / ours / theirs，以及本次发版约束。",
      "为每个文件、每个 hunk 选择或组合出最终 resolved 内容，并给出简短 rationale。",
      "不得新增或遗漏文件与 hunk；只返回结构化结果，不要输出 Markdown 或额外解释。",
    ].join("\n"),
    user: JSON.stringify(
      {
        version: scenario.version,
        service: scenario.service,
        context: scenario.conflictContext,
        files: scenario.files.map((file) => ({
          path: file.path,
          hunks: file.hunks.map(({ id, base, ours, theirs }) => ({
            id,
            base,
            ours,
            theirs,
          })),
        })),
      },
      null,
      2,
    ),
  };
}

export class LlmConflictResolver implements ConflictResolver {
  constructor(private readonly invoke: StructuredInvoker) {}

  async resolve(input: ConflictInput): Promise<ConflictResolution> {
    const startedAt = Date.now();
    const output = await this.invoke(buildPrompt(input.scenario), input.signal);
    const parsed = llmResolutionSchema.safeParse(output);

    if (!parsed.success) {
      throw new Error(
        `LLM 冲突方案不符合 schema：${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }

    return {
      files: mergeResolution(input.scenario.files, parsed.data),
      mode: "llm",
      latencyMs: Date.now() - startedAt,
    };
  }
}

export function withFallback(
  primary: ConflictResolver,
  fallback: ConflictResolver,
): ConflictResolver {
  return {
    async resolve(input: ConflictInput): Promise<ConflictResolution> {
      const startedAt = Date.now();

      try {
        return await primary.resolve(input);
      } catch (cause) {
        console.warn(
          "[conflict] llm failed, falling back",
          cause instanceof Error ? cause.message : cause,
        );
        const result = await fallback.resolve(input);

        return {
          ...result,
          mode: "fallback",
          fallbackReason:
            cause instanceof Error ? cause.message : "LLM 冲突解决失败",
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}

export function createConflictResolver(config: RuntimeConfig): ConflictResolver {
  const deterministic = new DeterministicConflictResolver();

  if (config.mode !== "agent" || config.conflictMode === "fixture") {
    return deterministic;
  }

  try {
    const model = createChatModel(config);

    if (!model.withStructuredOutput) {
      return deterministic;
    }

    const structured = model.withStructuredOutput(llmResolutionSchema, {
      name: "resolve_release_conflicts",
      method: "functionCalling",
    });
    const invoke: StructuredInvoker = async ({ system, user }, signal) => {
      const timeout = AbortSignal.timeout(10_000);
      const combined = AbortSignal.any([signal, timeout]);

      return structured.invoke(
        [new SystemMessage(system), new HumanMessage(user)],
        { signal: combined },
      );
    };

    return withFallback(new LlmConflictResolver(invoke), deterministic);
  } catch {
    return deterministic;
  }
}
