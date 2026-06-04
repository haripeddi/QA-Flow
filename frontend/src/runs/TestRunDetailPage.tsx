import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRun, type ActivityState } from "../api";
import RunPanel from "../RunPanel";

export default function TestRunDetailPage() {
  const { runId = "" } = useParams();
  const [activities, setActivities] = useState<ActivityState[]>([]);
  const [active, setActive] = useState(false);
  const [meta, setMeta] = useState<{ processKey?: string; kind?: string }>({});

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      const r = await fetchRun(runId);
      if (cancelled) return;
      setActivities(r.activities);
      setActive(r.active);
      setMeta({ processKey: r.run?.processKey, kind: r.run?.kind });
      if (r.active) setTimeout(tick, 800);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="runs-page">
      <Link to="/runs">← All runs</Link>
      <h2>
        Run {runId.slice(0, 8)}… {meta.processKey && `· ${meta.processKey}`}{" "}
        {meta.kind && `(${meta.kind})`}
      </h2>
      <RunPanel activities={activities} active={active} />
    </div>
  );
}
