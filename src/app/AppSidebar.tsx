import { Activity, ChevronRight, FileText, House, ImageUp, MessageSquare, Mouse, Settings as SettingsIcon, Star, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";
import { deviceImage, deviceImageFilename, UNKNOWN_DEVICE_FILENAME } from "../ui/device-images";

export const OPENMOUSE_URL = "https://openmouse.app/";

export type DesktopPage = "home" | "dashboard" | "test" | "settings";

function NavIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }): ReactNode {
  return <Icon className="app-sidebar-nav-icon" strokeWidth={2} stroke={color} aria-hidden="true" />;
}

function NavArrow(): ReactNode {
  return <ChevronRight className="app-sidebar-nav-arrow" size={18} strokeWidth={2.2} aria-hidden="true" />;
}

// A device counts as missing artwork either when its name has no render (it
// resolves to the placeholder directly) or when the named file fails to load
// from the bucket (the art was never uploaded). The <img> probe is used only
// for the second case — it detects 404s cross-origin, which a HEAD fetch
// cannot, and resolves to "missing" unless the image actually loads.
function useArtworkMissing(deviceName: string): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    if (!deviceName) return;
    if (deviceImageFilename(deviceName) === UNKNOWN_DEVICE_FILENAME) {
      setMissing(true);
      return;
    }
    if (typeof Image === "undefined") return;
    const probe = new Image();
    probe.onload = () => { if (!cancelled) setMissing(false); };
    probe.onerror = () => { if (!cancelled) setMissing(true); };
    probe.src = deviceImage(null, deviceName);
    return () => { cancelled = true; };
  }, [deviceName]);
  return missing;
}

export function AppSidebar({
  snapshot,
  page,
  onNavigate,
  onOpenFeedback,
  onOpenWhatsNew,
  onOpenArtworkRequest,
}: {
  snapshot: ControlSnapshot;
  page: DesktopPage;
  onNavigate: (page: DesktopPage) => void;
  onOpenFeedback: () => void;
  onOpenWhatsNew: () => void;
  onOpenArtworkRequest: () => void;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  const needsArtwork = useArtworkMissing(snapshot.status?.name ?? "");
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-top">
        <a
          className="app-sidebar-brand"
          href={OPENMOUSE_URL}
          target="_blank"
          rel="noreferrer"
          title="OpenMouse"
          aria-label="OpenMouse"
        >
          <img className="brand-mark" src="/logo.png" alt="" width={16} height={24} />
          <span className="app-sidebar-brand-text">OpenMouse</span>
          <span className="app-sidebar-brand-version" title={snapshot.buildLabel}>
            {snapshot.buildLabel}
          </span>
        </a>

        <nav className="app-sidebar-nav">
          <button
            className={`app-sidebar-nav-item${page === "home" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.home")}
            onClick={() => onNavigate("home")}
          >
            <NavIcon icon={House} color="#5dde89" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.home")}</span>
            <NavArrow />
          </button>
          <button
            className={`app-sidebar-nav-item${page === "dashboard" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.dashboard")}
            onClick={() => onNavigate("dashboard")}
          >
            <NavIcon icon={Mouse} color="#67d8ff" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.dashboard")}</span>
            <NavArrow />
          </button>
          <button
            className={`app-sidebar-nav-item${page === "test" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.mouseCheck")}
            onClick={() => onNavigate("test")}
          >
            <NavIcon icon={Activity} color="#f472b6" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.mouseCheck")}</span>
            <NavArrow />
          </button>
          <a
            className="app-sidebar-nav-item"
            href="https://docs.openmouse.app"
            target="_blank"
            rel="noreferrer"
            title={t(locale, "nav.docs")}
          >
            <NavIcon icon={FileText} color="#e8b267" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.docs")}</span>
            <NavArrow />
          </a>
        </nav>
      </div>

      <div className="app-sidebar-bottom">
        <button
          className="app-sidebar-nav-item"
          type="button"
          title={t(locale, "nav.whatsNew")}
          onClick={onOpenWhatsNew}
        >
          <NavIcon icon={Star} color="#fbbf24" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.whatsNew")}</span>
          <NavArrow />
        </button>
        {needsArtwork ? (
          <button
            className="app-sidebar-nav-item"
            type="button"
            title={t(locale, "artreq.request")}
            onClick={onOpenArtworkRequest}
          >
            <NavIcon icon={ImageUp} color="#a3e635" />
            <span className="app-sidebar-nav-label">{t(locale, "artreq.request")}</span>
            <NavArrow />
          </button>
        ) : null}
        <button
          className="app-sidebar-nav-item"
          type="button"
          title={t(locale, "nav.feedback")}
          onClick={onOpenFeedback}
        >
          <NavIcon icon={MessageSquare} color="#fb923c" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.feedback")}</span>
          <NavArrow />
        </button>
        <button
          className={`app-sidebar-nav-item${page === "settings" ? " active" : ""}`}
          type="button"
          title={t(locale, "nav.settings")}
          onClick={() => onNavigate("settings")}
        >
          <NavIcon icon={SettingsIcon} color="#94a3b8" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.settings")}</span>
          <NavArrow />
        </button>
      </div>
    </aside>
  );
}