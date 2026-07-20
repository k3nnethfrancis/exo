import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  electronPlatformPath,
  ensureElectronRuntime,
} from "./electron-runtime.mjs";

test("electronPlatformPath matches Electron's canonical host paths", () => {
  assert.equal(electronPlatformPath("darwin"), "Electron.app/Contents/MacOS/Electron");
  assert.equal(electronPlatformPath("mas"), "Electron.app/Contents/MacOS/Electron");
  assert.equal(electronPlatformPath("linux"), "electron");
  assert.equal(electronPlatformPath("freebsd"), "electron");
  assert.equal(electronPlatformPath("openbsd"), "electron");
  assert.equal(electronPlatformPath("win32"), "electron.exe");
  assert.throws(() => electronPlatformPath("plan9"), /not available on platform: plan9/);
});

test("repairs a cached Electron dist whose required path.txt is missing", () => {
  withElectronFixture("darwin", ({ electronDirectory, platformPath, binaryPath }) => {
    mkdirSync(path.dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, "electron");
    let installCalls = 0;

    const resolved = ensureElectronRuntime({
      electronDirectory,
      platform: "darwin",
      install() {
        installCalls += 1;
      },
    });

    assert.equal(resolved, binaryPath);
    assert.equal(installCalls, 0);
    assert.equal(readFileSync(path.join(electronDirectory, "path.txt"), "utf8"), platformPath);
  });
});

test("runs upstream installation when the canonical Electron binary is absent", () => {
  withElectronFixture("linux", ({ electronDirectory, platformPath, binaryPath }) => {
    let installCalls = 0;

    const resolved = ensureElectronRuntime({
      electronDirectory,
      platform: "linux",
      install() {
        installCalls += 1;
        mkdirSync(path.dirname(binaryPath), { recursive: true });
        writeFileSync(binaryPath, "electron");
        writeFileSync(path.join(electronDirectory, "path.txt"), platformPath);
      },
    });

    assert.equal(resolved, binaryPath);
    assert.equal(installCalls, 1);
  });
});

test("fails loudly when upstream installation leaves Electron incomplete", () => {
  withElectronFixture("win32", ({ electronDirectory }) => {
    assert.throws(
      () => ensureElectronRuntime({ electronDirectory, platform: "win32", install() {} }),
      /Electron runtime is incomplete after installation/,
    );
  });
});

function withElectronFixture(platform, run) {
  const electronDirectory = mkdtempSync(path.join(os.tmpdir(), "exo-electron-runtime-"));
  const platformPath = electronPlatformPath(platform);
  const binaryPath = path.join(electronDirectory, "dist", platformPath);
  try {
    run({ electronDirectory, platformPath, binaryPath });
  } finally {
    rmSync(electronDirectory, { recursive: true, force: true });
  }
}
