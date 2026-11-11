interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  pastCount: number;
}

// Past requests are hidden by default but stay one click away.
export function ShowPastToggle({ checked, onChange, pastCount }: Props) {
  if (pastCount === 0) return null;
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-lg border text-[13px] px-3 py-[7px] bg-surface cursor-pointer select-none transition-colors ${
        checked ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-hairline-strong text-ink-2'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary-600" />
      Show past ({pastCount})
    </label>
  );
}
