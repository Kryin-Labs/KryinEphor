import React from 'react';
import NotFound from '../pages/NotFound';

interface State { hasError: boolean; message?: string }

/**
 * Top-level error boundary. Catches runtime errors anywhere below it —
 * including the "useAuth must be used within an AuthProvider" throw — and
 * renders the NotFound fallback instead of a blank screen. Logs full
 * details to the console for developers.
 */
export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, message: error.message };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
         
        console.error('[AppErrorBoundary] Uncaught error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <NotFound
                    variant="unauthorized"
                    message="Something went wrong while loading this page. Try going back to the home page."
                />
            );
        }
        return this.props.children;
    }
}
