import { useEffect, useState } from 'react';
import type { ParticipantGroupState } from '../shared/types';
import { MAX_GROUP_NAME } from '../shared/participantGroups';
import type { Dict } from '../shared/i18n';
import { api } from './api';
import { ipcMessage } from './hooks';

interface Props {
  state: ParticipantGroupState;
  emails: string[];
  hasDraft: boolean;
  onApply: (emails: string[]) => void;
  t: Dict;
}

export function ParticipantGroups({ state, emails, hasDraft, onApply, t }: Props) {
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const group = state.groups.find(g => g.id === selected);

  useEffect(() => {
    if (selected && !state.groups.some(g => g.id === selected)) {
      setSelected('');
      setEditing(false);
      setConfirmDelete(false);
    }
    // A snapshot from another window may remove the selected group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groups]);

  function begin(id?: string) {
    setEditId(id);
    setName(id ? group?.name ?? '' : '');
    setEditing(true);
    setConfirmDelete(false);
    setError(null);
    setMessage('');
  }

  async function save() {
    if (busy || !emails.length || hasDraft || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveParticipantGroup(state.account, { id: editId, name, emails });
      setSelected(saved.id);
      setEditing(false);
      setMessage(t.groupSaved(saved.name));
    } catch (e) { setError(ipcMessage(e)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteParticipantGroup(state.account, group.id);
      setSelected('');
      setConfirmDelete(false);
      setMessage(t.groupDeleted);
    } catch (e) { setError(ipcMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="av-groups" aria-label={t.groupsTitle}>
      <div className="av-groups-row">
        <label htmlFor="participant-group">{t.groupsTitle}</label>
        <select id="participant-group" className="field av-group-select" value={selected} disabled={busy || hasDraft} onChange={e => {
          const chosen = state.groups.find(g => g.id === e.target.value);
          setSelected(e.target.value);
          setEditing(false);
          setConfirmDelete(false);
          setError(null);
          setMessage('');
          if (chosen) onApply([...chosen.emails]);
        }}>
          <option value="">{state.groups.length ? t.groupChoose : t.groupsEmpty}</option>
          {state.groups.map(g => <option key={g.id} value={g.id}>{g.name} · {g.emails.length}</option>)}
        </select>
        <button className="btn compact" disabled={busy || !emails.length || hasDraft} onClick={() => begin()}>{t.groupSaveNew}</button>
        {group && <>
          <button className="btn compact" disabled={busy || !emails.length || hasDraft} onClick={() => begin(group.id)}>{t.groupEdit}</button>
          <button className="btn compact" disabled={busy} onClick={() => { setConfirmDelete(true); setEditing(false); setError(null); setMessage(''); }}>{t.groupDelete}</button>
        </>}
      </div>
      <div className="hint av-group-hint">{hasDraft ? t.groupFinishDraft : t.groupsHint}</div>
      {editing && <form className="av-group-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label htmlFor="participant-group-name">{t.groupName}</label>
        <input autoFocus id="participant-group-name" className="field" placeholder={t.groupNamePlaceholder} value={name} maxLength={MAX_GROUP_NAME} disabled={busy} onChange={e => setName(e.target.value)} onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); }
        }} />
        <span className="hint">{t.groupMembers(emails.length)}</span>
        <button className="btn primary compact" disabled={busy || !name.trim() || !emails.length || hasDraft} type="submit">{editId ? t.groupSaveChanges : t.groupSave}</button>
        <button className="btn compact" disabled={busy} type="button" onClick={() => setEditing(false)}>{t.groupCancel}</button>
      </form>}
      {confirmDelete && group && <div className="av-group-delete" role="group" aria-label={t.groupDelete}>
        <span>{t.groupDeleteConfirm(group.name)}</span>
        <button className="btn danger compact" disabled={busy} onClick={() => void remove()}>{t.groupDelete}</button>
        <button className="btn compact" disabled={busy} onClick={() => setConfirmDelete(false)}>{t.groupCancel}</button>
      </div>}
      {error && <div className="field-error" role="alert">{error}</div>}
      <div className="av-group-status hint" role="status">{message}</div>
    </section>
  );
}
