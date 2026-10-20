import { describe, expect, it } from "vitest";

import { parsePartialJson } from "../partial-json";

describe("parsePartialJson", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['{"a":1', { a: 1 }],
    ['{"branch":"release/1.2.0",', { branch: "release/1.2.0" }],
    ['{"files":["src/a.ts"', { files: ["src/a.ts"] }],
    ['{"files":["src/a.ts",', { files: ["src/a.ts"] }],
    ['{"a":true,"b":', { a: true }],
    ['{"a":"checkout', { a: "checkout" }],
    ['{"a":"x\\"y', { a: 'x"y' }],
    ['{"a":"x\\', { a: "x" }],
    ['{"a":12.', { a: 12 }],
    ['{"a":1 "b":2}', { a: 1 }],
    ['[1,2', [1, 2]],
    ['"hello', "hello"],
    ["true", true],
    ["null", null],
  ])("parses %s", (input, expected) => {
    expect(parsePartialJson(input)).toEqual(expected);
  });

  it("falls back when no useful prefix exists", () => {
    expect(parsePartialJson("not json")).toBeUndefined();
    expect(parsePartialJson("tru")).toBeUndefined();
    expect(parsePartialJson("")).toBeUndefined();
    expect(parsePartialJson('{"a":')).toBeUndefined();
    expect(parsePartialJson("{")).toBeUndefined();
  });
});
