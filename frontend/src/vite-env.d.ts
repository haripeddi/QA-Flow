/// <reference types="vite/client" />

declare module "bpmn-js/lib/NavigatedViewer" {
  export default class NavigatedViewer {
    constructor(opts: { container: HTMLElement | string });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    get<T = unknown>(name: string): T;
    destroy(): void;
  }
}
