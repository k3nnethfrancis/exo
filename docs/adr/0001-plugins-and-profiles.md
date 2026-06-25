# Plugins And Profiles

Exo treats plugins as replaceable capabilities and profiles as curated bundles of capabilities, configuration, and conventions. A profile may recommend or require plugins, metadata schemas, context templates, MCP config, skills, routine templates, graph views, and review/output policies, but executable behavior must live in explicit plugin capabilities rather than being hidden inside a profile. This keeps Exo hackable and modular while preserving a clear trust boundary for future plugin loading.

## Considered Options

- Treat every component, bundle, and workflow as a plugin. This is flexible but makes it unclear which parts execute code and which parts are configuration.
- Treat profiles as a separate product feature with hardcoded semantics. This simplifies early UI but would make LM Wiki, Shoshin, Guardian Angel, OKF, and other graph conventions harder to compose.
- Separate plugin capabilities from profile bundles. This is the chosen model because it supports modular OSS customization while keeping executable behavior, configuration, and graph conventions inspectable.
