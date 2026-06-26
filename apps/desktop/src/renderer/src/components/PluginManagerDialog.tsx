import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { X } from "lucide-react";

import {
  buildPluginCategoryFilters,
  buildPluginDetailSections,
  filterPluginInventoryItems,
} from "../pluginManagerModel";

interface PluginManagerDialogProps {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: PluginManagerDialogProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("core");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  const detailHeadingId = selectedItem ? `plugin-manager-detail-heading-${selectedItem.id}` : undefined;

  function selectCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedItemId(null);
  }

  return (
    <div className="dialog-overlay" data-testid="plugin-manager-overlay">
      <div className="dialog-card dialog-card--plugin-manager" data-testid="plugin-manager">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Plugin Manager</div>
            <div className="dialog-card__message">
              Inspect Exo core surfaces, official plugins, and local plugin manifests. This first pass is read-only.
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
