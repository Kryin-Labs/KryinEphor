import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}

const EmptyState: React.FC<Props> = ({ icon: Icon, title, description, action, className }) => (
    <div className={`py-12 text-center px-6 ${className ?? ''}`}>
        <Icon className="w-10 h-10 mx-auto text-stone-300 mb-3" />
        <p className="text-sm font-semibold text-stone-700">{title}</p>
        {description && <p className="text-xs text-muted mt-1 max-w-sm mx-auto">{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
);

export default EmptyState;
