/// <reference types="vite/client" />

import type { DesktopApi } from "../../shared/api";

declare global {
  interface Window {
    exo: DesktopApi;
  }
}

export {};
