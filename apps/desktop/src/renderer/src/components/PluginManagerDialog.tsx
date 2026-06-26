import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, PluginInventoryItem } from "@exo/core";
import { X } from "lucide-react";

import { groupPluginInventoryItems } from "../pluginManagerModel";

interface PluginManagerDialogProps {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: PluginManagerDialogProps) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const groups = useMemo(() => groupPluginInventoryItems(inventory?.items ?? []), [inventory]);

  return (
    <div className="dialog-overlay" data-testid="plugin-manager-overlay">
      <div className="dialog-card dialog-card--plugin-manager" data-testid="plugin-manager">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Plugin Manager</div>
            <div className="dialog-card__message">
              Inspect Exo core surfaces, bundled capabilities, and local plugin manifests. This first pass is read-only.
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
              <SummaryTile label="Bundled" value={inventory.counts.bundled} />
              <SummaryTile label="Local manifests" value={inventory.counts.localManifest} />
              <SummaryTile label="Review needed" value={inventory.counts.untrusted} />
            </div>
            <div className="plugin-manager__groups">
              {groups.map((group) => (
                <section className="plugin-manager__group" data-testid={`plugin-manager-group-${group.id}`} key={group.id}>
                  <div className="plugin-manager__group-header">
                    <h3>{group.label}</h3>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="plugin-manager__items">
                    {group.items.map((item) => (
                      <PluginInventoryRow item={item} key={`${item.source}:${item.id}`} />
                    ))}
                  </div>
                </section>
              ))}
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

function PluginInventoryRow({ item }: { item: PluginInventoryItem }) {
  return (
    <article className="plugin-manager__row" data-testid={`plugin-inventory-item-${item.id}`}>
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
        <MetadataList label="Surfaces" values={item.surfaces} />
        <MetadataList label="Permissions" values={item.permissions.length > 0 ? item.permissions : ["none"]} />
        <small>{item.owner}</small>
        {item.manifestPath ? <small>{item.manifestPath}</small> : null}
        {item.dependencies?.length ? (
          <small>
            {item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}`).join(" · ")}
          </small>
        ) : null}
      </div>
    </article>
  );
}

function StatusPill({ item }: { item: PluginInventoryItem }) {
  const tone = !item.enabled || item.trust === "disabled"
    ? "disabled"
    : item.trust === "untrusted"
      ? "warning"
      : item.status === "broken" || item.status === "missing-dependency"
        ? "danger"
        : "ok";
  return <span className={`plugin-manager__status plugin-manager__status--${tone}`}>{item.statusLabel}</span>;
}

function MetadataList({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <small>
      {label}: {values.join(", ")}
    </small>
  );
}
