import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

import {
  graphPropertyRecord,
  type ConceptNode,
  type GraphFinding,
  type GraphPropertyValue,
  type RelationEdge,
  type RelationResolution,
} from "./knowledge-graph";

export const WORKSPACE_ONTOLOGY_SCHEMA = 1 as const;
export const WORKSPACE_ONTOLOGY_FILENAME = "ontology.yaml" as const;
export const WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA = 1 as const;
const MAX_ONTOLOGY_BYTES = 1024 * 1024;
const MAX_ACTIVATION_BYTES = MAX_ONTOLOGY_BYTES + 64 * 1024;

export type OntologyPropertyValueShape =
  | "string"
  | "string[]"
  | "number"
  | "number[]"
  | "boolean"
  | "boolean[]"
  | "reference"
  | "reference[]";

export interface OntologyTypeDefinition {
  label?: string;
  description?: string;
  paths: readonly string[];
}

export interface OntologyPropertyDefinition {
  label?: string;
  description?: string;
  value: OntologyPropertyValueShape;
  allowed?: readonly GraphPropertyValue[];
  predicate?: string;
  direction: "outgoing" | "incoming";
  targets: readonly string[];
}

export interface OntologyValidationRule {
  id: string;
  conceptType: string;
  require: readonly string[];
  recommend: readonly string[];
}

/** Parsed, immutable interpretation data. `source` retains every unknown key. */
export interface WorkspaceOntology {
  ontologySchema: typeof WORKSPACE_ONTOLOGY_SCHEMA;
  id: string;
  version: string;
  revision: string;
  label?: string;
  description?: string;
  typeProperty: string;
  types: Readonly<Record<string, OntologyTypeDefinition>>;
  properties: Readonly<Record<string, OntologyPropertyDefinition>>;
  rules: readonly OntologyValidationRule[];
  source: Readonly<Record<string, GraphPropertyValue>>;
}

export interface WorkspaceOntologyDiagnostic {
  severity: "error";
  code: string;
  path: string;
  message: string;
}

export interface WorkspaceOntologyCandidate {
  state: "absent" | "valid" | "invalid";
  path: string;
  sourceRevision?: string;
  ontology?: WorkspaceOntology;
  diagnostics: readonly WorkspaceOntologyDiagnostic[];
}

export interface WorkspaceOntologyActive {
  state: "generic" | "active" | "invalid-state";
  ontology: WorkspaceOntology | null;
  activationRevision: string | null;
  sourceRevision?: string;
  rejectedCandidateRevision?: string;
  diagnostics: readonly WorkspaceOntologyDiagnostic[];
}

export interface WorkspaceOntologyState {
  candidate: WorkspaceOntologyCandidate;
  active: WorkspaceOntologyActive;
}

interface StoredWorkspaceOntologyActivation {
  schema: typeof WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA;
  active?: {
    source: string;
    sourceRevision: string;
    ontologyRevision: string;
  };
  rejectedCandidateRevision?: string;
  recordHash: string;
}

export interface OntologyReferenceResolution {
  targetId: string;
  resolution: RelationResolution;
}

export interface OntologyInterpretation {
  concepts: readonly ConceptNode[];
  relations: readonly RelationEdge[];
  findings: readonly GraphFinding[];
}

export function workspaceOntologyPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), WORKSPACE_ONTOLOGY_FILENAME);
}

export function isWorkspaceOntologyPath(workspaceRoot: string, filePath: string): boolean {
  return path.resolve(filePath) === workspaceOntologyPath(workspaceRoot);
}

/**
 * Separates the user-edited candidate from the explicitly kept interpreter.
 * Merely changing ontology.yaml never changes the active graph contract.
 */
export class WorkspaceOntologyStore {
  readonly ontologyPath: string;
  readonly activationPath: string;
  private readonly workspaceRoot: string;
  private readonly runtimeRoot: string;

  constructor(options: { workspaceRoot: string; runtimeRoot: string }) {
    const { workspaceRoot, runtimeRoot } = options;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.ontologyPath = workspaceOntologyPath(workspaceRoot);
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.activationPath = path.join(this.runtimeRoot, "ontology", "activation.json");
  }

  async inspectCandidate(): Promise<WorkspaceOntologyCandidate> {
    let source: string;
    try {
      const handle = await openNoFollow(this.ontologyPath);
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error(`${WORKSPACE_ONTOLOGY_FILENAME} must be a regular file.`);
        if (info.size > MAX_ONTOLOGY_BYTES) {
          return { state: "invalid", path: this.ontologyPath, diagnostics: [{
            severity: "error",
            code: "ontology.too-large",
            path: "$",
            message: `${WORKSPACE_ONTOLOGY_FILENAME} exceeds the ${MAX_ONTOLOGY_BYTES}-byte limit.`,
          }] };
        }
        const [realRoot, realCandidate] = await Promise.all([
          realpath(this.workspaceRoot),
          realpath(this.ontologyPath),
        ]);
        if (realCandidate !== path.join(realRoot, WORKSPACE_ONTOLOGY_FILENAME)) {
          throw new Error(`${WORKSPACE_ONTOLOGY_FILENAME} escapes the configured Workspace root.`);
        }
        source = await readBoundedUtf8(handle, MAX_ONTOLOGY_BYTES);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { state: "absent", path: this.ontologyPath, diagnostics: [] };
      }
      return { state: "invalid", path: this.ontologyPath, diagnostics: [{
        severity: "error",
        code: "ontology.read-failed",
        path: "$",
        message: `Could not read ${WORKSPACE_ONTOLOGY_FILENAME}.`,
      }] };
    }

    const sourceRevision = revision("ontology-source", source);

    const parsed = parseWorkspaceOntology(source);
    if (!parsed.ontology) {
      return { state: "invalid", path: this.ontologyPath, sourceRevision, diagnostics: parsed.diagnostics };
    }
    return { state: "valid", path: this.ontologyPath, sourceRevision, ontology: parsed.ontology, diagnostics: [] };
  }

  async active(): Promise<WorkspaceOntologyActive> {
    const stored = await this.readActivation();
    if (!stored) return { state: "generic", ontology: null, activationRevision: null, diagnostics: [] };
    if ("diagnostics" in stored) return stored;
    if (!stored.active) {
      return {
        state: "generic",
        ontology: null,
        activationRevision: stored.recordHash,
        ...(stored.rejectedCandidateRevision ? { rejectedCandidateRevision: stored.rejectedCandidateRevision } : {}),
        diagnostics: [],
      };
    }
    const parsed = parseWorkspaceOntology(stored.active.source);
    if (!parsed.ontology
      || revision("ontology-source", stored.active.source) !== stored.active.sourceRevision
      || parsed.ontology.revision !== stored.active.ontologyRevision) {
      return invalidPersistedState("The kept Workspace Ontology state failed integrity validation.");
    }
    return {
      state: "active",
      ontology: parsed.ontology,
      activationRevision: stored.recordHash,
      sourceRevision: stored.active.sourceRevision,
      ...(stored.rejectedCandidateRevision ? { rejectedCandidateRevision: stored.rejectedCandidateRevision } : {}),
      diagnostics: [],
    };
  }

  async state(): Promise<WorkspaceOntologyState> {
    const [candidate, active] = await Promise.all([this.inspectCandidate(), this.active()]);
    return { candidate, active };
  }

  async keepCandidate(expectedSourceRevision: string): Promise<WorkspaceOntologyState> {
    const active = await this.active();
    return this.keepReviewedCandidate(expectedSourceRevision, active.activationRevision);
  }

  async keepReviewedCandidate(
    expectedSourceRevision: string,
    expectedActivationRevision: string | null,
  ): Promise<WorkspaceOntologyState> {
    await this.assertActivationRevision(expectedActivationRevision);
    const candidate = await this.inspectCandidate();
    assertCandidateRevision(candidate, expectedSourceRevision);
    if (candidate.state !== "valid" || !candidate.ontology || !candidate.sourceRevision) {
      throw new Error("Only a valid Workspace Ontology candidate can be kept.");
    }
    const source = await this.readValidatedCandidateSource(expectedSourceRevision);
    await this.writeActivation({
      schema: WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA,
      active: {
        source,
        sourceRevision: expectedSourceRevision,
        ontologyRevision: candidate.ontology.revision,
      },
      recordHash: "",
    });
    return this.state();
  }

  async rejectCandidate(expectedSourceRevision: string): Promise<WorkspaceOntologyState> {
    const active = await this.active();
    return this.rejectReviewedCandidate(expectedSourceRevision, active.activationRevision);
  }

  async rejectReviewedCandidate(
    expectedSourceRevision: string,
    expectedActivationRevision: string | null,
  ): Promise<WorkspaceOntologyState> {
    await this.assertActivationRevision(expectedActivationRevision);
    const candidate = await this.inspectCandidate();
    assertCandidateRevision(candidate, expectedSourceRevision);
    const stored = await this.readActivationRecord();
    await this.writeActivation({
      schema: WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA,
      ...(stored?.active ? { active: stored.active } : {}),
      rejectedCandidateRevision: expectedSourceRevision,
      recordHash: "",
    });
    return this.state();
  }

  async keepGeneric(expectedActiveSourceRevision: string): Promise<WorkspaceOntologyState> {
    const active = await this.active();
    return this.keepReviewedGeneric(active.activationRevision, expectedActiveSourceRevision);
  }

  async keepReviewedGeneric(
    expectedActivationRevision: string | null,
    expectedActiveSourceRevision?: string,
  ): Promise<WorkspaceOntologyState> {
    await this.assertActivationRevision(expectedActivationRevision);
    const candidate = await this.inspectCandidate();
    if (candidate.state !== "absent") {
      throw new Error("Generic Markdown can be kept only after the Workspace Ontology candidate is removed.");
    }
    const active = await this.active();
    if (active.state !== "active"
      || (expectedActiveSourceRevision !== undefined && active.sourceRevision !== expectedActiveSourceRevision)) {
      throw new Error("The active Workspace Ontology changed; inspect it again before keeping Generic Markdown.");
    }
    await this.writeActivation({ schema: WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA, recordHash: "" });
    return this.state();
  }

  async rejectReviewedGeneric(expectedActivationRevision: string | null): Promise<WorkspaceOntologyState> {
    await this.assertActivationRevision(expectedActivationRevision);
    const candidate = await this.inspectCandidate();
    if (candidate.state !== "absent") {
      throw new Error("Generic Markdown rejection requires an absent Workspace Ontology candidate.");
    }
    const stored = await this.readActivationRecord();
    if (!stored?.active || expectedActivationRevision === null) {
      throw new Error("There is no active Workspace Ontology deactivation to reject.");
    }
    await this.writeActivation({
      schema: WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA,
      active: stored.active,
      rejectedCandidateRevision: absentCandidateRevision(stored.active.sourceRevision),
      recordHash: "",
    });
    return this.state();
  }

  private async assertActivationRevision(expected: string | null): Promise<void> {
    const active = await this.active();
    if (active.state === "invalid-state") {
      throw new Error("Workspace Ontology activation state is invalid; repair it before Keep or Reject.");
    }
    if (active.activationRevision !== expected) {
      throw new Error("Workspace Ontology activation changed; review it again before Keep or Reject.");
    }
  }

  private async readValidatedCandidateSource(expectedRevision: string): Promise<string> {
    const handle = await openNoFollow(this.ontologyPath);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_ONTOLOGY_BYTES) throw candidateChangedError();
      const [realRoot, realCandidate] = await Promise.all([
        realpath(this.workspaceRoot),
        realpath(this.ontologyPath),
      ]);
      if (realCandidate !== path.join(realRoot, WORKSPACE_ONTOLOGY_FILENAME)) throw candidateChangedError();
      const source = await readBoundedUtf8(handle, MAX_ONTOLOGY_BYTES);
      if (revision("ontology-source", source) !== expectedRevision || !parseWorkspaceOntology(source).ontology) {
        throw candidateChangedError();
      }
      return source;
    } finally {
      await handle.close();
    }
  }

  private async readActivation(): Promise<StoredWorkspaceOntologyActivation | WorkspaceOntologyActive | null> {
    try {
      await this.assertActivationPathSafe(false);
      const handle = await openNoFollow(this.activationPath);
      let source: string;
      try {
        const info = await handle.stat();
        if (!info.isFile()) return invalidPersistedState("The kept Workspace Ontology state is not a regular file.");
        if (info.size > MAX_ACTIVATION_BYTES) {
          return invalidPersistedState("The kept Workspace Ontology state exceeds its size limit.");
        }
        source = await readBoundedUtf8(handle, MAX_ACTIVATION_BYTES);
      } finally {
        await handle.close();
      }
      const value = JSON.parse(source) as unknown;
      if (!isStoredActivation(value)) return invalidPersistedState("The kept Workspace Ontology state is invalid.");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return invalidPersistedState("The kept Workspace Ontology state could not be read.");
    }
  }

  private async readActivationRecord(): Promise<StoredWorkspaceOntologyActivation | null> {
    const active = await this.readActivation();
    return active && !("diagnostics" in active) ? active : null;
  }

  private async writeActivation(value: StoredWorkspaceOntologyActivation): Promise<void> {
    await this.assertActivationPathSafe(true);
    const complete = { ...value, recordHash: activationRecordHash(value) };
    const temporaryPath = `${this.activationPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(complete, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.activationPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async assertActivationPathSafe(create: boolean): Promise<void> {
    if (create) await mkdir(this.runtimeRoot, { recursive: true });
    const runtimeStat = await lstat(this.runtimeRoot);
    if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) throw new Error("Workspace Ontology runtime root must be a real directory.");
    const directory = path.dirname(this.activationPath);
    if (create) await mkdir(directory, { recursive: true });
    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Workspace Ontology activation directory must not be a symlink.");
    const [realRoot, realDirectory] = await Promise.all([realpath(this.runtimeRoot), realpath(directory)]);
    if (realDirectory !== realRoot && !realDirectory.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error("Workspace Ontology activation path escapes the configured runtime root.");
    }
    try {
      if ((await lstat(this.activationPath)).isSymbolicLink()) {
        throw new Error("Workspace Ontology activation file must not be a symlink.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function parseWorkspaceOntology(source: string): {
  ontology: WorkspaceOntology | null;
  diagnostics: readonly WorkspaceOntologyDiagnostic[];
} {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ontology: null,
      diagnostics: document.errors.map((error, index) => ({
        severity: "error" as const,
        code: "ontology.invalid-yaml",
        path: "$",
        message: `YAML ${index + 1}: ${error.message}`,
      })),
    };
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return {
      ontology: null,
      diagnostics: [{
        severity: "error",
        code: "ontology.invalid-yaml",
        path: "$",
        message: error instanceof Error ? error.message : "The YAML document could not be read.",
      }],
    };
  }
  const diagnostics: WorkspaceOntologyDiagnostic[] = [];
  const root = expectRecord(value, "$", diagnostics);
  if (!root) return { ontology: null, diagnostics };

  if (root.ontology_schema !== WORKSPACE_ONTOLOGY_SCHEMA) {
    diagnostics.push({
      severity: "error",
      code: "ontology.unsupported-schema",
      path: "ontology_schema",
      message: `Expected ontology_schema: ${WORKSPACE_ONTOLOGY_SCHEMA}.`,
    });
  }
  const id = requiredString(root.id, "id", diagnostics);
  const ontologyVersion = scalarVersion(root.version, "version", diagnostics);
  const label = optionalString(root.label, "label", diagnostics);
  const description = optionalString(root.description, "description", diagnostics);
  const typeProperty = root.type_property === undefined
    ? "type"
    : requiredString(root.type_property, "type_property", diagnostics);
  const types = parseTypes(root.types, diagnostics);
  const properties = parseProperties(root.properties, diagnostics);
  const rules = parseRules(root.rules, diagnostics);
  if (diagnostics.length > 0 || !id || !ontologyVersion || !typeProperty) {
    return { ontology: null, diagnostics: stableDiagnostics(diagnostics) };
  }

  return {
    ontology: {
      ontologySchema: WORKSPACE_ONTOLOGY_SCHEMA,
      id,
      version: ontologyVersion,
      revision: revision("workspace-ontology", source),
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      typeProperty,
      types,
      properties,
      rules,
      source: graphPropertyRecord(root),
    },
    diagnostics: [],
  };
}

export function ontologyConceptTypes(
  ontology: WorkspaceOntology | null,
  properties: Readonly<Record<string, unknown>>,
  relativePath: string,
  formatTypes: readonly string[],
): readonly string[] {
  if (!ontology) return formatTypes;
  const explicit = openStrings(properties[ontology.typeProperty]);
  if (explicit.length > 0) return explicit;
  const pathDefaults = Object.entries(ontology.types)
    .filter(([, definition]) => definition.paths.some((pattern) => pathGlobMatches(pattern, relativePath)))
    .map(([type]) => type)
    .sort();
  return pathDefaults.length > 0 ? pathDefaults : [...formatTypes];
}

export function interpretWorkspaceOntology(
  ontology: WorkspaceOntology | null,
  concepts: readonly ConceptNode[],
  resolveReference: (source: ConceptNode, reference: string) => OntologyReferenceResolution,
): OntologyInterpretation {
  if (!ontology) return { concepts: [], relations: [], findings: [] };
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const endpointConcepts = new Map<string, ConceptNode>();
  const relations: RelationEdge[] = [];
  const findings: GraphFinding[] = [];

  for (const concept of concepts.filter((candidate) => candidate.noteId).sort((left, right) => left.id.localeCompare(right.id))) {
    validateConceptProperties(ontology, concept, findings);
    for (const [property, definition] of Object.entries(ontology.properties)) {
      if (definition.value !== "reference" && definition.value !== "reference[]") continue;
      const references = referenceValues(concept.properties[property]);
      references.forEach((reference, occurrence) => {
        const target = resolveReference(concept, reference);
        if (!conceptById.has(target.targetId) && !endpointConcepts.has(target.targetId)) {
          endpointConcepts.set(target.targetId, {
            id: target.targetId,
            label: reference,
            conceptTypes: [],
            properties: {},
            resolution: target.resolution === "external" ? "external" : "unresolved",
            tags: [],
          });
        }
        const rulePath = `properties.${property}`;
        const relation: RelationEdge = {
          id: `relation:ontology:${encodeURIComponent(ontology.id)}:${encodeURIComponent(concept.id)}:${encodeURIComponent(property)}:${encodeURIComponent(reference)}:${occurrence}`,
          source: definition.direction === "outgoing" ? concept.id : target.targetId,
          target: definition.direction === "outgoing" ? target.targetId : concept.id,
          family: "property-reference",
          predicate: definition.predicate ?? property,
          origin: "ontology",
          resolution: target.resolution,
          directed: true,
          label: reference,
          evidence: [
            { kind: "property", noteId: concept.noteId, property, detail: reference },
            ontologyRuleEvidence(ontology, rulePath),
          ],
        };
        relations.push(relation);
        if (target.resolution !== "resolved") {
          findings.push(ontologyFinding(
            ontology,
            `reference-${target.resolution}`,
            `${property} references ${reference}, which is ${target.resolution}.`,
            [concept.id, target.targetId],
            [relation.id],
            property,
            rulePath,
          ));
          return;
        }
        if (definition.targets.length === 0) return;
        const targetConcept = conceptById.get(target.targetId);
        if (targetConcept && !targetConcept.conceptTypes.some((type) => definition.targets.includes(type))) {
          findings.push(ontologyFinding(
            ontology,
            "reference-target-type",
            `${property} expects ${formatList(definition.targets)} but references ${targetConcept.label}.`,
            [concept.id, target.targetId],
            [relation.id],
            property,
            rulePath,
          ));
        }
      });
    }
  }
  return {
    concepts: [...endpointConcepts.values()].sort(byId),
    relations: relations.sort(byId),
    findings: findings.sort(byId),
  };
}

function parseTypes(
  value: unknown,
  diagnostics: WorkspaceOntologyDiagnostic[],
): Readonly<Record<string, OntologyTypeDefinition>> {
  if (value === undefined) return {};
  const record = expectRecord(value, "types", diagnostics);
  if (!record) return {};
  const result: Record<string, OntologyTypeDefinition> = {};
  for (const [id, item] of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    const definition = expectRecord(item, `types.${id}`, diagnostics);
    if (!definition) continue;
    const label = optionalString(definition.label, `types.${id}.label`, diagnostics);
    const description = optionalString(definition.description, `types.${id}.description`, diagnostics);
    const paths = optionalStringArray(definition.paths, `types.${id}.paths`, diagnostics);
    result[id] = { ...(label ? { label } : {}), ...(description ? { description } : {}), paths };
  }
  return result;
}

function parseProperties(
  value: unknown,
  diagnostics: WorkspaceOntologyDiagnostic[],
): Readonly<Record<string, OntologyPropertyDefinition>> {
  if (value === undefined) return {};
  const record = expectRecord(value, "properties", diagnostics);
  if (!record) return {};
  const result: Record<string, OntologyPropertyDefinition> = {};
  for (const [id, item] of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    const definition = expectRecord(item, `properties.${id}`, diagnostics);
    if (!definition) continue;
    const shape = requiredString(definition.value, `properties.${id}.value`, diagnostics);
    if (!isValueShape(shape)) {
      diagnostics.push({
        severity: "error",
        code: "ontology.invalid-value-shape",
        path: `properties.${id}.value`,
        message: `Unsupported Property value shape: ${shape || "missing"}.`,
      });
      continue;
    }
    const label = optionalString(definition.label, `properties.${id}.label`, diagnostics);
    const description = optionalString(definition.description, `properties.${id}.description`, diagnostics);
    const predicate = optionalString(definition.predicate, `properties.${id}.predicate`, diagnostics);
    const direction = definition.direction === undefined ? "outgoing" : definition.direction;
    if (direction !== "outgoing" && direction !== "incoming") {
      diagnostics.push({ severity: "error", code: "ontology.invalid-direction", path: `properties.${id}.direction`, message: "Direction must be outgoing or incoming." });
      continue;
    }
    const targets = optionalStringArray(definition.targets, `properties.${id}.targets`, diagnostics);
    const allowed = optionalAllowedValues(definition.allowed, `properties.${id}.allowed`, diagnostics);
    if ((predicate || targets.length > 0 || direction === "incoming") && shape !== "reference" && shape !== "reference[]") {
      diagnostics.push({
        severity: "error",
        code: "ontology.non-reference-relation",
        path: `properties.${id}`,
        message: "Predicate, direction, and targets are valid only for reference Properties.",
      });
      continue;
    }
    result[id] = {
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      value: shape,
      ...(allowed ? { allowed } : {}),
      ...(predicate ? { predicate } : {}),
      direction,
      targets,
    };
  }
  return result;
}

function parseRules(value: unknown, diagnostics: WorkspaceOntologyDiagnostic[]): readonly OntologyValidationRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push({ severity: "error", code: "ontology.invalid-shape", path: "rules", message: "rules must be a list." });
    return [];
  }
  const rules = value.map((item, index): OntologyValidationRule | null => {
    const rulePath = `rules[${index}]`;
    const rule = expectRecord(item, rulePath, diagnostics);
    if (!rule) return null;
    const conceptType = requiredString(rule.type, `${rulePath}.type`, diagnostics);
    const id = requiredString(rule.id, `${rulePath}.id`, diagnostics);
    const require = optionalStringArray(rule.require, `${rulePath}.require`, diagnostics);
    const recommend = optionalStringArray(rule.recommend, `${rulePath}.recommend`, diagnostics);
    return conceptType && id ? { id, conceptType, require, recommend } : null;
  }).filter((rule): rule is OntologyValidationRule => rule !== null);
  const seen = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    if (!seen.has(rule.id)) {
      seen.add(rule.id);
      continue;
    }
    diagnostics.push({
      severity: "error",
      code: "ontology.duplicate-rule-id",
      path: `rules[${index}].id`,
      message: `Ontology rule id ${rule.id} is duplicated.`,
    });
  }
  return rules;
}

function validateConceptProperties(
  ontology: WorkspaceOntology,
  concept: ConceptNode,
  findings: GraphFinding[],
): void {
  for (const [property, definition] of Object.entries(ontology.properties)) {
    const value = concept.properties[property];
    if (value === undefined) continue;
    if (!valueMatchesShape(value, definition.value)) {
      findings.push(ontologyFinding(
        ontology,
        "property-shape",
        `${property} must be ${definition.value}.`,
        [concept.id],
        [],
        property,
        `properties.${property}.value`,
      ));
    }
    if (definition.allowed && !arrayValues(value).every((item) => definition.allowed?.some((allowed) => sameScalar(allowed, item)))) {
      findings.push(ontologyFinding(
        ontology,
        "property-allowed",
        `${property} contains a value outside its allowed set.`,
        [concept.id],
        [],
        property,
        `properties.${property}.allowed`,
      ));
    }
  }
  for (const rule of ontology.rules) {
    if (!concept.conceptTypes.includes(rule.conceptType)) continue;
    for (const property of rule.require) {
      if (!hasPropertyValue(concept.properties[property])) {
        findings.push(ontologyFinding(
          ontology,
          "required-property",
          `${concept.label} requires ${property}.`,
          [concept.id],
          [],
          property,
          `rules.${rule.id}.require`,
        ));
      }
    }
    for (const property of rule.recommend) {
      if (!hasPropertyValue(concept.properties[property])) {
        findings.push({
          ...ontologyFinding(
            ontology,
            "recommended-property",
            `${concept.label} recommends ${property}.`,
            [concept.id],
            [],
            property,
            `rules.${rule.id}.recommend`,
          ),
          severity: "info",
        });
      }
    }
  }
}

function ontologyFinding(
  ontology: WorkspaceOntology,
  code: string,
  message: string,
  conceptIds: readonly string[],
  relationIds: readonly string[],
  property: string,
  rulePath: string,
): GraphFinding {
  return {
    id: `finding:ontology:${encodeURIComponent(ontology.id)}:${code}:${encodeURIComponent(conceptIds.join("|"))}:${encodeURIComponent(relationIds.join("|"))}:${encodeURIComponent(property)}:${encodeURIComponent(rulePath)}`,
    severity: "warning",
    code: `ontology.${code}`,
    message,
    conceptIds,
    relationIds,
    evidence: [
      { kind: "property", noteId: conceptIds[0], property },
      ontologyRuleEvidence(ontology, rulePath),
    ],
  };
}

function ontologyRuleEvidence(ontology: WorkspaceOntology, rulePath: string) {
  return {
    kind: "ontology-rule" as const,
    producer: { id: ontology.id, version: ontology.revision },
    detail: `${ontology.version}:${rulePath}`,
  };
}

function invalidPersistedState(message: string): WorkspaceOntologyActive {
  return {
    state: "invalid-state",
    ontology: null,
    activationRevision: null,
    diagnostics: [{ severity: "error", code: "ontology.invalid-activation-state", path: "$", message }],
  };
}

function isStoredActivation(value: unknown): value is StoredWorkspaceOntologyActivation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredWorkspaceOntologyActivation>;
  if (candidate.schema !== WORKSPACE_ONTOLOGY_ACTIVATION_SCHEMA) return false;
  if (typeof candidate.recordHash !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.recordHash)) return false;
  if (!Object.keys(candidate).every((key) => ["schema", "active", "rejectedCandidateRevision", "recordHash"].includes(key))) return false;
  if (candidate.rejectedCandidateRevision !== undefined && typeof candidate.rejectedCandidateRevision !== "string") return false;
  const validActive = candidate.active === undefined || (Boolean(candidate.active)
    && Object.keys(candidate.active).every((key) => ["source", "sourceRevision", "ontologyRevision"].includes(key))
    && typeof candidate.active.source === "string"
    && typeof candidate.active.sourceRevision === "string"
    && typeof candidate.active.ontologyRevision === "string");
  return validActive && candidate.recordHash === activationRecordHash(candidate as StoredWorkspaceOntologyActivation);
}

function activationRecordHash(value: Omit<StoredWorkspaceOntologyActivation, "recordHash"> | StoredWorkspaceOntologyActivation): string {
  return revision("ontology-activation", JSON.stringify({
    schema: value.schema,
    active: value.active,
    rejectedCandidateRevision: value.rejectedCandidateRevision,
  }));
}

function assertCandidateRevision(candidate: WorkspaceOntologyCandidate, expected: string): void {
  if (!candidate.sourceRevision || candidate.sourceRevision !== expected) throw candidateChangedError();
}

function candidateChangedError(): Error {
  return new Error("Workspace Ontology candidate changed; inspect it again before Keep or Reject.");
}

function openNoFollow(filePath: string) {
  return open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
}

export function absentWorkspaceOntologyCandidateRevision(activationRevision: string): string {
  return absentCandidateRevision(activationRevision);
}

function absentCandidateRevision(activationRevision: string): string {
  return revision("ontology-candidate-absent", activationRevision);
}

async function readBoundedUtf8(handle: FileHandle, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const remaining = maxBytes + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit.`);
  return Buffer.concat(chunks, total).toString("utf8");
}

function expectRecord(
  value: unknown,
  itemPath: string,
  diagnostics: WorkspaceOntologyDiagnostic[],
): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  diagnostics.push({ severity: "error", code: "ontology.invalid-shape", path: itemPath, message: `${itemPath} must be a map.` });
  return null;
}

function requiredString(value: unknown, itemPath: string, diagnostics: WorkspaceOntologyDiagnostic[]): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  diagnostics.push({ severity: "error", code: "ontology.invalid-string", path: itemPath, message: `${itemPath} must be a nonempty string.` });
  return "";
}

function optionalString(value: unknown, itemPath: string, diagnostics: WorkspaceOntologyDiagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, itemPath, diagnostics) || undefined;
}

function scalarVersion(value: unknown, itemPath: string, diagnostics: WorkspaceOntologyDiagnostic[]): string {
  if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim();
  diagnostics.push({ severity: "error", code: "ontology.invalid-version", path: itemPath, message: `${itemPath} must be a nonempty string or number.` });
  return "";
}

function optionalStringArray(value: unknown, itemPath: string, diagnostics: WorkspaceOntologyDiagnostic[]): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    diagnostics.push({ severity: "error", code: "ontology.invalid-string-list", path: itemPath, message: `${itemPath} must be a list of nonempty strings.` });
    return [];
  }
  return [...new Set(value.map((item) => (item as string).trim()))].sort();
}

function optionalAllowedValues(
  value: unknown,
  itemPath: string,
  diagnostics: WorkspaceOntologyDiagnostic[],
): readonly GraphPropertyValue[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => item !== null && !["string", "number", "boolean"].includes(typeof item))) {
    diagnostics.push({ severity: "error", code: "ontology.invalid-allowed", path: itemPath, message: `${itemPath} must contain only scalar YAML values.` });
    return undefined;
  }
  return value as readonly GraphPropertyValue[];
}

function isValueShape(value: string): value is OntologyPropertyValueShape {
  return ["string", "string[]", "number", "number[]", "boolean", "boolean[]", "reference", "reference[]"].includes(value);
}

function openStrings(value: unknown): readonly string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}

function referenceValues(value: GraphPropertyValue | undefined): readonly string[] {
  return openStrings(value);
}

function valueMatchesShape(value: GraphPropertyValue, shape: OntologyPropertyValueShape): boolean {
  const base = shape.replace("[]", "");
  const values = shape.endsWith("[]") ? Array.isArray(value) ? value : null : [value];
  if (!values) return false;
  return values.every((item) => {
    if (base === "reference" || base === "string") return typeof item === "string" && item.trim().length > 0;
    return typeof item === base;
  });
}

function arrayValues(value: GraphPropertyValue): readonly GraphPropertyValue[] {
  return Array.isArray(value) ? value : [value];
}

function sameScalar(left: GraphPropertyValue, right: GraphPropertyValue): boolean {
  return (left === null || ["string", "number", "boolean"].includes(typeof left)) && left === right;
}

function hasPropertyValue(value: GraphPropertyValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pathGlobMatches(pattern: string, relativePath: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedPath = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index] ?? "";
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${expression}$`).test(normalizedPath);
}

function revision(namespace: string, source: string): string {
  return createHash("sha256").update(namespace).update("\u0000").update(source).digest("hex");
}

function stableDiagnostics(diagnostics: readonly WorkspaceOntologyDiagnostic[]): readonly WorkspaceOntologyDiagnostic[] {
  return [...diagnostics].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}

function formatList(values: readonly string[]): string {
  return values.join(" or ");
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
