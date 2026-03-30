import React from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// Fallback component (functional — required to use hooks)
// ---------------------------------------------------------------------------

interface PanelErrorFallbackProps {
  /** Panel label shown in the error message. */
  label: string;
  /** Called when the user presses `r` to reset the boundary. */
  onReset: () => void;
}

/**
 * Rendered by {@link ErrorBoundary} when the wrapped panel throws.
 *
 * Pressing `r` calls `onReset`, clearing the stored error and re-mounting
 * the original panel children.
 */
const PanelErrorFallback: React.FC<PanelErrorFallbackProps> = ({ label, onReset }) => {
  useInput((input) => {
    if (input === 'r') onReset();
  });

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      <Text color="red" bold>
        [{label} Error — press r to reload]
      </Text>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// ErrorBoundary class component
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  /** Short label for the panel (shown in the error message). */
  label: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Ink-compatible React error boundary.
 *
 * Wraps a TUI panel so that a render-time exception shows a recovery prompt
 * (`[Panel Error — press r to reload]`) instead of crashing the entire TUI.
 *
 * ### Usage
 * ```tsx
 * <ErrorBoundary label="Tasks">
 *   <TasksPanel ... />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <PanelErrorFallback
          label={this.props.label}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
