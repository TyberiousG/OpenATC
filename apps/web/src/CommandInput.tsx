import { forwardRef, type ReactNode } from "react";

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** Slot for the push-to-talk control, rendered to the right of the field. */
  children?: ReactNode;
}

/**
 * Text-based controller input, shared by the keyboard and the voice pipeline:
 * push-to-talk → STT writes into this same field, so there is one command
 * path (typed or spoken) into the server-side parser.
 */
export const CommandInput = forwardRef<HTMLInputElement, Props>(function CommandInput(
  { value, onChange, onSubmit, children },
  ref,
) {
  return (
    <div className="command-input">
      <span className="prompt">▸</span>
      <input
        ref={ref}
        value={value}
        placeholder='Type or hold PTT: "United 421 turn left heading 240, descend and maintain 4000"'
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        autoFocus
        spellCheck={false}
      />
      {children}
    </div>
  );
});
