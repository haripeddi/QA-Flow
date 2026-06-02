import { useEffect, useRef } from "react";
import BpmnViewer from "bpmn-js/lib/NavigatedViewer";
import type { ActivityState } from "./api";

interface Props {
  bpmnXml: string;
  activities: ActivityState[];
}

export default function BpmnRunCanvas({ bpmnXml, activities }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<BpmnViewer | null>(null);
  const loadedXmlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new BpmnViewer({ container: containerRef.current });
    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bpmnXml) return;
    if (loadedXmlRef.current === bpmnXml) {
      applyOverlay(viewer, activities);
      return;
    }
    viewer
      .importXML(bpmnXml)
      .then(() => {
        loadedXmlRef.current = bpmnXml;
        const canvas = viewer.get("canvas") as { zoom: (s: string) => void };
        canvas.zoom("fit-viewport");
        applyOverlay(viewer, activities);
      })
      .catch((err) => console.error("bpmn import failed", err));
  }, [bpmnXml, activities]);

  return <div className="canvas" ref={containerRef} />;
}

function applyOverlay(viewer: BpmnViewer, activities: ActivityState[]) {
  const canvas = viewer.get("canvas") as {
    removeMarker: (id: string, cls: string) => void;
    addMarker: (id: string, cls: string) => void;
  };
  const registry = viewer.get("elementRegistry") as {
    getAll: () => Array<{ id: string }>;
  };
  const classes = ["qa-passed", "qa-failed", "qa-running", "qa-executed"];
  for (const el of registry.getAll()) {
    for (const c of classes) {
      try { canvas.removeMarker(el.id, c); } catch {}
    }
  }
  for (const a of activities) {
    const cls = `qa-${a.status}`;
    try { canvas.addMarker(a.activityId, cls); } catch {}
  }
}
