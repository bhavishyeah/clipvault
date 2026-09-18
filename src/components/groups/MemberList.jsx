import { IconTrash } from '../ui/Icons'

// VOLT — MemberList (Feature 3: group sharing)
//
// Shows the members of a group with their username / display name and a role
// badge (owner vs member). Member-management controls (add / remove) render
// ONLY when the viewing user is the group owner (Req 12.7). Non-owners see the
// roster read-only. The owner's own row never shows a remove control because
// the owner cannot be removed (they transfer or delete the group instead;
// Req 12.4, 12.6).
//
// The parent (Dashboard wiring, task 18.1) supplies the members array from
// useGroups.members(groupId) and the onAddMember / onRemoveMember handlers.
// The add flow itself (searching for an app user) lives in the parent — this
// component only surfaces the "Add member" trigger when permitted.

// Resolve a stable label for a member: prefer display name, then @username,
// then a short form of the user id so a member is never rendered blank.
function memberLabel(member) {
  if (member.display_name) return member.display_name
  if (member.username) return `@${member.username}`
  return 'Unknown member'
}

export default function MemberList({
  group,
  members = [],
  currentUserId,
  onAddMember,
  onRemoveMember,
}) {
  // The viewer is the owner when the group's owner_id matches them, or when the
  // hook has already resolved the isOwner flag. Either signal grants controls.
  const isOwner =
    Boolean(group) &&
    (group.isOwner === true || group.owner_id === currentUserId)

  return (
    <section className="member-list" aria-label="Group members">
      <div className="member-list-header">
        <h4 className="member-list-title">
          Members
          <span className="member-list-count">{members.length}</span>
        </h4>
        {isOwner && onAddMember && (
          <button
            type="button"
            className="member-add-btn"
            onClick={() => onAddMember(group)}
            aria-label="Add member to group"
          >
            + Add member
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="member-empty">No members yet.</p>
      ) : (
        <ul className="member-roster">
          {members.map((member) => {
            const owner = member.role === 'owner'
            // A remove control shows only for the owner viewer, and never for
            // the owner's row (the owner cannot be removed).
            const canRemove = isOwner && !owner && onRemoveMember
            const label = memberLabel(member)

            return (
              <li key={member.user_id} className="member-row">
                <div className="member-identity">
                  <span className="member-name">{label}</span>
                  {member.username && member.display_name && (
                    <span className="member-username">@{member.username}</span>
                  )}
                </div>

                <span
                  className="member-role-badge"
                  data-role={owner ? 'owner' : 'member'}
                >
                  {owner ? 'Owner' : 'Member'}
                </span>

                {canRemove && (
                  <button
                    type="button"
                    className="member-remove-btn"
                    onClick={() => onRemoveMember(group, member.user_id)}
                    aria-label={`Remove ${label} from group`}
                  >
                    <IconTrash />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
