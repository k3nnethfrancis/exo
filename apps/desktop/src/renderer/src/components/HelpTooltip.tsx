import { HelpCircle } from "lucide-react";

export function HelpTooltip({ label }: { label: string }) {
  return (
    <span aria-label={label} className="help-tooltip" data-tooltip={label} tabIndex={0}>
      <HelpCircle size={14} />
    </span>
  );
}
