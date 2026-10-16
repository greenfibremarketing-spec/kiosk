"use client";
import React from "react";
import { trace } from "@/lib/debugTrace";

/**
 * Diagnostic ErrorBoundary:
 * Renders children without altering UI/behavior.
 * Catches errors, traces them with component stack, and keeps rendering children.
 */
export default class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    trace("errorboundary", {
      name: this.props.name || "unnamed",
      message: error?.message || String(error),
      stack: error?.stack || null,
      componentStack: errorInfo?.componentStack || null,
    });
  }

  render() {
    return this.props.children;
  }
}
