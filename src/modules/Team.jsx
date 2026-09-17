import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { SectionHeader, LockBanner, Btn } from '../components/ui';
import Roster from './team/Roster';

const MODULE = moduleByKey('team');

export default function Team() {
  const { canEdit, locks } = useAuth();
  const editable = canEdit('team');
  const locked = !!locks.team;

  return (
    <div>
      <SectionHeader title="Team" subtitle="Workers on the roll and their wage history" icon={MODULE.icon} accent={MODULE.accent}
        action={<Link to="/team/archive"><Btn variant="ghost" icon={Archive}>Archive</Btn></Link>} />
      <LockBanner locked={locked} readOnly={!editable && !locked} />
      <Roster editable={editable && !locked} />
    </div>
  );
}
