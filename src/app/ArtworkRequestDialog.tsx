import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t, type I18nKey } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const MAX_ART_SIZE = 5 * 1024 * 1024;
const MAX_NOTE_LENGTH = 600;
const ACCEPTED_TYPES = ["image/png", "image/webp"] as const;
const ARTWORK_URL = "/api/artwork";

/** Server-side screening reasons (see functions/api/artwork.js) mapped to
    localized messages. Anything unknown falls back to artreq.rejected. */
const REJECT_KEYS: Record<string, I18nKey> = {
  nsfw: "artreq.rejectedNsfw",
  hate: "artreq.rejectedHate",
  gore: "artreq.rejectedGore",
  junk: "artreq.rejectedJunk",
  invalid: "artreq.rejectedInvalid",
};

export function ArtworkRequestDialog({ open, onClose, locale = "en", deviceName = "" }: {
  open: boolean;
  onClose: () => void;
  locale?: InterfaceLocale;
  deviceName?: string;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [discordUsername, setDiscordUsername] = useState("");
  const [discordError, setDiscordError] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (typeof element.close === "function") {
      if (element.open) element.close();
    } else {
      element.removeAttribute("open");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setFileError(null);
    setDiscordUsername("");
    setDiscordError(false);
    setNote("");
    setError(false);
    setRejectReason(null);
  }, [open]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function acceptFile(next: File | null | undefined): void {
    setFileError(null);
    setRejectReason(null);
    if (!next) return;
    if (!(ACCEPTED_TYPES as readonly string[]).includes(next.type)) {
      setFileError(t(locale, "artreq.typeError"));
      return;
    }
    if (next.size > MAX_ART_SIZE) {
      setFileError(t(locale, "artreq.sizeError"));
      return;
    }
    setFile(next);
  }

  async function send(): Promise<void> {
    const trimmedDiscord = discordUsername.trim();
    if (!trimmedDiscord) {
      setDiscordError(true);
      return;
    }
    if (!file || busy) return;
    setBusy(true);
    setError(false);
    setDiscordError(false);
    setRejectReason(null);
    try {
      const ext = file.type === "image/png" ? "png" : "webp";
      const slug = (deviceName || "device")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "device";
      const filename = `${slug}.${ext}`;
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({
          embeds: [
            {
              title: "Artwork Request",
              color: 0x5dde89,
              description: note.trim().slice(0, MAX_NOTE_LENGTH) || "No note provided.",
              fields: [
                { name: "Device", value: `**${deviceName}**`, inline: false },
                { name: "Discord", value: trimmedDiscord, inline: false },
              ],
              attachments: [{ id: "0", description: `Artwork request for ${deviceName}`, filename }],
            },
          ],
        }),
      );
      form.append("files[0]", file, filename);
      const response = await fetch(ARTWORK_URL, { method: "POST", body: form });
      if (response.status === 422) {
        const body: unknown = await response.json().catch(() => null);
        const reason =
          body && typeof body === "object" && "reason" in body
            ? (body as { reason?: unknown }).reason
            : null;
        setRejectReason(typeof reason === "string" && REJECT_KEYS[reason] ? reason : "invalid");
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      control.pushToast("success", t(locale, "artreq.sent"), t(locale, "artreq.sentDetail"));
      onClose();
    } catch {
      setError(true);
      control.pushToast("error", t(locale, "artreq.error"), t(locale, "artreq.errorDetail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="support-dialog feedback-dialog artreq-dialog"
      aria-labelledby="artreq-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <form
        className="support-dialog-inner feedback-dialog-inner"
        onSubmit={(event) => { event.preventDefault(); void send(); }}
      >
        <header>
          <div>
            <p className="overline">OpenMouse</p>
            <h2 id="artreq-dialog-title">{t(locale, "artreq.title")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>

        <p className="feedback-description">{t(locale, "artreq.description")}</p>

        <div className="artreq-device">
          <span>{t(locale, "artreq.deviceLabel")}</span>
          <strong>{deviceName || "—"}</strong>
        </div>

        <label className="feedback-handle" htmlFor="artreq-discord">
          <span>{t(locale, "artreq.discordLabel")}</span>
          <input
            id="artreq-discord"
            type="text"
            required
            placeholder={t(locale, "artreq.discordPlaceholder")}
            value={discordUsername}
            onChange={(event) => { setDiscordUsername(event.currentTarget.value); setDiscordError(false); }}
          />
        </label>
        {discordError ? (
          <p className="feedback-error" role="alert">
            {t(locale, "artreq.discordRequired")}
          </p>
        ) : null}

        <div
          className={`artreq-dropzone${file ? " has-file" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={t(locale, "artreq.drop")}
          onClick={() => { inputRef.current?.click(); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer?.files?.[0];
            if (dropped) acceptFile(dropped);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".png,.webp,image/png,image/webp"
            hidden
            onChange={(event) => { acceptFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
          />
          {previewUrl ? (
            <img className="artreq-preview" src={previewUrl} alt="" />
          ) : (
            <span className="artreq-drop-empty">{t(locale, "artreq.drop")}</span>
          )}
        </div>
        <p className="artreq-hint">{t(locale, "artreq.hint")}</p>
        <p className="artreq-hint">{t(locale, "artreq.screened")}</p>

        {fileError ? (
          <p className="feedback-error" role="alert">
            {fileError}
          </p>
        ) : null}

        <label className="feedback-handle" htmlFor="artreq-note">
          <span>{t(locale, "artreq.noteLabel")}</span>
          <textarea
            id="artreq-note"
            className="artreq-note"
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            placeholder={t(locale, "artreq.notePlaceholder")}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>

        {rejectReason ? (
          <p className="feedback-error" role="alert">
            {t(locale, REJECT_KEYS[rejectReason] ?? "artreq.rejected")}
          </p>
        ) : error ? (
          <p className="feedback-error" role="alert">
            {t(locale, "artreq.error")} {t(locale, "artreq.errorDetail")}
          </p>
        ) : null}

        <div className="feedback-actions">
          <button type="button" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button type="submit" className="is-primary" disabled={!file || !discordUsername.trim() || busy}>
            {busy ? "…" : t(locale, "artreq.send")}
          </button>
        </div>
      </form>
    </dialog>
  );
}