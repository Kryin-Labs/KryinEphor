import React from 'react';
import { useLocation } from 'react-router-dom';
import { useSubscriptionGate, isPathAllowedWhenLocked } from '../../hooks/useSubscriptionGate';
import LockedScreen from './LockedScreen';

/**
 * Wraps protected app content. When the tenant is locked, replaces children
 * with the LockedScreen unless the user is on an allow-listed path
 * (login / payment / support / finance).
 */
const SubscriptionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { status, loading } = useSubscriptionGate();
    const location = useLocation();

    if (loading) return <>{children}</>;
    if (status === 'locked' && !isPathAllowedWhenLocked(location.pathname)) {
        return <LockedScreen />;
    }
    if (status === 'archived' && !isPathAllowedWhenLocked(location.pathname)) {
        return <LockedScreen />;
    }
    return <>{children}</>;
};

export default SubscriptionGate;
