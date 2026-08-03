import { cardArtRequirementText, type Card } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'

export function CardArtSection({
  draft,
  artFileName,
  artPreviewUrl,
  artUploading,
  onUploadArt,
  onClearArt,
}: {
  draft: Card
  artFileName: string
  artPreviewUrl: string | null
  artUploading: boolean
  onUploadArt: (file: File | null) => void
  onClearArt: () => void
}) {
  return (
    <FormSection title="Artwork" hint="Portrait image shown on the printed card.">
      <Field label="Card Art" className="span-3">
        <div className="art-controls">
          <label className="btn art-file-btn">
            {artUploading ? 'Uploading…' : 'Choose image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={artUploading}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                onUploadArt(file)
                e.target.value = ''
              }}
            />
          </label>
          <button
            type="button"
            className="btn danger"
            disabled={!draft.hasArt && !artPreviewUrl}
            onClick={() => onClearArt()}
          >
            Clear image
          </button>
        </div>
        <p className="art-requirements">{cardArtRequirementText()}</p>
        <p className={artFileName ? 'art-filename' : 'muted'}>
          {artUploading
            ? 'Uploading…'
            : artFileName
              ? `Selected: ${artFileName}`
              : 'No image selected'}
        </p>
      </Field>
    </FormSection>
  )
}
