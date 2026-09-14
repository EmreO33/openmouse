import { useEffect, useRef, type ReactNode } from "react";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { batteryFillWidth, batteryIconState, batteryLevel } from "../ui/battery-icon";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

export function SwitchButton({
  id,
  value,
  label,
  disabled,
  onChange,
}: {
  id?: string;
  value: boolean | null | undefined;
  label?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const unsupported = value === null || value === undefined;
  return (
    <button
      id={id}
      className={`switch-button${unsupported ? "" : value ? " is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={unsupported ? false : value}
      aria-label={label ? (unsupported ? `${label}, unavailable on this mouse` : label) : undefined}
      disabled={unsupported || disabled}
      onClick={() => onChange(value !== true)}
    >
      {unsupported ? "N/A" : value ? "On" : "Off"}
    </button>
  );
}

export function SwitchRow({
  id,
  label,
  value,
  disabled,
  onChange,
  hidden,
  labelId,
}: {
  id?: string;
  label: string;
  value: boolean | null | undefined;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  hidden?: boolean;
  labelId?: string;
}): ReactNode {
  if (hidden) return null;
  return (
    <div className="switch-row">
      <span id={labelId}>{label}</span>
      <SwitchButton id={id} value={value} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export interface SegmentedOption<T> {
  value: T;
  label: string;
  hidden?: boolean;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
  id,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null | undefined;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}): ReactNode {
  return (
    <div id={id} className={["segmented", className].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          hidden={option.hidden}
          className={option.value === value ? "selected" : ""}
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled || option.hidden}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function shortRate(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz);
}

export function RateSlider({
  id,
  options,
  valueHz,
  label,
  disabled,
  hidden,
  onChange,
  locale = "en",
}: {
  id?: string;
  options: number[];
  valueHz: number | null;
  label?: string;
  disabled?: boolean;
  hidden?: boolean;
  onChange: (hz: number) => void;
  locale?: InterfaceLocale;
  /** Kept for callers that used to hide the readout; buttons always show it. */
  bubble?: boolean;
}): ReactNode {
  if (options.length === 0) return <div id={id} className="rate-slider" hidden={hidden} />;
  const selected = valueHz !== null && options.includes(valueHz)
    ? options.indexOf(valueHz)
    : options.reduce(
      (best, rate, step) =>
        Math.abs(rate - (valueHz ?? options[0] ?? 0)) < Math.abs((options[best] ?? 0) - (valueHz ?? options[0] ?? 0))
          ? step
          : best,
      0,
    );

  return (
    <div id={id} className="rate-slider" hidden={hidden}>
      {label ? (
        <div className="rate-slider-head">
          <span>{label}</span>
          <output>{options[selected]?.toLocaleString() ?? "—"} Hz</output>
        </div>
      ) : null}
      <div className="rate-slider-buttons" role="group" aria-label={label ?? t(locale, "perf.reportRate")}>
        {options.map((rate, step) => {
          const on = step === selected;
          return (
            <button
              key={rate}
              type="button"
              className={on ? "is-on" : ""}
              aria-pressed={on}
              disabled={disabled}
              title={`${rate.toLocaleString()} Hz`}
              onClick={() => onChange(rate)}
            >
              {shortRate(rate)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BatteryIcon({
  percent,
  state,
}: {
  percent: number | null | undefined;
  state: MouseStatus["batteryState"];
}): ReactNode {
  const kind = batteryIconState(percent, state);
  const level = batteryLevel(percent, state);
  const TRACK = { x: 2.85, y: 2.85, width: 19.3, height: 9.3, radius: 2.1 };
  const BOLT = "M14.3 3.1 9.3 9.2h3.1l-.9 3.9 5.2-6.2h-3.1l.7-3.8Z";
  const DEAD_CROSS = "m9.9 5.7 5.2 3.9M15.1 5.7 9.9 9.6";
  return (
    <svg className={`battery-icon is-${kind}`} viewBox="0 0 30 15" aria-hidden="true" focusable="false">
      <rect className="battery-shell" x="0.85" y="0.85" width="23.3" height="13.3" rx="3.6" />
      <rect className="battery-cap" x="25.5" y="4.9" width="2.7" height="5.2" rx="1.35" />
      <rect className="battery-track" x={TRACK.x} y={TRACK.y} width={TRACK.width} height={TRACK.height} rx={TRACK.radius} />
      {kind === "charging" ? (
        <>
          <mask id="battery-bolt-mask">
            <rect x="0" y="0" width="30" height="15" fill="#fff" />
            <path d={BOLT} fill="#000" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
          </mask>
          {level === null ? null : (
            <rect
              className="battery-fill"
              mask="url(#battery-bolt-mask)"
              x={TRACK.x}
              y={TRACK.y}
              width={batteryFillWidth(level).toFixed(2)}
              height={TRACK.height}
              rx={TRACK.radius}
            />
          )}
          <path className="battery-bolt" d={BOLT} />
        </>
      ) : kind === "dead" ? (
        <path className="battery-dead" d={DEAD_CROSS} />
      ) : level !== null ? (
        <rect
          className="battery-fill"
          x={TRACK.x}
          y={TRACK.y}
          width={batteryFillWidth(level).toFixed(2)}
          height={TRACK.height}
          rx={TRACK.radius}
        />
      ) : null}
    </svg>
  );
}

export function Collapsible({
  id,
  className,
  overline,
  title,
  open,
  onToggle,
  hidden,
  children,
}: {
  id?: string;
  className: string;
  overline: string;
  title: string;
  open: boolean;
  onToggle?: (open: boolean) => void;
  hidden?: boolean;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = open;
  }, [open]);
  return (
    <details
      id={id}
      ref={ref}
      className={className}
      hidden={hidden}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          <small>{overline}</small>
          {title}
        </span>
        <i aria-hidden="true" />
      </summary>
      <div className={className === "egg-experimental" ? "egg-experimental-body" : "egg-collapsible-body"}>
        {children}
      </div>
    </details>
  );
}
