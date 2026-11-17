// Typed access to the vendored CyAc bundle (window.CyAc). Types come from the design system's
// own index.d.ts, copied unchanged next to the bundle.
import type { ComponentType } from "react";
import "./globals";
import "./cyac/bundle.js";
import type * as T from "./cyac/index";

type WithClass<P> = P & { className?: string };

export interface CyAcComponents {
  Button: ComponentType<T.ButtonProps>;
  Field: ComponentType<T.FieldProps>;
  Tabs: ComponentType<T.TabsProps>;
  Panel: ComponentType<WithClass<T.PanelProps>>;
  Badge: ComponentType<WithClass<T.BadgeProps>>;
  Readout: ComponentType<T.ReadoutProps>;
  Loader: ComponentType<T.LoaderProps>;
  Message: ComponentType<WithClass<T.MessageProps>>;
  Thinking: ComponentType<WithClass<T.ThinkingProps>>;
  ToolCall: ComponentType<WithClass<T.ToolCallProps>>;
  CodeBlock: ComponentType<T.CodeBlockProps>;
  Composer: ComponentType<WithClass<T.ComposerProps>>;
  StatusBar: ComponentType<T.StatusBarProps>;
  Metric: ComponentType<T.MetricProps>;
  Menu: ComponentType<T.MenuProps>;
  InputGroup: ComponentType<T.InputGroupProps>;
  Input: ComponentType<T.InputProps>;
  Addon: ComponentType<T.AddonProps>;
  Slug: ComponentType<T.SlugProps>;
  TickStrip: ComponentType<T.TickStripProps>;
}

const CyAc = window.CyAc as CyAcComponents;

export const {
  Button,
  Field,
  Panel,
  Badge,
  Loader,
  Message,
  Thinking,
  ToolCall,
  CodeBlock,
  Composer,
  StatusBar,
  Metric,
  Menu,
  InputGroup,
  Input,
  Slug,
  TickStrip,
} = CyAc;
