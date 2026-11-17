// CyAc ships as a global script bundle that reads React from window. This module must be
// imported before ./cyac/bundle.js so the bundle finds it.
import * as React from "react";
import * as ReactDOM from "react-dom";

declare global {
  interface Window {
    React: typeof React;
    ReactDOM: typeof ReactDOM;
    CyAc: unknown;
  }
}

window.React = React;
window.ReactDOM = ReactDOM;
