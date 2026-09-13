import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const MAX_ART_SIZE = 5 * 1024 * 1024;
const MAX_NOTE_LENGTH = 600;
const ACCEPTED_TYPES = ["image/png", "image/webp"] as const;
const FEEDBACK_URL = "/api/feedback";

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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
    setNote("");
    setError(false);
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
    if (!file || busy) return;
    setBusy(true);
    setError(false);
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
              fields: [{ name: "Device", value: `**${deviceName}**`, inline: false }],
              attachments: [{ id: "0", description: `Artwork request for ${deviceName}`, filename }],
            },
          ],
        }),
      );
      form.append("files[0]", file, filename);
      const response = await fetch(FEEDBACK_URL, { method: "POST", body: form });
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

        {error ? (
          <p className="feedback-error" role="alert">
            {t(locale, "artreq.error")} {t(locale, "artreq.errorDetail")}
          </p>
        ) : null}

        <div className="feedback-actions">
          <button type="button" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button type="submit" className="is-primary" disabled={!file || busy}>
            {busy ? "…" : t(locale, "artreq.send")}
          </button>
        </div>
      </form>
    </dialog>
  );
}