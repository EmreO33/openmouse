import { Bell, Gamepad2, Power, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  saveBridgeAutostart,
  saveBridgeBatteryThreshold,
  type BridgeStatus,
} from "../bridge";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const BATTERY_THRESHOLDS = [10, 15, 20, 25, 30, 40, 50] as const;

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function Metric({ label, value }: { label: string; value: string | number }): ReactNode {
  return (
    <div className="bridge-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BridgeSettings({
  status,
  locale,
  onRefresh,
  onStatusChange,
}: {
  status: BridgeStatus;
  locale: InterfaceLocale;
  onRefresh: () => Promise<void>;
  onStatusChange: (status: BridgeStatus) => void;
}): ReactNode {
  const [saving, setSaving] = useState<"autostart" | "battery" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(status.batteryThresholdPercent);

  useEffect(() => setThreshold(status.batteryThresholdPercent), [status.batteryThresholdPercent]);

  async function updateAutostart(enabled: boolean): Promise<void> {
    setSaving("autostart");
    setError(null);
    onStatusChange({ ...status, autostartEnabled: enabled });
    try {
      await saveBridgeAutostart(enabled);
      await onRefresh();
    } catch (cause) {
      onStatusChange(status);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  async function updateThreshold(percent: number): Promise<void> {
    const previous = threshold;
    setThreshold(percent);
    setSaving("battery");
    setError(null);
    try {
      await saveBridgeBatteryThreshold(percent);
      await onRefresh();
    } catch (cause) {
      setThreshold(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  async function refresh(): Promise<void> {
    setSaving("refresh");
    setError(null);
    try {
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="page bridge-settings-page" aria-labelledby="bridge-settings-title">
      <div className="bridge-page-heading">
        <div>
          <span className="bridge-page-overline">{t(locale, "bridge.overline")}</span>
          <h1 id="bridge-settings-title" className="page-title">{t(locale, "bridge.title")}</h1>
          <p>{t(locale, "bridge.subtitle")}</p>
        </div>
        <span className="bridge-live-badge"><i aria-hidden="true" />{t(locale, "bridge.running")}</span>
      </div>

      <div className="bridge-status-card">
        <div className="bridge-status-icon"><Server aria-hidden="true" /></div>
        <div className="bridge-status-copy">
          <strong>{t(locale, "bridge.connected")}</strong>
          <span>127.0.0.1:17846</span>
        </div>
        <button
          type="button"
          className="bridge-refresh-button"
          disabled={saving === "refresh"}
          onClick={() => void refresh()}
        >
          <RefreshCw className={saving === "refresh" ? "spin" : ""} aria-hidden="true" />
          {t(locale, "bridge.refresh")}
        </button>
      </div>

      <div className="bridge-metrics" aria-label={t(locale, "bridge.runtime")}> 
        <Metric label={t(locale, "bridge.version")} value={`v${status.version}`} />
        <Metric label={t(locale, "bridge.platform")} value={status.platform} />
        <Metric label={t(locale, "bridge.uptime")} value={formatUptime(status.uptimeSeconds)} />
        <Metric label={t(locale, "bridge.profiles")} value={status.profileCount} />
        <Metric label={t(locale, "bridge.games")} value={status.trackedGameCount} />
        <Metric
          label={t(locale, "bridge.panel")}
          value={status.clientConnected ? t(locale, "bridge.active") : t(locale, "bridge.idle")}
        />
      </div>

      <div className="bridge-settings-grid">
        <article className="bridge-setting-card">
          <div className="bridge-setting-card-head">
            <div className="bridge-setting-card-icon"><Power aria-hidden="true" /></div>
            <div>
              <h2>{t(locale, "bridge.startup")}</h2>
              <p>{t(locale, "bridge.startupBody")}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status.autostartEnabled}
            className={`bridge-toggle${status.autostartEnabled ? " is-on" : ""}`}
            disabled={saving === "autostart"}
            onClick={() => void updateAutostart(!status.autostartEnabled)}
          >
            <span>{status.autostartEnabled ? t(locale, "bridge.on") : t(locale, "bridge.off")}</span>
            <i aria-hidden="true" />
          </button>
        </article>

        <article className="bridge-setting-card">
          <div className="bridge-setting-card-head">
            <div className="bridge-setting-card-icon"><Bell aria-hidden="true" /></div>
            <div>
              <h2>{t(locale, "bridge.battery")}</h2>
              <p>{t(locale, "bridge.batteryBody")}</p>
            </div>
          </div>
          <label className="bridge-threshold-field">
            <span>{t(locale, "bridge.alertBelow")}</span>
            <select
              value={threshold}
              disabled={saving === "battery"}
              onChange={(event) => void updateThreshold(Number(event.currentTarget.value))}
            >
              {BATTERY_THRESHOLDS.map((percent) => (
                <option key={percent} value={percent}>{percent}%</option>
              ))}
            </select>
          </label>
        </article>

        <article className="bridge-setting-card bridge-setting-card-wide">
          <div className="bridge-setting-card-head">
            <div className="bridge-setting-card-icon"><Gamepad2 aria-hidden="true" /></div>
            <div>
              <h2>{t(locale, "bridge.activity")}</h2>
              <p>{t(locale, "bridge.activityBody")}</p>
            </div>
          </div>
          <div className="bridge-activity-row">
            <ShieldCheck aria-hidden="true" />
            <span>
              {status.activeProfile?.application.name
                ?? status.foregroundApplication?.name
                ?? t(locale, "bridge.noActivity")}
            </span>
          </div>
        </article>
      </div>

      {error ? <p className="bridge-settings-error" role="alert">{error}</p> : null}
    </section>
  );
}
