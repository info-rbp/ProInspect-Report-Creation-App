import React from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';

export const LoadingState: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading…', className = '' }) => (
  <div role="status" aria-live="polite" className={`rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 ${className}`}>
    <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden="true" />
    {label}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void; className?: string }> = ({ message, onRetry, className = '' }) => (
  <div role="alert" className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 ${className}`}>
    <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{message}</span></div>
    {onRetry && <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 font-semibold underline"><RefreshCw size={14} aria-hidden="true" />Retry</button>}
  </div>
);

export const EmptyState: React.FC<{ title: string; description?: string; action?: React.ReactNode; className?: string }> = ({ title, description, action, className = '' }) => (
  <div className={`rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center ${className}`}>
    <div className="font-semibold text-gray-800">{title}</div>
    {description && <p className="mx-auto mt-1 max-w-2xl text-sm text-gray-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
