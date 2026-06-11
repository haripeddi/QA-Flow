import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  PLAYWRIGHT_COMMANDS,
  filterCommands,
  type PlaywrightCommand,
} from "./playwrightCommands";

export interface VarOption {
  name: string;
  hint?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  availableVars?: VarOption[];
  enableSlash?: boolean;
  enableAt?: boolean;
}

type PaletteKind = "slash" | "at" | null;

export default function StepTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  className = "step-textarea",
  availableVars = [],
  enableSlash = true,
  enableAt = true,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [palette, setPalette] = useState<PaletteKind>(null);
  const [query, setQuery] = useState("");
  const [triggerPos, setTriggerPos] = useState(0);
  const [highlight, setHighlight] = useState(0);

  const slashItems = filterCommands(query);
  const atItems = availableVars.filter((v) =>
    v.name.toLowerCase().includes(query.toLowerCase()),
  );
  const items: Array<
    | { kind: "slash"; cmd: PlaywrightCommand }
    | { kind: "at"; var: VarOption }
  > =
    palette === "slash"
      ? slashItems.map((cmd) => ({ kind: "slash" as const, cmd }))
      : palette === "at"
        ? atItems.map((v) => ({ kind: "at" as const, var: v }))
        : [];

  const closePalette = useCallback(() => {
    setPalette(null);
    setQuery("");
    setHighlight(0);
  }, []);

  const detectTrigger = useCallback(
    (text: string, cursor: number) => {
      const before = text.slice(0, cursor);
      const slashMatch = /(?:^|\s)\/([^\s]*)$/.exec(before);
      if (enableSlash && slashMatch) {
        setPalette("slash");
        setQuery(slashMatch[1] ?? "");
        setTriggerPos(cursor - (slashMatch[1]?.length ?? 0) - 1);
        setHighlight(0);
        return;
      }
      const atMatch = /@([A-Za-z0-9_.]*)$/.exec(before);
      if (enableAt && atMatch && availableVars.length > 0) {
        setPalette("at");
        setQuery(atMatch[1] ?? "");
        setTriggerPos(cursor - (atMatch[1]?.length ?? 0) - 1);
        setHighlight(0);
        return;
      }
      closePalette();
    },
    [availableVars.length, closePalette, enableAt, enableSlash],
  );

  const insertSelection = useCallback(
    (insertText: string) => {
      const el = ref.current;
      if (!el) return;
      const before = value.slice(0, triggerPos);
      const after = value.slice(el.selectionStart);
      const next = before + insertText + after;
      onChange(next);
      closePalette();
      requestAnimationFrame(() => {
        const pos = before.length + insertText.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [closePalette, onChange, triggerPos, value],
  );

  const onSelectItem = useCallback(
    (item: (typeof items)[number]) => {
      if (item.kind === "slash") {
        insertSelection(item.cmd.insertTemplate);
      } else {
        insertSelection(`{{${item.var.name}}}`);
      }
    },
    [insertSelection],
  );

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    detectTrigger(e.target.value, e.target.selectionStart);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!palette || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      onSelectItem(items[highlight]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };

  useEffect(() => {
    if (palette && items.length === 0) closePalette();
  }, [palette, items.length, closePalette]);

  return (
    <div className="step-textarea-wrap">
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) =>
          detectTrigger(
            e.currentTarget.value,
            e.currentTarget.selectionStart,
          )
        }
        onBlur={() => window.setTimeout(closePalette, 150)}
      />
      {palette && items.length > 0 && (
        <div className="step-palette" role="listbox">
          {items.map((item, i) =>
            item.kind === "slash" ? (
              <button
                key={item.cmd.name}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`step-palette-item ${i === highlight ? "step-palette-on" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => onSelectItem(item)}
              >
                <span className="step-palette-name">{item.cmd.name}</span>
                <span className="step-palette-sig">{item.cmd.signature}</span>
                <span className="step-palette-desc">{item.cmd.description}</span>
              </button>
            ) : (
              <button
                key={item.var.name}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`step-palette-item ${i === highlight ? "step-palette-on" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => onSelectItem(item)}
              >
                <span className="step-palette-name">{`{{${item.var.name}}}`}</span>
                {item.var.hint && (
                  <span className="step-palette-desc">{item.var.hint}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
