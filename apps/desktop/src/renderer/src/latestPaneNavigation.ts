export class LatestPaneNavigation {
  private nextRequestId = 0;
  private readonly latestRequestByPane = new Map<string, number>();

  async commitLatest(
    paneId: string,
    load: () => Promise<void>,
    commit: () => void,
  ): Promise<boolean> {
    const requestId = ++this.nextRequestId;
    this.latestRequestByPane.set(paneId, requestId);
    try {
      await load();
    } catch (error) {
      if (this.latestRequestByPane.get(paneId) !== requestId) return false;
      this.latestRequestByPane.delete(paneId);
      throw error;
    }
    if (this.latestRequestByPane.get(paneId) !== requestId) {
      return false;
    }
    this.latestRequestByPane.delete(paneId);
    commit();
    return true;
  }

  /**
   * A load may outlive the leaf it targeted. The loader itself is not assumed
   * cancellable, but its completion loses authority as soon as the target is
   * no longer an editor leaf.
   */
  invalidateUnavailablePanes(availablePaneIds: ReadonlySet<string>): void {
    for (const paneId of this.latestRequestByPane.keys()) {
      if (!availablePaneIds.has(paneId)) this.latestRequestByPane.delete(paneId);
    }
  }

  /** A synchronous choice in this pane supersedes any outstanding load. */
  invalidatePane(paneId: string): void {
    this.latestRequestByPane.delete(paneId);
  }
}
