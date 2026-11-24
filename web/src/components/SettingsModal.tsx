import { useEffect, useRef } from "react";
import { Button, Menu, Panel } from "../cyac";
import { send } from "../socket";
import { useStore } from "../store";
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

/** pi's default model: what new threads start with. Stored in pi's global settings, like /model in the TUI. */
function DefaultModelPicker() {
  const models = useStore((s) => s.models);
  const current = useStore((s) => s.defaultModel);
  const items = models.map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name || m.id, code: m.provider }));
  const value = current ? `${current.provider}/${current.id}` : undefined;
  // A default without credentials any more still shows, so the picker doesn't look unset.
  if (current && !items.some((i) => i.value === value)) items.unshift({ value: value!, label: current.id, code: current.provider });
  return (
    <fieldset className="settings__group">
      <legend className="settings__label">
        <span>Default model</span>
        <span>{pad(models.length)}</span>
      </legend>
      {items.length > 0 ? (
        <Menu
          size="s"
          variant="secondary"
          value={value}
          label={current ? undefined : "Not set"}
          items={items}
          onSelect={(v) => {
            const [provider, ...rest] = v.split("/");
            send({ type: "set_default_model", provider: provider!, modelId: rest.join("/") });
          }}
        />
      ) : (
        <p className="settings__hint">No models with credentials. Use /login in a thread first.</p>
      )}
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
          <DefaultModelPicker />
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
