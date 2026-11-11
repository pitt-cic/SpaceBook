interface ToggleGroupOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  options: ToggleGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // Names the group for screen readers (e.g. "Calendar view").
  label: string;
}

// Segmented control. Each segment is a toggle button whose aria-pressed state
// tells screen readers which option is selected — the white "raised" segment
// is otherwise a visual-only cue.
export function ToggleGroup<T extends string>({ options, value, onChange, label }: ToggleGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === option.value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
