import { useId } from 'react';
import { Label } from '@renderer/components/ui/label';

interface FormFieldProps {
  readonly label: string;
  /** Validation message shown below the field; `undefined` while the value is valid. */
  readonly error?: string | undefined;
  /** Renders the input; receives the id that connects it with the label. */
  readonly children: (id: string) => React.ReactNode;
}

/** Label, input and optional validation message of one form field. */
export function FormField(props: FormFieldProps): React.JSX.Element {
  const { label, error, children } = props;
  const id = useId();

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
