import { useEffect, useRef } from "react";
import { Button, Panel } from "../cyac";
import { THEMES, setTheme, useTheme } from "../theme";
import { pad } from "./format";

function ThemePicker() {
  const theme = useTheme();
  return (
    <fieldset className="settings__group">
      <legend className="settings__label">
        <span>Theme</span>
        <span>{pad(THEMES.length)}</span>
      </legend>
      <div className="theme-choices" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <label key={t.value} className={`theme-choice${theme === t.value ? " theme-choice--on" : ""}`}>
            <input
              type="radio"
              name="theme"
              value={t.value}
              checked={theme === t.value}
              onChange={() => setTheme(t.value)}
            />
            <span className={`theme-choice__swatch theme-choice__swatch--${t.value}`} aria-hidden="true">
              <span />
            </span>
            <span className="theme-choice__text">
              <span className="theme-choice__name">{t.label}</span>
              <span className="theme-choice__hint">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** App settings in a native modal dialog (focus trap, Esc to close, backdrop click closes). */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label="Settings"
      onClose={onClose}
      // Mouse down, not click: a press that starts inside the panel and ends on the
      // backdrop (e.g. selecting text) must not close the dialog.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <Panel title="Settings" code="SYS / CFG" className="settings__panel">
          <ThemePicker />
          <div className="settings__actions">
            <Button size="s" onClick={onClose} autoFocus>
              Done
            </Button>
          </div>
        </Panel>
      )}
    </dialog>
  );
}
