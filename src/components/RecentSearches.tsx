import React, { useEffect, useState } from 'react';
import { fetchRecentSearches } from '../api';
import { useToast } from './ToastProvider';

export const RecentSearches: React.FC<{ onPick: (q: string) => void }> = ({ onPick }) => {
  const [items, setItems] = useState<{ q: string; at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { error: notifyError } = useToast();

  useEffect(() => {
    fetchRecentSearches()
      .then(setItems)
      .catch((e) => {
        const msg = e?.message || 'Failed to load recent searches.';
        setError(msg);
        notifyError(msg);
      });
  }, [notifyError]);

  return (
    <div>
      <div className="text-sm font-medium mb-2">Recent searches</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <ul className="space-y-1">
        {items.map((it, idx) => (
          <li key={`${it.q}-${it.at}-${idx}`}>
            <button
              onClick={() => onPick(it.q)}
              className="text-left w-full text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {it.q} <span className="text-text-secondary">· {new Date(it.at).toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
