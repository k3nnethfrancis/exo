import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  electronPlatformPath,
  electronInstallStrategy,
  electronRuntimeRequiredPaths,
  ensureElectronRuntime,
  resolveElectronDownloadArch,
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

test("resolveElectronDownloadArch preserves explicit arch and Rosetta behavior", () => {
  assert.equal(resolveElectronDownloadArch({ platform: "darwin", arch: "x64", isRosetta: true }), "arm64");
  assert.equal(resolveElectronDownloadArch({
    platform: "darwin",
    arch: "x64",
    configuredArch: "x64",
    isRosetta: true,
  }), "x64");
  assert.equal(resolveElectronDownloadArch({ platform: "linux", arch: "x64", isRosetta: true }), "x64");
});

test("electronInstallStrategy confines ditto recovery to macOS", () => {
  assert.equal(electronInstallStrategy("darwin"), "ditto");
  assert.equal(electronInstallStrategy("mas"), "ditto");
  assert.equal(electronInstallStrategy("linux"), "upstream");
  assert.equal(electronInstallStrategy("win32"), "upstream");
});

test("repairs a complete cached Electron dist whose required path.txt is missing", () => {
  withElectronFixture("darwin", ({ electronDirectory, platformPath, requiredPaths, binaryPath }) => {
    for (const requiredPath of requiredPaths) {
      mkdirSync(path.dirname(requiredPath), { recursive: true });
      writeFileSync(requiredPath, "electron");
    }
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

test("reinstalls a Darwin runtime whose launcher survived but Framework was consumed", () => {
  withElectronFixture("darwin", ({ electronDirectory, platformPath, requiredPaths, binaryPath }) => {
    mkdirSync(path.dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, "electron");
    const staleResource = path.join(electronDirectory, "dist", "stale-resource");
    writeFileSync(staleResource, "partial");
    writeFileSync(path.join(electronDirectory, "path.txt"), platformPath);
    let installCalls = 0;

    const resolved = ensureElectronRuntime({
      electronDirectory,
      platform: "darwin",
      install() {
        installCalls += 1;
        assert.equal(existsSync(path.join(electronDirectory, "path.txt")), false);
        assert.equal(existsSync(path.join(electronDirectory, "dist")), false);
        assert.equal(existsSync(staleResource), false);
        for (const requiredPath of requiredPaths) {
          mkdirSync(path.dirname(requiredPath), { recursive: true });
          writeFileSync(requiredPath, "electron");
        }
        writeFileSync(path.join(electronDirectory, "path.txt"), platformPath);
      },
    });

    assert.equal(resolved, binaryPath);
    assert.equal(installCalls, 1);
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
  const requiredPaths = electronRuntimeRequiredPaths(electronDirectory, platform);
  try {
    run({ electronDirectory, platformPath, requiredPaths, binaryPath });
  } finally {
    rmSync(electronDirectory, { recursive: true, force: true });
  }
}
