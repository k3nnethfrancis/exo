import { qmdSearchProvider } from "./search-providers/qmd-provider";
import type { SearchProvider } from "./search-provider";

export class SearchProviderRegistry {
  private readonly providers = new Map<string, SearchProvider>();

  constructor(providers: SearchProvider[] = []) {
    this.registerMany(providers);
  }

  register(provider: SearchProvider): void {
    const id = provider.metadata.id;
    if (this.providers.has(id)) {
      throw new Error(`Search provider already registered: ${id}`);
    }
    this.providers.set(id, provider);
  }

  registerMany(providers: SearchProvider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  get(id: string): SearchProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): SearchProvider {
    const provider = this.get(id);
    if (!provider) {
      throw new Error(`Search provider is not registered: ${id}`);
    }
    return provider;
  }

  list(): SearchProvider[] {
    return [...this.providers.values()];
  }
}

export function createBuiltInSearchProviderRegistry(): SearchProviderRegistry {
  return new SearchProviderRegistry([qmdSearchProvider]);
}

export const searchProviderRegistry = createBuiltInSearchProviderRegistry();

export function defaultSearchProvider(): SearchProvider {
  return searchProviderRegistry.require("qmd");
}
