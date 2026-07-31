/**
 * The document-native protocol is intentionally small: ordinary Markdown is
 * the user’s data, while these envelopes make one explicit agent request and
 * its durable response addressable by Exograph and by a configured Command.
 *
 * Tags are inert source text. They never grant trust or execute a Command.
 */
export const EXOGRAPH_INVOCATION_TAG = "exograph-invocation";
export const EXOGRAPH_AGENT_RESPONSE_TAG = "exograph-agent-response";
const LEGACY_EXO_INVOCATION_TAG = "exo-invocation";
const LEGACY_EXO_AGENT_RESPONSE_TAG = "exo-agent-response";

type DocumentAgentInvocationTag =
  | typeof EXOGRAPH_INVOCATION_TAG
  | typeof LEGACY_EXO_INVOCATION_TAG;
type DocumentAgentResponseTag =
  | typeof EXOGRAPH_AGENT_RESPONSE_TAG
  | typeof LEGACY_EXO_AGENT_RESPONSE_TAG;
type DocumentAgentProtocolTag = DocumentAgentInvocationTag | DocumentAgentResponseTag;

export interface DocumentAgentInvocationEnvelope {
  kind: "invocation";
  /** Missing for render-only source envelopes that cannot identify a V1 run. */
  id?: string;
  agent: string;
  status: "sent";
  from: number;
  contentFrom: number;
  contentTo: number;
  to: number;
}

export interface DocumentAgentResponseEnvelope {
  kind: "response";
  invocationId: string;
  agent: string;
  from: number;
  contentFrom: number;
  contentTo: number;
  to: number;
}

export type DocumentAgentEnvelope = DocumentAgentInvocationEnvelope | DocumentAgentResponseEnvelope;

export function isDocumentAgentProtocolId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function formatDocumentAgentInvocation(input: { id: string; agent: string; message: string }): string {
  assertProtocolId(input.id, "invocation id");
  assertAgent(input.agent);
  return `<${EXOGRAPH_INVOCATION_TAG} id="${input.id}" agent="${input.agent}" status="sent">\n${input.message}\n</${EXOGRAPH_INVOCATION_TAG}>`;
}

export function formatDocumentAgentResponse(input: { invocationId: string; agent: string; message: string }): string {
  assertProtocolId(input.invocationId, "response invocation id");
  assertAgent(input.agent);
  return `<${EXOGRAPH_AGENT_RESPONSE_TAG} invocation="${input.invocationId}" agent="${input.agent}">\n${input.message}\n</${EXOGRAPH_AGENT_RESPONSE_TAG}>`;
}

/**
 * Detects both the canonical protocol and the durable `exo-*` envelope names
 * emitted before the product rename. This keeps the editor's incremental
 * reparsing trigger aligned with the parser grammar.
 */
export function containsDocumentAgentProtocolSyntax(text: string): boolean {
  return /<\/?(?:exograph|exo)-(?:invocation|agent-response)\b/.test(text);
}

/**
 * Parses the two canonical protocol envelopes plus the durable `exo-*` names
 * emitted before the product rename, retains source coordinates for the
 * editor, and ignores malformed/unpaired markup. Parsing never rewrites source.
 * ID-less invocation envelopes remain render-only Markdown and can never
 * identify or authorize a V1 run.
 */
export function findDocumentAgentEnvelopes(text: string): DocumentAgentEnvelope[] {
  const envelopes: DocumentAgentEnvelope[] = [];
  const openings: Array<{
    tag: DocumentAgentProtocolTag;
    attrs: Record<string, string>;
    from: number;
    contentFrom: number;
  }> = [];
  const tokens = /<((?:exograph|exo)-(?:invocation|agent-response))\b([^>]*)>\n|\n<\/((?:exograph|exo)-(?:invocation|agent-response))>/g;

  for (const match of text.matchAll(tokens)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const openingTag = match[1] as DocumentAgentProtocolTag | undefined;
    if (openingTag) {
      openings.push({ tag: openingTag, attrs: parseAttributes(match[2] ?? ""), from, contentFrom: to });
      continue;
    }
    const closingTag = match[3] as DocumentAgentProtocolTag;
    const openingIndex = findMatchingOpening(openings, closingTag);
    if (openingIndex < 0) continue;
    const [opening] = openings.splice(openingIndex, 1);
    if (opening.contentFrom > from) continue;
    const agent = opening.attrs.agent;
    if (!isProtocolAgent(agent)) continue;

    if (isInvocationTag(opening.tag)) {
      if (opening.attrs.status !== "sent" || (opening.attrs.id !== undefined && !isDocumentAgentProtocolId(opening.attrs.id))) continue;
      envelopes.push({
        kind: "invocation",
        ...(opening.attrs.id ? { id: opening.attrs.id } : {}),
        agent,
        status: "sent",
        from: opening.from,
        contentFrom: opening.contentFrom,
        contentTo: from,
        to,
      });
      continue;
    }

    if (!isDocumentAgentProtocolId(opening.attrs.invocation)) continue;
    envelopes.push({
      kind: "response",
      invocationId: opening.attrs.invocation,
      agent,
      from: opening.from,
      contentFrom: opening.contentFrom,
      contentTo: from,
      to,
    });
  }
  return envelopes;
}

/**
 * Derive the clean pre-invocation document from the exact saved launch body.
 * The invocation envelope replaced the live compose range in one editor
 * transaction, so deleting this exact source range also deletes the request
 * text and no unrelated document bytes.
 */
export function removeDocumentAgentInvocation(
  text: string,
  invocationId: string,
  expectedAgent?: string,
): string | null {
  if (!isDocumentAgentProtocolId(invocationId)) return null;
  const envelope = findDocumentAgentEnvelopes(text).find((candidate) =>
    candidate.kind === "invocation" &&
    candidate.id === invocationId &&
    (expectedAgent === undefined || candidate.agent === expectedAgent),
  );
  return envelope ? `${text.slice(0, envelope.from)}${text.slice(envelope.to)}` : null;
}

function findMatchingOpening(
  openings: Array<{ tag: DocumentAgentProtocolTag }>,
  closingTag: DocumentAgentProtocolTag,
): number {
  for (let index = openings.length - 1; index >= 0; index -= 1) {
    if (openings[index].tag === closingTag) return index;
  }
  return -1;
}

function isInvocationTag(tag: DocumentAgentProtocolTag): tag is DocumentAgentInvocationTag {
  return tag === EXOGRAPH_INVOCATION_TAG || tag === LEGACY_EXO_INVOCATION_TAG;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/\s([a-z][a-z0-9_-]*)="([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function isProtocolAgent(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{1,31}$/.test(value);
}

function assertProtocolId(value: string, label: string): void {
  if (!isDocumentAgentProtocolId(value)) throw new Error(`Invalid ${label}.`);
}

function assertAgent(value: string): void {
  if (!isProtocolAgent(value)) throw new Error("Invalid agent handle.");
}
