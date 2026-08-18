interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  className?: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
}

export default function Dropdown({ className = "", ariaLabel, value, onChange, options }: DropdownProps) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-lol-darkBg border border-lol-border rounded px-3 py-2 text-white text-xs uppercase font-bold focus:border-lol-gold outline-none ${className}`.trim()}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
