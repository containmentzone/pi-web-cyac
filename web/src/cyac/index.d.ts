// CyAc components — types as documentation. Global: window.CyAc. Requires React 18.

/** Action trigger. Label text is set in ModeNine caps automatically. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = acid fill (one per view); secondary = outlined (default); ghost = no border; danger = pulse fill. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** 's' tightens padding for toolbars and table rows; 'xs' is for StatusBar. */
  size?: 'm' | 's' | 'xs';
  /** Optional mono marking shown before the label, e.g. "F1" or "04". */
  code?: string;
  children: React.ReactNode;
}

/** Labelled single-line text input with hint and error. */
export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field name, rendered as a mono caps marking. Required. */
  label: string;
  /** Optional right-aligned marking: a unit, ID or constraint ("MAX 32"). */
  code?: string;
  /** Help text under the input, in Inter. */
  hint?: string;
  /** Error message. Turns the field to alert state and is prefixed "ALERT /". */
  error?: string;
  /** Render a textarea instead of an input. */
  multiline?: boolean;
  /** Textarea rows when multiline. Default 4. */
  rows?: number;
}

export interface TabItem { value: string; label: string; }
/** Horizontal tab list (role=tablist) with arrow-key navigation. Renders tabs only; the consumer renders the panel. */
export interface TabsProps {
  items: TabItem[];
  /** Controlled value. Omit to let Tabs manage selection from defaultValue. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Show zero-padded index numbers before labels. Default true. */
  indexed?: boolean;
  /** Accessible name for the tab list. */
  label?: string;
}

/** Content container: surface ground, ModeNine title, mono marking code. */
export interface PanelProps {
  title?: string;
  /** Marking in the header's right corner, e.g. "SEC-04 / LOWER". */
  code?: string;
  /** Replace the box border with corner crop brackets. */
  bracketed?: boolean;
  /** Acid leading edge: the one selected/active panel in a group. */
  active?: boolean;
  children?: React.ReactNode;
}

/** Short status marking. Non-neutral tones default to a word so state never relies on colour alone. */
export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'alert' | 'caution' | 'info';
  /** Leading status dot (the one radius-pill use besides the loader). */
  dot?: boolean;
  /** Text; defaults to ALERT / CAUTION / INFO for those tones. */
  children?: React.ReactNode;
}

/** Labelled numeric readout in tabular mono. */
export interface ReadoutProps {
  label: string;
  /** Pre-formatted, zero-padded value: "0412.88", "00:14:32". */
  value: string;
  unit?: string;
  /** Signed change, e.g. "+12" or "-3.5%". Up = acid-text, down = pulse-text, plus an arrow glyph. */
  delta?: string;
}

/** Capsule loader: three stepping acid pills plus a tracked caption. role=status. */
export interface LoaderProps {
  /** Caption; default "Syncing". Pass "" to hide (then give the surrounding region an accessible name). */
  label?: string;
}

/** One turn in a conversation. Assistant name is marked in brand-text; user turns sit in a surface box. */
export interface MessageProps {
  role?: 'user' | 'assistant';
  /** Display name; defaults to "You" / "CyAc". Rendered as a mono caps marking. */
  name?: string;
  /** Timestamp text, e.g. "14:02". */
  time?: string;
  /** Extra marking, e.g. a model or run ID. */
  meta?: string;
  /** Rendered markdown: paragraphs, lists, inline <code>, links, and CodeBlock / ToolCall / Thinking children. */
  children: React.ReactNode;
}

/** Collapsible reasoning trace (<details>). Closed by default; dashed border marks it as secondary. */
export interface ThinkingProps {
  /** While true, label reads "Thinking" with stepping pills; otherwise "Thought". */
  streaming?: boolean;
  /** Elapsed time marking, e.g. "12S". */
  duration?: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}

/** One tool invocation: name, one-line summary, status word, expandable input/output. */
export interface ToolCallProps {
  /** Tool identifier, shown as-is in mono (not uppercased). */
  name: string;
  /** One-line human summary of the arguments, e.g. a path or query. Truncates. */
  summary?: string;
  status?: 'running' | 'ok' | 'error';
  duration?: string;
  /** Arguments; objects are pretty-printed as JSON. */
  input?: unknown;
  /** Result or error text; objects are pretty-printed as JSON. */
  output?: unknown;
  defaultOpen?: boolean;
}

/** Fenced code with language label, optional filename, copy button and light built-in highlighting. */
export interface CodeBlockProps {
  code: string;
  /** Language label; also picks comment syntax for the highlighter. "text" disables highlighting. */
  language?: string;
  filename?: string;
  /** Default: on when the block has more than 3 lines. */
  lineNumbers?: boolean;
  /** 1-based line numbers to mark with an acid-text leading edge. */
  highlightLines?: number[];
  /** Default true. */
  copyable?: boolean;
}

/** Chat input: auto-growing textarea, tool slot, send/stop. Enter sends, Shift+Enter adds a line. */
export interface ComposerProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Called with the text on Enter or Send. Uncontrolled composers clear themselves afterwards. */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Accessible name; default "Message". */
  label?: string;
  /** Left side of the bottom bar: attach buttons, a model Menu, etc. */
  tools?: React.ReactNode;
  /** While a reply is generating: shows Stop instead of Send. */
  busy?: boolean;
  onStop?: () => void;
  /** Shows a character counter in place of the key hint; over the limit blocks sending. */
  maxLength?: number;
  submitLabel?: string;
  disabled?: boolean;
}

/** One status-bar reading: label, optional meter bar, value. */
export interface MetricProps {
  label: string;
  value: string;
  /** 0–100; draws a 48px meter between label and value. */
  percent?: number;
  tone?: 'accent' | 'alert' | 'caution';
}

/** Thin bar of segments split by hairlines; left and right groups. Left segments that don't fit collapse into a "+N" popover. */
export interface StatusBarProps {
  /** Readings, in priority order: when space runs out, segments drop from the END into a "+N" overflow popover. */
  left?: React.ReactNode[];
  /** Controls. Never collapse; keep them few. */
  right?: React.ReactNode[];
  label?: string;
  /** Where the "+N" popover opens: 'top' (default, for bars at the bottom of a view) or 'bottom'. */
  overflowPlacement?: 'top' | 'bottom';
}

export interface MenuItem { value?: string; label?: string; code?: string; danger?: boolean; disabled?: boolean; divider?: boolean; }
/** Button-triggered dropdown (role=menu). Pass value to make it a single-choice picker with a check mark. */
export interface MenuProps {
  items: MenuItem[];
  /** Trigger text. Defaults to the selected item's label when value is set. */
  label?: string;
  value?: string;
  onSelect?: (value: string) => void;
  /** Open upward (status bars, composers at the bottom of the screen). */
  placement?: 'bottom' | 'top';
  align?: 'left' | 'right';
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'm' | 's' | 'xs';
  code?: string;
  defaultOpen?: boolean;
}

/** Joins inputs, addons, buttons and menus edge to edge into one control. */
export interface InputGroupProps { label?: string; children: React.ReactNode; }
/** Bare input with the Field frame and no label; for use inside InputGroup (label the group or use aria-label). */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
/** Static mono prefix/suffix inside an InputGroup: units, protocols, currency. */
export interface AddonProps { children: React.ReactNode; }

/** Flips a region to an acid ground with black ink by remapping colour tokens locally. One hero moment per screen. */
export interface AcidGroundProps { as?: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode; }
/** Stacked heavy rules; with notch the middle third of each bar drops half a pitch. Decorative. */
export interface RuleStackProps { bars?: number; thickness?: number; gap?: number; notch?: boolean; }
/** Four plus-shaped corner marks around a focal element. Decorative frame. */
export interface RegistrationProps { inset?: string | number; children?: React.ReactNode; }
/** Ruler tick strip with optional heavy blocks. Decorative. */
export interface TickStripProps { count?: number; height?: number; heavy?: number[]; }
export interface SequenceLine { label: string; status?: 'ok' | 'fail' | 'wait' | null; value?: string; sub?: boolean; }
/** Terminal-style LABEL . . . STATUS log with tag and footer. */
export interface SequenceLogProps { lines: SequenceLine[]; tag?: string; footer?: string; }
/** Colon-coded ModeNine header with boxed chips. */
export interface SlugProps { segments: string[]; chips?: (string | { text: string; solid?: boolean })[]; }
