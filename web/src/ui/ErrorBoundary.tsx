// Keeps one broken panel from blanking the whole agency view.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { label: string; children: ReactNode; quiet?: boolean; resetKey?: unknown }
interface State { error: Error | null; key: unknown }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new resetKey (e.g. a new snapshot run) clears the error.
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="crash glass" role="alert">
        <strong>{this.props.label} a rencontré une erreur</strong>
        <span className="small muted">{this.state.error.message}</span>
        <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>Réessayer</button>
      </div>
    );
  }
}
