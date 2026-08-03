import { Field } from './Field'

export function TagsField({
  tags,
  onChange,
  className,
  placeholder,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  className?: string
  placeholder?: string
}) {
  return (
    <Field label="Tags" className={className}>
      <input
        value={tags.join(', ')}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          )
        }
      />
    </Field>
  )
}
