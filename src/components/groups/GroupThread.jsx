import { useEffect } from 'react'
import FileCard from '../ui/FileCard'

// VOLT — Group message thread (Feature 3: group sharing)
//
// Renders the message list for a single group and subscribes to that group's
// Realtime channel so new messages appear live (Req 14.2). Each message is
// rendered by Clip_Type (Req 14.3):
//   - `image`         -> an <img> thumbnail (src = file_url)
//   - `file` / `audio`-> a <FileCard kind name size url /> (download control)
//   - `text` / `link` -> the message text; `link` as an anchor
//
// Own messages are visually distinguished from others' via a className derived
// from `sender_id === currentUserId`. The list is semantic (<ul>/<li>) and
// images carry alt text for accessibility.
//
// Props are intentionally simple so Dashboard wiring (task 18.1) can pass the
// data straight from useGroups (messagesByGroup[group.id], subscribeGroup).

// A minimal URL check so `link` messages only become anchors for real URLs.
function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function GroupMessage({ message, isOwn }) {
  const { type, content, file_url, file_name, file_size } = message

  return (
    <li className={`group-thread-message ${isOwn ? 'is-own' : 'is-other'}`}>
      {type === 'image' && file_url ? (
        <div className="group-thread-image-wrap">
          <img src={file_url} alt={file_name || 'Shared image'} loading="lazy" />
        </div>
      ) : type === 'file' || type === 'audio' ? (
        <FileCard kind={type} name={file_name} size={file_size} url={file_url} />
      ) : type === 'link' && isUrl(content) ? (
        <a
          className="group-thread-link"
          href={content}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      ) : (
        <p className="group-thread-text">{content}</p>
      )}
    </li>
  )
}

export default function GroupThread({ group, messages = [], currentUserId, onSubscribe }) {
  const groupId = group?.id

  // Subscribe on mount / when the group changes; clean up on unmount (Req 14.2).
  useEffect(() => {
    if (!groupId || typeof onSubscribe !== 'function') return undefined
    const unsubscribe = onSubscribe(groupId)
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [groupId, onSubscribe])

  if (messages.length === 0) {
    return (
      <div className="group-thread">
        <p className="group-thread-empty">No messages yet.</p>
      </div>
    )
  }

  return (
    <div className="group-thread">
      <ul className="group-thread-list">
        {messages.map((message) => (
          <GroupMessage
            key={message.id}
            message={message}
            isOwn={message.sender_id === currentUserId}
          />
        ))}
      </ul>
    </div>
  )
}
