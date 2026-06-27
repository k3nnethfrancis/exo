import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem, PluginSettingField, PluginSettingsSchema, ResolvedPluginSettings } from "@exo/core";
import { Power, PowerOff, RotateCcw, Save, ShieldCheck, X } from "lucide-react";

import {
  buildPluginCategoryFilters,
  buildPluginDetailSections,
  createPluginSettingsDraft,
  filterPluginInventoryItems,
  pluginSettingsAvailability,
  pluginSettingsValuesFromDraft,
  pluginActionAvailability,
  pluginActionInput,
  type PluginManagerAction,
  type PluginSettingsDraft,
} from "../pluginManagerModel";
import type { WorkspacePluginSettingsResponse } from "../../../shared/api";

interface PluginManagerDialogProps {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: PluginManagerDialogProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [settingsState, setSettingsState] = useState<"idle" | "loading" | "error">("idle");
  const [settingsResponse, setSettingsResponse] = useState<WorkspacePluginSettingsResponse | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PluginSettingsDraft>({});
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [pendingSettingsAction, setPendingSettingsAction] = useState<"apply" | "reset" | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("core");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setErrorMessage(null);
    window.exo.workspace.listPluginInventory()
      .then((nextInventory) => {
        if (!cancelled) {
          setInventory(nextInventory);
          setLoadState("idle");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const categoryFilters = useMemo(() => buildPluginCategoryFilters(inventory?.items ?? []), [inventory]);
  const visibleItems = useMemo(
    () => filterPluginInventoryItems(inventory?.items ?? [], selectedCategoryId),
    [inventory, selectedCategoryId],
  );
  const selectedItem = useMemo(() => {
    if (!inventory || visibleItems.length === 0) {
      return null;
    }
    return visibleItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? null;
  }, [inventory, selectedItemId, visibleItems]);
  const detailSections = useMemo(
    () => selectedItem ? buildPluginDetailSections(selectedItem, inventory ?? undefined) : [],
    [inventory, selectedItem],
  );
  const actionAvailability = useMemo(
    () => selectedItem ? pluginActionAvailability(selectedItem) : null,
    [selectedItem],
  );
  const settingsAvailability = useMemo(
    () => selectedItem ? pluginSettingsAvailability(selectedItem) : null,
    [selectedItem],
  );
  const selectedSettingsKey = selectedItem
    ? `${selectedItem.pluginId ?? selectedItem.id}:${selectedItem.pluginSource ?? selectedItem.source}:${selectedItem.manifestPath ?? ""}:${selectedItem.rootDirectory ?? ""}`
    : "";
  const detailHeadingId = selectedItem ? `plugin-manager-detail-heading-${selectedItem.id}` : undefined;

  useEffect(() => {
    let cancelled = false;
    setSettingsResponse(null);
    setSettingsDraft({});
    setSettingsMessage(null);
    setSettingsState("idle");

    if (!selectedItem || !settingsAvailability?.canRead) {
      return () => {
        cancelled = true;
      };
    }

    setSettingsState("loading");
    window.exo.workspace.readPluginSettings(pluginActionInput(selectedItem))
      .then((response) => {
        if (!cancelled) {
          setSettingsResponse(response);
          setSettingsDraft(createPluginSettingsDraft(response.schema, response.settings));
          setSettingsState("idle");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsState("error");
          setSettingsMessage(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSettingsKey, settingsAvailability?.canRead]);

  function selectCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedItemId(null);
  }

  async function runPluginAction(item: PluginInventoryItem, action: PluginManagerAction) {
    const actionKey = `${item.pluginId ?? item.id}:${action}`;
    setPendingAction(actionKey);
    setActionMessage(null);
    setErrorMessage(null);
    try {
      const input = pluginActionInput(item);
      const nextInventory = action === "trust"
        ? await window.exo.workspace.trustPlugin(input)
        : action === "enable"
          ? await window.exo.workspace.enablePlugin(input)
          : await window.exo.workspace.disablePlugin(input);
      setInventory(nextInventory);
      setLoadState("idle");
      setSelectedItemId(item.id);
      setActionMessage(pluginActionSuccessMessage(action, item));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setLoadState("error");
    } finally {
      setPendingAction(null);
    }
  }

  async function applyPluginSettings(item: PluginInventoryItem, schema: PluginSettingsSchema) {
    setPendingSettingsAction("apply");
    setSettingsMessage(null);
    setErrorMessage(null);
    try {
      const values = pluginSettingsValuesFromDraft(schema, settingsDraft);
      const response = await window.exo.workspace.updatePluginSettings({
        ...pluginActionInput(item),
        values,
      });
      setInventory(response.inventory);
      setSettingsResponse(response);
      setSettingsDraft(createPluginSettingsDraft(response.schema, response.settings));
      setSettingsState("idle");
      setSettingsMessage("Plugin settings applied.");
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSettingsAction(null);
    }
  }

  async function resetPluginSettings(item: PluginInventoryItem) {
    setPendingSettingsAction("reset");
    setSettingsMessage(null);
    setErrorMessage(null);
    try {
      const response = await window.exo.workspace.resetPluginSettings(pluginActionInput(item));
      setInventory(response.inventory);
      setSettingsResponse(response);
      setSettingsDraft(createPluginSettingsDraft(response.schema, response.settings));
      setSettingsState("idle");
      setSettingsMessage("Plugin settings reset to defaults.");
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSettingsAction(null);
    }
  }

  return (
    <div className="dialog-overlay" data-testid="plugin-manager-overlay">
      <div className="dialog-card dialog-card--plugin-manager" data-testid="plugin-manager">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Plugin Manager</div>
            <div className="dialog-card__message">
              Inspect Exo core surfaces, official plugins, and local plugin manifests. Local and developer manifests can be trusted or enabled here.
            </div>
          </div>
          <button
            aria-label="Close plugin manager"
            className="dialog-card__close"
            data-testid="plugin-manager-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {loadState === "loading" ? <div className="dialog-card__status">Loading plugin inventory...</div> : null}
        {loadState === "error" ? <div className="dialog-card__status dialog-card__status--error">{errorMessage}</div> : null}
        {actionMessage ? <div className="dialog-card__status dialog-card__status--success">{actionMessage}</div> : null}
        {inventory && inventory.errors.length > 0 ? (
          <div className="dialog-card__status dialog-card__status--warning" data-testid="plugin-manager-errors">
            <div>Some plugin manifests could not be loaded.</div>
            {inventory.errors.slice(0, 3).map((error) => (
              <div key={`${error.directory}:${error.message}`}>{error.directory}: {error.message}</div>
            ))}
          </div>
        ) : null}

        {inventory ? (
          <div className="plugin-manager">
            <div className="plugin-manager__summary" data-testid="plugin-manager-summary">
              <SummaryTile label="Core" value={inventory.counts.core} />
              <SummaryTile label="Official" value={inventory.counts.official} />
              <SummaryTile label="Local" value={inventory.counts.local} />
              <SummaryTile label="Review needed" value={inventory.counts.untrusted} />
            </div>
            <div className="plugin-manager__body">
              <div className="plugin-manager__inventory">
                <div className="plugin-manager__categories" aria-label="Plugin categories" role="tablist">
                  {categoryFilters.map((category) => (
                    <button
                      aria-controls="plugin-manager-item-list"
                      aria-selected={selectedCategoryId === category.id}
                      className={`plugin-manager__category ${selectedCategoryId === category.id ? "plugin-manager__category--selected" : ""}`}
                      data-testid={`plugin-manager-category-${category.id}`}
                      disabled={category.count === 0}
                      key={category.id}
                      onClick={() => selectCategory(category.id)}
                      role="tab"
                      type="button"
                    >
                      <span>{category.label}</span>
                      <strong>{category.count}</strong>
                    </button>
                  ))}
                </div>
                <div
                  aria-activedescendant={selectedItem ? `plugin-inventory-option-${selectedItem.id}` : undefined}
                  aria-label="Plugin inventory"
                  className="plugin-manager__items"
                  data-testid={`plugin-manager-group-${selectedCategoryId}`}
                  id="plugin-manager-item-list"
                  role="listbox"
                >
                  {visibleItems.map((item) => (
                    <PluginInventoryRow
                      isSelected={selectedItem?.id === item.id}
                      item={item}
                      key={`${item.source}:${item.id}`}
                      onSelect={() => setSelectedItemId(item.id)}
                    />
                  ))}
                  {visibleItems.length === 0 ? <p className="plugin-manager__empty">No capabilities in this category.</p> : null}
                </div>
              </div>
              <aside
                aria-labelledby={detailHeadingId}
                className="plugin-manager__detail-panel"
                data-testid="plugin-manager-detail"
              >
                {selectedItem ? (
                  <>
                    <div className="plugin-manager__detail-header">
                      <div>
                        <div className="plugin-manager__detail-kicker">{selectedItem.categoryLabel}</div>
                        <h3 id={detailHeadingId}>{selectedItem.label}</h3>
                      </div>
                      <StatusPill item={selectedItem} />
                    </div>
                    <p>{selectedItem.description}</p>
                    {actionAvailability ? (
                      <div className="plugin-manager__actions" data-testid="plugin-manager-actions">
                        {actionAvailability.actions.map((action) => (
                          <PluginActionButton
                            action={action}
                            disabled={pendingAction !== null}
                            isPending={pendingAction === `${selectedItem.pluginId ?? selectedItem.id}:${action}`}
                            item={selectedItem}
                            key={action}
                            onRun={runPluginAction}
                          />
                        ))}
                        {actionAvailability.actions.length === 0 ? (
                          <small>{actionAvailability.reason}</small>
                        ) : null}
                      </div>
                    ) : null}
                    {detailSections.map((section) => (
                      <section className="plugin-manager__detail-section" key={section.id}>
                        <h4>{section.label}</h4>
                        <dl>
                          {section.rows.map((row) => (
                            <div key={`${section.id}:${row.label}`}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ))}
                    {settingsAvailability?.visible ? (
                      <PluginSettingsSection
                        availabilityReason={settingsAvailability.reason}
                        draft={settingsDraft}
                        editable={settingsAvailability.editable && settingsState !== "loading"}
                        item={selectedItem}
                        message={settingsMessage}
                        onApply={applyPluginSettings}
                        onDraftChange={(fieldId, value) => setSettingsDraft((current) => ({ ...current, [fieldId]: value }))}
                        onReset={resetPluginSettings}
                        pendingAction={pendingSettingsAction}
                        schema={settingsResponse?.schema ?? null}
                        settings={settingsResponse?.settings ?? null}
                        state={settingsState}
                      />
                    ) : null}
                  </>
                ) : (
                  <p>Select a plugin or core surface to inspect.</p>
                )}
              </aside>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PluginSettingsSection({
  availabilityReason,
  draft,
  editable,
  item,
  message,
  onApply,
  onDraftChange,
  onReset,
  pendingAction,
  schema,
  settings,
  state,
}: {
  availabilityReason: string;
  draft: PluginSettingsDraft;
  editable: boolean;
  item: PluginInventoryItem;
  message: string | null;
  onApply: (item: PluginInventoryItem, schema: PluginSettingsSchema) => void;
  onDraftChange: (fieldId: string, value: boolean | string) => void;
  onReset: (item: PluginInventoryItem) => void;
  pendingAction: "apply" | "reset" | null;
  schema: PluginSettingsSchema | null;
  settings: ResolvedPluginSettings | null;
  state: "idle" | "loading" | "error";
}) {
  const canEdit = editable && Boolean(schema);
  return (
    <section className="plugin-manager__settings" data-testid="plugin-manager-settings">
      <div className="plugin-manager__settings-header">
        <h4>Settings</h4>
        {settings ? (
          <span>
            {settings.configuredCount} of {settings.fieldCount} configured
          </span>
        ) : null}
      </div>
      <p>{availabilityReason}</p>
      {state === "loading" ? <p>Loading plugin settings...</p> : null}
      {message ? (
        <div className={`plugin-manager__settings-message ${state === "error" ? "plugin-manager__settings-message--error" : ""}`}>
          {message}
        </div>
      ) : null}
      {settings?.validationErrors.length ? (
        <div className="plugin-manager__settings-message plugin-manager__settings-message--error">
          {settings.validationErrors.join(" ")}
        </div>
      ) : null}
      {settings?.configReviewRequired ? (
        <div className="plugin-manager__settings-message plugin-manager__settings-message--warning">
          The manifest changed after these settings were saved. Review values before applying changes.
        </div>
      ) : null}
      {schema ? (
        <div className="plugin-manager__settings-fields">
          {settingsFieldsBySection(schema).map((section) => (
            <div className="plugin-manager__settings-group" key={section.id}>
              {section.label ? <div className="plugin-manager__settings-group-title">{section.label}</div> : null}
              {section.description ? <p>{section.description}</p> : null}
              {section.fields.map((field) => (
                <PluginSettingsFieldControl
                  disabled={!canEdit || pendingAction !== null}
                  draft={draft}
                  field={field}
                  key={field.id}
                  onDraftChange={onDraftChange}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {schema ? (
        <div className="plugin-manager__settings-actions">
          <button
            className="plugin-manager__action plugin-manager__action--enable"
            data-testid="plugin-manager-settings-apply"
            disabled={!canEdit || pendingAction !== null}
            onClick={() => onApply(item, schema)}
            type="button"
          >
            <Save size={14} />
            {pendingAction === "apply" ? "Applying..." : "Apply"}
          </button>
          <button
            className="plugin-manager__action"
            data-testid="plugin-manager-settings-reset"
            disabled={!canEdit || pendingAction !== null}
            onClick={() => onReset(item)}
            type="button"
          >
            <RotateCcw size={14} />
            {pendingAction === "reset" ? "Resetting..." : "Reset"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PluginSettingsFieldControl({
  disabled,
  draft,
  field,
  onDraftChange,
}: {
  disabled: boolean;
  draft: PluginSettingsDraft;
  field: PluginSettingField;
  onDraftChange: (fieldId: string, value: boolean | string) => void;
}) {
  const value = draft[field.id];
  return (
    <label className={`plugin-manager__settings-field plugin-manager__settings-field--${field.type}`}>
      <span>
        <strong>{field.label}</strong>
        {field.description ? <small>{field.description}</small> : null}
      </span>
      {field.type === "boolean" ? (
        <input
          checked={value === true}
          data-testid={`plugin-setting-${field.id}`}
          disabled={disabled}
          onChange={(event) => onDraftChange(field.id, event.currentTarget.checked)}
          type="checkbox"
        />
      ) : field.type === "select" ? (
        <select
          data-testid={`plugin-setting-${field.id}`}
          disabled={disabled}
          onChange={(event) => onDraftChange(field.id, event.currentTarget.value)}
          value={typeof value === "string" ? value : ""}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          data-testid={`plugin-setting-${field.id}`}
          disabled={disabled}
          onChange={(event) => onDraftChange(field.id, event.currentTarget.value)}
          type={field.type === "number" ? "number" : "text"}
          value={typeof value === "string" ? value : ""}
        />
      )}
    </label>
  );
}

function settingsFieldsBySection(schema: PluginSettingsSchema): Array<{
  id: string;
  label?: string;
  description?: string;
  fields: PluginSettingField[];
}> {
  const fieldsById = new Map(schema.fields.map((field) => [field.id, field]));
  if (!schema.sections?.length) {
    return [{ id: "default", fields: schema.fields }];
  }
  const seen = new Set<string>();
  const sections = schema.sections.map((section) => {
    const fields = (section.fields ?? [])
      .map((fieldId) => fieldsById.get(fieldId))
      .filter((field): field is PluginSettingField => Boolean(field));
    for (const field of fields) {
      seen.add(field.id);
    }
    return { ...section, fields };
  }).filter((section) => section.fields.length > 0);
  const unsectioned = schema.fields.filter((field) => !seen.has(field.id));
  return unsectioned.length ? [...sections, { id: "other", label: "Other", fields: unsectioned }] : sections;
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="plugin-manager__summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PluginInventoryRow({
  isSelected,
  item,
  onSelect,
}: {
  isSelected: boolean;
  item: PluginInventoryItem;
  onSelect: () => void;
}) {
  return (
    <button
      aria-selected={isSelected}
      className={`plugin-manager__row ${isSelected ? "plugin-manager__row--selected" : ""}`}
      data-testid={`plugin-inventory-item-${item.id}`}
      id={`plugin-inventory-option-${item.id}`}
      onClick={onSelect}
      role="option"
      type="button"
    >
      <div className="plugin-manager__row-main">
        <div className="plugin-manager__row-title">
          <strong>{item.label}</strong>
          <StatusPill item={item} />
        </div>
        <p>{item.description}</p>
        <div className="plugin-manager__meta">
          <span>{item.sourceLabel}</span>
          <span>{item.lifecycle}</span>
          <span>{item.trust}</span>
          {item.pluginName ? <span>{item.pluginName}</span> : null}
        </div>
      </div>
      <div className="plugin-manager__row-detail">
        {item.dependencies?.length ? (
          <small>
            Diagnostics: {item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}`).join(" · ")}
          </small>
        ) : null}
        {item.status !== "available" && item.status !== "configured" ? <small>State: {item.statusLabel}</small> : null}
        {item.dependencies?.length ? (
          <small>Setup: review dependencies in the detail panel</small>
        ) : null}
      </div>
    </button>
  );
}

function PluginActionButton({
  action,
  disabled,
  isPending,
  item,
  onRun,
}: {
  action: PluginManagerAction;
  disabled: boolean;
  isPending: boolean;
  item: PluginInventoryItem;
  onRun: (item: PluginInventoryItem, action: PluginManagerAction) => void;
}) {
  const Icon = action === "trust" ? ShieldCheck : action === "enable" ? Power : PowerOff;
  const label = action === "trust" ? "Trust" : action === "enable" ? "Enable" : "Disable";
  const title = action === "trust"
    ? "Trust this local plugin manifest"
    : action === "enable"
      ? "Enable this plugin"
      : "Disable this plugin";
  return (
    <button
      className={`plugin-manager__action plugin-manager__action--${action}`}
      data-testid={`plugin-manager-action-${action}`}
      disabled={disabled}
      onClick={() => onRun(item, action)}
      title={title}
      type="button"
    >
      <Icon size={15} />
      <span>{isPending ? "Working..." : label}</span>
    </button>
  );
}

function StatusPill({ item }: { item: PluginInventoryItem }) {
  const tone = !item.enabled
    ? "disabled"
    : item.trust === "untrusted"
      ? "warning"
      : item.status === "broken" || item.status === "missing-dependency"
        ? "danger"
        : "ok";
  return <span className={`plugin-manager__status plugin-manager__status--${tone}`}>{item.statusLabel}</span>;
}

function pluginActionSuccessMessage(action: PluginManagerAction, item: PluginInventoryItem): string {
  const pluginName = item.pluginName ?? item.label;
  switch (action) {
    case "trust":
      return `${pluginName} trusted.`;
    case "enable":
      return `${pluginName} enabled.`;
    case "disable":
      return `${pluginName} disabled.`;
  }
}
