import { describe, expect, it } from "vitest";

import type { SearchProvider } from "../search-provider";
import { defaultSearchProvider, SearchProviderRegistry, searchProviderRegistry } from "../search-provider-registry";
import { qmdSearchProvider } from "../search-providers/qmd-provider";

describe("search provider registry", () => {
  it("registers QMD as the bundled advanced provider behind stable index routes", () => {
    expect(defaultSearchProvider()).toBe(qmdSearchProvider);
    expect(searchProviderRegistry.require("qmd")).toBe(qmdSearchProvider);
    expect(searchProviderRegistry.list().map((provider) => provider.metadata.id)).toEqual(["qmd"]);
    expect(qmdSearchProvider.metadata).toMatchObject({
      label: "QMD advanced search",
      compatibility: { indexBackend: "qmd" },
    });
  });

  it("rejects duplicate provider ids", () => {
    const registry = new SearchProviderRegistry([qmdSearchProvider]);

    expect(() => registry.register(qmdSearchProvider)).toThrow("Search provider already registered: qmd");
  });

  it("throws a clear error for missing required providers", () => {
    const registry = new SearchProviderRegistry();

    expect(registry.get("missing")).toBeUndefined();
    expect(() => registry.require("missing")).toThrow("Search provider is not registered: missing");
  });

  it("can register a second provider implementation without changing capability metadata shape", () => {
    const lexicalTestProvider: SearchProvider = {
      metadata: {
        ...qmdSearchProvider.metadata,
        id: "lexical-test",
        label: "Lexical Test",
      },
      getStatus: qmdSearchProvider.getStatus.bind(qmdSearchProvider),
      search: qmdSearchProvider.search.bind(qmdSearchProvider),
      read: qmdSearchProvider.read.bind(qmdSearchProvider),
      update: qmdSearchProvider.update.bind(qmdSearchProvider),
      embed: qmdSearchProvider.embed.bind(qmdSearchProvider),
      sync: qmdSearchProvider.sync.bind(qmdSearchProvider),
    };
    const registry = new SearchProviderRegistry([qmdSearchProvider, lexicalTestProvider]);

    expect(registry.list().map((provider) => provider.metadata.id)).toEqual(["qmd", "lexical-test"]);
    expect(registry.require("lexical-test")).toBe(lexicalTestProvider);
  });
});
