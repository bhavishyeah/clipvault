import { useState } from 'react'
import { canSendToGroup } from '../../lib/group'

// VOLT — RecipientTabs (Feature 3: group sharing)
//
// Presents send targets in two separately labeled, mutually exclusive tabs:
// "Contacts" (individual Direct_Send recipients) and "Groups" (group
// recipients). The two tabs hold disjoint contents — a contact never appears
// under Groups and a group never appears under Contacts (Req 13.1). Each tab
// panel shows its own empty-state message when it holds zero entries
// (Req 13.2).
//
// Selecting a group surfaces the number of members that will receive the item
// and a "delivers to all N members" indicator (Req 13.3, 13.4). A group with
// zero members is still listed, but it cannot be chosen as a send target: its
// control is disabled and labeled as unable to receive yet, gated by
// canSendToGroup(memberCount) (Req 13.5). The actual send is performed by the
// parent (Dashboard wiring, task 18.1); this component only reports the
// selected recipient through onSelectRecipient.
//
// Props:
//   contacts            array of { id, username, display_name, presence }
//   groups              array of { id, name, memberCount?, ... }
//   selectedRecipient   currently selected target, shape { kind, id, ... } or null
//   onSelectRecipient   (recipient | null) => void — called with the chosen
//                       target ({ kind: 'contact' | 'group', ... }) on select

// Resolve the member count for a group. Groups may carry a `memberCount`
// field; when it is missing/unknown we treat the group as having zero members
// so it is shown but blocked from sending until membership is known (Req 13.5).
function groupMemberCount(group) {
  const n = group?.memberCount
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// A stable label for a contact so a row is never rendered blank.
function contactLabel(contact) {
  if (contact.display_name) return contact.display_name
  if (contact.username) return `@${contact.username}`
  return 'Unknown contact'
}

export default function RecipientTabs({
  contacts = [],
  groups = [],
  selectedRecipient = null,
  onSelectRecipient,
}) {
  const [activeTab, setActiveTab] = useState('contacts')

  const selectContact = (contact) => {
    onSelectRecipient?.({
      kind: 'contact',
      id: contact.id,
      username: contact.username,
      display_name: contact.display_name,
    })
  }

  const selectGroup = (group, memberCount) => {
    // A zero-member group cannot receive a send (Req 13.5); ignore the click.
    if (!canSendToGroup(memberCount)) return
    onSelectRecipient?.({
      kind: 'group',
      id: group.id,
      name: group.name,
      memberCount,
    })
  }

  const isContactSelected = (contact) =>
    selectedRecipient?.kind === 'contact' && selectedRecipient.id === contact.id

  const isGroupSelected = (group) =>
    selectedRecipient?.kind === 'group' && selectedRecipient.id === group.id

  return (
    <div className="recipient-tabs">
      <div className="recipient-tablist" role="tablist" aria-label="Recipient type">
        <button
          type="button"
          role="tab"
          id="recipient-tab-contacts"
          aria-selected={activeTab === 'contacts'}
          aria-controls="recipient-panel-contacts"
          tabIndex={activeTab === 'contacts' ? 0 : -1}
          className="recipient-tab"
          onClick={() => setActiveTab('contacts')}
        >
          Contacts
          <span className="recipient-tab-count">{contacts.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="recipient-tab-groups"
          aria-selected={activeTab === 'groups'}
          aria-controls="recipient-panel-groups"
          tabIndex={activeTab === 'groups' ? 0 : -1}
          className="recipient-tab"
          onClick={() => setActiveTab('groups')}
        >
          Groups
          <span className="recipient-tab-count">{groups.length}</span>
        </button>
      </div>

      {/* Contacts panel — disjoint from Groups (Req 13.1) */}
      <div
        role="tabpanel"
        id="recipient-panel-contacts"
        aria-labelledby="recipient-tab-contacts"
        hidden={activeTab !== 'contacts'}
        className="recipient-panel"
      >
        {contacts.length === 0 ? (
          <p className="recipient-empty">No contacts yet</p>
        ) : (
          <ul className="recipient-list" aria-label="Contacts">
            {contacts.map((contact) => {
              const label = contactLabel(contact)
              const selected = isContactSelected(contact)
              return (
                <li key={contact.id} className="recipient-item">
                  <button
                    type="button"
                    className="recipient-btn"
                    aria-pressed={selected}
                    aria-label={`Send to ${label}`}
                    onClick={() => selectContact(contact)}
                  >
                    <span
                      className="send-status-dot"
                      data-status={contact.presence?.status || 'offline'}
                    />
                    <span className="recipient-name">{label}</span>
                    {contact.username && contact.display_name && (
                      <span className="recipient-sub">@{contact.username}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Groups panel — disjoint from Contacts (Req 13.1) */}
      <div
        role="tabpanel"
        id="recipient-panel-groups"
        aria-labelledby="recipient-tab-groups"
        hidden={activeTab !== 'groups'}
        className="recipient-panel"
      >
        {groups.length === 0 ? (
          <p className="recipient-empty">No groups yet</p>
        ) : (
          <ul className="recipient-list" aria-label="Groups">
            {groups.map((group) => {
              const memberCount = groupMemberCount(group)
              const sendable = canSendToGroup(memberCount)
              const selected = isGroupSelected(group)
              const memberText = `${memberCount} member${memberCount === 1 ? '' : 's'}`
              const ariaLabel = sendable
                ? `Send to group ${group.name}, delivers to all ${memberText}`
                : `Group ${group.name} has no members and cannot receive items yet`

              return (
                <li key={group.id} className="recipient-item">
                  <button
                    type="button"
                    className="recipient-btn recipient-btn-group"
                    aria-pressed={selected}
                    aria-label={ariaLabel}
                    disabled={!sendable}
                    onClick={() => selectGroup(group, memberCount)}
                  >
                    <span className="recipient-name">{group.name}</span>
                    <span className="recipient-sub">{memberText}</span>
                    {!sendable && (
                      <span className="recipient-unsendable">Can’t receive yet</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Selected-group delivery indicator (Req 13.3, 13.4) */}
        {selectedRecipient?.kind === 'group' && (
          <p className="recipient-deliver-note" role="status">
            Delivers to all {selectedRecipient.memberCount}{' '}
            member{selectedRecipient.memberCount === 1 ? '' : 's'} of{' '}
            {selectedRecipient.name}
          </p>
        )}
      </div>
    </div>
  )
}
