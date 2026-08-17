import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export default function SortableClipGrid({ pinnedClips, unpinnedClips, renderClip, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = pinnedClips.findIndex((c) => c.id === active.id)
    const newIndex = pinnedClips.findIndex((c) => c.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(pinnedClips, oldIndex, newIndex)
    onReorder(reordered)
  }

  return (
    <section className="clip-grid">
      {pinnedClips.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedClips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {pinnedClips.map((clip) => (
              <SortableClipCard key={clip.id} clip={clip} renderClip={renderClip} />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {unpinnedClips.map((clip) => renderClip(clip, false))}
    </section>
  )
}

function SortableClipCard({ clip, renderClip }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: clip.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {renderClip(clip, true, listeners)}
    </div>
  )
}
