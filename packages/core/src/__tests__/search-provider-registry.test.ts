import { describe, expect, it } from "vitest";

import type { SearchProvider } from "../search-provider";
import { defaultSearchProvider, SearchProviderRegistry, searchProviderRegistry } from "../search-provider-registry";
import { filesystemSearchProvider } from "../search-providers/filesystem-provider";
import { qmdSearchProvider } from "../search-providers/qmd-provider";

describe("search provider registry", () => {
  it("registers core filesystem search and keeps QMD as the default advanced provider", () => {
    expect(defaultSearchProvider()).toBe(qmdSearchProvider);
    expect(searchProviderRegistry.require("filesystem")).toBe(filesystemSearchProvider);
    expect(searchProviderRegistry.require("qmd")).toBe(qmdSearchProvider);
    expect(searchProviderRegistry.list().map((provider) => provider.metadata.id)).toEqual(["filesystem", "qmd"]);
    expect(filesystemSearchProvider.metadata).toMatchObject({
      label: "Core filesystem search",
      backend: "filesystem",
      capabilities: expect.arrayContaining(["lexical", "read"]),
    });
    expect(qmdSearchProvider.metadata).toMatchObject({
      label: "QMD advanced search",
      backend: "qmd",
      capabilities: expect.arrayContaining(["lexical", "semantic", "hybrid"]),
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

  it("can register a second provider implementation without capability metadata", () => {
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
    const registry = new SearchProviderRegistry([filesystemSearchProvider, qmdSearchProvider, lexicalTestProvider]);

    expect(registry.list().map((provider) => provider.metadata.id)).toEqual(["filesystem", "qmd", "lexical-test"]);
    expect(registry.require("lexical-test")).toBe(lexicalTestProvider);
  });
});
