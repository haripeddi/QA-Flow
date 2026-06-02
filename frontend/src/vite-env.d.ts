/// <reference types="vite/client" />

declare module "bpmn-js/lib/NavigatedViewer" {
  export default class NavigatedViewer {
    constructor(opts: { container: HTMLElement | string });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    get<T = unknown>(name: string): T;
    destroy(): void;
  }
}

declare module "bpmn-js/lib/Modeler" {
  export default class BpmnModeler {
    constructor(opts: {
      container: HTMLElement | string;
      keyboard?: { bindTo?: Window | HTMLElement };
      additionalModules?: unknown[];
    });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    saveXML(opts?: { format?: boolean }): Promise<{ xml: string }>;
    get<T = unknown>(name: string): T;
    on(event: string, fn: (e: unknown) => void): void;
    off(event: string, fn: (e: unknown) => void): void;
    destroy(): void;
  }
}

interface BusinessObject {
  id?: string;
  name?: string;
  $type?: string;
}
