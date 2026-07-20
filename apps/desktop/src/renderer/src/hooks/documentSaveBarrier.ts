/** Serializes writes for one open document and exposes an exact idle barrier. */
export class DocumentSaveBarrier {
  private readonly tails = new Map<string, Promise<void>>();

  run(filePath: string, write: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(filePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(write);
    this.tails.set(filePath, current);
    void current.finally(() => {
      if (this.tails.get(filePath) === current) this.tails.delete(filePath);
    }).catch(() => undefined);
    return current;
  }

  async idle(filePath: string): Promise<void> {
    await this.tails.get(filePath);
  }
}
