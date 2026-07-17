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
}
