import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import BpmnModelerLib from "bpmn-js/lib/Modeler";

export interface BpmnModelerHandle {
  saveXml(): Promise<string>;
  importXml(xml: string): Promise<void>;
  getSelectedId(): string | null;
}

interface BizObj { id?: string; name?: string; $type?: string }
interface SelectionEvent {
  newSelection?: Array<{ id: string; type?: string; businessObject?: BizObj }>;
}

interface ElementEvent {
  element: {
    id: string;
    type?: string;
    businessObject?: BizObj;
  };
}

export interface ElementInfo {
  id: string;
  type: string | null;
  name: string | null;
}

interface Props {
  initialXml: string;
  onSelection: (el: ElementInfo | null) => void;
  onChange?: () => void;
  onElementRename?: (oldId: string, newId: string) => void;
  onElementDblClick?: (el: ElementInfo) => void;
}

function toElementInfo(element: {
  id: string;
  type?: string;
  businessObject?: BizObj;
}): ElementInfo {
  const bo = element.businessObject;
  return {
    id: bo?.id ?? element.id,
    type: bo?.$type ?? element.type ?? null,
    name: bo?.name ?? null,
  };
}

const BpmnModeler = forwardRef<BpmnModelerHandle, Props>(function BpmnModeler(
  { initialXml, onSelection, onChange, onElementRename, onElementDblClick },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<BpmnModelerLib | null>(null);
  const loadedXmlRef = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      async saveXml() {
        const m = modelerRef.current;
        if (!m) throw new Error("modeler not ready");
        const { xml } = await m.saveXML({ format: true });
        return xml;
      },
      async importXml(xml: string) {
        const m = modelerRef.current;
        if (!m) throw new Error("modeler not ready");
        await m.importXML(xml);
        loadedXmlRef.current = xml;
        const canvas = m.get("canvas") as { zoom: (s: string) => void };
        canvas.zoom("fit-viewport");
      },
      getSelectedId() {
        const m = modelerRef.current;
        if (!m) return null;
        const sel = m.get("selection") as {
          get: () => Array<{ id: string }>;
        };
        const arr = sel.get();
        return arr[0]?.id ?? null;
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const modeler = new BpmnModelerLib({
      container: containerRef.current,
      keyboard: { bindTo: window },
    });
    modelerRef.current = modeler;
    if (import.meta.env.DEV) {
      const win = window as unknown as {
        __modeler?: BpmnModelerLib;
        __selectBpmnElement?: (id: string) => boolean;
      };
      win.__modeler = modeler;
      win.__selectBpmnElement = (id: string) => {
        const registry = modeler.get("elementRegistry") as {
          get: (elementId: string) =>
            | {
                id: string;
                type?: string;
                businessObject?: BizObj;
              }
            | undefined;
        };
        const selection = modeler.get("selection") as {
          select: (element: unknown) => void;
        };
        const element = registry.get(id);
        if (!element) return false;
        selection.select(element);
        onSelection(toElementInfo(element));
        return true;
      };
    }

    const eventBus = modeler.get("eventBus") as {
      on: (ev: string, fn: (e: unknown) => void) => void;
      off: (ev: string, fn: (e: unknown) => void) => void;
    };

    const onSel = (e: unknown) => {
      const evt = e as SelectionEvent;
      const first = evt.newSelection?.[0];
      if (!first) {
        onSelection(null);
        return;
      }
      onSelection(toElementInfo(first));
    };

    const onChanged = () => {
      onChange?.();
    };

    const onIdChange = (e: unknown) => {
      const evt = e as { element?: { id?: string }; oldProperties?: { id?: string }; properties?: { id?: string } };
      const oldId = evt.oldProperties?.id;
      const newId = evt.properties?.id ?? evt.element?.id;
      if (oldId && newId && oldId !== newId) {
        onElementRename?.(oldId, newId);
      }
    };

    const onElementChange = (e: unknown) => {
      const evt = e as ElementEvent;
      const id = evt.element?.businessObject?.id ?? evt.element?.id;
      if (id) {
        onSelection(toElementInfo(evt.element));
      }
    };

    const onElementClick = (e: unknown) => {
      const evt = e as ElementEvent;
      if (evt.element) onSelection(toElementInfo(evt.element));
    };

    const onElementDblClick = (e: unknown) => {
      const evt = e as ElementEvent;
      if (evt.element) onElementDblClick?.(toElementInfo(evt.element));
    };

    eventBus.on("selection.changed", onSel);
    eventBus.on("element.click", onElementClick);
    eventBus.on("element.dblclick", onElementDblClick);
    eventBus.on("commandStack.changed", onChanged);
    eventBus.on("element.changed", onElementChange);
    eventBus.on("element.updateProperties", onIdChange);

    modeler.importXML(initialXml).then(() => {
      loadedXmlRef.current = initialXml;
      const canvas = modeler.get("canvas") as { zoom: (s: string) => void };
      canvas.zoom("fit-viewport");
    });

    return () => {
      try {
        eventBus.off("selection.changed", onSel);
        eventBus.off("element.click", onElementClick);
        eventBus.off("element.dblclick", onElementDblClick);
        eventBus.off("commandStack.changed", onChanged);
        eventBus.off("element.changed", onElementChange);
        eventBus.off("element.updateProperties", onIdChange);
      } catch {}
      if (import.meta.env.DEV) {
        const win = window as unknown as {
          __modeler?: BpmnModelerLib;
          __selectBpmnElement?: (id: string) => boolean;
        };
        delete win.__modeler;
        delete win.__selectBpmnElement;
      }
      modeler.destroy();
      modelerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = modelerRef.current;
    if (!m || !initialXml) return;
    if (loadedXmlRef.current === initialXml) return;
    m.importXML(initialXml).then(() => {
      loadedXmlRef.current = initialXml;
      const canvas = m.get("canvas") as { zoom: (s: string) => void };
      canvas.zoom("fit-viewport");
    });
  }, [initialXml]);

  return <div className="canvas" ref={containerRef} />;
});

export default BpmnModeler;
