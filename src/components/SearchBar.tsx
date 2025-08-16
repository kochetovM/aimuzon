import React, { useState } from 'react';

type Props = {
  defaultValue?: string;
  onSubmit: (q: string) => void;
};

export const SearchBar: React.FC<Props> = ({ defaultValue = '', onSubmit }) => {
  const [value, setValue] = useState(defaultValue);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim() || 'AI music');
      }}
      className="w-full flex gap-2"
    >
      <input
        aria-label="Search videos"
        className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Search AI music…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        className="rounded-md bg-blue-600 text-white px-4 py-2 hover:bg-blue-700"
      >
        Search
      </button>
    </form>
  );
};
