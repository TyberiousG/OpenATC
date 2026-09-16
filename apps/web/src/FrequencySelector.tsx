import type { PositionDTO } from "@openatc/shared";

interface Props {
  positions: PositionDTO[];
  active: string;
  onChange: (id: string) => void;
}

/**
 * Lets the controller choose which position/frequency they are working
 * (Approach / Tower / Ground). The active position drives ownership on the
 * scope — traffic on other frequencies is dimmed.
 */
export function FrequencySelector({ positions, active, onChange }: Props) {
  const activePos = positions.find((p) => p.id === active);
  return (
    <div className="freq-selector" role="group" aria-label="Frequency selector">
      {positions.map((p) => (
        <button
          key={p.id}
          type="button"
          className={p.id === active ? "freq active" : "freq"}
          onClick={() => onChange(p.id)}
          title={`${p.label} — ${p.frequency}`}
        >
          {p.id}
        </button>
      ))}
      {activePos && (
        <span className="freq-readout">
          {activePos.label} <b>{activePos.frequency}</b>
        </span>
      )}
    </div>
  );
}
