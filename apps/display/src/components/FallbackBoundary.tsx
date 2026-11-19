import { Component, type ReactNode } from "react";

/**
 * Draws `children`, and `fallback` if they throw while rendering. Used for a themed alert: if dressing it ever fails, the
 * default alert is drawn instead, never a blank screen. React keeps the error state until the boundary is remounted, so
 * give it a `key` that changes with the alert.
 */
export class FallbackBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    console.error("themed alert failed, showing the default alert:", error.message);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
