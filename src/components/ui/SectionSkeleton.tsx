import React from 'react';

interface Props {
    rows?: number;
    height?: number;
    className?: string;
}

const SectionSkeleton: React.FC<Props> = ({ rows = 3, height = 56, className }) => (
    <div className={`space-y-3 animate-pulse ${className ?? ''}`}>
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="rounded-xl bg-stone-100" style={{ height }} />
        ))}
    </div>
);

export default SectionSkeleton;
