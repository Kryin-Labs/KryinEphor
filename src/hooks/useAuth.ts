import { useContext } from 'react';
import { AuthContext } from '../context/authContextValue';

/**
 * Access the auth context. Throws a clear, actionable error if the calling
 * component is not wrapped in <AuthProvider>. The thrown error is caught by
 * <AppErrorBoundary> in App.tsx, which renders a friendly fallback UI
 * instead of a blank white screen.
 */
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        // Log for devtools so the cause is visible even after the boundary
        // swaps in the fallback UI.
         
        console.error(
            '[useAuth] AuthProvider is missing in the component tree. ' +
            'Ensure <AuthProvider> wraps your <Router> in src/App.tsx.'
        );
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
