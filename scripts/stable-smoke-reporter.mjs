export default class StableSmokeReporter {
  skippedTests = [];

  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    if (result.status === 'skipped') {
      this.skippedTests.push(test.titlePath().join(' › '));
    }
  }

  onEnd() {
    if (this.skippedTests.length === 0) {
      return;
    }

    process.stderr.write(
      `[stable:smoke] FAIL skipped or fixme test(s) are not live smoke evidence: ${this.skippedTests.join(', ')}\n`,
    );
    return { status: 'failed' };
  }
}
