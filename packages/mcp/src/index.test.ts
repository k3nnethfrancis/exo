import { describe, expect, it } from "vitest";
import * as z from "zod/v4";

import { createExoMcpServer } from "./index";

describe("Exo MCP server tools", () => {
  it("does not advertise a hidden read_agent maxLines cap", () => {
    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { inputSchema?: z.ZodType }>;
    };
    const readAgentSchema = server._registeredTools.read_agent?.inputSchema;
    const jsonSchema = readAgentSchema ? z.toJSONSchema(readAgentSchema) : {};
    const maxLinesSchema = (jsonSchema as { properties?: Record<string, Record<string, unknown>> }).properties?.maxLines ?? {};

    expect(maxLinesSchema.maximum).not.toBe(1000);
  });
});
